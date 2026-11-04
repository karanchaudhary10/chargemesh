import type { Tariff } from "@chargemesh/shared";
import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "./audit-core.js";
import type { AuditService } from "./audit.js";
import type { Repositories } from "./repositories.js";
import { AppError } from "./errors.js";

export function latestTariff(tariffs: Tariff[]): Tariff | null {
  const sorted = [...tariffs].sort(
    (a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom)
  );
  return sorted[0] ?? null;
}

function tariffIdOf(tariff: Tariff): string {
  return tariff.tariffId ?? tariff.id;
}

function tariffRateOf(tariff: Tariff): number {
  return tariff.rateNprPerKwh ?? tariff.nprPerKwh;
}

function tariffScope(tariff: Tariff): string | undefined {
  return tariff.roomId ?? tariff.scope;
}

function overlaps(a: Tariff, b: Tariff): boolean {
  const ascope = tariffScope(a);
  const bscope = tariffScope(b);
  if (ascope && bscope && ascope !== bscope) {
    return false;
  }
  if (!ascope && !bscope) {
    // global scope
  }
  const aStart = Date.parse(a.effectiveFrom);
  const aEnd = a.effectiveTo ? Date.parse(a.effectiveTo) : Number.POSITIVE_INFINITY;
  const bStart = Date.parse(b.effectiveFrom);
  const bEnd = b.effectiveTo ? Date.parse(b.effectiveTo) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(aStart) || Number.isNaN(aEnd) || Number.isNaN(bStart) || Number.isNaN(bEnd)) {
    return false;
  }
  return aStart <= bEnd && bStart <= aEnd;
}

export class TariffService {
  constructor(
    private readonly repositories: Repositories,
    private readonly audit: AuditService
  ) {}

  async list(): Promise<Tariff[]> {
    const tariffs = await this.repositories.tariffs.list();
    return tariffs.sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
  }

  async get(tariffId: string): Promise<Tariff | null> {
    const tariffs = await this.repositories.tariffs.list();
    const found = tariffs.find((tariff) => tariffIdOf(tariff) === tariffId || tariff.id === tariffId);
    return found ?? null;
  }

  async current(): Promise<Tariff | null> {
    const tariffs = await this.repositories.tariffs.list();
    const global = tariffs.filter((tariff) => !tariffScope(tariff));
    return latestTariff(global.length > 0 ? global : tariffs);
  }

  async set(nprPerKwh: number, configuredBy: string, roomId?: string): Promise<Tariff> {
    return this.create(
      {
        rateNprPerKwh: nprPerKwh,
        roomId,
        effectiveFrom: new Date().toISOString(),
        configuredBy
      },
      configuredBy
    );
  }

  async create(input: {
    rateNprPerKwh?: number;
    nprPerKwh?: number;
    roomId?: string;
    scope?: string;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    configuredBy?: string;
  }, actorName: string): Promise<Tariff> {
    const rate = input.rateNprPerKwh ?? input.nprPerKwh;
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      throw new AppError(400, "validation_failed", "Tariff rate must be a finite positive number");
    }
    if (input.effectiveFrom && Number.isNaN(Date.parse(input.effectiveFrom))) {
      throw new AppError(400, "validation_failed", "Invalid effectiveFrom date");
    }
    if (input.effectiveTo !== undefined && input.effectiveTo !== null && Number.isNaN(Date.parse(input.effectiveTo))) {
      throw new AppError(400, "validation_failed", "Invalid effectiveTo date");
    }
    const result = await this.repositories.transaction(async (tx) => {
      const now = new Date().toISOString();
      const effectiveFrom = input.effectiveFrom ?? now;
      const effectiveTo = input.effectiveTo === undefined ? null : input.effectiveTo;
      if (effectiveTo !== null && Date.parse(effectiveTo) < Date.parse(effectiveFrom)) {
        throw new AppError(400, "validation_failed", "effectiveTo must be after or equal to effectiveFrom");
      }
      const scope = input.roomId ?? input.scope;
      const tariff: Tariff = {
        id: `tariff_${randomUUID().slice(0, 12)}`,
        tariffId: `tariff_${randomUUID().slice(0, 12)}`,
        roomId: scope,
        scope,
        nprPerKwh: rate,
        rateNprPerKwh: rate,
        effectiveFrom,
        effectiveTo,
        createdAt: now,
        configuredBy: input.configuredBy ?? actorName
      };
      const tariffs = await tx.tariffs.list();
      for (const existing of tariffs) {
        const exScope = tariffScope(existing);
        if ((scope && exScope && scope === exScope) || (!scope && !exScope)) {
          if (overlaps(existing, tariff)) {
            const existingStart = Date.parse(existing.effectiveFrom);
            const nextStart = Date.parse(effectiveFrom);
            if (existing.effectiveTo || existingStart >= nextStart) {
              throw new AppError(409, "tariff_overlap", "Overlapping active tariff period for this scope");
            }
            existing.effectiveTo = new Date(nextStart - 1).toISOString();
            await tx.tariffs.save(existing);
          }
        }
      }
      await tx.tariffs.save(tariff);
      const event = await appendAuditEvent(tx.auditEvents, {
        type: "tariff.set",
        actor: input.configuredBy ?? actorName,
        payload: { tariffId: tariffIdOf(tariff), nprPerKwh: rate, roomId: scope ?? null }
      });
      return { tariff, event };
    });
    void this.audit.notarize(result.event);
    return result.tariff;
  }

  async findApplicable(roomId: string | undefined, at: string): Promise<Tariff> {
    const tariffs = await this.repositories.tariffs.list();
    const time = Date.parse(at);
    if (Number.isNaN(time)) {
      throw new AppError(400, "validation_failed", "Invalid timestamp");
    }
    const candidates = tariffs.filter((tariff) => {
      const scope = tariffScope(tariff);
      if (scope && roomId && scope !== roomId) {
        return false;
      }
      if (scope && !roomId) {
        return false;
      }
      if (!scope && roomId) {
        // global allowed? prefer room specific; but can use global
      }
      const start = Date.parse(tariff.effectiveFrom);
      if (Number.isNaN(start) || start > time) {
        return false;
      }
      const end = tariff.effectiveTo ? Date.parse(tariff.effectiveTo) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(end) || end < time) {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      throw new AppError(422, "tariff_not_applicable", "No applicable tariff for the billing period");
    }
    const roomSpecific = candidates.filter((t) => tariffScope(t) === roomId);
    const pool = roomSpecific.length > 0 ? roomSpecific : candidates.filter((t) => !tariffScope(t));
    if (pool.length !== candidates.length && roomSpecific.length === 0) {
      // if roomSpecific not found use global
    }
    if (pool.length === 0) {
      throw new AppError(422, "tariff_not_applicable", "No applicable tariff for the billing period");
    }
    if (pool.length > 1) {
      throw new AppError(422, "tariff_period_conflict", "Billing period crosses a tariff change");
    }
    const selected = pool[0];
    if (!selected) {
      throw new AppError(422, "tariff_not_applicable", "No applicable tariff for the billing period");
    }
    return selected;
  }
}

export { tariffIdOf, tariffRateOf };
