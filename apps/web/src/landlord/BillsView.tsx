import React, { useEffect, useState } from 'react';
import {
  Plus, Calendar, Zap, RefreshCw, X, Send,
  Trash2, ShieldCheck, CheckCircle2, Receipt, BadgeCheck, Wallet, Clock
} from 'lucide-react';
import { api, type Bill as ApiBill } from '../api.js';
import { formatPeriod } from './adapter.js';
import type { Bill, Room, PropertySettings } from './types';

interface BillsViewProps {
  bills: Bill[];
  rooms: Room[];
  settings: PropertySettings;
  selectedBill: Bill | null;
  onSelectBill: (bill: Bill | null) => void;
  onOpenCreateModal: () => void;
  onSendBill: (billId: string) => Promise<void>;
  onMarkPaid: (billId: string) => Promise<void>;
  onVerifyPayment: (billId: string) => Promise<void>;
  onDeleteBill: (billId: string) => Promise<void>;
  onCreateQuickBill: (roomId: string) => Promise<void>;
  landlordWallets?: any[];
}

export const BillsView: React.FC<BillsViewProps> = (props) => {
  const {
    bills,
    rooms,
    settings,
    selectedBill,
    onSelectBill,
    onOpenCreateModal,
    onSendBill,
    onMarkPaid,
    onVerifyPayment,
    onDeleteBill,
    onCreateQuickBill,
    landlordWallets
  } = props as BillsViewProps & { landlordWallets?: any[] };
  const [activeTab, setActiveTab] = useState<'review' | 'sent' | 'paid'>('review');

  // Quick billing section form state
  const occupiedRooms = rooms.filter((r) => r.renterName);
  const [quickRoomId, setQuickRoomId] = useState<string>(
    occupiedRooms.find((r) => r.unitNumber === '102')?.id || occupiedRooms[0]?.id || ''
  );
  const quickSelectedRoom = rooms.find((r) => r.id === quickRoomId) || occupiedRooms[0];
  const [quickPreview, setQuickPreview] = useState<ApiBill | null>(null);
  const [quickPeriod, setQuickPeriod] = useState<string>('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickToast, setQuickToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The backend decides the billable window from signed readings.
  useEffect(() => {
    if (!quickRoomId) {
      setQuickPreview(null);
      setQuickPeriod('');
      return;
    }
    let cancelled = false;
    setQuickError(null);
    api
      .billSuggestion(quickRoomId)
      .then(async (suggestion) => {
        const { bill } = await api.previewBill({
          roomId: quickRoomId,
          periodStart: suggestion.periodStart,
          periodEnd: suggestion.periodEnd
        });
        if (cancelled) return;
        setQuickPreview(bill);
        setQuickPeriod(formatPeriod(suggestion.periodStart, suggestion.periodEnd));
      })
      .catch((err) => {
        if (cancelled) return;
        setQuickPreview(null);
        setQuickPeriod('');
        setQuickError(err instanceof Error ? err.message : 'No billable readings yet.');
      });
    return () => {
      cancelled = true;
    };
  }, [quickRoomId]);

  // Filter bills
  const needsReviewBills = bills.filter((b) => b.status === 'Draft');
  const sentBills = bills.filter(
    (b) => b.status === 'Sent' || b.status === 'Pending verification'
  );
  const paidBills = bills.filter((b) => b.status === 'Paid');

  const displayedBills =
    activeTab === 'review'
      ? needsReviewBills
      : activeTab === 'sent'
      ? sentBills
      : paidBills;

  // Handle Quick Billing Calculate & Create
  const handleCalculateQuickBill = async () => {
    if (!quickSelectedRoom || !quickSelectedRoom.renterName || quickBusy) return;
    setQuickBusy(true);
    setError(null);
    try {
      await onCreateQuickBill(quickSelectedRoom.id);
      setQuickToast(`Bill generated for Room ${quickSelectedRoom.unitNumber}!`);
      setTimeout(() => setQuickToast(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this bill.');
    } finally {
      setQuickBusy(false);
    }
  };

  const handleSend = async (bill: Bill) => {
    setBusy(true);
    setError(null);
    try {
      await onSendBill(bill.id);
      onSelectBill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this bill.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async (bill: Bill) => {
    setBusy(true);
    setError(null);
    try {
      await onMarkPaid(bill.id);
      onSelectBill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this payment.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (bill: Bill) => {
    setBusy(true);
    setError(null);
    try {
      await onVerifyPayment(bill.id);
      onSelectBill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this payment.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (bill: Bill) => {
    if (!window.confirm(`Delete draft bill ${bill.billNumber}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDeleteBill(bill.id);
      onSelectBill(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this draft.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 relative">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Electricity Bills
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review usage and send electricity bills to your renters in US Dollars (USD).
          </p>
        </div>

        <button
          onClick={onOpenCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Create New Bill</span>
        </button>
      </div>

      {quickToast && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{quickToast}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
          {error}
        </div>
      )}

      {/* Generate a Monthly Bill (Quick Billing Card) */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600"></span>
            <h2 className="text-sm font-bold text-slate-900">
              Generate a Monthly Bill
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            Quick Billing
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Select Room */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Select Room
            </label>
            <div className="relative">
              <select
                value={quickRoomId}
                onChange={(e) => setQuickRoomId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                {occupiedRooms.length === 0 && <option value="">No occupied rooms</option>}
                {occupiedRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.unitNumber} — {r.renterName}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Meter sub-gauge active</p>
          </div>

          {/* Billing Month */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Billing Month
            </label>
            <div className="relative">
              <input
                type="text"
                value={quickPeriod || (quickError ? 'No billable period' : 'Loading…')}
                readOnly
                className="w-full pl-3.5 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Starts where the last bill ended</p>
          </div>

          {/* Electricity Rate */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Electricity Rate
            </label>
            <div className="relative">
              <input
                type="text"
                value={`USD ${settings.electricityRateNpr.toFixed(2)} per unit`}
                readOnly
                className="w-full pl-3.5 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Zap className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Applied from the room's tariff
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 flex items-start gap-2.5">
          <Wallet className="w-4 h-4 text-blue-600 shrink-0 mt-px" />
          <div className="text-xs flex-1">
            <p className="font-semibold text-blue-900">
              Payment Method
            </p>
            <p className="text-blue-700 mt-0.5">
              Amount will be received in your HashPack wallet
            </p>
          </div>
        </div>

        {/* Sync notification bar */}
        <div className="p-3.5 bg-blue-50 rounded-xl border border-blue-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            {quickPreview ? (
              <span>
                Meter readings (Start: {quickPreview.startingCumulativeKwh.toFixed(1)} · End:{' '}
                {quickPreview.endingCumulativeKwh.toFixed(1)}) synced automatically.
              </span>
            ) : (
              <span>{quickError || 'Waiting for at least two signed readings from this room.'}</span>
            )}
          </div>

          <button
            onClick={() => void handleCalculateQuickBill()}
            disabled={!quickPreview || quickBusy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors shrink-0"
          >
            {quickBusy ? 'Creating…' : 'Calculate & Create Bill'}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setActiveTab('review')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'review'
              ? 'bg-slate-200 text-slate-900'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Needs Review <span className="ml-1 text-[11px] opacity-80">{needsReviewBills.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('sent')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'sent'
              ? 'bg-slate-200 text-slate-900'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Sent<span className="hidden sm:inline"> &amp; Awaiting Payment</span>{' '}
          <span className="ml-1 text-[11px] opacity-80">{sentBills.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('paid')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'paid'
              ? 'bg-slate-200 text-slate-900'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Paid <span className="ml-1 text-[11px] opacity-80">{paidBills.length}</span>
        </button>
      </div>

      {/* Bills Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px] font-semibold">
                <th className="py-3 px-6">Bill ID &amp; Date</th>
                <th className="py-3 px-6">Renter &amp; Room</th>
                <th className="py-3 px-6">Electricity Used</th>
                <th className="py-3 px-6">Amount (USD)</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedBills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No bills in this category.
                  </td>
                </tr>
              ) : (
                displayedBills.map((bill) => (
                  <tr
                    key={bill.id}
                    className="hover:bg-slate-100 transition-colors group cursor-pointer"
                    onClick={() => onSelectBill(bill)}
                  >
                    <td className="py-4 px-6">
                      <div className="font-bold text-slate-900 text-sm">
                        {bill.billNumber}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {bill.billDate}
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <div className="font-semibold text-slate-900 text-sm">
                        {bill.renterName}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        Room {bill.roomUnit} ({bill.roomFloor})
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

                    <td className="py-4 px-6">
                      <span
                        className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${
                          bill.status === 'Pending verification'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                            : bill.status === 'Sent'
                            ? 'bg-blue-50 text-blue-700 border border-blue-100'
                            : bill.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {bill.status}
                      </span>
                    </td>

                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBill(bill);
                        }}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                      >
                        {bill.status === 'Draft'
                          ? 'Review & Send'
                          : bill.status === 'Pending verification'
                          ? 'Verify Payment'
                          : 'View Breakdown'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill Breakdown Slide-over Drawer */}
      {selectedBill && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-slate-900/30 backdrop-blur-2xs animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between border-l border-slate-200 animate-in slide-in-from-right duration-250"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div>
              <div className="p-6 border-b border-slate-100 flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    Bill {selectedBill.billNumber}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                    Bill Breakdown
                  </h2>
                </div>
                <button
                  onClick={() => onSelectBill(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-230px)]">
                {/* Tenant Box */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">
                      {selectedBill.renterName}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Room {selectedBill.roomUnit}
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-700">
                    {selectedBill.status}
                  </span>
                </div>

                {/* Meter Calculations */}
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Start reading</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {selectedBill.startReading.toFixed(3)} units
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600">
                    <span>End reading</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {selectedBill.endReading.toFixed(3)} units
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-slate-100 rounded-lg font-semibold text-slate-900">
                    <span>Total units used</span>
                    <span className="tabular-nums">
                      {selectedBill.electricityUsed.toFixed(3)} units
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 pt-1">
                    <span>Calculation</span>
                    <span className="font-medium text-slate-800 tabular-nums">
                      {selectedBill.electricityUsed.toFixed(3)} units × USD{' '}
                      {selectedBill.ratePerUnit.toFixed(2)}
                    </span>
                  </div>

                  {!!selectedBill.appliedCreditNpr && (
                    <div className="flex items-center justify-between text-emerald-700">
                      <span>Courtesy credit applied</span>
                      <span className="font-semibold tabular-nums">
                        − USD {selectedBill.appliedCreditNpr.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Total Amount Due Highlight Card */}
                <div className="p-5 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-blue-900 block">
                      {selectedBill.status === 'Paid' ? 'Amount paid' : 'Total Amount Due'}
                    </span>
                    <span className="text-3xl font-extrabold text-blue-600 tracking-tight tabular-nums block mt-1">
                      USD {selectedBill.totalAmountNpr.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                    <Receipt className="w-5 h-5 stroke-[2]" />
                  </div>
                </div>

                {selectedBill.status === 'Paid' && selectedBill.paymentReference && (
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-bold text-emerald-900">
                      <Wallet className="w-4 h-4" />
                      Paid by wallet QR
                    </div>
                    <div className="flex items-start justify-between gap-3 text-emerald-800">
                      <span>Wallet</span>
                      <span className="font-semibold text-right uppercase tracking-wide">
                        {selectedBill.paymentScheme || 'Wallet'}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3 text-emerald-800">
                      <span>Reference</span>
                      <span className="font-mono text-[11px] font-semibold text-right break-all">
                        {selectedBill.paymentReference.slice(0, 16)}…
                      </span>
                    </div>
                    {selectedBill.paymentCapturedAt && (
                      <div className="flex items-start justify-between gap-3 text-emerald-800">
                        <span>Captured</span>
                        <span className="font-semibold text-right">
                          {new Date(selectedBill.paymentCapturedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {selectedBill.status === 'Pending verification' && (
                  <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 font-bold text-indigo-900">
                      <Clock className="w-4 h-4" />
                      Payment submitted by renter
                    </div>
                    <div className="flex items-start justify-between gap-3 text-indigo-800">
                      <span>Transaction ID</span>
                      <span className="font-mono text-[11px] font-semibold text-right break-all">
                        {selectedBill.paymentDetails?.transactionId ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3 text-indigo-800">
                      <span>Paid to</span>
                      <span className="font-semibold text-right">
                        {selectedBill.paymentDetails?.paidFromLabel ||
                          selectedBill.paymentDetails?.method ||
                          '—'}
                      </span>
                    </div>
                    {selectedBill.paymentDetails?.paidFromAccountId && (
                      <div className="flex items-start justify-between gap-3 text-indigo-800">
                        <span>Account</span>
                        <span className="font-mono text-[11px] text-right break-all">
                          {selectedBill.paymentDetails.paidFromAccountId}
                        </span>
                      </div>
                    )}
                    {selectedBill.paymentDetails?.note && (
                      <div className="flex items-start justify-between gap-3 text-indigo-800">
                        <span>Note</span>
                        <span className="text-right">{selectedBill.paymentDetails.note}</span>
                      </div>
                    )}
                    {selectedBill.paymentDetails?.submittedAt && (
                      <div className="flex items-start justify-between gap-3 text-indigo-800">
                        <span>Submitted</span>
                        <span className="text-right">
                          {new Date(selectedBill.paymentDetails.submittedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Trust / Verification Note */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70 flex items-start gap-3 text-xs text-slate-600 leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    Readings verified automatically from the room meter. Both you and your renter have access to this
                    ledger record.
                  </span>
                </div>
              </div>
            </div>

            {/* Drawer Bottom Actions */}
            <div className="p-6 border-t border-slate-100 bg-white space-y-3">
              {selectedBill.status === 'Draft' && (
                <button
                  onClick={() => void handleSend(selectedBill)}
                  disabled={busy}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{busy ? 'Sending…' : 'Send Bill to Renter'}</span>
                </button>
              )}

              {selectedBill.status === 'Sent' && (
                <button
                  onClick={() => void handleMarkPaid(selectedBill)}
                  disabled={busy}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
                >
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span>{busy ? 'Recording…' : 'Mark as Paid'}</span>
                </button>
              )}

              {selectedBill.status === 'Pending verification' && (
                <button
                  onClick={() => void handleVerify(selectedBill)}
                  disabled={busy}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
                >
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span>{busy ? 'Verifying…' : 'Verify & Mark as Paid'}</span>
                </button>
              )}

              {selectedBill.status === 'Draft' ? (
                <button
                  onClick={() => void handleDelete(selectedBill)}
                  disabled={busy}
                  className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-60 text-rose-700 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Delete Draft</span>
                </button>
              ) : (
                <button
                  onClick={() => onSelectBill(null)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
