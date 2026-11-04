import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Gauge, RefreshCw, Zap } from "lucide-react";
import { api, type Reading } from "../api.js";
import { Alert } from "../components/ui.js";
import { dateTime, kwh, timeAgo, watts } from "../lib/format.js";
import { messageOf } from "../lib/model.js";
import type { Room } from "./types.js";

const POLL_MS = 5_000;
const WINDOW_MS = 15 * 60_000;
const HEIGHT = 236;
const PAD = { top: 18, right: 18, bottom: 30, left: 52 };

interface Sample {
  time: number;
  powerW: number;
  cumulativeKwh?: number;
}

function ascending(a: Reading, b: Reading) {
  return Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp);
}

function cumulativeKwh(reading: Reading): number | undefined {
  const payload = reading.payload as { cumulativeEnergyKwh?: number; cumulativeKwh?: number };
  return payload.cumulativeEnergyKwh ?? payload.cumulativeKwh;
}

/** Accepted readings from the meter that produced the newest reading. */
function acceptedReadings(readings: Reading[]): Reading[] {
  const accepted = readings.filter((reading) => reading.status === "accepted").sort(ascending);
  const latest = accepted[accepted.length - 1];
  if (!latest) return [];
  return accepted.filter((reading) => reading.meterId === latest.meterId);
}

/** Uses the reported draw, or derives it from the cumulative meter delta. */
function toSamples(readings: Reading[]): Sample[] {
  const samples: Sample[] = [];
  readings.forEach((reading, index) => {
    const time = Date.parse(reading.payload.timestamp);
    if (Number.isNaN(time)) return;

    let powerW = reading.payload.powerW;
    if (typeof powerW !== "number" || !Number.isFinite(powerW) || powerW < 0) {
      const previous = readings[index - 1];
      const previousTime = previous ? Date.parse(previous.payload.timestamp) : Number.NaN;
      const current = cumulativeKwh(reading);
      const before = previous ? cumulativeKwh(previous) : undefined;
      const seconds = (time - previousTime) / 1000;
      if (current === undefined || before === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        return;
      }
      const delta = current - before;
      if (delta < 0) return;
      powerW = (delta * 3600 * 1000) / seconds;
    }

    samples.push({ time, powerW, cumulativeKwh: cumulativeKwh(reading) });
  });
  return samples;
}

function niceCeiling(value: number): number {
  const step = value <= 500 ? 100 : value <= 1_500 ? 250 : value <= 3_000 ? 500 : 1_000;
  return Math.max(step, Math.ceil(value / step) * step);
}

function axisPower(value: number): string {
  if (value === 0) return "0";
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.round(value));
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function LiveUsageChart({ rooms }: { rooms: Room[] }) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [width, setWidth] = useState(760);
  const chartRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const room = rooms.find((candidate) => candidate.id === selectedRoomId) ?? rooms[0];
  const roomId = room?.id;

  const load = useCallback(async (id: string, mode: "initial" | "poll" | "manual") => {
    const requestId = ++requestRef.current;
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);
    try {
      const { readings: next } = await api.readings(id, 240);
      if (requestId !== requestRef.current) return;
      setReadings(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(messageOf(err));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!roomId) {
      setReadings([]);
      setError(null);
      setUpdatedAt(null);
      return;
    }
    setReadings([]);
    setError(null);
    setUpdatedAt(null);
    void load(roomId, "initial");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(roomId, "poll");
    }, POLL_MS);
    return () => {
      requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [roomId, load]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      // The chart lives in a px-6 panel inside this card, so measure the card
      // (always mounted) and subtract that padding for the SVG width.
      if (next) setWidth(Math.max(280, next - 48));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const samples = useMemo(() => toSamples(acceptedReadings(readings)), [readings]);
  const latest = samples[samples.length - 1];
  const windowEnd = latest?.time ?? Date.now();
  const windowStart = windowEnd - WINDOW_MS;
  const visible = samples.filter((sample) => sample.time >= windowStart);
  const first = visible[0];
  const last = visible[visible.length - 1];

  const maxPower = niceCeiling(Math.max(0, ...visible.map((sample) => sample.powerW)));
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const xOf = (time: number) =>
    PAD.left + ((time - windowStart) / (windowEnd - windowStart || 1)) * plotWidth;
  const yOf = (powerW: number) => PAD.top + plotHeight - (powerW / maxPower) * plotHeight;

  const points = visible.map((sample) => ({
    x: xOf(sample.time),
    y: yOf(sample.powerW),
    powerW: sample.powerW,
    time: sample.time
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${PAD.top + plotHeight} L${points[0]!.x.toFixed(1)},${PAD.top + plotHeight} Z`
    : "";

  const gridValues = [1, 0.75, 0.5, 0.25, 0];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => windowStart + ratio * WINDOW_MS);

  const energyKwh =
    first?.cumulativeKwh !== undefined && last?.cumulativeKwh !== undefined
      ? Math.max(0, last.cumulativeKwh - first.cumulativeKwh)
      : undefined;

  const age = latest ? Date.now() - latest.time : Number.POSITIVE_INFINITY;
  const status: { label: string; className: string; dot: string } = !room
    ? { label: "No rooms", className: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" }
    : !room.rawMeterId
      ? { label: "No meter", className: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" }
      : !latest
        ? { label: "Waiting", className: "bg-blue-50 text-blue-700 border-blue-100", dot: "bg-blue-500" }
        : age <= 30_000
          ? { label: "Live", className: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500" }
          : age <= 5 * 60_000
            ? { label: "Delayed", className: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-500" }
            : { label: "Offline", className: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" };

  const refresh = () => {
    if (roomId) void load(roomId, "manual");
  };

  return (
    <section ref={chartRef} className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="p-6 pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">Live electricity usage</h2>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${status.className}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${status.label === "Live" ? "animate-pulse" : ""}`} />
                {status.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {room
                ? `Room ${room.unitNumber} · ${room.meterId}${room.renterName ? ` · ${room.renterName}` : " · Vacant"}`
                : "Create a room to start monitoring live usage."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="live-usage-room" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Room
          </label>
          <div className="relative">
            <select
              id="live-usage-room"
              value={room?.id ?? ""}
              onChange={(event) => setSelectedRoomId(event.target.value)}
              disabled={rooms.length === 0}
              className="appearance-none min-w-44 max-w-60 pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            >
              {rooms.length === 0 && <option value="">No rooms yet</option>}
              {rooms.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  Room {candidate.unitNumber} · {candidate.renterName ?? "Vacant"}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          </div>
        </div>
      </div>

      {error && (
        <div className="px-6 pt-4">
          <Alert kind="error">Could not load live readings: {error}</Alert>
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
            <Gauge className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 mt-3">No rooms to monitor</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
            Add a room and connect a meter. Its live usage will appear here as readings arrive.
          </p>
        </div>
      ) : !room?.rawMeterId ? (
        <div className="px-6 py-14 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
            <Gauge className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 mt-3">No meter connected to Room {room?.unitNumber}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
            Connect a sub-meter to this room to stream live usage.
          </p>
        </div>
      ) : loading ? (
        <div className="h-72 flex items-center justify-center text-xs text-slate-400">
          Loading live readings…
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="relative w-12 h-12 mx-auto">
            <span className="absolute inset-0 rounded-full bg-blue-100 animate-ping" />
            <div className="relative w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Zap className="w-6 h-6" />
            </div>
          </div>
          <h3 className="text-sm font-bold text-slate-900 mt-3">Waiting for live data</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
            {latest
              ? `The last reading was at ${dateTime(new Date(latest.time).toISOString())}. The chart shows the most recent 15 minutes once new readings arrive.`
              : `No readings from ${room.meterId} yet. The chart updates every 5 seconds as data arrives.`}
          </p>
        </div>
      ) : (
        <div className="px-6 pt-5 pb-2">
          <svg width={width} height={HEIGHT} className="block max-w-full" role="img" aria-label={`Live power usage for Room ${room.unitNumber}`}>
            <defs>
              <linearGradient id="live-usage-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {gridValues.map((ratio) => {
              const y = PAD.top + plotHeight * (1 - ratio);
              return (
                <g key={ratio}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotWidth}
                    y1={y}
                    y2={y}
                    strokeWidth="1"
                    strokeDasharray={ratio === 0 ? undefined : "3 4"}
                    className={ratio === 0 ? "stroke-slate-300" : "stroke-slate-200"}
                  />
                  <text x={PAD.left - 8} y={y + 3.5} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
                    {axisPower(maxPower * ratio)}
                  </text>
                </g>
              );
            })}

            <text x={PAD.left - 8} y={PAD.top - 6} textAnchor="end" className="fill-slate-400 text-[9px] font-semibold">
              W
            </text>

            {xTicks.map((tick, index) => (
              <text
                key={tick}
                x={PAD.left + (plotWidth * index) / (xTicks.length - 1)}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {clock(tick)}
              </text>
            ))}

            {areaPath && <path d={areaPath} fill="url(#live-usage-fill)" />}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="#2563EB"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {last && (
              <>
                <line
                  x1={xOf(last.time)}
                  x2={xOf(last.time)}
                  y1={PAD.top}
                  y2={PAD.top + plotHeight}
                  stroke="#93C5FD"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <circle cx={xOf(last.time)} cy={yOf(last.powerW)} r="7" fill="#3B82F6" opacity="0.16" />
                <circle cx={xOf(last.time)} cy={yOf(last.powerW)} r="3.5" fill="#2563EB" stroke="#FFFFFF" strokeWidth="1.5" />
              </>
            )}
          </svg>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 mb-2">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current draw</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                {last ? watts(last.powerW) : "—"}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Used in window</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                {energyKwh === undefined ? "—" : kwh(energyKwh)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Readings shown</div>
              <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{visible.length}</div>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          Last 15 minutes · auto-refreshes every 5 seconds
          {latest ? ` · last reading ${timeAgo(new Date(latest.time).toISOString())}` : ""}
          {updatedAt && !latest ? ` · checked ${dateTime(new Date(updatedAt).toISOString())}` : ""}
        </span>
        <button
          onClick={refresh}
          disabled={!roomId || refreshing || loading}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          Refresh now
        </button>
      </div>
    </section>
  );
}
