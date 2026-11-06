import { roundNpr } from "./billing.js";
import type {
  AttestationFinding,
  AttestationResult,
  EvidenceBundle,
  SessionEvidence
} from "./types.js";

const SIGNATURE_ANOMALIES = new Set([
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

function evaluateSession(session: SessionEvidence): AttestationFinding[] {
  const findings: AttestationFinding[] = [];
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

export function evaluateAttestation(bundle: EvidenceBundle): AttestationResult {
  const findings: AttestationFinding[] = [];

  if (!bundle.audit.chainValid) {
    findings.push({
      code: "audit_chain_broken",
      severity: "error",
      message: "The append-only local audit hash chain failed verification"
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
