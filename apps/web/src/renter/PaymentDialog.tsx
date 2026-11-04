import { useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Wallet
} from "lucide-react";
import { api, type Bill } from "../api.js";
import { npr, period, shortId } from "../lib/format.js";
import { messageOf } from "../lib/model.js";
import { Alert, Modal, PrimaryButton, cardClass } from "../components/ui.js";
import { amountDue } from "./useRenterData.js";
import { WalletQrScanner } from "./WalletQrScanner.js";

function walletScheme(payload: string): string | undefined {
  return /^([a-z][a-z0-9+.-]{0,30}):/i.exec(payload)?.[1]?.toLowerCase();
}

export function PaymentDialog({
  bill,
  roomName,
  propertyName,
  onClose,
  onPaid
}: {
  bill: Bill;
  roomName?: string;
  propertyName?: string;
  onClose: () => void;
  onPaid: () => Promise<void> | void;
}) {
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = amountDue(bill);
  const scheme = scanned ? walletScheme(scanned) : undefined;

  const recordPayment = async () => {
    if (!scanned) return;
    setBusy(true);
    setError(null);
    try {
      await api.payBill(bill.billId, { payload: scanned });
      await onPaid();
      onClose();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Pay with wallet QR"
      subtitle={`Bill ${shortId(bill.billId)} · ${period(bill.periodStart, bill.periodEnd)}`}
      icon={<Camera className="w-4 h-4" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className={`${cardClass} p-4 flex items-center justify-between gap-4`}>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Amount to pay
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{npr(amount)}</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              {roomName ? `Room ${roomName}` : "Your room"}
              {propertyName ? ` · ${propertyName}` : ""}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
        </div>

        {scanned ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-900">Wallet QR captured</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
                    {scheme ? `Detected a ${scheme} wallet code. ` : ""}
                    Review the code below, then confirm to save it with this bill.
                  </p>
                  {scheme && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      {scheme}
                    </span>
                  )}
                </div>
              </div>
              <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-white border border-emerald-100 p-2.5 text-[10px] leading-relaxed text-slate-600 whitespace-pre-wrap break-all font-mono">
                {scanned}
              </pre>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-px" />
              Only confirm after you have actually sent {npr(amount)} from your wallet. This marks
              the bill paid and sends the payment reference to your landlord.
            </div>

            {error && <Alert kind="error">{error}</Alert>}

            <div className="flex flex-col sm:flex-row gap-2.5">
              <PrimaryButton onClick={() => void recordPayment()} disabled={busy} className="flex-1">
                <Check className="w-3.5 h-3.5" />
                {busy ? "Saving payment…" : `Confirm payment of ${npr(amount)}`}
              </PrimaryButton>
              <button
                onClick={() => {
                  setScanned(null);
                  setError(null);
                }}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Scan again
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <ScanLine className="w-4 h-4 text-blue-600 shrink-0" />
              <p className="leading-relaxed">
                Show your wallet&apos;s payment QR to the camera. The code is saved with this bill
                when you confirm.
              </p>
            </div>

            <WalletQrScanner onCapture={setScanned} />

            <Alert kind="info">
              Your landlord sees the bill marked as paid with the wallet reference as soon as you
              confirm. Camera access is only used while this screen is open.
            </Alert>

            {error && <Alert kind="error">{error}</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}
