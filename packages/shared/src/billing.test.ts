import { describe, expect, it } from "vitest";
import {
  calculateBill,
  energyFromPower,
  roundKwh,
  roundNpr,
  sessionEnergy
} from "./billing.js";

describe("billing", () => {
  it("rounds kWh to six decimals and NPR to paisa", () => {
    expect(roundKwh(1.12345678)).toBe(1.123457);
    expect(roundNpr(13.455)).toBe(13.46);
    expect(roundNpr(13.454)).toBe(13.45);
  });

  it("integrates power over time", () => {
    expect(energyFromPower(1_000, 3_600)).toBe(1);
    expect(energyFromPower(2_000, 1_800)).toBe(1);
    expect(energyFromPower(0, 60)).toBe(0);
  });

  it("rejects invalid power and duration", () => {
    expect(() => energyFromPower(-1, 60)).toThrow();
    expect(() => energyFromPower(1, -1)).toThrow();
    expect(() => energyFromPower(Number.NaN, 60)).toThrow();
  });

  it("computes positive session energy and rejects resets", () => {
    expect(sessionEnergy(10, 12.3456789)).toBe(2.345679);
    expect(() => sessionEnergy(12, 10)).toThrow(/reset/);
    expect(() => sessionEnergy(Number.POSITIVE_INFINITY, 1)).toThrow(/finite/);
  });

  it("calculates the Nepali tariff amount", () => {
    expect(calculateBill(3.333, 13.5)).toBe(45);
    expect(calculateBill(0, 13.5)).toBe(0);
    expect(() => calculateBill(-1, 13.5)).toThrow();
    expect(() => calculateBill(1, 0)).toThrow();
  });
});
