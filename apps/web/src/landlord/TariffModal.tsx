import React, { useState } from 'react';
import { X, Zap, Check } from 'lucide-react';

interface TariffModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRate: number;
  onSave: (newRate: number) => Promise<void>;
}

export const TariffModal: React.FC<TariffModalProps> = ({
  isOpen,
  onClose,
  currentRate,
  onSave,
}) => {
  const [rate, setRate] = useState<string>(currentRate.toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const val = parseFloat(rate);
    if (isNaN(val) || val <= 0) {
      setError('Enter a rate greater than zero.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(val);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this rate.');
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
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Change Electricity Rate</h3>
              <p className="text-xs text-slate-500">Update the USD per unit price for sub-meters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Tariff Rate (USD per unit/kWh)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-xs font-semibold text-slate-500">
                USD
              </span>
              <input
                type="number"
                step="0.10"
                min="0.01"
                max="10000"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-full pl-14 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Standard commercial/sub-meter slab in Kathmandu is between USD 11.50 – 14.00 per unit.
            </p>
          </div>

          <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 text-xs text-blue-900 flex items-start gap-2">
            <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              New rate will apply automatically to every room in this property from the next billing
              period onward.
            </span>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors shadow-xs"
            >
              {busy ? 'Saving…' : 'Save Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
