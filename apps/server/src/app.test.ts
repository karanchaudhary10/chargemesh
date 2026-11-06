import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Bill } from "@chargemesh/shared";
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

describe("authenticated room access", () => {
  const servers: Array<ReturnType<ReturnType<typeof createApp>["listen"]>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) => new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        })
      )
    );
  });

  it("requires a session and limits renter room results to active assignments", async () => {
    const repositories = await createTestRepositories();
    const authRepo = new PostgresAuthRepository(repositories.pool);
    const auth = new AuthService(authRepo);
    const landlord = await auth.register({
      email: "owner@example.test",
      name: "Property Owner",
      password: "landlord-password",
      role: "landlord"
    });
    const renter = await auth.register({
      email: "renter@example.test",
      name: "Room Renter",
      password: "renter-password",
      role: "renter"
    });
    await repositories.properties.save({
      id: "property_owned",
      name: "Owned Property",
      ownerId: landlord.id,
      createdAt: new Date().toISOString()
    });
    await repositories.properties.save({
      id: "property_other",
      name: "Other Property",
      ownerId: "other-landlord",
      createdAt: new Date().toISOString()
    });
    const ownRoom = {
      id: "room_assigned",
      propertyId: "property_owned",
      name: "Assigned room",
      description: "",
      createdAt: new Date().toISOString()
    };
    const otherRoom = {
      id: "room_private",
      propertyId: "property_other",
      name: "Private room",
      description: "",
      createdAt: new Date().toISOString()
    };
    const vacantRoom = {
      id: "room_vacant",
      propertyId: "property_owned",
      name: "Vacant room",
      description: "",
      createdAt: new Date().toISOString()
    };
    await repositories.rooms.save(ownRoom);
    await repositories.rooms.save(otherRoom);
    await repositories.rooms.save(vacantRoom);
    await repositories.tenancies.save({
      tenancyId: "tenancy_active",
      roomId: ownRoom.id,
      userId: renter.id,
      role: "renter",
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: null,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const roomsService = {
      listOverviews: async () => [
        { room: ownRoom, recentReadings: [], recentEnergyKwh: 0, estimatedCostNpr: 0, flags: [] },
        { room: otherRoom, recentReadings: [], recentEnergyKwh: 0, estimatedCostNpr: 0, flags: [] },
        { room: vacantRoom, recentReadings: [], recentEnergyKwh: 0, estimatedCostNpr: 0, flags: [] }
      ],
      overview: async (roomId: string) => ({
        room: roomId === ownRoom.id ? ownRoom : otherRoom,
        recentReadings: [],
        recentEnergyKwh: 0,
        estimatedCostNpr: 0,
        flags: []
      })
    };
    const ownBill: Bill = {
      billId: "bill_assigned",
      roomId: ownRoom.id,
      meterId: "meter_assigned",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.999Z",
      startingReadingId: "reading_1",
      endingReadingId: "reading_2",
      startingCumulativeKwh: 10,
      endingCumulativeKwh: 20,
      consumptionKwh: 10,
      tariffId: "tariff_1",
      rateNprPerKwh: 15,
      electricityChargeNpr: 150,
      status: "draft",
      createdAt: new Date().toISOString()
    };
    const privateBill: Bill = {
      ...ownBill,
      billId: "bill_private",
      roomId: otherRoom.id,
      status: "issued"
    };
    const bills = [ownBill, privateBill];
    const app = createApp({
      config,
      repositories,
      auth,
      rooms: roomsService,
      billing: {
        list: async () => bills,
        get: async (billId: string) => bills.find((bill) => bill.billId === billId),
        listForRoom: async (roomId: string) => bills.filter((bill) => bill.roomId === roomId),
        issue: async (billId: string) => {
          const bill = bills.find((entry) => entry.billId === billId);
          if (!bill) throw new Error("bill_not_found");
          bill.status = "issued";
          return bill;
        }
      }
    } as unknown as AppDependencies);
    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthenticated = await fetch(`${baseUrl}/api/rooms`);
    expect(unauthenticated.status).toBe(401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "renter@example.test", password: "renter-password" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^chargemesh_session=/);

    const roomList = await fetch(`${baseUrl}/api/rooms`, { headers: { cookie: cookie! } });
    expect(roomList.status).toBe(200);
    const payload = await roomList.json() as { rooms: Array<{ room: { id: string } }> };
    expect(payload.rooms.map((overview) => overview.room.id)).toEqual([ownRoom.id]);

    const privateRoom = await fetch(`${baseUrl}/api/rooms/${otherRoom.id}`, {
      headers: { cookie: cookie! }
    });
    expect(privateRoom.status).toBe(404);

    const renterBillsBeforeIssue = await fetch(`${baseUrl}/api/bills`, { headers: { cookie: cookie! } });
    expect(renterBillsBeforeIssue.status).toBe(200);
    expect((await renterBillsBeforeIssue.json() as { bills: Bill[] }).bills).toEqual([]);
    const draftBillResponse = await fetch(`${baseUrl}/api/bills/${ownBill.billId}`, {
      headers: { cookie: cookie! }
    });
    expect(draftBillResponse.status).toBe(404);

    const landlordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "landlord-password" })
    });
    const landlordCookie = landlordLogin.headers.get("set-cookie")?.split(";")[0];
    expect(landlordLogin.status).toBe(200);
    const issueResponse = await fetch(`${baseUrl}/api/bills/${ownBill.billId}/issue`, {
      method: "POST",
      headers: { cookie: landlordCookie! }
    });
    expect(issueResponse.status).toBe(200);

    const renterBills = await fetch(`${baseUrl}/api/bills`, { headers: { cookie: cookie! } });
    expect(renterBills.status).toBe(200);
    const visibleBills = await renterBills.json() as { bills: Bill[] };
    expect(visibleBills.bills.map((bill) => bill.billId)).toEqual([ownBill.billId]);
    const privateBillResponse = await fetch(`${baseUrl}/api/bills/${privateBill.billId}`, {
      headers: { cookie: cookie! }
    });
    expect(privateBillResponse.status).toBe(404);

    const createdPropertyResponse = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: landlordCookie! },
      body: JSON.stringify({
        name: "New landlord property",
        ownerId: "other-landlord"
      })
    });
    const createdProperty = await createdPropertyResponse.json() as { property: { ownerId: string } };
    expect(createdPropertyResponse.status).toBe(201);
    expect(createdProperty.property.ownerId).toBe(landlord.id);

    const assignmentResponse = await fetch(`${baseUrl}/api/rooms/${vacantRoom.id}/tenancies`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: landlordCookie! },
      body: JSON.stringify({ email: renter.email })
    });
    expect(assignmentResponse.status).toBe(201);
    const assignment = await assignmentResponse.json() as { tenancy: { userId: string } };
    expect(assignment.tenancy.userId).toBe(renter.id);
  });

  it("does not allow public registration to create an admin account", async () => {
    const repositories = await createTestRepositories();
    const app = createApp({
      config,
      repositories,
      auth: new AuthService(new PostgresAuthRepository(repositories.pool))
    } as unknown as AppDependencies);
    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.test",
        name: "Unauthorized admin",
        password: "some-password",
        role: "admin"
      })
    });
    expect(response.status).toBe(400);
  });
});
