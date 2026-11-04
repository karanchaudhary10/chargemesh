import React, { useEffect, useState } from 'react';
import { X, Building2 } from 'lucide-react';

export interface NewRoomInput {
  unitNumber: string;
  floor: string;
  type: string;
  meterId?: string;
  renterName?: string;
  renterEmail?: string;
  rate: number;
}

interface AddRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddRoom: (room: NewRoomInput) => Promise<void>;
  existingCount: number;
  currentRate: number;
}

export const AddRoomModal: React.FC<AddRoomModalProps> = ({
  isOpen,
  onClose,
  onAddRoom,
  currentRate,
}) => {
  const [unitNumber, setUnitNumber] = useState('');
  const [floor, setFloor] = useState('Ground Floor');
  const [roomType, setRoomType] = useState('Studio');
  const [meterId, setMeterId] = useState('');
  const [renterName, setRenterName] = useState('');
  const [renterEmail, setRenterEmail] = useState('');
  const [rate, setRate] = useState(String(currentRate || 12.5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setRate(String(currentRate || 12.5));
    }
  }, [isOpen, currentRate]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitNumber.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAddRoom({
        unitNumber: unitNumber.trim(),
        floor,
        type: roomType.trim() || 'Room',
        meterId: meterId.trim() || undefined,
        renterName: renterName.trim() || undefined,
        renterEmail: renterEmail.trim() || undefined,
        rate: Number(rate) || currentRate || 12.5,
      });
      onClose();
      setUnitNumber('');
      setMeterId('');
      setRenterName('');
      setRenterEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Add Room Unit</h3>
              <p className="text-xs text-slate-500">Expand building inventory &amp; link sub-meter</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Room Number *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 205"
                value={unitNumber}
                onChange={(e) => {
                  setUnitNumber(e.target.value);
                  if (!meterId) setMeterId(`Meter #${e.target.value}`);
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Floor
              </label>
              <select
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Ground Floor">Ground Floor</option>
                <option value="First Floor">First Floor</option>
                <option value="Second Floor">Second Floor</option>
                <option value="Third Floor">Third Floor</option>
                <option value="Fourth Floor">Fourth Floor</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Unit Type
              </label>
              <input
                type="text"
                placeholder="e.g. 1-Bedroom, Studio"
                value={roomType}
                onChange={(e) => setRoomType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Connected Meter ID
              </label>
              <input
                type="text"
                placeholder="Meter #205"
                value={meterId}
                onChange={(e) => setMeterId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Tariff (USD / kWh) *
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Existing rooms keep their own tariff until you change the property rate.
            </p>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
            <span className="text-xs font-semibold text-slate-600 block">
              Tenant Assignment (Optional)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Renter Name (e.g. Ramesh Giri)"
                value={renterName}
                onChange={(e) => setRenterName(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="email"
                placeholder="Registered renter email"
                value={renterEmail}
                onChange={(e) => setRenterEmail(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              The renter must already have a ChargeMesh account. The account name is used on bills.
            </p>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors shadow-xs"
            >
              {busy ? 'Adding…' : 'Add Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
