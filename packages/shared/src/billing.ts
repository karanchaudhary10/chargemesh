export const KWH_PRECISION = 1_000_000;
export const NPR_PRECISION = 100;

export function roundKwh(value: number): number {
  return Math.round(value * KWH_PRECISION) / KWH_PRECISION;
}

export function roundNpr(value: number): number {
  return Math.round(value * NPR_PRECISION) / NPR_PRECISION;
}

export function energyFromPower(powerW: number, seconds: number): number {
  if (!Number.isFinite(powerW) || powerW < 0) {
    throw new Error("Power must be a finite non-negative number");
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Duration must be a finite non-negative number");
  }
  return roundKwh((powerW * seconds) / 3_600_000);
}

export function sessionEnergy(startEnergyKwh: number, endEnergyKwh: number): number {
  if (!Number.isFinite(startEnergyKwh) || !Number.isFinite(endEnergyKwh)) {
    throw new Error("Energy readings must be finite numbers");
  }
  if (endEnergyKwh < startEnergyKwh) {
    throw new Error("End energy cannot be lower than start energy; meter reset must be investigated");
  }
  return roundKwh(endEnergyKwh - startEnergyKwh);
}

export function calculateBill(energyKwh: number, tariffNprPerKwh: number): number {
  if (!Number.isFinite(energyKwh) || energyKwh < 0) {
    throw new Error("Energy must be a finite non-negative number");
  }
  if (!Number.isFinite(tariffNprPerKwh) || tariffNprPerKwh <= 0) {
    throw new Error("Tariff must be a finite positive number");
  }
  return roundNpr(energyKwh * tariffNprPerKwh);
}

export const BILLING_PRECISION_KWH = 1_000_000;
export const BILLING_PRECISION_NPR = 100;
export const BILLING_ROUNDING_RULE = "round to nearest NPR cent (Math.round(value * 100) / 100)";

export function roundKwhBill(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Value must be finite");
  }
  return Math.round(value * BILLING_PRECISION_KWH) / BILLING_PRECISION_KWH;
}

export function roundNprBill(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Value must be finite");
  }
  return Math.round(value * BILLING_PRECISION_NPR) / BILLING_PRECISION_NPR;
}

export function computeConsumption(startCumulativeKwh: number, endCumulativeKwh: number): number {
  if (!Number.isFinite(startCumulativeKwh) || !Number.isFinite(endCumulativeKwh)) {
    throw new Error("Cumulative readings must be finite numbers");
  }
  if (endCumulativeKwh < startCumulativeKwh) {
    throw new Error("End energy cannot be lower than start energy");
  }
  const consumption = endCumulativeKwh - startCumulativeKwh;
  return roundKwhBill(consumption);
}

export function computeElectricityCharge(consumptionKwh: number, rateNprPerKwh: number): number {
  if (!Number.isFinite(consumptionKwh) || consumptionKwh < 0) {
    throw new Error("Consumption must be a finite non-negative number");
  }
  if (!Number.isFinite(rateNprPerKwh) || rateNprPerKwh <= 0) {
    throw new Error("Tariff rate must be a finite positive number");
  }
  const charge = consumptionKwh * rateNprPerKwh;
  return roundNprBill(charge);
}
