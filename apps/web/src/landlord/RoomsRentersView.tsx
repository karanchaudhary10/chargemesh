import React, { useState } from 'react';
import { 
  Building2, Users, Calendar, Search, Plus, UserPlus, 
  CheckCircle2, AlertCircle, Gauge, Trash2, Mail
} from 'lucide-react';
import type { Room, PropertySettings } from './types';

interface RoomsRentersViewProps {
  rooms: Room[];
  settings: PropertySettings;
  onOpenAddRoom: () => void;
  onOpenCreateBillForRoom: (room: Room) => void;
  onAssignRenter: (roomId: string, name: string, email: string) => Promise<void>;
  onRemoveRenter: (roomId: string) => Promise<void>;
  initialAssignRoomUnit?: string;
}

export const RoomsRentersView: React.FC<RoomsRentersViewProps> = ({
  rooms,
  settings,
  onOpenAddRoom,
  onOpenCreateBillForRoom,
  onAssignRenter,
  onRemoveRenter,
  initialAssignRoomUnit,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'occupied' | 'empty'>('all');
  
  // Track which empty room is currently being assigned in the bottom card
  const firstEmptyRoom = rooms.find((r) => !r.renterName);
  const [selectedEmptyRoomId, setSelectedEmptyRoomId] = useState<string>(
    initialAssignRoomUnit 
      ? (rooms.find(r => r.unitNumber === initialAssignRoomUnit && !r.renterName)?.id || firstEmptyRoom?.id || '')
      : (rooms.find(r => r.unitNumber === '201')?.id || firstEmptyRoom?.id || '')
  );
  
  const [assignName, setAssignName] = useState('');
  const [assignEmail, setAssignEmail] = useState('');
  const [assignSuccessToast, setAssignSuccessToast] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  const selectedEmptyRoom =
    rooms.find((r) => r.id === selectedEmptyRoomId && !r.renterName) || firstEmptyRoom;

  const totalCount = rooms.length;
  const occupiedCount = rooms.filter((r) => r.renterName).length;
  const emptyCount = totalCount - occupiedCount;

  // Filtered rooms
  const filteredRooms = rooms.filter((room) => {
    const matchesSearch =
      room.unitNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.floor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (room.renterName && room.renterName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (room.renterEmail && room.renterEmail.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (statusFilter === 'occupied') return !!room.renterName;
    if (statusFilter === 'empty') return !room.renterName;
    return true;
  });

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmptyRoom || assignBusy) return;

    const email = assignEmail.trim();
    if (!email) return;

    // Use name if provided, or derive friendly name from email
    const name = assignName.trim() || (email.split('@')[0] ?? email).replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    setAssignBusy(true);
    setAssignError(null);
    try {
      await onAssignRenter(selectedEmptyRoom.id, name, email);
      setAssignSuccessToast(`Renter assigned to Room ${selectedEmptyRoom.unitNumber} successfully!`);
      setTimeout(() => setAssignSuccessToast(null), 3500);
      setAssignName('');
      setAssignEmail('');
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : 'Could not assign this renter.');
    } finally {
      setAssignBusy(false);
    }
  };

  const handleRemoveRenter = async (room: Room) => {
    if (!window.confirm(`Remove tenant ${room.renterName} from Room ${room.unitNumber}?`)) return;
    setAssignError(null);
    try {
      await onRemoveRenter(room.id);
      setAssignSuccessToast(`Renter removed from Room ${room.unitNumber}.`);
      setTimeout(() => setAssignSuccessToast(null), 3500);
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : 'Could not remove this renter.');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Header & Breadcrumb */}
      <div>
        <div className="text-xs font-semibold text-blue-600 tracking-wider uppercase mb-1">
          PROPERTY MANAGEMENT <span className="text-slate-400">·</span> {settings.address.split(',')[0]}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Rooms &amp; Renters
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage your rooms and assign tenants to automatically track electricity usage.
            </p>
          </div>

          <button
            onClick={onOpenAddRoom}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add Room</span>
          </button>
        </div>
      </div>

      {/* 3 Stat KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Inventory */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              TOTAL INVENTORY
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
              {totalCount} Rooms
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Building2 className="w-6 h-6 stroke-[1.8]" />
          </div>
        </div>

        {/* Active Tenants */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              ACTIVE TENANTS
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
              {occupiedCount} Occupied
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users className="w-6 h-6 stroke-[1.8]" />
          </div>
        </div>

        {/* Ready to Fill */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-wider text-amber-700 uppercase">
              READY TO FILL
            </div>
            <div className="text-2xl font-bold text-amber-700 mt-1.5 tabular-nums">
              {emptyCount} Vacant
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-orange-50 text-amber-600 flex items-center justify-center">
            <Calendar className="w-6 h-6 stroke-[1.8]" />
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search room or tenant..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-100 hover:bg-slate-200 focus:bg-white border border-transparent focus:border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>

        {/* Filter Segmented Controls */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-stretch sm:self-auto shrink-0">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            All Rooms ({totalCount})
          </button>
          <button
            onClick={() => setStatusFilter('occupied')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'occupied'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            Occupied ({occupiedCount})
          </button>
          <button
            onClick={() => setStatusFilter('empty')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === 'empty'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            Empty ({emptyCount})
          </button>
        </div>
      </div>

      {/* Rooms Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px] font-semibold">
                <th className="py-3 px-6">Room Unit</th>
                <th className="py-3 px-6">Current Renter</th>
                <th className="py-3 px-6">Connected Meter</th>
                <th className="py-3 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRooms.map((room) => {
                const isEmpty = !room.renterName;

                return (
                  <tr
                    key={room.id}
                    className="hover:bg-slate-100 transition-colors group"
                  >
                    {/* Room Unit with Unit Number Box */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 font-bold text-slate-800 text-xs flex items-center justify-center shrink-0">
                          {room.unitNumber}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm">
                              Room {room.unitNumber}
                            </span>
                            {isEmpty && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 tracking-wider">
                                EMPTY
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 text-xs mt-0.5">
                            {room.floor} · {room.type}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Current Renter */}
                    <td className="py-4 px-6">
                      {isEmpty ? (
                        <span className="text-slate-400 italic text-xs">None assigned</span>
                      ) : (
                        <div>
                          <div className="font-semibold text-slate-900 text-sm">
                            {room.renterName}
                          </div>
                          <div className="text-slate-500 text-xs mt-0.5 font-mono">
                            {room.renterEmail || `${room.renterName?.toLowerCase().replace(/\s+/g, '.')}@gmail.com`}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Connected Meter */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                          <Gauge className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-800 text-xs">
                            {room.meterId}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                room.meterStatus === 'Working'
                                  ? 'bg-blue-600'
                                  : 'bg-slate-400'
                              }`}
                            ></span>
                            <span>{room.meterStatus}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right">
                      {isEmpty ? (
                        <button
                          onClick={() => {
                            setSelectedEmptyRoomId(room.id);
                            // Scroll down smoothly to assignment form
                            const formElement = document.getElementById('assign-renter-card');
                            formElement?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-all shadow-2xs"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                          <span>Assign Renter</span>
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() => onOpenCreateBillForRoom(room)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                          >
                            Create Bill
                          </button>
                          <button
                            onClick={() => void handleRemoveRenter(room)}
                            className="text-xs text-slate-500 hover:text-red-600 font-medium transition-colors"
                          >
                            Remove Renter
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign Renter Inline Card (matching screenshot bottom element) */}
      {selectedEmptyRoom && (
        <div 
          id="assign-renter-card"
          className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all animate-in fade-in duration-200 max-w-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
              <UserPlus className="w-5 h-5" />
            </div>

            <div className="flex-1">
              <h2 className="text-base font-bold text-slate-900">
                Assign a renter to empty Room {selectedEmptyRoom.unitNumber}
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Add the renter's details to connect them with their sub-meter and enable automated monthly bills.
              </p>

              <form onSubmit={handleAssignSubmit} className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Renter's Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Sarah Jenkins"
                      value={assignName}
                      onChange={(e) => setAssignName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Renter's Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. sarah.jenkins@gmail.com"
                      value={assignEmail}
                      onChange={(e) => setAssignEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  We will invite them to view their room electricity bills online.
                </p>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={assignBusy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg shadow-xs transition-colors"
                  >
                    {assignBusy ? 'Assigning…' : 'Save and Assign'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignName('');
                      setAssignEmail('');
                    }}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Assignment / removal feedback stays visible even after the room fills up */}
      {(assignSuccessToast || assignError) && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm space-y-2">
          {assignSuccessToast && (
            <div className="px-4 py-3 bg-emerald-50 text-emerald-800 text-xs font-medium rounded-xl border border-emerald-200 shadow-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{assignSuccessToast}</span>
            </div>
          )}
          {assignError && (
            <div className="px-4 py-3 bg-rose-50 text-rose-800 text-xs font-medium rounded-xl border border-rose-200 shadow-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{assignError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
