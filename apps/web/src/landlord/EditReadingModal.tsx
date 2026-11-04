import React, { useState } from 'react';
import { X, Gauge, ShieldCheck, RefreshCw } from 'lucide-react';
import type { Bill } from './types';

interface EditReadingModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: Bill | null;
  onRecord: (bill: Bill) => Promise<void>;
}

/**
 * Meter readings are signed by the device and cannot be rewritten. This modal
 * keeps the original breakdown visible and lets the landlord record a fresh
 * signed reading so the next bill picks up the latest usage.
 */
export const EditReadingModal: React.FC<EditReadingModalProps> = ({
  isOpen,
  onClose,
  bill,
  onRecord,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !bill) return null;

  const handleRecord = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRecord(bill);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record a fresh reading.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Gauge className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Meter Reading for Bill {bill.billNumber}
              </h3>
              <p className="text-xs text-slate-500">
                {bill.renterName} (Room {bill.roomUnit})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Start Reading
              </span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">
                {bill.startReading.toFixed(3)} kWh
              </span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                End Reading
              </span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">
                {bill.endReading.toFixed(3)} kWh
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs">
            <div>
              <span className="text-blue-700 font-medium block">Recorded units</span>
              <span className="text-sm font-bold text-blue-950 tabular-nums">
                {bill.electricityUsed.toFixed(3)} units
              </span>
            </div>
            <div className="text-right">
              <span className="text-blue-700 font-medium block">Bill total</span>
              <span className="text-base font-bold text-blue-950 tabular-nums">
                USD {bill.totalAmountNpr.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              Readings are cryptographically signed by the sub-meter, so past values can't be
              edited. Record a fresh reading to capture current usage; the next bill will use it.
            </span>
          </div>

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
              Close
            </button>
            <button
              type="button"
              onClick={() => void handleRecord()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>{busy ? 'Recording…' : 'Record Fresh Reading'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
