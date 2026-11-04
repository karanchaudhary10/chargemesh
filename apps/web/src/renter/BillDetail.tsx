import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  HelpCircle,
  MessageSquare,
  Printer,
  Receipt,
  Send,
  ShieldCheck,
  Wallet,
  Zap
} from "lucide-react";
import { HashConnect } from "hashconnect";
import {
  AccountId,
  Hbar,
  LedgerId,
  TransferTransaction
} from "@hashgraph/sdk";
import { api, type Bill, type Dispute, type User, type UserWallet } from "../api.js";
import { dateTime, kwh, period, shortId, usd } from "../lib/format.js";
import { messageOf } from "../lib/model.js";
import {
  Alert,
  BillStatusBadge,
  PrimaryButton,
  cardClass,
  inputClass,
  labelClass,
  useFlash
} from "../components/ui.js";
import { amountDue, disputeBillId, type RenterData } from "./useRenterData.js";
import { downloadReceipt, printReceipt } from "./receipt.js";

const badgeStatus = (status: string) =>
  status === "issued" ? "unpaid" : status;

function issueBadge(status: Dispute["status"], creditNpr?: number) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3 h-3" />
        Waiting for landlord
      </span>
    );
  }
  if (status === "upheld") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" />
        {creditNpr ? `Credit ${usd(creditNpr)}` : "Issue accepted"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      <CheckCircle2 className="w-3 h-3" />
      Bill confirmed
    </span>
  );
}

const HBAR_TINYBARS = 100_000_000;
const TESTNET_MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

function mirrorTransactionId(transactionId: string): string {
  const [accountId, timestamp] = transactionId.split("@");
  return timestamp ? `${accountId}-${timestamp.replace(".", "-")}` : transactionId;
}

async function hbarPriceInUsd(): Promise<number> {
  const sources = [
    {
      url: "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd",
      read: (payload: any) => payload["hedera-hashgraph"]?.usd
    },
    {
      url: "https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT",
      read: (payload: any) => payload.price
    },
    {
      url: "https://api.kraken.com/0/public/Ticker?pair=HBARUSD",
      read: (payload: any) => payload.result?.HBARUSD?.c?.[0] ?? payload.result?.XHBARZUSD?.c?.[0]
    },
    {
      url: "https://api.huobi.pro/market/detail/merged?symbol=hbarusdt",
      read: (payload: any) => payload.tick?.close ?? payload.tick?.last
    }
  ];
  let lastError = "No live price source responded.";
  for (const source of sources) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(source.url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const price = Number(source.read(await response.json()));
      if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid HBAR/USD price");
      return price;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown price service error";
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error(
    `Could not fetch the live HBAR/USD price. Check the browser network connection and try again. (${lastError})`
  );
}

async function verifyHashPackTransfer(
  transactionId: string,
  senderAccountId: string,
  receiverAccountId: string,
  amountTinybars: number
): Promise<void> {
  const mirrorId = mirrorTransactionId(transactionId);
  let lastError = "The transaction was not visible on the Hedera testnet mirror node.";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${TESTNET_MIRROR_NODE}/api/v1/transactions/${encodeURIComponent(mirrorId)}`,
        { headers: { Accept: "application/json" } }
      );
    } catch {
      throw new Error(
        "Could not reach the Hedera testnet Mirror Node. Check your browser network connection."
      );
    }
    if (response.ok) {
      const data = (await response.json()) as {
        transactions?: Array<{
          result?: string;
          transfers?: Array<{ account?: string; amount?: number }>;
        }>;
      };
      const transaction = data.transactions?.[0];
      const senderTransfer = transaction?.transfers?.find(
        (transfer) => transfer.account === senderAccountId
      );
      const receiverTransfer = transaction?.transfers?.find(
        (transfer) => transfer.account === receiverAccountId
      );
      if (
        transaction?.result?.toUpperCase() === "SUCCESS" &&
        // The sender also pays the Hedera transaction fee, so its net debit
        // is larger than the requested transfer amount.
        typeof senderTransfer?.amount === "number" &&
        senderTransfer.amount <= -amountTinybars &&
        receiverTransfer?.amount === amountTinybars
      ) {
        return;
      }
      lastError = "The Hedera testnet transaction did not match this bill payment.";
      break;
    }
    if (response.status !== 404) {
      lastError = `The Hedera testnet mirror node returned HTTP ${response.status}.`;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`${lastError} Transaction ID: ${transactionId}`);
}

export function BillDetail({
  bill,
  data,
  user,
  onUpdated,
  onPay,
  hashconnect,
  hashpackAccountId
}: {
  bill: Bill;
  data: RenterData;
  user: User;
  onUpdated: () => Promise<void>;
  onPay?: () => void;
  hashconnect: HashConnect | null;
  hashpackAccountId: string | null;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  const [payOpen, setPayOpen] = useState(false);
  const [payWalletId, setPayWalletId] = useState("");
  const [payTransactionId, setPayTransactionId] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [hashpackPayBusy, setHashpackPayBusy] = useState(false);
  const [hashpackPayStatus, setHashpackPayStatus] = useState<string | null>(null);
  const [hbarAmount, setHbarAmount] = useState("");
  const hashconnectRef = useRef<HashConnect | null>(null);
  const hashpackAccountRef = useRef<string | null>(null);

  const receiveWallets = [...(bill.receiveWallets ?? [])]
    .filter((wallet) => wallet.isActive !== false)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const selectedPayWallet =
    receiveWallets.find((wallet) => wallet.id === payWalletId) ?? receiveWallets[0];
  const hashpackReceiveWallet = receiveWallets.find(
    (wallet) => wallet.type === "hashpack" && Boolean(wallet.accountId)
  );

  useEffect(() => {
    if (hashconnect) hashconnectRef.current = hashconnect;
    if (hashpackAccountId) hashpackAccountRef.current = hashpackAccountId;
  }, [hashconnect, hashpackAccountId]);

  const executeHashPackPayment = async (
    hashconnect: HashConnect,
    renterAccountId: string,
    landlordWallet: UserWallet,
    amountTinybars: number
  ) => {
    if (!landlordWallet.accountId) {
      throw new Error("This landlord wallet does not have a Hedera account ID.");
    }
    if (!Number.isSafeInteger(amountTinybars) || amountTinybars <= 0) {
      throw new Error("Enter a valid HBAR amount greater than zero.");
    }

    const sender = AccountId.fromString(renterAccountId);
    const receiver = AccountId.fromString(landlordWallet.accountId);
    const transaction = new TransferTransaction()
      .addHbarTransfer(sender, Hbar.fromTinybars(-amountTinybars))
      .addHbarTransfer(receiver, Hbar.fromTinybars(amountTinybars));

    setHashpackPayStatus(`Approve ${Hbar.fromTinybars(amountTinybars).toString()} in HashPack…`);
    await hashconnect.sendTransaction(sender, transaction);
    const transactionId = transaction.transactionId;
    if (!transactionId) {
      throw new Error("HashPack approved the payment, but no transaction ID was returned.");
    }
    const transactionIdText = transactionId.toString();
    setHashpackPayStatus("Payment approved. Verifying it on the Hedera testnet…");
    await verifyHashPackTransfer(
      transactionIdText,
      renterAccountId,
      landlordWallet.accountId,
      amountTinybars
    );
    await api.submitBillPayment(bill.billId, {
      method: "hashpack",
      transactionId: transactionIdText,
      paidFromWalletId: landlordWallet.id,
      note: `Verified HBAR payment of ${Hbar.fromTinybars(amountTinybars).toString()}`
    });
    setPayTransactionId(transactionIdText);
    setHashpackPayStatus(
      `Payment verified on Hedera testnet. Transaction ID: ${transactionIdText}.`
    );
    await onUpdated();
  };

  const payWithHashPack = async (wallet: UserWallet) => {
    if (!wallet.accountId || hashpackPayBusy) return;
    setHashpackPayBusy(true);
    setPayError(null);
    setHashpackPayStatus("Preparing the HashPack confirmation…");
    try {
      const activeHashconnect = hashconnectRef.current;
      if (!activeHashconnect) {
        throw new Error("Connect your HashPack wallet from the renter header first.");
      }
      const amountHbar = Number(hbarAmount);
      const amountTinybars = Math.round(amountHbar * HBAR_TINYBARS);
      if (!Number.isSafeInteger(amountTinybars) || amountTinybars <= 0) {
        throw new Error("Enter a valid HBAR amount greater than zero.");
      }
      const accountId =
        hashpackAccountRef.current ?? activeHashconnect.connectedAccountIds[0]?.toString();
      if (!accountId) {
        throw new Error("Connect your HashPack wallet from the renter header first.");
      }
      await executeHashPackPayment(activeHashconnect, accountId, wallet, amountTinybars);
    } catch (err) {
      const message = err instanceof Error ? err.message : "HashPack payment failed.";
      setPayError(
        message === "Failed to fetch"
          ? "HashPack could not be reached. Check that the HashPack extension is installed, unlocked, and that WalletConnect is not blocked by the browser."
          : message
      );
      setHashpackPayStatus(null);
      setHashpackPayBusy(false);
    } finally {
      if (hashpackAccountRef.current) setHashpackPayBusy(false);
    }
  };

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (payBusy) return;
    setPayBusy(true);
    setPayError(null);
    try {
      await api.submitBillPayment(bill.billId, {
        method: selectedPayWallet?.type,
        transactionId: payTransactionId.trim(),
        paidFromWalletId: selectedPayWallet?.id
      });
      setPayOpen(false);
      setPayTransactionId("");
      await onUpdated();
      setFlash("Payment submitted. Your landlord will verify the transaction ID.");
    } catch (err) {
      setPayError(messageOf(err));
    } finally {
      setPayBusy(false);
    }
  };

  const disputes = data.disputes.filter((dispute) => disputeBillId(dispute) === bill.billId);
  const openIssue = disputes.find((dispute) => dispute.status === "open");

  const receiptDetails = {
    propertyName: data.property?.name,
    propertyAddress: data.property?.address,
    roomName: data.room?.name,
    roomFloor: data.room?.floor,
    renterName: user.name,
    renterEmail: user.email
  };

  const rows: Array<[string, string]> = [
    ["Starting meter reading", `${bill.startingCumulativeKwh.toFixed(3)} kWh`],
    ["Ending meter reading", `${bill.endingCumulativeKwh.toFixed(3)} kWh`],
    ["Electricity used", kwh(bill.consumptionKwh)],
    ["Rate", `${usd(bill.rateNprPerKwh)} / kWh`],
    ["Electricity charge", usd(bill.electricityChargeNpr)],
    ...(bill.creditNpr
      ? ([[
          "Courtesy credit from landlord",
          `− ${usd(bill.creditNpr)}`
        ]] as Array<[string, string]>)
      : [])
  ];

  const submitIssue = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.openDispute(bill.billId, reason.trim());
      setReason("");
      await onUpdated();
      setFlash("Your issue was sent to your landlord.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={`${cardClass} overflow-hidden`} aria-label="Bill details">
      <header className="p-5 sm:p-6 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Zap className="w-4 h-4 text-blue-600" />
                Bill {shortId(bill.billId)}
              </span>
              <BillStatusBadge status={badgeStatus(bill.status)} />
              {openIssue && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <MessageSquare className="w-3 h-3" />
                  Issue open
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-2">Your electricity bill</h2>
            <p className="text-xs text-slate-500 mt-1">{period(bill.periodStart, bill.periodEnd)}</p>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {bill.status === "paid" ? "Amount paid" : "Amount due"}
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
              {usd(amountDue(bill))}
            </div>
          </div>
        </div>
      </header>

      <div className="p-5 sm:p-6 space-y-6">
        {flash && <Alert kind="success">{flash}</Alert>}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/80 bg-slate-50">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">How this bill was calculated</h3>
            </div>
            <dl className="space-y-2.5 text-xs">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-semibold text-slate-900 text-right tabular-nums">{value}</dd>
                </div>
              ))}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-sm">
                <dt className="font-bold text-slate-900">
                  {bill.status === "paid" ? "Total paid" : "Total due"}
                </dt>
                <dd className="font-bold text-slate-900 tabular-nums">{usd(amountDue(bill))}</dd>
              </div>
            </dl>
          </div>

          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/80 bg-white">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">The readings behind it</h3>
            </div>
            <dl className="space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Meter at start</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">
                  {bill.startingCumulativeKwh.toFixed(3)} kWh
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Meter at end</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">
                  {bill.endingCumulativeKwh.toFixed(3)} kWh
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Units charged</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">{kwh(bill.consumptionKwh)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Rate used</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">
                  {usd(bill.rateNprPerKwh)} / kWh
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Sent by landlord</dt>
                <dd className="font-semibold text-slate-900 text-right">{dateTime(bill.issuedAt)}</dd>
              </div>
              {bill.paidAt && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">Payment recorded</dt>
                  <dd className="font-semibold text-slate-900 text-right">{dateTime(bill.paidAt)}</dd>
                </div>
              )}
              {bill.payment && (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Paid with</dt>
                    <dd className="font-semibold text-slate-900 text-right">
                      Wallet QR
                      {bill.payment.scheme ? ` · ${bill.payment.scheme}` : ""}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Payment reference</dt>
                    <dd className="font-mono text-[11px] font-semibold text-slate-900 text-right break-all">
                      {bill.payment.reference.slice(0, 16)}…
                    </dd>
                  </div>
                </>
              )}
            </dl>
            <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] leading-relaxed text-slate-500 flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-px" />
              Both you and your landlord see these same signed meter readings.
            </p>
          </div>
        </div>

        {(bill.status === "issued" || bill.status === "payment_pending_verification") && (
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-blue-600" />
                  Pay through ChargeMesh
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Start the payment here and confirm it securely in HashPack.
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Amount
                </div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {usd(amountDue(bill))}
                </div>
              </div>
            </div>

            {bill.status === "payment_pending_verification" ? (
              <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-px" />
                <div className="text-xs">
                  <p className="font-semibold text-amber-900">Payment submitted — waiting for verification</p>
                  <p className="text-amber-800 mt-0.5">
                    Transaction ID:{" "}
                    <span className="font-mono font-semibold">
                      {bill.paymentDetails?.transactionId}
                    </span>
                    {bill.paymentDetails?.paidFromLabel
                      ? ` · ${bill.paymentDetails.paidFromLabel}`
                      : ""}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="px-5 py-4 space-y-3">
              {bill.status === "issued" && hashpackReceiveWallet && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-bold text-blue-950">Pay via ChargeMesh</p>
                    <p className="text-[11px] text-blue-800 mt-1 leading-relaxed">
                      Confirm the payment details below. HashPack opens only after you click Pay.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="chargemesh-receiver">
                        Landlord HashPack account
                      </label>
                      <input
                        id="chargemesh-receiver"
                        value={hashpackReceiveWallet.accountId}
                        readOnly
                        className={`${inputClass} font-mono text-xs bg-white`}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="chargemesh-amount">
                        Amount to pay
                      </label>
                      <input
                        id="chargemesh-amount"
                        type="number"
                        min="0.00000001"
                        step="0.00000001"
                        value={hbarAmount}
                        onChange={(event) => setHbarAmount(event.target.value)}
                        placeholder="Enter HBAR amount"
                        className={`${inputClass} font-semibold bg-white`}
                      />
                      <p className="text-[10px] text-blue-800 mt-1">
                        Bill total: {usd(amountDue(bill))} · testnet
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void payWithHashPack(hashpackReceiveWallet)}
                    disabled={hashpackPayBusy || !(Number(hbarAmount) > 0)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    {hashpackPayBusy ? "Waiting for HashPack confirmation…" : "Pay"}
                  </button>
                </div>
              )}

              {receiveWallets.length > 0 ? (
                <div className="space-y-2">
                  {receiveWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                        wallet.id === selectedPayWallet?.id
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {wallet.qrDataUrl ? (
                          <img
                            src={wallet.qrDataUrl}
                            alt={`${wallet.label} QR`}
                            className="w-14 h-14 rounded-lg object-contain border border-slate-200 bg-white shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                            <Wallet className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {wallet.label}
                            </span>
                          </div>
                          {(wallet.accountId || (wallet as any).publicKey) && (
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5 break-all">
                              {wallet.accountId || (wallet as any).publicKey}
                            </p>
                          )}
                        </div>
                      </div>
                      {bill.status === "issued" && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayWalletId(wallet.id);
                            setPayOpen(true);
                          }}
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold shrink-0"
                        >
                          I paid this
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                (bill as any).landlordPaymentQr?.dataUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={(bill as any).landlordPaymentQr.dataUrl}
                      alt="Landlord payment QR"
                      className="w-52 h-52 object-contain rounded-xl border border-slate-100 bg-white"
                    />
                    {(bill as any).landlordPaymentQr.note && (
                      <p className="text-xs text-slate-600 text-center">
                        {(bill as any).landlordPaymentQr.note}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Your landlord hasn&apos;t added payment details to this bill yet. Ask them for
                    their wallet number, pay them directly, then submit the transaction ID below.
                  </p>
                )
              )}

              {bill.status === "issued" && receiveWallets.length === 0 && (
                <button
                  type="button"
                  onClick={() => setPayOpen(true)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  I&apos;ve paid — submit transaction ID
                </button>
              )}
            </div>

            {hashpackPayStatus && (
              <Alert kind="info">{hashpackPayStatus}</Alert>
            )}
            {payError && !payOpen && <Alert kind="error">{payError}</Alert>}

            {payOpen && bill.status === "issued" && (
              <form onSubmit={submitPayment} className="px-5 py-4 border-t border-slate-100 space-y-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-900">Confirm your payment</p>
                  <button
                    type="button"
                    onClick={() => setPayOpen(false)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>

                {receiveWallets.length > 1 && (
                  <div>
                    <label className={labelClass} htmlFor="pay-wallet">
                      Which wallet did you pay?
                    </label>
                    <select
                      id="pay-wallet"
                      value={selectedPayWallet?.id ?? ""}
                      onChange={(event) => setPayWalletId(event.target.value)}
                      className={inputClass}
                    >
                      {receiveWallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {wallet.label}
                          {wallet.accountId ? ` · ${wallet.accountId}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={labelClass} htmlFor="pay-transaction">
                    Transaction ID / reference
                  </label>
                  <input
                    id="pay-transaction"
                    required
                    minLength={3}
                    maxLength={160}
                    value={payTransactionId}
                    onChange={(event) => setPayTransactionId(event.target.value)}
                    placeholder="e.g. 0A12B34C56D78E90"
                    className={inputClass}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Copy the reference from your wallet app receipt so your landlord can verify it.
                  </p>
                </div>

                {payError && <Alert kind="error">{payError}</Alert>}

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <PrimaryButton type="submit" disabled={payBusy || payTransactionId.trim().length < 3}>
                    <Send className="w-3.5 h-3.5" />
                    {payBusy ? "Submitting…" : "Submit for verification"}
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={() => setPayOpen(false)}
                    className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold"
                  >
                    I&apos;ll pay later
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={() => printReceipt(bill, receiptDetails)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Print receipt
          </button>
          <button
            onClick={() => downloadReceipt(bill, receiptDetails)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download receipt
          </button>
        </div>

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Not satisfied with this bill?</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Write what looks wrong and send it to your landlord. Your message stays attached to
                this bill and the readings above.
              </p>
            </div>
          </div>

          {disputes.length > 0 && (
            <div className="mt-4 space-y-3">
              {disputes.map((dispute) => (
                <div
                  key={dispute.id}
                  className="p-4 rounded-xl border border-slate-200/80 bg-slate-50 text-xs space-y-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    {issueBadge(dispute.status, dispute.creditNpr)}
                    <span className="text-[11px] text-slate-400">
                      Sent {dateTime(dispute.createdAt)}
                    </span>
                  </div>
                  <p className="text-slate-800 leading-relaxed">
                    <span className="font-semibold text-slate-900">Your message: </span>
                    “{dispute.reason}”
                  </p>
                  {dispute.resolution ? (
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <div className="font-semibold text-slate-900 mb-0.5">
                        Landlord&apos;s reply
                      </div>
                      <p className="text-slate-700 leading-relaxed">{dispute.resolution}</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Replied {dateTime(dispute.resolvedAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-amber-700 font-medium">Waiting for your landlord to reply.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {openIssue ? (
            <div className="mt-4">
              <Alert kind="info">
                You already have an open issue on this bill. Your landlord will reply here.
              </Alert>
            </div>
          ) : (
            <form onSubmit={submitIssue} className="mt-4 space-y-3">
              <label className={labelClass} htmlFor="issue-message">
                Describe the problem
              </label>
              <textarea
                id="issue-message"
                required
                minLength={5}
                maxLength={2000}
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Example: I was away for a week, so this usage looks too high. Can you check the meter readings?"
                className={`${inputClass} resize-y leading-relaxed`}
              />
              {error && <Alert kind="error">{error}</Alert>}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <PrimaryButton type="submit" disabled={busy || reason.trim().length < 5}>
                  <Send className="w-3.5 h-3.5" />
                  {busy ? "Sending…" : "Send issue to landlord"}
                </PrimaryButton>
                <p className="text-[11px] text-slate-400">
                  Your landlord sees this message with the bill and its readings.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
      </section>
    </>
  );
}
