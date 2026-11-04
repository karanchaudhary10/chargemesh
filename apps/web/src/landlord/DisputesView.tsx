import React, { useEffect, useState } from 'react';
import { 
  HelpCircle, ShieldCheck, CheckCircle2, FileText, Send, 
  RotateCcw, Paperclip, Info, Check, Eye
} from 'lucide-react';
import type { TenantDispute, ResolvedInquiry } from './types';

interface DisputesViewProps {
  disputes: TenantDispute[];
  resolvedInquiries: ResolvedInquiry[];
  onResolveDispute: (
    disputeId: string,
    resolutionType: 'bill_correct' | 'courtesy_discount',
    customMessage: string
  ) => Promise<void>;
}

export const DisputesView: React.FC<DisputesViewProps> = ({
  disputes,
  resolvedInquiries,
  onResolveDispute,
}) => {
  const [activeId, setActiveId] = useState<string | null>(disputes[0]?.id ?? null);
  const dispute = disputes.find((item) => item.id === activeId) ?? disputes[0] ?? null;

  const [selectedResolution, setSelectedResolution] = useState<'bill_correct' | 'courtesy_discount'>(
    dispute?.selectedResolution || 'bill_correct'
  );
  const [messageText, setMessageText] = useState('');
  const [viewNotesItem, setViewNotesItem] = useState<ResolvedInquiry | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftMessage = (item: TenantDispute | null, type: 'bill_correct' | 'courtesy_discount') => {
    if (!item) return '';
    const first = item.renterName.trim().split(/\s+/)[0];
    const discount = item.appliedDiscountNpr ?? 500;
    const revised = Math.max(0, item.totalAmount - discount);

    if (type === 'bill_correct') {
      return `Hi ${first}, we checked the meter records for ${item.period}. ${item.diagnosisSummary} The full amount of USD ${item.totalAmount.toLocaleString()} remains due.`;
    }
    return `Hi ${first}, we verified the sub-meter readings for ${item.period}. ${item.diagnosisSummary} As a good-neighbour gesture we have applied a courtesy credit of USD ${discount.toLocaleString()}. Your revised amount due is USD ${revised.toLocaleString()}.`;
  };

  // Reset the draft reply whenever the landlord switches to a different tenant question.
  useEffect(() => {
    const resolution = dispute?.selectedResolution || 'bill_correct';
    setSelectedResolution(resolution);
    setMessageText(draftMessage(dispute, resolution));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispute?.id]);

  const handleResolutionChange = (type: 'bill_correct' | 'courtesy_discount') => {
    setSelectedResolution(type);
    setMessageText(draftMessage(dispute, type));
  };

  const handleSendDecision = async () => {
    if (!dispute || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onResolveDispute(dispute.id, selectedResolution, messageText);
      setToastMessage(
        `Decision sent to ${dispute.renterName} (Room ${dispute.roomUnit}). Invoice status updated.`
      );
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve this question.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1">
          <div className="flex items-center gap-1.5 text-blue-600">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Resolution Desk</span>
          </div>
          <span className="text-slate-300">·</span>
          {disputes.length > 0 ? (
            <span className="bg-orange-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
              {disputes.length} Open Question{disputes.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
              All Caught Up
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Tenant Questions &amp; Disputes
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Quickly resolve questions raised by renters about their electricity bills.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs text-slate-500 font-medium">Room selection:</span>
            {disputes.length > 1 ? (
              <select
                value={dispute?.id || ''}
                onChange={(event) => setActiveId(event.target.value)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {disputes.map((item) => (
                  <option key={item.id} value={item.id}>
                    Room {item.roomUnit} — {item.renterName}
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-3 py-1.5 bg-slate-100 border border-slate-200/80 rounded-lg text-xs font-semibold text-slate-800">
                {dispute ? `Room ${dispute.roomUnit} (Active)` : 'No open questions'}
              </div>
            )}
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
          {error}
        </div>
      )}

      {/* Main Active Dispute Card */}
      {dispute && dispute.status === 'Needs Review' ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          {/* Dispute Card Top Banner */}
          <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <HelpCircle className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-blue-700 tracking-wider">
                  <span>NEEDS REVIEW</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500 font-normal">{dispute.receivedTime}</span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  Question on Bill for Room {dispute.roomUnit}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
                  <span className="font-semibold text-slate-900">{dispute.renterName}</span>
                  <span className="text-slate-300">·</span>
                  <span>{dispute.billRef}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-slate-900">
                    USD {dispute.totalAmount.toLocaleString()} total
                  </span>
                </div>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200/90 rounded-lg text-xs font-medium text-slate-700 self-start sm:self-auto shadow-2xs">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>{dispute.subMeterId}</span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Quote Block: What Bibek Asked */}
            <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100/60 relative">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  What {dispute.renterName.split(' ')[0]} asked
                </span>
                <span className="text-[11px] text-slate-400">
                  Submitted via Tenant Portal
                </span>
              </div>
              <blockquote className="text-sm italic font-medium text-slate-800 leading-relaxed pl-1 pr-6">
                {dispute.questionText}
              </blockquote>
            </div>

            {/* Automatic Diagnosis Box */}
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <Info className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Meter check for {dispute.period}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                  <span>Automatic Diagnosis</span>
                </div>
              </div>

              {/* 3 Metric Columns */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200/80">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Observed Load
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    {dispute.observedLoad}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {dispute.observedProfile}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/80">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Switch Activity
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    {dispute.switchActivity}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {dispute.switchDetails}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/80">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Circuit Health
                  </div>
                  <div className="text-base font-bold text-blue-700 flex items-center gap-1.5 mt-1">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>{dispute.circuitHealth}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {dispute.circuitDetails}
                  </div>
                </div>
              </div>

              {/* Diagnosis Summary Statement */}
              <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 text-xs text-slate-700 flex items-start gap-2.5 leading-relaxed">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900">Diagnosis summary: </span>
                  {dispute.diagnosisSummary}
                </div>
              </div>
            </div>

            {/* Choose Resolution Radio Cards */}
            <div>
              <h3 className="text-sm font-bold text-slate-900">Choose Resolution</h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Select an action to update {dispute.renterName.split(' ')[0]} and automatically tailor the response message.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option 1: Bill is Correct */}
                <div
                  onClick={() => handleResolutionChange('bill_correct')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedResolution === 'bill_correct'
                      ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-500/20'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        checked={selectedResolution === 'bill_correct'}
                        onChange={() => handleResolutionChange('bill_correct')}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-bold text-xs text-slate-900">
                        Bill is Correct
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      Standard
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 pl-6 leading-relaxed">
                    Explain to {dispute.renterName.split(' ')[0]} that the sub-meter readings for {dispute.period} match the
                    recorded load ({dispute.observedLoad}). The full amount of USD {dispute.totalAmount.toLocaleString()}{' '}
                    remains due.
                  </p>
                </div>

                {/* Option 2: Courtesy Discount */}
                <div
                  onClick={() => handleResolutionChange('courtesy_discount')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedResolution === 'courtesy_discount'
                      ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-500/20'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        checked={selectedResolution === 'courtesy_discount'}
                        onChange={() => handleResolutionChange('courtesy_discount')}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-bold text-xs text-slate-900">
                        Give a Courtesy Discount
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      Good neighbor
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 pl-6 leading-relaxed">
                    Offer a courtesy credit of USD {(dispute.appliedDiscountNpr ?? 500).toLocaleString()} off this bill as a
                    good neighbour gesture. The renter's bill updates to USD{' '}
                    {Math.max(0, dispute.totalAmount - (dispute.appliedDiscountNpr ?? 500)).toLocaleString()}.
                  </p>
                </div>
              </div>
            </div>

            {/* Message to Bibek Thapa */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-slate-900">
                  Message to {dispute.renterName}
                </label>
                <span className="text-slate-400 text-[11px]">
                  Includes meter verification chart automatically
                </span>
              </div>

              <textarea
                rows={3}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white leading-relaxed resize-none"
              />

              <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                <span>Attached file: </span>
                <span className="font-semibold text-slate-700 underline cursor-pointer hover:text-blue-600">
                  {dispute.attachedFile}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex items-center justify-between border-t border-slate-100">
              <button
                type="button"
                onClick={() => alert("Dispute kept in review queue. You can revisit anytime.")}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel &amp; Review Later
              </button>

              <button
                type="button"
                onClick={() => void handleSendDecision()}
                disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{busy ? 'Sending…' : 'Send Decision to Tenant'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 stroke-[2.5]" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            No Active Inquiries Requiring Review
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            All tenant disputes have been addressed and resolved with attached meter telemetry documentation.
          </p>
        </div>
      )}

      {/* Previous Inquiries (Resolved) Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="p-6 pb-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-900">
              Previous Inquiries (Resolved)
            </h2>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
              {resolvedInquiries.length} completed
            </span>
          </div>

          <span className="text-xs text-slate-400">
            Archived for landlord records
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {resolvedInquiries.map((inq) => (
            <div
              key={inq.id}
              className="p-6 hover:bg-slate-100 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4 text-slate-400" />
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-slate-900">
                      {inq.renterName} ({inq.roomUnit})
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">{inq.billDate}</span>
                  </div>

                  <p className="text-xs text-slate-600 mt-1 italic">
                    {inq.quote}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-100">
                      {inq.resolutionTag}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {inq.closedDate}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-left md:text-right shrink-0 pl-12 md:pl-0">
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {inq.amountFormatted}
                </div>
                <button
                  onClick={() => setViewNotesItem(inq)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors mt-0.5"
                >
                  View Notes
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* View Notes Modal */}
      {viewNotesItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Resolution Notes: {viewNotesItem.renterName}
              </h3>
              <button
                onClick={() => setViewNotesItem(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-medium block">Room &amp; Period</span>
                <span className="font-semibold text-slate-900">
                  {viewNotesItem.roomUnit} · {viewNotesItem.billDate}
                </span>
              </div>

              <div>
                <span className="text-slate-500 font-medium block">Inquiry</span>
                <span className="italic text-slate-800">{viewNotesItem.quote}</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium block mb-1">Audit Record &amp; Actions</span>
                <span className="text-slate-800 leading-relaxed block">
                  {viewNotesItem.notes || "Sub-meter diagnostics reviewed. Verified against baseline readings. Renter confirmed closure."}
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setViewNotesItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
