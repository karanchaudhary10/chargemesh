import React, { useEffect, useState } from 'react';
import { X, Calculator, Zap, Calendar, ShieldCheck, Wallet } from 'lucide-react';
import { api, type Bill as ApiBill } from '../api.js';
import { fromLocalInput, toLocalInput } from '../lib/format.js';
import type { Room } from './types';

interface CreateBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: Room[];
  currentTariff: number;
  initialRoomId?: string;
  onCreated: (bill: ApiBill) => Promise<void>;
}

export const CreateBillModal: React.FC<CreateBillModalProps> = ({
  isOpen,
  onClose,
  rooms,
  currentTariff,
  initialRoomId,
  onCreated,
}) => {
  const occupiedRooms = rooms.filter((r) => r.renterName);
  const billableRooms = rooms.filter((r) => r.rawMeterId);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [preview, setPreview] = useState<ApiBill | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRoom =
    rooms.find((r) => r.id === selectedRoomId) || occupiedRooms[0] || rooms[0];

  // Choose a sensible room each time the modal is opened.
  useEffect(() => {
    if (!isOpen) return;
    const preferred = initialRoomId ? rooms.find((r) => r.id === initialRoomId) : undefined;
    const first = preferred ?? occupiedRooms.find((r) => r.rawMeterId) ?? billableRooms[0];
    setSelectedRoomId(first?.id ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialRoomId]);

  // Ask the backend where the next billable window starts and ends.
  useEffect(() => {
    if (!isOpen || !selectedRoomId) return;
    let cancelled = false;
    setPreview(null);
    setSuggestionError(null);
    setPreviewError(null);
    api
      .billSuggestion(selectedRoomId)
      .then((suggestion) => {
        if (cancelled) return;
        setPeriodStart(toLocalInput(suggestion.periodStart));
        setPeriodEnd(toLocalInput(suggestion.periodEnd));
      })
      .catch((err) => {
        if (cancelled) return;
        setPeriodStart('');
        setPeriodEnd('');
        setSuggestionError(err instanceof Error ? err.message : 'No billable readings yet.');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedRoomId]);

  // Recalculate through the server whenever the user tweaks the window.
  useEffect(() => {
    if (!isOpen || !selectedRoomId || !periodStart || !periodEnd) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .previewBill({
          roomId: selectedRoomId,
          periodStart: fromLocalInput(periodStart),
          periodEnd: fromLocalInput(periodEnd)
        })
        .then(({ bill }) => {
          if (cancelled) return;
          setPreview(bill);
          setPreviewError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : 'Could not calculate this bill.');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, selectedRoomId, periodStart, periodEnd]);

  if (!isOpen) return null;

  const handleRoomChange = (roomId: string) => {
    setSelectedRoomId(roomId);
    setPreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom || !periodStart || !periodEnd || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const { bill } = await api.createBill({
        roomId: selectedRoom.id,
        periodStart: fromLocalInput(periodStart),
        periodEnd: fromLocalInput(periodEnd)
      });
      await onCreated(bill);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this bill.');
    } finally {
      setBusy(false);
    }
  };

  const unitsUsed = preview?.consumptionKwh ?? 0;
  const rate = preview?.rateNprPerKwh ?? currentTariff;
  const totalAmount = preview?.electricityChargeNpr ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Create Electricity Bill</h3>
              <p className="text-xs text-slate-500">Calculate usage from signed meter readings</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {billableRooms.length === 0 ? (
          <div className="mt-5 p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900 leading-relaxed">
            No room has a meter yet. Add a room with a connected meter first, then come back once it has recorded
            readings.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Select Room &amp; Tenant
              </label>
              <select
                value={selectedRoomId}
                onChange={(e) => handleRoomChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              >
                {billableRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    Room {room.unitNumber} — {room.renterName ?? 'no renter'} ({room.floor})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Period Start
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    step="1"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Period End
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    step="1"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Start Reading (kWh)
                </label>
                <input
                  type="text"
                  readOnly
                  value={preview ? preview.startingCumulativeKwh.toFixed(3) : '—'}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  End Reading (kWh)
                </label>
                <input
                  type="text"
                  readOnly
                  value={preview ? preview.endingCumulativeKwh.toFixed(3) : '—'}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                />
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-800 font-medium">
                  Calculated Usage: <span className="font-bold">{unitsUsed.toFixed(3)} units</span>
                </div>
                <div className="text-[11px] text-blue-600 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {unitsUsed.toFixed(3)} units × USD {rate.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-blue-700 tracking-wider block">
                  Total Due
                </span>
                <span className="text-xl font-bold text-blue-900 tabular-nums">
                  USD {totalAmount.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-2.5">
              <Wallet className="w-4 h-4 text-blue-600 shrink-0 mt-px" />
              <div className="text-[11px] leading-relaxed">
                <p className="font-semibold text-slate-900">
                  Payment details are added automatically
                </p>
                <p className="text-slate-600 mt-0.5">
                  The renter sees your saved eSewa / Fonepay / Khalti / bank wallets when you send
                  this bill. Manage them in Settings → Payment Wallets.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Amounts are computed by the server from the meter's signed readings. They can't be typed in, and the
                ledger keeps both copies in sync.
              </span>
            </div>

            {suggestionError && (
              <div className="p-3 bg-amber-50 text-amber-800 text-xs rounded-xl border border-amber-200">
                {suggestionError}
              </div>
            )}
            {previewError && (
              <div className="p-3 bg-amber-50 text-amber-800 text-xs rounded-xl border border-amber-200">
                {previewError}
              </div>
            )}
            {selectedRoom && !selectedRoom.renterName && (
              <div className="p-3 bg-blue-50 text-blue-800 text-xs rounded-xl border border-blue-100">
                Room {selectedRoom.unitNumber} has no renter right now, so nobody will see this bill.
              </div>
            )}
            {error && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !preview}
                className="px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors shadow-xs"
              >
                {busy ? 'Creating…' : 'Create Draft Bill'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
