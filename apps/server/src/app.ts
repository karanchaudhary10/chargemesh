import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import {
  billCreateSchema,
  billSubmitPaymentSchema,
  billVerifyPaymentSchema,
  creReportSchema,
  disputeOpenSchema,
  disputeResolveSchema,
  meterCreateSchema,
  meterRegistrationSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  readingSubmissionSchema,
  roomCreateSchema,
  settleSchema,
  tenancyAssignSchema,
  tenancyEndSchema,
  tariffCreateSchema,
  tariffUpdateSchema,
  userWalletCreateSchema,
  userWalletUpdateSchema,
  walletPaymentSchema,
  ensResolveSchema,
  type DashboardData,
  type DashboardSummary,
  type Dispute,
  type IntegrationStatus,
  type Meter,
  type Reading,
  type RenterOverview,
  type Session,
  type Tariff,
  type User
} from "@chargemesh/shared";
import type { Config } from "./config.js";
import type { Repositories } from "./repositories.js";
import type { AuditService } from "./audit.js";
import type { HederaService } from "./hedera.js";
import type { EnsService } from "./ens.js";
import type { RoomService } from "./rooms.js";
import type { ReadingService } from "./readings.js";
import type { SessionService } from "./sessions.js";
import type { CreService } from "./cre.js";
import type { TariffService } from "./tariffs.js";
import type { BillingService } from "./billing.js";
import { AppError } from "./errors.js";
import { getSessionId, requireAuth, requireRole } from "./auth-middleware.js";
import type { AuthService } from "./auth.js";

export interface AppDependencies {
  config: Config;
  repositories: Repositories;
  audit: AuditService;
  hedera: HederaService;
  ens: EnsService;
  rooms: RoomService;
  readings: ReadingService;
  sessions: SessionService;
  cre: CreService;
  tariffs: TariffService;
  billing?: BillingService;
  auth?: AuthService;
}

function actor(req: Request): string {
  const user = (req as Request & { user?: User }).user;
  if (user) return user.id;
  const header = req.header("x-actor");
  return header && header.trim() ? header.trim().slice(0, 120) : "operator";
}

function requestUser(req: Request): User {
  const user = (req as Request & { user?: User }).user;
  if (!user) {
    throw new AppError(401, "unauthorized", "Authentication required");
  }
  return user;
}

async function accessibleRoomIds(user: User, deps: AppDependencies): Promise<string[]> {
  const rooms = await deps.repositories.rooms.list();
  if (user.role === "admin") return rooms.map((room) => room.id);

  if (user.role === "landlord") {
    const ownedProperties = deps.repositories.properties
      ? (await deps.repositories.properties.list()).filter(
          (property) => property.ownerId === user.id
        )
      : [];
    const propertyIds = new Set([
      ...(user.propertyIds ?? []),
      ...ownedProperties.map((property) => property.id)
    ]);
    return rooms
      .filter((room) => room.propertyId && propertyIds.has(room.propertyId))
      .map((room) => room.id);
  }

  if (!deps.repositories.tenancies) return [];
  const now = Date.now();
  return (await deps.repositories.tenancies.findActiveByUser(user.id))
    .filter((tenancy) => {
      const starts = Date.parse(tenancy.startDate);
      const ends = tenancy.endDate ? Date.parse(tenancy.endDate) : Number.POSITIVE_INFINITY;
      return tenancy.status === "active" && starts <= now && ends >= now;
    })
    .map((tenancy) => tenancy.roomId);
}

async function assertRoomAccess(
  req: Request,
  deps: AppDependencies,
  roomId: string
): Promise<void> {
  const allowedRoomIds = await accessibleRoomIds(requestUser(req), deps);
  if (!allowedRoomIds.includes(roomId)) {
    throw new AppError(404, "room_not_found", "Room was not found");
  }
}

async function assertLandlordRoom(
  req: Request,
  deps: AppDependencies,
  roomId: string
): Promise<void> {
  const user = requestUser(req);
  if (user.role === "admin") return;
  const room = await deps.repositories.rooms.findById(roomId);
  if (!room?.propertyId || !deps.repositories.properties) {
    throw new AppError(404, "room_not_found", "Room was not found");
  }
  const property = await deps.repositories.properties.findById(room.propertyId);
  if (!property || property.ownerId !== user.id) {
    throw new AppError(404, "room_not_found", "Room was not found");
  }
}

/** Owner of the room's property, falling back to a room-level owner. */
async function landlordIdForRoom(
  deps: AppDependencies,
  roomId: string
): Promise<string | undefined> {
  const room: any = await deps.repositories.rooms.findById(roomId);
  if (!room) return undefined;
  const property: any = room.propertyId
    ? await deps.repositories.properties?.findById(room.propertyId)
    : null;
  return property?.ownerId ?? room.ownerId;
}

/** Attach the landlord's active receive wallets to a bill for display. */
async function attachReceiveWallets(deps: AppDependencies, bill: any): Promise<any> {
  if (bill?.receiveWallets?.length || !deps.repositories.userWallets) return bill;
  const landlordId = await landlordIdForRoom(deps, bill.roomId);
  if (!landlordId) return bill;
  const wallets = await deps.repositories.userWallets.listByUserId(landlordId);
  const active = wallets.filter((wallet) => wallet.isActive !== false);
  if (active.length > 0) {
    bill.receiveWallets = active;
  }
  return bill;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, "validation_failed", "Request validation failed", result.error.issues);
  }
  return result.data;
}

function limitFrom(request: Request, fallback: number, max: number): number {
  const raw = request.query.limit;
  const value = typeof raw === "string" ? Number(raw) : fallback;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), max));
}

function queryString(request: Request, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pathParam(request: Request, key: string): string {
  const value = request.params[key];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    throw new AppError(400, "validation_failed", `${key} is required`);
  }
  return normalized;
}

function integrationStatus(deps: AppDependencies): IntegrationStatus {
  const hedera = deps.hedera.status();
  return {
    hedera: hedera.hedera,
    hts: hedera.hts,
    ens: { configured: deps.ens.configured },
    cre: { reportTokenRequired: Boolean(deps.config.creReportToken) }
  };
}

function summaryFromData(
  sessions: Session[],
  disputes: Dispute[],
  readings: Reading[]
): DashboardSummary {
  const nonActive = sessions.filter((session) => session.status !== "active");
  return {
    activeSessions: sessions.filter((session) => session.status === "active").length,
    closedSessions: nonActive.length,
    openDisputes: disputes.filter((dispute) => dispute.status === "open").length,
    totalBilledNpr:
      Math.round(
        nonActive.reduce((sum, session) => sum + (session.amountNpr ?? 0), 0) * 100
      ) / 100,
    totalEnergyKwh:
      Math.round(
        nonActive.reduce((sum, session) => sum + (session.energyKwh ?? 0), 0) * 1_000_000
      ) / 1_000_000,
    acceptedReadings: readings.filter((reading) => reading.status === "accepted").length,
    rejectedReadings: readings.filter((reading) => reading.status === "rejected").length,
    quarantinedReadings: readings.filter((reading) => reading.status === "quarantined")
      .length
  };
}

function requireCreToken(deps: AppDependencies) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!deps.config.creReportToken) {
      next(new AppError(503, "cre_token_not_configured", "CRE report token is not configured"));
      return;
    }
    const header = request.header("x-cre-token") ?? "";
    const expected = deps.config.creReportToken;
    const providedBuffer = Buffer.from(header);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      next(new AppError(401, "cre_token_invalid", "A valid CRE report token is required"));
      return;
    }
    next();
  };
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "chargemesh-api", time: new Date().toISOString() });
  });

  app.get("/api/status", async (_request, response) => {
    response.json({
      integrations: integrationStatus(deps),
      storage: {
        mode: "postgres",
        persists: true,
        resetsOnRestart: false,
        database: "postgres",
        schemas: ["identity", "property", "metering", "billing", "audit", "system"]
      },
      policy: {
        staleAfterMs: deps.config.staleAfterMs,
        maxPowerW: deps.config.maxPowerW,
        energyJumpTolerance: deps.config.energyJumpTolerance
      }
    });
  });

  const auth = deps.auth;
  const authRequired = auth
    ? requireAuth(auth)
    : (_req: Request, _res: Response, next: NextFunction) => next();
  app.use("/api", (request, response, next) => {
    const publicRoute =
      request.path === "/health" ||
      request.path === "/status" ||
      request.path.startsWith("/auth/") ||
      (request.method === "POST" && request.path === "/readings") ||
      request.path === "/cre/evidence" ||
      (request.method === "POST" && request.path === "/cre/report");
    if (publicRoute) {
      next();
      return;
    }
    authRequired(request, response, next);
  });
  const operatorOnly = auth
    ? requireRole(auth, ["landlord", "admin"])
    : (_req: Request, _res: Response, next: NextFunction) => next();
  const adminOnly = auth
    ? requireRole(auth, ["admin"])
    : (_req: Request, _res: Response, next: NextFunction) => next();

  app.get("/api/dashboard", async (request, response) => {
    const [rooms, readings, sessions, disputes, creReports, tariff] =
      await Promise.all([
        deps.rooms.listOverviews(),
        deps.repositories.readings.list(),
        deps.sessions.list(),
        deps.sessions.listDisputes(),
        deps.cre.list(),
        deps.tariffs.current()
      ]);
    const user = requestUser(request);
    const allowedRooms = new Set(await accessibleRoomIds(user, deps));
    const visibleRooms = rooms.filter((overview) => allowedRooms.has(overview.room.id));
    const visibleReadings = readings.filter(
      (reading) => reading.roomId && allowedRooms.has(reading.roomId)
    );
    const visibleSessions = sessions.filter((session) => allowedRooms.has(session.roomId));
    const visibleSessionIds = new Set(visibleSessions.map((session) => session.id));
    const billRecords = await Promise.all(
      disputes.map((dispute) =>
        deps.repositories.bills.findById(dispute.billId ?? dispute.sessionId)
      )
    );
    const visibleDisputes = disputes.filter((dispute, index) =>
      visibleSessionIds.has(dispute.sessionId) ||
      Boolean(billRecords[index] && allowedRooms.has(billRecords[index]!.roomId))
    );
    const data: DashboardData = {
      summary: summaryFromData(visibleSessions, visibleDisputes, visibleReadings),
      rooms: visibleRooms,
      recentReadings: visibleReadings
        .sort(
          (a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp)
        )
        .slice(0, 50),
      sessions: visibleSessions.slice(0, 25),
      tariff,
      disputes: visibleDisputes,
      creReports: user.role === "renter" ? [] : creReports.slice(0, 10),
      integrations: integrationStatus(deps)
    };
    response.json(data);
  });

  // One call that gives the renter portal their full picture: tenancy, room,
  // property, meter, readings, rate, bills and questions. Everything is scoped
  // to the signed-in renter's active room assignments.
  app.get("/api/renter/overview", async (request, response) => {
    const user = requestUser(request);
    if (user.role !== "renter") {
      throw new AppError(403, "forbidden", "This view is only available to renter accounts");
    }

    const now = Date.now();
    const allowedRooms = new Set(await accessibleRoomIds(user, deps));
    const activeTenancies = deps.repositories.tenancies
      ? (await deps.repositories.tenancies.findActiveByUser(user.id))
          .filter((tenancy) => {
            const starts = Date.parse(tenancy.startDate);
            const ends = tenancy.endDate ? Date.parse(tenancy.endDate) : Number.POSITIVE_INFINITY;
            return (
              tenancy.status === "active" &&
              allowedRooms.has(tenancy.roomId) &&
              starts <= now &&
              ends >= now
            );
          })
          .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))
      : [];
    const tenancy = activeTenancies[0] ?? null;

    const overview = tenancy
      ? (await deps.rooms.listOverviews()).find((entry) => entry.room.id === tenancy.roomId) ?? null
      : null;
    const room = overview?.room ?? null;
    const property = room?.propertyId
      ? (await deps.repositories.properties?.findById(room.propertyId)) ?? null
      : null;
    const meter =
      overview?.meter ?? (room ? await deps.repositories.meters.findActiveByRoom(room.id) : null);

    const readings = room
      ? (await deps.repositories.readings.list({ roomId: room.id }))
          .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp))
          .slice(0, 200)
      : [];
    const latestReading = overview?.latestReading ?? readings[0];

    const bills = room && deps.billing
      ? await Promise.all(
          (await deps.billing.list({ roomId: room.id }))
            .filter((bill) => bill.status !== "draft")
            .sort((a, b) => Date.parse(b.periodEnd) - Date.parse(a.periodEnd))
            .map((bill) =>
              bill.status === "issued" || bill.status === "payment_pending_verification"
                ? attachReceiveWallets(deps, bill)
                : bill
            )
        )
      : [];
    const billIds = new Set(bills.map((bill) => bill.billId));
    const disputes = (await deps.sessions.listDisputes())
      .filter((dispute) => billIds.has(dispute.billId ?? dispute.sessionId))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    let tariff: Tariff | null = null;
    if (room) {
      try {
        tariff = await deps.tariffs.findApplicable(room.id, new Date(now).toISOString());
      } catch {
        tariff = null;
      }
    }

    const dueOf = (bill: (typeof bills)[number]) =>
      bill.amountDueNpr ?? bill.electricityChargeNpr;
    const unpaid = bills.filter(
      (bill) => bill.status === "issued" || bill.status === "payment_pending_verification"
    );
    const paid = bills.filter((bill) => bill.status === "paid");
    const payloadOf = (reading: Reading | undefined) =>
      (reading?.payload as { cumulativeEnergyKwh?: number; cumulativeKwh?: number } | undefined);
    const totalUnits = payloadOf(latestReading)?.cumulativeEnergyKwh ?? payloadOf(latestReading)?.cumulativeKwh;
    const latestBill = bills[0];
    const unitsSinceLastBill =
      totalUnits !== undefined && latestBill
        ? Math.max(0, totalUnits - latestBill.endingCumulativeKwh)
        : totalUnits;

    const data: RenterOverview = {
      user,
      tenancy,
      room,
      property,
      meter: meter ?? undefined,
      latestReading,
      readings,
      tariff,
      bills,
      disputes,
      summary: {
        dueNpr: unpaid.reduce((sum, bill) => sum + dueOf(bill), 0),
        paidNpr: paid.reduce((sum, bill) => sum + dueOf(bill), 0),
        unpaidCount: unpaid.length,
        paidCount: paid.length,
        openQuestionCount: disputes.filter((dispute) => dispute.status === "open").length,
        totalUnits,
        unitsSinceLastBill,
        currentRateNprPerKwh: tariff ? tariff.rateNprPerKwh ?? tariff.nprPerKwh : undefined,
        latestBillId: latestBill?.billId
      }
    };
    response.json(data);
  });

  app.get("/api/properties", async (request, response) => {
    const user = requestUser(request);
    if (user.role === "renter") {
      response.json({ properties: [] });
      return;
    }
    const properties = await deps.repositories.properties?.list() ?? [];
    response.json({
      properties:
        user.role === "admin"
          ? properties
          : properties.filter((property) => property.ownerId === user.id)
    });
  });

  app.post("/api/properties", operatorOnly, async (request, response) => {
    const input = parse(propertyCreateSchema, request.body);
    if (!deps.repositories.properties) {
      throw new AppError(501, "not_implemented", "Property storage is not configured");
    }
    const now = new Date().toISOString();
    const property = {
      id: `prop_${randomUUID().slice(0, 12)}`,
      name: input.name.trim(),
      address: input.address?.trim(),
      description: input.description?.trim(),
      ownerId: requestUser(request).id,
      defaultRateNprPerKwh: input.defaultRateNprPerKwh,
      billingCycle: input.billingCycle?.trim() || undefined,
      landlordTitle: input.landlordTitle?.trim() || undefined,
      createdAt: now,
      updatedAt: now
    };
    await deps.repositories.transaction(async (tx) => {
      if (!tx.properties) {
        throw new AppError(501, "not_implemented", "Property storage is not configured");
      }
      await tx.properties.save(property);
    });
    response.status(201).json({ property });
  });

  app.patch("/api/properties/:propertyId", operatorOnly, async (request, response) => {
    const input = parse(propertyUpdateSchema, request.body ?? {});
    const propertyId = pathParam(request, "propertyId");
    const user = requestUser(request);
    const property = await deps.repositories.transaction(async (tx) => {
      const existing = await tx.properties?.findById(propertyId);
      if (!existing || (user.role !== "admin" && existing.ownerId !== user.id)) {
        throw new AppError(404, "property_not_found", "Property was not found");
      }
      const updated = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.address !== undefined ? { address: input.address.trim() } : {}),
        ...(input.defaultRateNprPerKwh !== undefined ? { defaultRateNprPerKwh: input.defaultRateNprPerKwh } : {}),
        ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle.trim() } : {}),
        ...(input.landlordTitle !== undefined ? { landlordTitle: input.landlordTitle.trim() } : {}),
        updatedAt: new Date().toISOString()
      };
      await tx.properties!.save(updated);
      return updated;
    });
    response.json({ property });
  });

  app.get("/api/rooms", async (request, response) => {
    const roomIds = new Set(await accessibleRoomIds(requestUser(request), deps));
    response.json({
      rooms: (await deps.rooms.listOverviews()).filter((overview) =>
        roomIds.has(overview.room.id)
      )
    });
  });

  app.get("/api/rooms/:roomId", async (request, response) => {
    const roomId = pathParam(request, "roomId");
    await assertRoomAccess(request, deps, roomId);
    response.json({ room: await deps.rooms.overview(roomId) });
  });

  app.get("/api/rooms/:roomId/readings", async (request, response) => {
    const roomId = pathParam(request, "roomId");
    await assertRoomAccess(request, deps, roomId);
    const readings = (await deps.repositories.readings.list({ roomId }))
      .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp));
    response.json({ readings });
  });

  app.post("/api/rooms", operatorOnly, async (request, response) => {
    const input = parse(roomCreateSchema, request.body);
    if (!input.propertyId) {
      throw new AppError(400, "validation_failed", "propertyId is required");
    }
    const user = requestUser(request);
    if (user.role !== "admin") {
      const property = await deps.repositories.properties?.findById(input.propertyId);
      if (!property || property.ownerId !== user.id) {
        throw new AppError(404, "property_not_found", "Property was not found");
      }
    }
    const room = await deps.rooms.createRoom(input, actor(request));
    response.status(201).json({ room });
  });

  app.get("/api/rooms/:roomId/tenancies", operatorOnly, async (request, response) => {
    const roomId = pathParam(request, "roomId");
    await assertLandlordRoom(request, deps, roomId);
    const tenancies = await deps.repositories.tenancies?.findByRoomId(roomId) ?? [];
    const renters = await Promise.all(
      tenancies.map((tenancy) => deps.auth?.userById(tenancy.userId))
    );
    response.json({
      tenancies: tenancies.map((tenancy, index) => ({
        ...tenancy,
        renter: renters[index]
          ? { id: renters[index]!.id, name: renters[index]!.name, email: renters[index]!.email }
          : null
      }))
    });
  });

  app.post("/api/rooms/:roomId/tenancies", operatorOnly, async (request, response) => {
    const input = parse(tenancyAssignSchema, {
      ...request.body,
      roomId: pathParam(request, "roomId")
    });
    await assertLandlordRoom(request, deps, input.roomId);
    if (!deps.repositories.tenancies) {
      throw new AppError(501, "not_implemented", "Tenancy storage is not configured");
    }
    const renter = await deps.auth?.userByEmail(input.email);
    if (!renter || renter.role !== "renter") {
      throw new AppError(404, "renter_not_found", "Register this renter account before assigning the room");
    }
    if (await deps.repositories.tenancies.findActiveByRoom(input.roomId)) {
      throw new AppError(409, "room_occupied", "Room already has an active renter");
    }
    const now = new Date().toISOString();
    const tenancy = {
      tenancyId: `ten_${randomUUID().slice(0, 12)}`,
      roomId: input.roomId,
      userId: renter.id,
      role: "renter" as const,
      startDate: input.startDate ?? now,
      endDate: null,
      status: "active" as const,
      createdAt: now,
      updatedAt: now
    };
    await deps.repositories.transaction(async (tx) => {
      if (!tx.tenancies) {
        throw new AppError(501, "not_implemented", "Tenancy storage is not configured");
      }
      await tx.tenancies.save(tenancy);
    });
    response.status(201).json({ tenancy, renter: { id: renter.id, name: renter.name, email: renter.email } });
  });

  app.post("/api/tenancies/:tenancyId/end", operatorOnly, async (request, response) => {
    const input = parse(tenancyEndSchema, request.body ?? {});
    const tenancy = await deps.repositories.tenancies?.findById(pathParam(request, "tenancyId"));
    if (!tenancy) throw new AppError(404, "tenancy_not_found", "Tenancy was not found");
    await assertLandlordRoom(request, deps, tenancy.roomId);
    if (tenancy.status !== "active") {
      throw new AppError(409, "tenancy_not_active", "Tenancy is already ended");
    }
    const endDate = input.endDate ?? new Date().toISOString();
    if (Date.parse(endDate) < Date.parse(tenancy.startDate)) {
      throw new AppError(400, "validation_failed", "endDate cannot be before startDate");
    }
    tenancy.status = "ended";
    tenancy.endDate = endDate;
    tenancy.updatedAt = new Date().toISOString();
    await deps.repositories.tenancies!.save(tenancy);
    response.json({ tenancy });
  });
  app.post("/api/rooms/:roomId/meters", operatorOnly, async (request, response) => {
    const input = parse(meterCreateSchema, request.body);
    const roomId = pathParam(request, "roomId");
    await assertLandlordRoom(request, deps, roomId);
    const meter = await deps.rooms.createMeter(roomId, input, actor(request));
    response.status(201).json({
      meter: {
        ...meter,
        publicKeyPem: meter.publicKeyPem
      }
    });
  });

  app.post("/api/meters", operatorOnly, async (request, response) => {
    const input = parse(meterRegistrationSchema, request.body);
    await assertLandlordRoom(request, deps, input.roomId);
    const publicKeyPem = input.publicKeyPem ?? input.publicKey;
    if (!publicKeyPem) {
      throw new AppError(400, "validation_failed", "publicKey or publicKeyPem is required");
    }
    try {
      const { createPublicKey } = await import("node:crypto");
      createPublicKey(publicKeyPem);
    } catch {
      throw new AppError(400, "invalid_public_key", "publicKey format is invalid");
    }

    const existing = await deps.repositories.meters.findById(input.meterId);
    if (existing) {
      throw new AppError(409, "meter_exists", "Meter already exists");
    }
    if (await deps.repositories.meters.findActiveByRoom(input.roomId)) {
      throw new AppError(
        409,
        "meter_already_registered",
        "Room already has an active submeter"
      );
    }

    const meter: Meter = {
      id: input.meterId,
      meterId: input.meterId,
      roomId: input.roomId,
      label: input.deviceType ?? input.meterId,
      publicKeyPem,
      publicKey: publicKeyPem,
      deviceType: input.deviceType ?? "physical",
      status: input.status ?? "active",
      createdAt: new Date().toISOString()
    };
    await deps.repositories.transaction(async (tx) => {
      await tx.meters.save(meter);
    });
    response.status(201).json({ meter });
  });

  app.get("/api/meters", async (request, response) => {
    const roomIds = new Set(await accessibleRoomIds(requestUser(request), deps));
    const meters = (await deps.repositories.meters.list()).filter((meter) =>
      roomIds.has(meter.roomId)
    );
    response.json({ meters });
  });

  app.get("/api/meters/:meterId", async (request, response) => {
    const meterId = pathParam(request, "meterId");
    const meter = await deps.repositories.meters.findById(meterId);
    if (!meter) {
      throw new AppError(404, "meter_not_found", "Meter not found");
    }
    await assertRoomAccess(request, deps, meter.roomId);
    response.json({ meter });
  });

  app.get("/api/meters/:meterId/readings", async (request, response) => {
    const meterId = pathParam(request, "meterId");
    const meter = await deps.repositories.meters.findById(meterId);
    if (!meter) {
      throw new AppError(404, "meter_not_found", "Meter not found");
    }
    await assertRoomAccess(request, deps, meter.roomId);
    const readings = (await deps.repositories.readings.list({ meterId }))
      .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp));
    response.json({ readings });
  });

  app.get("/api/meters/:meterId/readings/:readingId", async (request, response) => {
    const meterId = pathParam(request, "meterId");
    const meter = await deps.repositories.meters.findById(meterId);
    if (!meter) {
      throw new AppError(404, "meter_not_found", "Meter not found");
    }
    await assertRoomAccess(request, deps, meter.roomId);
    const reading =
      (await deps.repositories.readings.findById?.(pathParam(request, "readingId"))) ??
      (await deps.repositories.readings.findByReadingId?.(pathParam(request, "readingId")));
    if (!reading || reading.meterId !== meterId) {
      throw new AppError(404, "reading_not_found", "Reading not found");
    }
    response.json({ reading });
  });

  app.get("/api/readings", async (request, response) => {
    const roomId = queryString(request, "roomId");
    const meterId = queryString(request, "meterId");
    const status = queryString(request, "status");
    const limit = limitFrom(request, 100, 500);
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    if (roomId && !allowedRooms.has(roomId)) {
      throw new AppError(404, "room_not_found", "Room was not found");
    }
    const meter = meterId ? await deps.repositories.meters.findById(meterId) : null;
    if (meterId && (!meter || !allowedRooms.has(meter.roomId))) {
      throw new AppError(404, "meter_not_found", "Meter was not found");
    }
    const readings = (
      await deps.repositories.readings.list({
        roomId,
        status:
          status === "accepted" || status === "rejected" || status === "quarantined"
            ? status
            : undefined
      })
    )
      .filter((reading) => allowedRooms.has(reading.roomId ?? ""))
      .filter((reading) => !meterId || reading.meterId === meterId)
      .sort((a, b) => Date.parse(b.payload.timestamp) - Date.parse(a.payload.timestamp))
      .slice(0, limit);
    response.json({ readings });
  });

  app.post("/api/readings", async (request, response) => {
    const input = parse(readingSubmissionSchema, request.body);
    try {
      const reading = await deps.readings.submit(input as any, "meter");
      response.status(reading.status === "accepted" ? 201 : 202).json({ reading });
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === "meter_not_found") {
          throw new AppError(404, "meter_not_found", error.message);
        }
        if (error.code === "signature_invalid" || error.code === "invalid_signature") {
          throw new AppError(401, "invalid_signature", error.message);
        }
        if (
          error.code === "duplicate_reading" ||
          error.code === "replayed_sequence" ||
          error.code === "sequence_conflict" ||
          error.code === "reading_exists"
        ) {
          throw new AppError(409, error.code, error.message);
        }
        if (error.code === "validation_failed") {
          throw new AppError(400, error.code, error.message, error.details);
        }
      }
      throw error;
    }
  });

  app.get("/api/tariff", async (_request, response) => {
    response.json({ tariff: await deps.tariffs.current() });
  });

  app.put("/api/tariff", operatorOnly, async (request, response) => {
    const input = parse(tariffUpdateSchema, request.body);
    const user = requestUser(request);
    const roomId = input.roomId;
    if (roomId) {
      await assertLandlordRoom(request, deps, roomId);
    } else if (user.role !== "admin") {
      throw new AppError(400, "room_scope_required", "Landlords must scope tariffs to a room");
    }
    const rate = input.rateNprPerKwh ?? input.nprPerKwh;
    if (rate === undefined) {
      throw new AppError(400, "validation_failed", "Tariff rate is required");
    }
    response.json({ tariff: await deps.tariffs.set(rate, actor(request), roomId) });
  });

  app.get("/api/tariffs", async (request, response) => {
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    response.json({
      tariffs: (await deps.tariffs.list()).filter(
        (tariff) => !(tariff.roomId ?? tariff.scope) || allowedRooms.has(tariff.roomId ?? tariff.scope!)
      )
    });
  });

  app.post("/api/tariffs", operatorOnly, async (request, response) => {
    const input = parse(tariffCreateSchema, request.body);
    const user = requestUser(request);
    const scope = input.roomId ?? input.scope;
    if (scope) {
      await assertLandlordRoom(request, deps, scope);
    } else if (user.role !== "admin") {
      throw new AppError(400, "room_scope_required", "Landlords must scope tariffs to a room");
    }
    const actorName = actor(request);
    const tariff = await deps.tariffs.create({ ...input, configuredBy: actorName }, actorName);
    response.status(201).json({ tariff });
  });

  app.get("/api/tariffs/:tariffId", async (request, response) => {
    const tariff = await deps.tariffs.get(pathParam(request, "tariffId"));
    if (!tariff) {
      throw new AppError(404, "tariff_not_found", "Tariff not found");
    }
    if (tariff.roomId ?? tariff.scope) {
      await assertRoomAccess(request, deps, tariff.roomId ?? tariff.scope!);
    }
    response.json({ tariff });
  });

  app.get("/api/sessions", async (request, response) => {
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    response.json({
      sessions: (await deps.sessions.list()).filter((session) => allowedRooms.has(session.roomId))
    });
  });

  app.get("/api/sessions/:sessionId", async (request, response) => {
    const detail = await deps.sessions.detail(pathParam(request, "sessionId"));
    await assertRoomAccess(request, deps, detail.session.roomId);
    response.json(detail);
  });

  app.post("/api/rooms/:roomId/sessions", operatorOnly, async (request, response) => {
    const roomId = pathParam(request, "roomId");
    await assertLandlordRoom(request, deps, roomId);
    const session = await deps.sessions.start(roomId, actor(request));
    response.status(201).json({ session });
  });

  app.post("/api/sessions/:sessionId/close", operatorOnly, async (request, response) => {
    const sessionId = pathParam(request, "sessionId");
    const existing = await deps.repositories.bills.findById(sessionId);
    if (!existing) throw new AppError(404, "session_not_found", "Session was not found");
    await assertLandlordRoom(request, deps, existing.roomId);
    const session = await deps.sessions.close(sessionId, actor(request));
    response.json({ session });
  });

  app.post("/api/sessions/:sessionId/dispute", async (request, response) => {
    const input = parse(disputeOpenSchema, {
      ...request.body,
      openedBy: requestUser(request).id
    });
    const session = await deps.repositories.bills.findById(pathParam(request, "sessionId"));
    if (!session) throw new AppError(404, "session_not_found", "Session was not found");
    await assertRoomAccess(request, deps, session.roomId);
    const dispute = await deps.sessions.openDispute(
      pathParam(request, "sessionId"),
      input.reason,
      requestUser(request).id
    );
    response.status(201).json({ dispute });
  });

  app.post("/api/sessions/:sessionId/settle", operatorOnly, async (request, response) => {
    const input = parse(settleSchema, request.body);
    const sessionId = pathParam(request, "sessionId");
    const existingSession = await deps.repositories.bills.findById(sessionId);
    if (!existingSession) throw new AppError(404, "session_not_found", "Session was not found");
    await assertLandlordRoom(request, deps, existingSession.roomId);
    const session = await deps.sessions.settleWithHts(
      sessionId,
      input.payerAccountId,
      actor(request)
    );
    response.json({ session });
  });

  app.get("/api/disputes", async (request, response) => {
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    const disputes = await Promise.all(
      (await deps.sessions.listDisputes()).map(async (dispute) => {
        const record = await deps.repositories.bills.findById(dispute.billId ?? dispute.sessionId);
        return record && allowedRooms.has(record.roomId) ? dispute : null;
      })
    );
    response.json({ disputes: disputes.filter((dispute) => dispute !== null) });
  });

  app.post("/api/disputes", async (request, response) => {
    const input = parse(disputeOpenSchema, {
      ...request.body,
      openedBy: requestUser(request).id
    });
    const billId = request.body?.billId;
    if (typeof billId !== "string" || !billId) {
      throw new AppError(400, "validation_failed", "billId is required");
    }
    const bill = await deps.billing?.get(billId);
    if (!bill) throw new AppError(404, "bill_not_found", "Bill was not found");
    await assertRoomAccess(request, deps, bill.roomId);
    const dispute = await deps.sessions.openBillDispute(billId, input.reason, requestUser(request).id);
    response.status(201).json({ dispute });
  });

  app.post("/api/disputes/:disputeId/resolve", operatorOnly, async (request, response) => {
    const disputeId = pathParam(request, "disputeId");
    const existing = await deps.repositories.disputes.findById(disputeId);
    if (!existing) throw new AppError(404, "dispute_not_found", "Dispute was not found");
    const billOrSession = await deps.repositories.bills.findById(existing.billId ?? existing.sessionId);
    if (!billOrSession) throw new AppError(404, "bill_not_found", "Bill was not found");
    await assertLandlordRoom(request, deps, billOrSession.roomId);
    const input = parse(disputeResolveSchema, {
      ...request.body,
      resolvedBy: requestUser(request).id
    });
    const dispute = await deps.sessions.resolveDispute(
      disputeId,
      input.status,
      input.resolution,
      requestUser(request).id,
      input.creditNpr
    );
    response.json({ dispute });
  });

  app.get("/api/audit", operatorOnly, async (request, response) => {
    const events = await deps.audit.list(limitFrom(request, 100, 1000));
    if (requestUser(request).role === "admin") {
      response.json({ events });
      return;
    }
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    response.json({
      events: events.filter((event) =>
        typeof event.payload.roomId === "string" && allowedRooms.has(event.payload.roomId)
      )
    });
  });

  app.get("/api/audit/verify", operatorOnly, async (_request, response) => {
    response.json(await deps.audit.verify());
  });

  app.get("/api/audit/status", operatorOnly, async (_request, response) => {
    response.json(await deps.audit.status());
  });

  app.get("/api/audit/hedera/:sequence", operatorOnly, async (request, response) => {
    response.json(await deps.audit.mirrorMessage(pathParam(request, "sequence")));
  });

  app.post("/api/audit/:eventId/notarize", operatorOnly, async (request, response) => {
    const eventId = pathParam(request, "eventId");
    if (requestUser(request).role !== "admin") {
      const existing = await deps.repositories.auditEvents.findById(eventId);
      const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
      if (!existing || typeof existing.payload.roomId !== "string" || !allowedRooms.has(existing.payload.roomId)) {
        throw new AppError(404, "audit_event_not_found", "Audit event was not found");
      }
    }
    const event = await deps.audit.notarizeById(eventId);
    response.json({ event });
  });

  app.get("/api/cre/evidence", requireCreToken(deps), async (_request, response) => {
    response.json(await deps.cre.evidence());
  });

  app.get("/api/cre/pending-readings", requireCreToken(deps), async (_request, response) => {
    response.json(await deps.cre.pendingReadings());
  });

  app.get("/api/cre/reading-evidence", requireCreToken(deps), async (_request, response) => {
    response.json(await deps.cre.readingEvidence());
  });

  app.post(
    "/api/cre/report",
    requireCreToken(deps),
    async (request, response) => {
      const input = parse(creReportSchema, request.body);
      const report = await deps.cre.submitReport(input);
      response.status(201).json({ report });
    }
  );

  app.post("/api/cre/simulate", operatorOnly, async (request, response) => {
    const report = await deps.cre.runLocalFallback(actor(request));
    response.status(201).json({ report });
  });

  app.get("/api/cre/reports", authRequired, async (request, response) => {
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    const allowedSessions = new Set(
      (await deps.sessions.list())
        .filter((session) => allowedRooms.has(session.roomId))
        .map((session) => session.id)
    );
    const reports = (await deps.cre.list()).map((report) => ({
      ...report,
      sessionIds: report.sessionIds.filter((sessionId) => allowedSessions.has(sessionId)),
      findings: report.findings.filter(
        (finding) => !finding.sessionId || allowedSessions.has(finding.sessionId)
      )
    }));
    response.json({ reports });
  });

  app.get("/api/identity/resolve", async (request, response) => {
    const name = queryString(request, "name");
    const input = parse(ensResolveSchema, { name });
    response.json(await deps.ens.resolveName(input.name));
  });

  app.get("/api/identity/reverse", async (request, response) => {
    const address = queryString(request, "address");
    if (!address) {
      throw new AppError(400, "validation_failed", "address query parameter is required");
    }
    response.json(await deps.ens.reverseName(address));
  });

  // Landlord receive wallets: added once in Settings and then attached to every
  // issued bill, so renters never need a per-bill QR upload.
  app.get("/api/wallets", async (request, response) => {
    const user = requestUser(request);
    const repository = deps.repositories.userWallets;
    if (!repository) {
      response.json({ wallets: [] });
      return;
    }
    const wallets = await repository.listByUserId(user.id);
    response.json({ wallets });
  });

  app.post("/api/wallets", async (request, response) => {
    const user = requestUser(request);
    const repository = deps.repositories.userWallets;
    if (!repository) {
      throw new AppError(503, "wallets_unavailable", "Wallet storage is not available");
    }
    // A landlord keeps one main Hedera wallet. Re-posting the same account is
    // idempotent; a different account must replace the existing wallet first.
    const bodyType = (request.body as any)?.type;
    const bodyAccountId = (request.body as any)?.accountId;
    if (bodyType === "hashpack" || bodyType === "hedera") {
      const current = await repository.listByUserId(user.id);
      const mainWallet = current.find(
        (item) =>
          (item.type === "hashpack" || item.type === "hedera") &&
          item.isActive !== false &&
          item.accountId
      );
      if (mainWallet) {
        if (bodyAccountId && mainWallet.accountId === bodyAccountId) {
          response.status(200).json({ wallet: mainWallet });
          return;
        }
        throw new AppError(
          409,
          "main_wallet_exists",
          "A main wallet is already connected. Remove it before connecting a different account."
        );
      }
    }
    try {
      const input = parse(userWalletCreateSchema, request.body);
      const existing = await repository.listByUserId(user.id);
      const now = new Date().toISOString();
      let qrDataUrl = (input as any).qrDataUrl;
      try {
        if (!qrDataUrl && ((input.type as any) === 'hashpack' || (input.type as any) === 'hedera') && (input as any).accountId) {
          try {
            const QRCodeLib = require('@walletconnect/qrcode-modal/node_modules/qrcode');
            const dataUrl = await QRCodeLib.toDataURL(String((input as any).accountId));
            if (dataUrl) qrDataUrl = dataUrl;
          } catch {}
        }
      } catch {}
      const wallet = {
        id: `wal_${randomUUID()}`,
        userId: user.id,
        type: input.type,
        label: input.label,
        accountId: (input as any).accountId,
        qrPayload: (input as any).qrPayload,
        qrDataUrl: qrDataUrl,
        publicKey: (input as any).publicKey,
        network: (input as any).network,
        pairingData: (input as any).pairingData ?? null,
        isDefault: input.isDefault ?? existing.filter((item) => item.isActive !== false).length === 0,
        isActive: true,
        createdAt: now,
        updatedAt: now
      } as any;
      if (wallet.isDefault) {
        await repository.clearDefaultForUser(user.id);
      }
      await repository.save(wallet);
      response.status(201).json({ wallet });
      return;
    } catch (e) {
      const body = request.body as any;
      if (body && repository && (body.type === 'hashpack' || body.type === 'hedera')) {
        const existing = await repository.listByUserId(user.id);
        const now = new Date().toISOString();
        let qrDataUrl2 = body.qrDataUrl;
        try {
          if (!qrDataUrl2 && (body.type === 'hashpack' || body.type === 'hedera') && body.accountId) {
            try {
              const QRCodeLib = require('@walletconnect/qrcode-modal/node_modules/qrcode');
              const dataUrl = await QRCodeLib.toDataURL(String(body.accountId));
              if (dataUrl) qrDataUrl2 = dataUrl;
            } catch {}
          }
        } catch {}
        const walletObj = {
          id: `wal_${randomUUID()}`,
          userId: user.id,
          type: body.type,
          label: body.label || `HashPack (${body.accountId || ''})`,
          accountId: body.accountId,
          qrPayload: body.qrPayload,
          qrDataUrl: qrDataUrl2,
          publicKey: body.publicKey,
          network: body.network || 'testnet',
          pairingData: body.pairingData ?? null,
          isDefault: body.isDefault ?? existing.filter((item: any) => item.isActive !== false).length === 0,
          isActive: true,
          createdAt: now,
          updatedAt: now
        } as any;
        if (walletObj.isDefault) {
          await repository.clearDefaultForUser(user.id);
        }
        await repository.save(walletObj);
        response.status(201).json({ wallet: walletObj });
        return;
      }
      throw e;
    }
  });

  app.patch("/api/wallets/:walletId", async (request, response) => {
    const user = requestUser(request);
    const repository = deps.repositories.userWallets;
    if (!repository) {
      throw new AppError(503, "wallets_unavailable", "Wallet storage is not available");
    }
    const wallet = await repository.findById(pathParam(request, "walletId"));
    if (!wallet || (wallet.userId !== user.id && user.role !== "admin")) {
      throw new AppError(404, "wallet_not_found", "Wallet was not found");
    }
    const input = parse(userWalletUpdateSchema, request.body);
    if (input.isDefault) {
      await repository.clearDefaultForUser(wallet.userId);
    }
    const updated = {
      ...wallet,
      ...input,
      updatedAt: new Date().toISOString()
    } as any;
    await repository.save(updated);
    response.json({ wallet: updated });
  });

  app.delete("/api/wallets/:walletId", async (request, response) => {
    const user = requestUser(request);
    const repository = deps.repositories.userWallets;
    if (!repository) {
      throw new AppError(503, "wallets_unavailable", "Wallet storage is not available");
    }
    const wallet = await repository.findById(pathParam(request, "walletId"));
    if (!wallet || (wallet.userId !== user.id && user.role !== "admin")) {
      throw new AppError(404, "wallet_not_found", "Wallet was not found");
    }
    await repository.delete(wallet.id);
    response.json({ ok: true });
  });

  if (deps.billing) {
    app.post("/api/bills/preview", operatorOnly, async (request, response) => {
      const input = parse(billCreateSchema, request.body);
      await assertLandlordRoom(request, deps, input.roomId);
      response.json({ bill: await deps.billing!.preview(input) });
    });
    app.get("/api/rooms/:roomId/bill-suggestion", operatorOnly, async (request, response) => {
      const roomId = pathParam(request, "roomId");
      await assertLandlordRoom(request, deps, roomId);
      response.json(await deps.billing!.suggestPeriod(roomId));
    });
    app.post("/api/bills", operatorOnly, async (request, response) => {
      const input = parse(billCreateSchema, request.body);
      await assertLandlordRoom(request, deps, input.roomId);
      const bill = await deps.billing!.create(input as any, actor(request));
      response.status(201).json({ bill });
    });
    app.get("/api/bills", async (request, response) => {
      const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
      const roomId = queryString(request, "roomId");
      if (roomId && !allowedRooms.has(roomId)) {
        throw new AppError(404, "room_not_found", "Room was not found");
      }
      const bills = await deps.billing!.list({
        roomId,
        status: queryString(request, "status")
      });
      response.json({
        bills: bills.filter((bill) =>
          allowedRooms.has(bill.roomId) &&
          (requestUser(request).role !== "renter" || bill.status !== "draft")
        )
      });
    });
    app.get("/api/bills/:billId", async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertRoomAccess(request, deps, bill.roomId);
      if (requestUser(request).role === "renter" && bill.status === "draft") {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      response.json({ bill: await attachReceiveWallets(deps, bill) });
    });
    app.post("/api/bills/:billId/issue", operatorOnly, async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertLandlordRoom(request, deps, bill.roomId);
      const issuedBill = await deps.billing!.issue(bill.billId, actor(request));
      response.json({ bill: issuedBill });
    });
    app.post("/api/bills/:billId/mark-paid", operatorOnly, async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertLandlordRoom(request, deps, bill.roomId);
      response.json({ bill: await deps.billing!.markPaid(bill.billId, actor(request)) });
    });
    // Renters can record payment on their own issued bill; landlords keep using mark-paid.
    app.post("/api/bills/:billId/pay", async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertRoomAccess(request, deps, bill.roomId);
      if (requestUser(request).role === "renter" && bill.status === "draft") {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const payment =
        request.body?.payment === undefined
          ? undefined
          : parse(walletPaymentSchema, request.body.payment);
      response.json({ bill: await deps.billing!.markPaid(bill.billId, actor(request), payment) });
    });
    // Renter pays outside the app (eSewa/Fonepay/bank) and submits the reference.
    app.post("/api/bills/:billId/submit-payment", async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertRoomAccess(request, deps, bill.roomId);
      if (bill.status === "draft") {
        throw new AppError(404, "bill_not_found", "Bill not found");
      }
      const input = parse(billSubmitPaymentSchema, request.body);
      response.json({
        bill: await deps.billing!.submitPayment(bill.billId, actor(request), input)
      });
    });
    // Landlord checks the transaction and confirms the bill as paid.
    app.post("/api/bills/:billId/verify-payment", operatorOnly, async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertLandlordRoom(request, deps, bill.roomId);
      const input =
        request.body === undefined ? {} : parse(billVerifyPaymentSchema, request.body);
      response.json({
        bill: await deps.billing!.verifyPayment(bill.billId, actor(request), input)
      });
    });
    app.delete("/api/bills/:billId", operatorOnly, async (request, response) => {
      const bill = await deps.billing!.get(pathParam(request, "billId"));
      await assertLandlordRoom(request, deps, bill.roomId);
      await deps.billing!.deleteDraft(bill.billId, actor(request));
      response.json({ ok: true });
    });
    app.get("/api/rooms/:roomId/bills", async (request, response) => {
      const roomId = pathParam(request, "roomId");
      await assertRoomAccess(request, deps, roomId);
      const bills = await deps.billing!.listForRoom(roomId);
      response.json({
        bills: requestUser(request).role === "renter"
          ? bills.filter((bill) => bill.status !== "draft")
          : bills
      });
    });
  }

  app.get("/api/audit-events", async (request, response) => {
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    const events = await deps.audit.list(1000);
    response.json({
      events: events.filter((event) => {
        const roomId = event.payload.roomId;
        return typeof roomId === "string" && allowedRooms.has(roomId);
      })
    });
  });

  app.get("/api/audit-events/:eventId", async (request, response) => {
    const event = await deps.repositories.auditEvents.findById(pathParam(request, "eventId"));
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    if (!event || typeof event.payload.roomId !== "string" || !allowedRooms.has(event.payload.roomId)) {
      response.status(404).json({ error: { code: "not_found", message: "Audit event not found" } });
      return;
    }
    response.json({ event });
  });

  app.get("/api/audit-events/:eventId/verify", async (request, response) => {
    const eventId = pathParam(request, "eventId");
    const event = await deps.repositories.auditEvents.findById(eventId);
    const allowedRooms = new Set(await accessibleRoomIds(requestUser(request), deps));
    const result = event && typeof event.payload.roomId === "string" && allowedRooms.has(event.payload.roomId)
      ? await deps.audit.verifyHedera(eventId)
      : null;
    if (!result) {
      response.status(404).json({ error: { code: "not_found", message: "Audit event not found" } });
      return;
    }
    response.json(result);
  });

  app.get("/api/audit/mirror", adminOnly, async (request, response) => {
    const limit = limitFrom(request, 25, 100);
    response.json(await deps.hedera.fetchMirrorMessages(limit));
  });

  app.get("/api/audit/mirror/:sequenceNumber", adminOnly, async (request, response) => {
    response.json({
      message: await deps.audit.mirrorMessage(pathParam(request, "sequenceNumber"))
    });
  });

  app.post("/api/auth/register", async (request, response) => {
    if (!auth) {
      throw new AppError(501, "not_implemented", "Auth not configured");
    }
    const input = parse(z.object({
      email: z.string().email().max(254),
      name: z.string().trim().min(1).max(120),
      password: z.string().min(8).max(256),
      role: z.enum(["landlord", "renter"]).default("landlord")
    }), request.body ?? {});
    try {
      const user = await auth.register(input);
      response.status(201).json({ user });
    } catch (error) {
      if (error instanceof Error && error.message === "email_exists") {
        throw new AppError(409, "email_exists", "Email already registered");
      }
      throw error;
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    if (!auth) {
      throw new AppError(501, "not_implemented", "Auth not configured");
    }
    const input = parse(z.object({
      email: z.string().email().max(254),
      password: z.string().min(1).max(256)
    }), request.body ?? {});
    try {
      const result = await auth.login(input.email, input.password);
      const secure = request.secure ? "; Secure" : "";
      response.setHeader(
        "Set-Cookie",
        `chargemesh_session=${encodeURIComponent(result.session.sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
      );
      response.json({ user: result.user, sessionId: result.session.sessionId });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_credentials") {
        throw new AppError(401, "unauthorized", "Invalid credentials");
      }
      throw error;
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    const sid = getSessionId(request);
    if (auth && sid) await auth.logout(sid);
    response.setHeader(
      "Set-Cookie",
      "chargemesh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    );
    response.json({ ok: true });
  });

  app.get("/api/auth/me", async (request, response) => {
    if (!auth) {
      response.status(401).json({ error: { code: "unauthorized", message: "Not authenticated" } });
      return;
    }
    const user = await auth.me(getSessionId(request) ?? "");
    if (!user) {
      response.status(401).json({ error: { code: "unauthorized", message: "Not authenticated" } });
      return;
    }
    response.json({ user });
  });

  app.patch("/api/auth/me", async (request, response) => {
    // /api/auth/* skips the auth middleware, so resolve the session here.
    const current = auth ? await auth.me(getSessionId(request) ?? "") : null;
    if (!current) throw new AppError(401, "unauthorized", "Not authenticated");
    const input = parse(z.object({ name: z.string().trim().min(1).max(120) }), request.body ?? {});
    const user = await auth!.updateName(current.id, input.name);
    if (!user) throw new AppError(404, "user_not_found", "User was not found");
    response.json({ user });
  });

  app.use((_request: IncomingMessage, response: ServerResponse) => {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { code: "not_found", message: "Route not found" } }));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error(`[api] ${message}`);
    response.status(500).json({
      error: {
        code: "internal_error",
        message: "Unexpected server error"
      }
    });
  });

  return app;
}
