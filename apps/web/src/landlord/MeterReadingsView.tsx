import React from 'react';
import { Gauge, ShieldCheck, Zap } from 'lucide-react';
import type { Room } from './types';

interface MeterReadingsViewProps {
  rooms: Room[];
}

export const MeterReadingsView: React.FC<MeterReadingsViewProps> = ({ rooms }) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sub-meter Readings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Live readings signed by each physical meter. Values update automatically as the
            hardware reports in.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-100">
          <Zap className="w-3.5 h-3.5" />
          <span>Hardware-signed</span>
        </div>
      </div>

      {rooms.length === 0 && (
        <div className="bg-white rounded-2xl p-10 border border-slate-200/80 text-center text-xs text-slate-400">
          No rooms yet. Add a room and connect a meter to start recording readings.
        </div>
      )}

      {/* Grid of Meter Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {rooms.map((room) => {
          const delta = Math.max(0, Number((room.currentReading - room.startReading).toFixed(1)));

          return (
            <div
              key={room.id}
              className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                    {room.unitNumber}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Room {room.unitNumber}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {room.renterName || 'Vacant Unit'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      room.meterStatus === 'Working' ? 'bg-blue-600' : 'bg-slate-400'
                    }`}
                  ></span>
                  <span>{room.meterStatus}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-100 text-xs">
                <div className="flex items-center justify-between text-slate-500">
                  <span>Hardware ID</span>
                  <span className="font-mono text-slate-700">{room.meterId}</span>
                </div>

                <div className="flex items-center justify-between text-slate-500">
                  <span>Start Reading</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {room.startReading.toFixed(1)} kWh
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-500">
                  <span>Current Reading</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {room.currentReading.toFixed(3)} kWh
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                  <span className="text-blue-900 font-semibold">Net Used (Delta)</span>
                  <span className="font-extrabold text-blue-600 text-sm tabular-nums">
                    {delta} units
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <ShieldCheck className="w-3 h-3" />
                  Signed by the meter
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Gauge className="w-3.5 h-3.5" />
                  Live
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
