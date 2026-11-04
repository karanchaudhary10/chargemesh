import React from 'react';
import { Plus, ArrowRight, UserPlus, Gauge, Sliders, ExternalLink } from 'lucide-react';
import type { Room, Bill, PropertySettings } from './types';
import type { NavTab } from './Navbar';
import { LiveUsageChart } from './LiveUsageChart.js';

interface OverviewViewProps {
  rooms: Room[];
  bills: Bill[];
  openDisputeCount: number;
  settings: PropertySettings;
  onNavigate: (tab: NavTab) => void;
  onOpenCreateBill: () => void;
  onOpenTariffModal: () => void;
  onAssignRenterPrompt: (roomUnit?: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  rooms,
  bills,
  openDisputeCount,
  settings,
  onNavigate,
  onOpenCreateBill,
  onOpenTariffModal,
  onAssignRenterPrompt,
}) => {
  const occupiedCount = rooms.filter((r) => r.renterName).length;
  const totalRooms = rooms.length;
  const occupancyPercent = Math.round((occupiedCount / (totalRooms || 1)) * 100);
  const vacantRooms = rooms.filter((r) => !r.renterName);
  const vacantRoomsSummary = vacantRooms.length > 0 
    ? `Rooms ${vacantRooms.map(r => r.unitNumber).join(' and ')} are currently vacant.`
    : 'All units occupied.';

  const draftBills = bills.filter((b) => b.status === 'Draft');
  const recentBills = bills.slice(0, 4);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Welcome & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome back, {settings.landlordName.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Here is what needs your attention today at {settings.propertyName}.
          </p>
        </div>

        <button
          onClick={onOpenCreateBill}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Create a Bill</span>
        </button>
      </div>

      {/* 3 Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Ready for Review */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                READY FOR REVIEW
              </span>
              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
            </div>
            <div className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
              {draftBills.length} bills
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Meter readings recorded. Ready to calculate and dispatch.
            </p>
          </div>

          <button
            onClick={() => onNavigate('bills')}
            className="w-full mt-6 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-semibold rounded-lg border border-blue-100 hover:border-blue-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>Review Bills</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card 2: Tenant Inquiries */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                TENANT INQUIRIES
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            </div>
            <div className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
              {openDisputeCount} question{openDisputeCount === 1 ? '' : 's'}
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {openDisputeCount > 0
                ? `${openDisputeCount === 1 ? 'A renter has' : 'Renters have'} a question about a bill. Open the resolution desk to reply.`
                : 'No pending tenant disputes at this time.'}
            </p>
          </div>

          <button
            onClick={() => onNavigate('disputes')}
            className="w-full mt-6 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-semibold rounded-lg border border-blue-100 hover:border-blue-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>View Dispute</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card 3: Occupancy */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                OCCUPANCY
              </span>
              <span className="text-xs font-medium text-slate-500 tabular-nums">
                {occupancyPercent}% full
              </span>
            </div>
            <div className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
              {occupiedCount} of {totalRooms}
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Rooms rented. {vacantRoomsSummary}
            </p>
          </div>

          <button
            onClick={() => onNavigate('rooms')}
            className="w-full mt-6 py-2 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-semibold rounded-lg border border-blue-100 hover:border-blue-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>Manage Rooms</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live electricity usage by room */}
      <LiveUsageChart rooms={rooms} />

      {/* Recent Bills Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="p-6 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Bills</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Electricity and monthly charges recorded this week.
            </p>
          </div>

          <button
            onClick={onOpenTariffModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-lg text-xs font-medium text-slate-700 transition-colors cursor-pointer self-start sm:self-auto"
            title="Click to change electricity rate"
          >
            <span>Current tariff:</span>
            <span className="font-semibold text-slate-900">
              USD {settings.electricityRateNpr.toFixed(2)} / unit
            </span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px] font-semibold">
                <th className="py-3 px-6">Tenant &amp; Room</th>
                <th className="py-3 px-6">Electricity Used</th>
                <th className="py-3 px-6">Total Amount</th>
                <th className="py-3 px-6 text-right">Status &amp; Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentBills.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    No bills yet. Create a bill once your meters have recorded at least two readings.
                  </td>
                </tr>
              )}
              {recentBills.map((bill) => (
                <tr
                  key={bill.id}
                  className="hover:bg-slate-100 transition-colors group"
                >
                  <td className="py-4 px-6">
                    <div className="font-semibold text-slate-900 text-sm">
                      {bill.renterName}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      Room {bill.roomUnit} · {bill.roomFloor}
                    </div>
                  </td>

                  <td className="py-4 px-6">
                    <span className="text-slate-900 font-medium text-sm tabular-nums">
                      {bill.electricityUsed.toFixed(1)} units
                    </span>
                  </td>

                  <td className="py-4 px-6">
                    <span className="text-slate-900 font-bold text-sm tabular-nums">
                      USD {bill.totalAmountNpr.toLocaleString()}
                    </span>
                  </td>

                  <td className="py-4 px-6 text-right">
                    <div className="inline-flex items-center gap-3">
                      {bill.status !== 'Sent' && (
                        <span
                          className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
                            bill.status === 'Pending verification'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                              : bill.status === 'Paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {bill.status}
                        </span>
                      )}

                      <button
                        onClick={() => onNavigate('bills')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold transition-colors"
                      >
                        Sent
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 px-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Showing latest {recentBills.length} bills</span>
          <button
            onClick={() => onNavigate('bills')}
            className="font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>View all bills</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Tasks Section */}
      <div>
        <h2 className="text-base font-bold text-slate-900">Quick Tasks</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">
          Frequent administrative jobs for your property.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Task 1: Add New Renter */}
          <div
            onClick={() => {
              onNavigate('rooms');
              onAssignRenterPrompt();
            }}
            className="p-5 bg-blue-50 hover:bg-blue-100 border border-blue-100 hover:border-blue-300 shadow-2xs hover:shadow-md rounded-2xl flex items-center gap-4 cursor-pointer transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                Add New Renter
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign a tenant to a room
              </p>
            </div>
          </div>

          {/* Task 2: Check Meter Readings */}
          <div
            onClick={() => onNavigate('readings')}
            className="p-5 bg-blue-50 hover:bg-blue-100 border border-blue-100 hover:border-blue-300 shadow-2xs hover:shadow-md rounded-2xl flex items-center gap-4 cursor-pointer transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                Check Meter Readings
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Log monthly sub-meter digits
              </p>
            </div>
          </div>

          {/* Task 3: Change Electricity Rate */}
          <div
            onClick={onOpenTariffModal}
            className="p-5 bg-blue-50 hover:bg-blue-100 border border-blue-100 hover:border-blue-300 shadow-2xs hover:shadow-md rounded-2xl flex items-center gap-4 cursor-pointer transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                Change Electricity Rate
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Update the USD per unit price
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
