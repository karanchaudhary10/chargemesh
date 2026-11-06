export type ReadingFlag =
  | "unregistered_meter"
  | "room_mismatch"
  | "signature_invalid"
  | "future_timestamp"
  | "stale_timestamp"
  | "duplicate_reading"
  | "replayed_sequence"
  | "out_of_order_timestamp"
  | "meter_reset"
  | "suspicious_power"
  | "suspicious_energy_jump";

export interface EvidenceReading {
  id: string;
  sequence: number;
  timestamp: string;
  cumulativeEnergyKwh: number;
  powerW: number;
  status: "accepted" | "rejected" | "quarantined";
  flags: ReadingFlag[];
}

export interface SessionEvidence {
  sessionId: string;
  roomId: string;
  meterId: string;
  status: "active" | "closed" | "disputed";
  tariffNprPerKwh: number;
  startEnergyKwh: number;
  endEnergyKwh: number;
  energyKwh: number;
  amountNpr: number;
  readingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  quarantinedCount: number;
  flags: ReadingFlag[];
  readings: EvidenceReading[];
  auditEventIds: string[];
  auditChainValid: boolean;
}

export interface EvidenceBundle {
  generatedAt: string;
  evidenceHash: string;
  readingEvidenceHash: string;
  audit: {
    eventCount: number;
    headHash: string;
    chainValid: boolean;
  };
  sessions: SessionEvidence[];
}

export interface PolicyFinding {
  code: string;
  severity: "error" | "warning";
  message: string;
  sessionId?: string;
}

export interface PolicyResult {
  status: "verified" | "flagged" | "review";
  findings: PolicyFinding[];
}

const SIGNATURE_ANOMALIES = new Set<string>([
  "unregistered_meter",
  "room_mismatch",
  "signature_invalid",
  "future_timestamp",
  "stale_timestamp",
  "duplicate_reading",
  "replayed_sequence",
  "out_of_order_timestamp",
  "meter_reset",
  "suspicious_power",
  "suspicious_energy_jump"
]);

const roundNpr = (value: number): number => Math.round(value * 100) / 100;

function evaluateSession(session: SessionEvidence): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const add = (code: string, severity: "error" | "warning", message: string) => {
    findings.push({ code, severity, message, sessionId: session.sessionId });
  };

  if (session.status === "active") {
    add("session_not_closed", "warning", "Session is still active and is not final billing evidence");
  }

  if (session.acceptedCount === 0) {
    add("no_verified_readings", "error", "Session has no accepted signed readings");
  }

  if (session.rejectedCount > 0) {
    add("rejected_readings_present", "error", "Session contains rejected readings");
  }

  if (session.quarantinedCount > 0) {
    add("quarantined_readings_present", "error", "Session contains quarantined readings");
  }

  if (session.flags.some((flag) => SIGNATURE_ANOMALIES.has(flag))) {
    add(
      "signature_or_sequence_anomaly",
      "error",
      `Evidence contains integrity anomalies: ${session.flags
        .filter((flag) => SIGNATURE_ANOMALIES.has(flag))
        .join(", ")}`
    );
  }

  if (session.endEnergyKwh < session.startEnergyKwh) {
    add("negative_energy", "error", "End energy is lower than start energy");
  }

  const expectedEnergy = session.endEnergyKwh - session.startEnergyKwh;
  if (Math.abs(expectedEnergy - session.energyKwh) > 1e-6) {
    add("energy_mismatch", "error", "Stored session energy does not match meter start/end readings");
  }

  if (session.tariffNprPerKwh <= 0) {
    add("invalid_tariff", "error", "Session tariff is not positive");
  } else {
    const expectedAmount = roundNpr(expectedEnergy * session.tariffNprPerKwh);
    if (Math.abs(expectedAmount - session.amountNpr) > 0.01) {
      add("amount_mismatch", "error", "Stored amount does not match energy multiplied by tariff");
    }
  }

  if (session.readings.length < 2) {
    add("insufficient_reading_span", "warning", "Fewer than two readings support this session");
  }

  if (session.auditEventIds.length === 0) {
    add("missing_audit_evidence", "warning", "No audit events are linked to this session");
  }

  if (!session.auditChainValid) {
    add("session_audit_chain_broken", "error", "The local audit chain is not valid");
  }

  return findings;
}

export function evaluateEvidence(bundle: EvidenceBundle): PolicyResult {
  const findings: PolicyFinding[] = [];

  if (!bundle.audit.chainValid) {
    findings.push({
      code: "audit_chain_broken",
      severity: "error",
      message: "The append-only local audit hash chain failed verification"
    });
  }

  if (!bundle.evidenceHash) {
    findings.push({
      code: "missing_evidence_hash",
      severity: "error",
      message: "Evidence bundle has no integrity hash"
    });
  }

  for (const session of bundle.sessions) {
    findings.push(...evaluateSession(session));
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");

  return {
    status: hasError ? "flagged" : hasWarning ? "review" : "verified",
    findings
  };
}

export interface ReadingEvidence {
  id: string;
  meterId: string;
  sessionId?: string;
  signedPayload: {
    sequence: number;
    timestamp: string;
    cumulativeEnergyKwh?: number;
    cumulativeKwh?: number;
    powerW?: number;
  };
  signature: string;
  publicKeyPem: string;
  status: "accepted" | "rejected" | "quarantined";
  flags: string[];
  reasons: string[];
  maxPowerW: number;
  energyJumpTolerance: number;
}

export function evaluateReadingEvidence(readings: ReadingEvidence[]): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const byMeter = new Map<string, ReadingEvidence[]>();

  for (const reading of readings) {
    const meterReadings = byMeter.get(reading.meterId) ?? [];
    meterReadings.push(reading);
    byMeter.set(reading.meterId, meterReadings);

    if (reading.status !== "accepted") {
      findings.push({
        code: reading.status === "rejected" ? "rejected_reading" : "quarantined_reading",
        severity: "error",
        message: `Reading ${reading.id} has status ${reading.status}`,
        sessionId: reading.sessionId
      });
    }

    for (const flag of reading.flags) {
      if (SIGNATURE_ANOMALIES.has(flag)) {
        findings.push({
          code: `reading_${flag}`,
          severity: "error",
          message: `Reading ${reading.id}: ${reading.reasons.join("; ") || flag}`,
          sessionId: reading.sessionId
        });
      }
    }

    if (!reading.signature || !reading.publicKeyPem) {
      findings.push({
        code: "incomplete_signature_evidence",
        severity: "error",
        message: `Reading ${reading.id} is missing its signature or meter public key`,
        sessionId: reading.sessionId
      });
    }
    if (
      !Number.isInteger(reading.signedPayload.sequence) ||
      reading.signedPayload.sequence < 1 ||
      !Number.isFinite(Date.parse(reading.signedPayload.timestamp))
    ) {
      findings.push({
        code: "invalid_reading_sequence_or_timestamp",
        severity: "error",
        message: `Reading ${reading.id} has an invalid sequence or timestamp`,
        sessionId: reading.sessionId
      });
    }
    if (
      !Number.isFinite(reading.maxPowerW) ||
      reading.maxPowerW <= 0 ||
      !Number.isFinite(reading.energyJumpTolerance) ||
      reading.energyJumpTolerance <= 0
    ) {
      findings.push({
        code: "invalid_meter_verification_limits",
        severity: "error",
        message: `Reading ${reading.id} has invalid meter plausibility limits`,
        sessionId: reading.sessionId
      });
    } else if (
      reading.signedPayload.powerW !== undefined &&
      reading.signedPayload.powerW > reading.maxPowerW
    ) {
      findings.push({
        code: "power_exceeds_meter_limit",
        severity: "error",
        message: `Reading ${reading.id} reports ${reading.signedPayload.powerW} W above the ${reading.maxPowerW} W limit`,
        sessionId: reading.sessionId
      });
    }
  }

  for (const [meterId, meterReadings] of byMeter) {
    const bySequence = new Map<number, ReadingEvidence[]>();
    for (const reading of meterReadings) {
      const sequence = reading.signedPayload.sequence;
      const sameSequence = bySequence.get(sequence) ?? [];
      sameSequence.push(reading);
      bySequence.set(sequence, sameSequence);
    }

    for (const [sequence, duplicates] of bySequence) {
      if (duplicates.length > 1) {
        findings.push({
          code: "duplicate_sequence",
          severity: "error",
          message: `Meter ${meterId} has ${duplicates.length} readings with sequence ${sequence}`
        });
      }
    }

    const ordered = [...meterReadings].sort(
      (a, b) => a.signedPayload.sequence - b.signedPayload.sequence
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const previousTime = Date.parse(previous.signedPayload.timestamp);
      const currentTime = Date.parse(current.signedPayload.timestamp);
      if (currentTime <= previousTime) {
        findings.push({
          code: "out_of_order_reading_timestamp",
          severity: "error",
          message: `Meter ${meterId} timestamps do not increase with sequence`,
          sessionId: current.sessionId
        });
      }
      const previousEnergy =
        previous.signedPayload.cumulativeEnergyKwh ?? previous.signedPayload.cumulativeKwh;
      const currentEnergy =
        current.signedPayload.cumulativeEnergyKwh ?? current.signedPayload.cumulativeKwh;
      if (previousEnergy !== undefined && currentEnergy !== undefined) {
        if (currentEnergy < previousEnergy) {
          findings.push({
            code: "cumulative_energy_decreased",
            severity: "error",
            message: `Meter ${meterId} cumulative energy decreased between sequences ${previous.signedPayload.sequence} and ${current.signedPayload.sequence}`,
            sessionId: current.sessionId
          });
        } else if (currentEnergy > previousEnergy && currentTime > previousTime) {
          const impliedPowerW =
            ((currentEnergy - previousEnergy) * 3_600_000_000) /
            (currentTime - previousTime);
          const powerLimit = current.maxPowerW * current.energyJumpTolerance;
          if (impliedPowerW > powerLimit) {
            findings.push({
              code: "energy_jump_exceeds_meter_limit",
              severity: "error",
              message: `Meter ${meterId} implied ${Math.round(impliedPowerW)} W between sequences ${previous.signedPayload.sequence} and ${current.signedPayload.sequence}, above the ${Math.round(powerLimit)} W plausibility limit`,
              sessionId: current.sessionId
            });
          }
        }
      }
    }
  }

  return findings;
}

export function evaluateVerification(
  bundle: EvidenceBundle,
  readings: ReadingEvidence[]
): PolicyResult {
  const result = evaluateEvidence(bundle);
  const findings = [...result.findings, ...evaluateReadingEvidence(readings)];
  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");

  return {
    status: hasError ? "flagged" : hasWarning ? "review" : "verified",
    findings
  };
}
