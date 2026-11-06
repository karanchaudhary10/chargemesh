import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Bill, Dispute, Meter, Reading, Tariff } from "@chargemesh/shared";
import type { AppDependencies } from "./app.js";
import { createApp } from "./app.js";
import { AuthService } from "./auth.js";
import type { Config } from "./config.js";
import { PostgresAuthRepository } from "./postgres-repositories.js";
import { createTestRepositories } from "./test-db.js";

const config = {
  port: 0,
  staleAfterMs: 60_000,
  maxPowerW: 5_000,
  energyJumpTolerance: 10,
  hederaNetwork: "testnet",
  hederaMirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  hederaEnabled: false
} as Config;

describe("renter portal API", () => {
  const servers: Array<ReturnType<ReturnType<typeof createApp>["listen"]>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it("returns one scoped overview and lets a renter pay only their own issued bill", async () => {
    const repositories = await createTestRepositories();
    const auth = new AuthService(new PostgresAuthRepository(repositories.pool));
    const landlord = await auth.register({
      email: "renter-api-landlord@example.test",
      name: "Owner",
      password: "landlord-password",
      role: "landlord"
    });
    const renter = await auth.register({
      email: "renter-api@example.test",
      name: "Sita Renter",
      password: "renter-password",
      role: "renter"
    });
    const otherRenter = await auth.register({
      email: "other-renter@example.test",
      name: "Other Renter",
      password: "renter-password",
      role: "renter"
    });
    const otherLandlord = await auth.register({
      email: "renter-api-other@example.test",
      name: "Other Owner",
      password: "landlord-password",
      role: "landlord"
    });

    const now = new Date().toISOString();
    const property = {
      id: "property_renter_api",
      name: "Sunrise Apartments",
      address: "Baneshwor, Kathmandu",
      ownerId: landlord.id,
      defaultRateNprPerKwh: 13,
      createdAt: now,
      updatedAt: now
    };
    const otherProperty = {
      id: "property_other_api",
      name: "Hidden Property",
      ownerId: otherLandlord.id,
      createdAt: now,
      updatedAt: now
    };
    await repositories.properties.save(property);
    await repositories.properties.save(otherProperty);

    const room = {
      id: "room_renter_api",
      propertyId: property.id,
      name: "2B",
      floor: "Second floor",
      unitType: "1BHK",
      description: "",
      createdAt: now
    };
    const otherRoom = {
      id: "room_other_api",
      propertyId: otherProperty.id,
      name: "9Z",
      description: "",
      createdAt: now
    };
    await repositories.rooms.save(room);
    await repositories.rooms.save(otherRoom);

    await repositories.tenancies.save({
      tenancyId: "tenancy_renter_api",
      roomId: room.id,
      userId: renter.id,
      role: "renter",
      startDate: new Date(Date.now() - 86_400_000).toISOString(),
      endDate: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    await repositories.tenancies.save({
      tenancyId: "tenancy_other_api",
      roomId: otherRoom.id,
      userId: otherRenter.id,
      role: "renter",
      startDate: new Date(Date.now() - 86_400_000).toISOString(),
      endDate: null,
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const meter: Meter = {
      id: "meter_renter_api",
      meterId: "meter_renter_api",
      roomId: room.id,
      label: "Sub-meter 2B",
      publicKeyPem: "test-key",
      status: "active",
      createdAt: now
    };
    await repositories.meters.save(meter);
    const meterKey = await repositories.meters.findActiveByRoom(room.id);
    expect(meterKey?.id).toBe(meter.id);

    const reading: Reading = {
      id: "reading_renter_api",
      readingId: "reading_renter_api",
      payloadHash: "a".repeat(64),
      meterId: meter.id,
      roomId: room.id,
      payload: {
        meterId: meter.id,
        roomId: room.id,
        sequence: 5,
        timestamp: now,
        cumulativeEnergyKwh: 42.5,
        powerW: 310
      },
      signedPayload: {
        meterId: meter.id,
        roomId: room.id,
        sequence: 5,
        timestamp: now,
        cumulativeEnergyKwh: 42.5,
        powerW: 310
      },
      signature: "sig",
      status: "accepted",
      flags: [],
      reasons: [],
      receivedAt: now,
      source: "meter"
    };
    await repositories.readings.save(reading);

    const issuedBill: Bill = {
      billId: "bill_renter_issued",
      roomId: room.id,
      meterId: meter.id,
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-30T23:59:59.999Z",
      startingReadingId: "reading_start",
      endingReadingId: "reading_end",
      startingCumulativeKwh: 10,
      endingCumulativeKwh: 40,
      consumptionKwh: 30,
      tariffId: "tariff_renter_api",
      rateNprPerKwh: 13,
      electricityChargeNpr: 390,
      status: "issued",
      createdAt: now,
      issuedAt: now
    };
    const draftBill: Bill = {
      ...issuedBill,
      billId: "bill_renter_draft",
      status: "draft"
    };
    const otherBill: Bill = {
      ...issuedBill,
      billId: "bill_other_issued",
      roomId: otherRoom.id,
      status: "issued"
    };
    const bills = [issuedBill, draftBill, otherBill];

    const dispute: Dispute = {
      id: "dispute_renter_api",
      sessionId: issuedBill.billId,
      billId: issuedBill.billId,
      reason: "Usage looks high this month",
      openedBy: renter.id,
      status: "open",
      createdAt: now
    };

    const tariff: Tariff = {
      id: "tariff_renter_api",
      tariffId: "tariff_renter_api",
      roomId: room.id,
      nprPerKwh: 13,
      rateNprPerKwh: 13,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      createdAt: now
    };

    const app = createApp({
      config,
      repositories,
      auth,
      rooms: {
        listOverviews: async () => [
          {
            room,
            meter,
            latestReading: reading,
            recentReadings: [reading],
            recentEnergyKwh: 0,
            estimatedCostNpr: 0,
            flags: []
          },
          {
            room: otherRoom,
            recentReadings: [],
            recentEnergyKwh: 0,
            estimatedCostNpr: 0,
            flags: []
          }
        ]
      },
      billing: {
        list: async (filters: { roomId?: string }) =>
          bills.filter((bill) => !filters.roomId || bill.roomId === filters.roomId),
        get: async (billId: string) => bills.find((bill) => bill.billId === billId) ?? null,
        markPaid: async (billId: string, _actor: string, payment?: { payload: string }) => {
          const bill = bills.find((entry) => entry.billId === billId);
          if (!bill || bill.status !== "issued") throw new Error("bill_not_issued");
          bill.status = "paid";
          bill.paidAt = new Date().toISOString();
          if (payment) {
            bill.payment = {
              method: "wallet_qr",
              payload: payment.payload,
              reference: "a".repeat(64),
              scheme: "fonepay",
              capturedAt: new Date().toISOString()
            };
          }
          return bill;
        }
      },
      sessions: {
        listDisputes: async () => [dispute]
      },
      tariffs: {
        findApplicable: async () => tariff
      }
    } as unknown as AppDependencies);

    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "renter-api@example.test", password: "renter-password" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0]!;

    const overviewResponse = await fetch(`${baseUrl}/api/renter/overview`, {
      headers: { cookie }
    });
    expect(overviewResponse.status).toBe(200);
    const overview = (await overviewResponse.json()) as {
      tenancy: { tenancyId: string } | null;
      room: { id: string; name: string } | null;
      property: { id: string; name: string } | null;
      meter?: Meter;
      readings: Reading[];
      tariff: Tariff | null;
      bills: Bill[];
      disputes: Dispute[];
      summary: {
        dueNpr: number;
        paidNpr: number;
        unpaidCount: number;
        paidCount: number;
        openQuestionCount: number;
        totalUnits?: number;
        unitsSinceLastBill?: number;
        currentRateNprPerKwh?: number;
      };
    };
    expect(overview.tenancy?.tenancyId).toBe("tenancy_renter_api");
    expect(overview.room).toMatchObject({ id: room.id, name: "2B" });
    expect(overview.property).toMatchObject({ id: property.id, name: "Sunrise Apartments" });
    expect(overview.meter?.id).toBe(meter.id);
    expect(overview.readings.map((entry) => entry.id)).toEqual([reading.id]);
    expect(overview.tariff?.id).toBe(tariff.id);
    expect(overview.bills.map((bill) => bill.billId)).toEqual([issuedBill.billId]);
    expect(overview.disputes.map((entry) => entry.id)).toEqual([dispute.id]);
    expect(overview.summary).toMatchObject({
      dueNpr: 390,
      paidNpr: 0,
      unpaidCount: 1,
      paidCount: 0,
      openQuestionCount: 1,
      totalUnits: 42.5,
      unitsSinceLastBill: 2.5,
      currentRateNprPerKwh: 13
    });

    const landlordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "renter-api-landlord@example.test", password: "landlord-password" })
    });
    const landlordCookie = landlordLogin.headers.get("set-cookie")?.split(";")[0]!;
    const landlordOverview = await fetch(`${baseUrl}/api/renter/overview`, {
      headers: { cookie: landlordCookie }
    });
    expect(landlordOverview.status).toBe(403);

    const draftResponse = await fetch(`${baseUrl}/api/bills/${draftBill.billId}/pay`, {
      method: "POST",
      headers: { cookie }
    });
    expect(draftResponse.status).toBe(404);

    const otherBillResponse = await fetch(`${baseUrl}/api/bills/${otherBill.billId}/pay`, {
      method: "POST",
      headers: { cookie }
    });
    expect(otherBillResponse.status).toBe(404);

    const invalidPayResponse = await fetch(`${baseUrl}/api/bills/${issuedBill.billId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ payment: { payload: "" } })
    });
    expect(invalidPayResponse.status).toBe(400);

    const walletQr = "fonepay://pay?pa=9800000000&am=390&tn=room-2b";
    const payResponse = await fetch(`${baseUrl}/api/bills/${issuedBill.billId}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ payment: { payload: walletQr } })
    });
    expect(payResponse.status).toBe(200);
    const paid = (await payResponse.json()) as { bill: Bill };
    expect(paid.bill.status).toBe("paid");
    expect(paid.bill.paidAt).toBeTruthy();
    expect(paid.bill.payment).toMatchObject({
      method: "wallet_qr",
      payload: walletQr,
      scheme: "fonepay"
    });
    expect(paid.bill.payment?.reference).toMatch(/^[a-f0-9]{64}$/);
    expect(paid.bill.payment?.capturedAt).toBeTruthy();

    const afterPay = await fetch(`${baseUrl}/api/renter/overview`, { headers: { cookie } });
    const afterPayBody = (await afterPay.json()) as {
      bills: Bill[];
      summary: { dueNpr: number; paidNpr: number; unpaidCount: number; paidCount: number };
    };
    expect(afterPayBody.summary).toMatchObject({
      dueNpr: 0,
      paidNpr: 390,
      unpaidCount: 0,
      paidCount: 1
    });
    expect(afterPayBody.bills.find((bill) => bill.billId === issuedBill.billId)?.status).toBe("paid");

    const rename = await fetch(`${baseUrl}/api/auth/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Sita Renter Updated" })
    });
    expect(rename.status).toBe(200);
    expect((await rename.json() as { user: { name: string } }).user.name).toBe("Sita Renter Updated");
  });
});
