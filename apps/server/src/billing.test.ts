import { describe, expect, it } from "vitest";
import type { Bill, Reading, Tariff } from "@chargemesh/shared";
import { AuditService } from "./audit.js";
import { BillingService } from "./billing.js";
import type { Config } from "./config.js";
import { HederaService } from "./hedera.js";
import { createTestRepositories } from "./test-db.js";
import { SessionService } from "./sessions.js";
import { TariffService } from "./tariffs.js";

const ROOM_ID = "room_bill";
const METER_ID = "meter_bill";

function testConfig(): Config {
  return {
    port: 4000,
    staleAfterMs: 60_000,
    maxPowerW: 5_000,
    energyJumpTolerance: 10,
    hederaNetwork: "testnet",
    hederaMirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
    hederaEnabled: false
  } as Config;
}

async function setup(options: { lateStartReading?: boolean; splitTariff?: boolean } = {}) {
  const repositories = await createTestRepositories();
  const config = testConfig();
  const hedera = new HederaService(config);
  const audit = new AuditService(repositories, hedera);
  const tariffs = new TariffService(repositories, audit);
  const billing = new BillingService(repositories, audit, tariffs);
  const sessions = new SessionService(repositories, audit, hedera);
  const firstTimestamp = options.lateStartReading
    ? "2026-10-02T00:00:00.000Z"
    : "2026-10-01T00:00:00.000Z";
  const firstTariff: Tariff = {
    id: "tariff_old",
    tariffId: "tariff_old",
    roomId: ROOM_ID,
    nprPerKwh: 15,
    rateNprPerKwh: 15,
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: options.splitTariff ? "2026-10-10T23:59:59.999Z" : null
  };
  await repositories.transaction(async (tx) => {
    await tx.rooms.save({
      id: ROOM_ID,
      name: "Bill test room",
      description: "",
      createdAt: "2026-10-01T00:00:00.000Z"
    });
    await tx.meters.save({
      id: METER_ID,
      meterId: METER_ID,
      roomId: ROOM_ID,
      publicKeyPem: "not-used-by-billing",
      status: "active",
      createdAt: "2026-10-01T00:00:00.000Z"
    });
    await tx.tariffs.save(firstTariff);
    if (options.splitTariff) {
      await tx.tariffs.save({
        id: "tariff_new",
        tariffId: "tariff_new",
        roomId: ROOM_ID,
        nprPerKwh: 20,
        rateNprPerKwh: 20,
        effectiveFrom: "2026-10-11T00:00:00.000Z",
        effectiveTo: null
      });
    }
    const readings: Reading[] = [
      {
        id: "reading_start",
        readingId: "reading_start",
        payloadHash: "hash_start",
        meterId: METER_ID,
        roomId: ROOM_ID,
        payload: {
          meterId: METER_ID,
          roomId: ROOM_ID,
          sequence: 1,
          timestamp: firstTimestamp,
          cumulativeEnergyKwh: 1_250
        },
        signedPayload: {
          meterId: METER_ID,
          roomId: ROOM_ID,
          sequence: 1,
          timestamp: firstTimestamp,
          cumulativeEnergyKwh: 1_250
        },
        signature: "signature",
        status: "accepted",
        flags: [],
        reasons: [],
        receivedAt: firstTimestamp,
        source: "meter"
      },
      {
        id: "reading_end",
        readingId: "reading_end",
        payloadHash: "hash_end",
        meterId: METER_ID,
        roomId: ROOM_ID,
        payload: {
          meterId: METER_ID,
          roomId: ROOM_ID,
          sequence: 2,
          timestamp: "2026-10-20T12:00:00.000Z",
          cumulativeEnergyKwh: 1_340
        },
        signedPayload: {
          meterId: METER_ID,
          roomId: ROOM_ID,
          sequence: 2,
          timestamp: "2026-10-20T12:00:00.000Z",
          cumulativeEnergyKwh: 1_340
        },
        signature: "signature",
        status: "accepted",
        flags: [],
        reasons: [],
        receivedAt: "2026-10-20T12:00:00.000Z",
        source: "meter"
      }
    ];
    for (const reading of readings) await tx.readings.save(reading);
  });
  return { billing, repositories, tariffs, sessions };
}

const period = {
  roomId: ROOM_ID,
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-10-20T23:59:59.999Z"
};

describe("room electricity billing", () => {
  it("calculates the charge from accepted boundary readings and stores one stable bill id", async () => {
    const { billing, sessions } = await setup();
    const bill = await billing.create(period, "landlord_1");
    expect(bill).toMatchObject({
      startingCumulativeKwh: 1_250,
      endingCumulativeKwh: 1_340,
      consumptionKwh: 90,
      rateNprPerKwh: 15,
      electricityChargeNpr: 1_350,
      id: bill.billId,
      status: "draft"
    } satisfies Partial<Bill>);
    await expect(
      sessions.openBillDispute(bill.billId, "Incorrect boundary values", "renter_1")
    ).rejects.toMatchObject({ code: "bill_not_disputable" });
    const issued = await billing.issue(bill.billId, "landlord_1");
    expect(issued.status).toBe("issued");
    const dispute = await sessions.openBillDispute(
      bill.billId,
      "Incorrect boundary values",
      "renter_1"
    );
    expect(dispute.billId).toBe(bill.billId);
    await expect(
      sessions.openBillDispute(bill.billId, "Another challenge", "renter_1")
    ).rejects.toMatchObject({ code: "dispute_already_open" });
    const resolved = await sessions.resolveDispute(
      dispute.id,
      "rejected",
      "Reviewed the accepted readings and applicable rate.",
      "landlord_1"
    );
    expect(resolved.status).toBe("rejected");
    await expect(billing.get(bill.billId)).resolves.toMatchObject({ status: "issued" });
    await expect(billing.create(period, "landlord_1")).rejects.toMatchObject({
      code: "bill_exists"
    });
  });

  it("allows a renter to raise an issue after a bill is paid", async () => {
    const { billing, sessions } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await billing.issue(bill.billId, "landlord_1");
    await billing.markPaid(bill.billId, "landlord_1");
    const dispute = await sessions.openBillDispute(
      bill.billId,
      "I think this bill is too high",
      "renter_1"
    );
    expect(dispute).toMatchObject({ billId: bill.billId, status: "open" });
    await expect(billing.get(bill.billId)).resolves.toMatchObject({ status: "paid" });
  });

  it("stores the wallet QR captured when a bill is paid", async () => {
    const { billing } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await billing.issue(bill.billId, "landlord_1");
    const payload = "esewa://pay?amt=1350&pid=bill_1&scd=room_bill";

    const paid = await billing.markPaid(bill.billId, "renter_1", { payload });
    expect(paid.payment).toMatchObject({
      method: "wallet_qr",
      payload,
      scheme: "esewa"
    });
    expect(paid.payment?.reference).toMatch(/^[a-f0-9]{64}$/);
    expect(paid.payment?.capturedAt).toBeTruthy();

    const stored = await billing.get(bill.billId);
    expect(stored.payment).toMatchObject({ payload, method: "wallet_qr" });
  });

  it("closes the prior open-ended tariff when a new rate is scheduled", async () => {
    const { repositories, tariffs } = await setup();
    await tariffs.create({
      roomId: ROOM_ID,
      rateNprPerKwh: 20,
      effectiveFrom: "2026-10-21T00:00:00.000Z"
    }, "landlord_1");
    const previous = await repositories.tariffs.findById("tariff_old");
    expect(previous?.effectiveTo).toBe("2026-10-20T23:59:59.999Z");
  });

  it("rejects a billing period without a reading at or before its start", async () => {
    const { billing } = await setup({ lateStartReading: true });
    await expect(billing.create(period, "landlord_1")).rejects.toMatchObject({
      code: "insufficient_readings"
    });
  });

  it("bills short usage when the period starts between two accepted readings", async () => {
    const { billing } = await setup();
    const bill = await billing.create({
      roomId: ROOM_ID,
      periodStart: "2026-10-01T00:00:01.000Z",
      periodEnd: "2026-10-20T12:00:00.000Z"
    }, "landlord_1");

    expect(bill).toMatchObject({
      startingReadingId: "reading_start",
      endingReadingId: "reading_end",
      consumptionKwh: 90,
      electricityChargeNpr: 1_350
    });
  });

  it("rejects a billing period that crosses a tariff change", async () => {
    const { billing } = await setup({ splitTariff: true });
    await expect(billing.create(period, "landlord_1")).rejects.toMatchObject({
      code: "tariff_period_conflict"
    });
  });
});

describe("bill lifecycle for the landlord dashboard", () => {
  it("previews a bill without saving it", async () => {
    const { billing, repositories } = await setup();
    const preview = await billing.preview(period);
    expect(preview).toMatchObject({ consumptionKwh: 90, electricityChargeNpr: 1_350, status: "draft" });
    expect(await repositories.bills.list()).toEqual([]);
  });

  it("suggests the period from the first reading to the latest, then from the last bill", async () => {
    const { billing } = await setup();
    await expect(billing.suggestPeriod(ROOM_ID)).resolves.toEqual({
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-20T12:00:00.000Z"
    });
    await billing.create({ ...period, periodEnd: "2026-10-20T12:00:00.000Z" }, "landlord_1");
    await expect(billing.suggestPeriod(ROOM_ID)).rejects.toMatchObject({ code: "no_new_readings" });
  });

  it("rejects a bill that overlaps an existing bill for the room", async () => {
    const { billing } = await setup();
    await billing.create(period, "landlord_1");
    await expect(
      billing.create({ ...period, periodStart: "2026-10-05T00:00:00.000Z" }, "landlord_1")
    ).rejects.toMatchObject({ code: "bill_period_overlap" });
  });

  it("deletes only draft bills and records the deletion in the audit log", async () => {
    const { billing, repositories } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await billing.deleteDraft(bill.billId, "landlord_1");
    expect(await repositories.bills.list()).toEqual([]);
    expect((await repositories.auditEvents.list()).map((event) => event.type)).toContain("bill.deleted");

    const again = await billing.create(period, "landlord_1");
    await billing.issue(again.billId, "landlord_1");
    await expect(billing.deleteDraft(again.billId, "landlord_1")).rejects.toMatchObject({
      code: "bill_not_draft"
    });
  });

  it("marks only issued bills as paid", async () => {
    const { billing } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await expect(billing.markPaid(bill.billId, "landlord_1")).rejects.toMatchObject({
      code: "bill_not_issued"
    });
    await billing.issue(bill.billId, "landlord_1");
    const paid = await billing.markPaid(bill.billId, "landlord_1");
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBeTruthy();
  });

  it("attaches the landlord's active receive wallets when a bill is issued", async () => {
    const { billing, repositories } = await setup();
    const now = "2026-10-01T00:00:00.000Z";
    await repositories.transaction(async (tx) => {
      await tx.users?.save({
        id: "landlord_1",
        email: "landlord@example.com",
        name: "Landlord",
        role: "landlord",
        propertyIds: ["property_1"],
        createdAt: now,
        updatedAt: now
      });
      await tx.properties?.save({
        id: "property_1",
        name: "Test Property",
        ownerId: "landlord_1",
        createdAt: now
      });
      await tx.rooms.save({
        id: ROOM_ID,
        name: "Bill test room",
        description: "",
        propertyId: "property_1",
        createdAt: now
      });
      await tx.userWallets?.save({
        id: "wal_1",
        userId: "landlord_1",
        type: "esewa",
        label: "eSewa — Landlord",
        accountId: "9800000000",
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
    });

    const bill = await billing.create(period, "landlord_1");
    const issued = await billing.issue(bill.billId, "landlord_1");
    expect(issued.receiveWallets).toHaveLength(1);
    expect(issued.receiveWallets?.[0]).toMatchObject({ label: "eSewa — Landlord", isDefault: true });
  });

  it("waits for landlord verification after the renter submits a transaction ID", async () => {
    const { billing } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await billing.issue(bill.billId, "landlord_1");

    const submitted = await billing.submitPayment(bill.billId, "renter_1", {
      method: "esewa",
      transactionId: "TX-0A12B34C",
      note: "Paid from eSewa ending 4321"
    });
    expect(submitted.status).toBe("payment_pending_verification");
    expect(submitted.paymentDetails).toMatchObject({
      method: "esewa",
      transactionId: "TX-0A12B34C",
      note: "Paid from eSewa ending 4321"
    });

    const verified = await billing.verifyPayment(submitted.billId, "landlord_1");
    expect(verified.status).toBe("paid");
    expect(verified.paidAt).toBeTruthy();
    expect(verified.paymentDetails).toMatchObject({
      transactionId: "TX-0A12B34C",
      verifiedBy: "landlord_1"
    });
  });

  it("applies a courtesy credit when upholding a dispute, capped at the bill amount", async () => {
    const { billing, sessions } = await setup();
    const bill = await billing.create(period, "landlord_1");
    await billing.issue(bill.billId, "landlord_1");
    const first = await sessions.openBillDispute(bill.billId, "Usage looks high", "renter_1");
    await expect(
      sessions.resolveDispute(first.id, "rejected", "Readings are correct.", "landlord_1", 100)
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      sessions.resolveDispute(first.id, "upheld", "Too much.", "landlord_1", 2_000)
    ).rejects.toMatchObject({ code: "credit_exceeds_bill" });
    const resolved = await sessions.resolveDispute(
      first.id, "upheld", "Courtesy credit applied.", "landlord_1", 350
    );
    expect(resolved.creditNpr).toBe(350);
    await expect(billing.get(bill.billId)).resolves.toMatchObject({
      electricityChargeNpr: 1_350,
      creditNpr: 350,
      amountDueNpr: 1_000
    });
  });
});
