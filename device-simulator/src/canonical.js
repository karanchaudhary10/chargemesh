function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot encode non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "bigint") {
    throw new Error("Canonical JSON cannot encode bigint");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Canonical JSON cannot encode cyclic arrays");
    }
    seen.add(value);
    const result = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new Error("Canonical JSON cannot encode cyclic objects");
    }
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        result[key] = normalize(value[key], seen);
      }
    }
    seen.delete(value);
    return result;
  }

  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalPayload(reading) {
  if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
    throw new Error("Reading must be an object");
  }
  const { signature: _signature, ...payload } = reading;
  return canonicalJson(payload);
}
