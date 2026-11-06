export function usd(amount: number | undefined | null): string {
  const value = amount ?? 0;
  return `USD ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const npr = usd;

/** Small kWh values need more precision, so show more decimals below a threshold. */
export function kwh(value: number | undefined | null): string {
  const v = value ?? 0;
  const digits = Math.abs(v) < 10 ? 3 : 1;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} kWh`;
}

export function watts(value: number | undefined | null): string {
  if (value === undefined || value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kW` : `${Math.round(value)} W`;
}

export function dateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function period(start: string, end: string): string {
  return `${dateTime(start)} → ${dateTime(end)}`;
}

export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

export function firstName(name: string | undefined | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** <input type="datetime-local"> works in local time without a zone suffix. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function shortId(id: string): string {
  const tail = id.replace(/^[a-z]+_/, "");
  return `#${tail.slice(0, 6).toUpperCase()}`;
}
