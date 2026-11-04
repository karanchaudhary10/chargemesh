import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Home as HomeIcon,
  LogOut,
  Mail,
  MessageSquare,
  Receipt,
  RefreshCw,
  Trash2,
  UserPlus,
  Wallet,
  Star
} from "lucide-react";
import type { HashConnect } from "hashconnect";
import { getHashConnect } from "../hashconnect.js";
import { api, type Bill, type User } from "../api.js";
import { dateOnly, firstName, kwh, npr, period, shortId } from "../lib/format.js";
import {
  Alert,
  BillStatusBadge,
  Footer,
  Loading,
  Modal,
  cardClass,
  useFlash
} from "../components/ui.js";
import { ChargeMeshBrand } from "../components/Brand.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { BillDetail } from "./BillDetail.js";
import { HomeView } from "./HomeView.js";
import { PaymentDialog } from "./PaymentDialog.js";
import { amountDue, disputeBillId, useRenterData } from "./useRenterData.js";

type RenterView = "home" | "bills";

const HASHPACK_PAIRING_LOCK = "chargemesh_hashpack_pairing_lock";
const HASHPACK_PAIRING_LOCK_TTL_MS = 30_000;

function acquireHashPackPairingLock(): string | null {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const current = window.localStorage.getItem(HASHPACK_PAIRING_LOCK);
  if (current) {
    const timestamp = Number(current.split(":")[0]);
    if (Number.isFinite(timestamp) && now - timestamp < HASHPACK_PAIRING_LOCK_TTL_MS) {
      return null;
    }
  }
  window.localStorage.setItem(HASHPACK_PAIRING_LOCK, token);
  return token;
}

function releaseHashPackPairingLock(token: string): void {
  if (window.localStorage.getItem(HASHPACK_PAIRING_LOCK) === token) {
    window.localStorage.removeItem(HASHPACK_PAIRING_LOCK);
  }
}

const badgeStatus = (status: string) => (status === "issued" ? "unpaid" : status);

function navClass(active: boolean) {
  return `inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
    active ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
  }`;
}

export function RenterApp({
  user,
  onLogout
}: {
  user: User;
  onLogout: () => void;
  /** Kept so the shared app shell can pass it through; the renter page does not edit profiles. */
  onUserChange?: (user: User) => void;
}) {
  const data = useRenterData();
  const [hashpackAccountId, setHashpackAccountId] = useState<string | null>(null);
  const [hashpackBalance, setHashpackBalance] = useState<string | null>(null);
  const [hashpackBusy, setHashpackBusy] = useState(false);
  const [hashpackError, setHashpackError] = useState<string | null>(null);
  // HashPack may authorise several accounts in one session. Hold them here so
  // the renter can pick exactly one instead of us silently using accountIds[0].
  const [pendingHashPackAccounts, setPendingHashPackAccounts] = useState<string[]>([]);
  const hashconnectRef = useRef<HashConnect | null>(null);
  const connectHashPackPromiseRef = useRef<Promise<void> | null>(null);
  const pairingModalOpenRef = useRef(false);
  const pairingListenerRef = useRef<((session: { accountIds?: string[] }) => void) | null>(null);
  const selectedAccountKey = `chargemesh_renter_hashpack_account:${user.id}`;
  const [view, setView] = useState<RenterView>("home");
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [payBillId, setPayBillId] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const handledPayLink = useRef(false);

  useEffect(() => {
    return () => {
      const hashconnect = hashconnectRef.current;
      const listener = pairingListenerRef.current;
      if (hashconnect && listener) hashconnect.pairingEvent.off(listener);
      pairingListenerRef.current = null;
    };
  }, []);

  const fetchHbarUsdPrice = async (): Promise<number | null> => {
    const sources = [
      "https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd",
      "https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT",
      "https://api.kraken.com/0/public/Ticker?pair=HBARUSD",
      "https://api.huobi.pro/market/detail/merged?symbol=hbarusdt"
    ];
    for (const url of sources) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          "hedera-hashgraph"?: { usd?: number };
          price?: string;
          result?: { HBARUSD?: { c?: [string] }; XHBARZUSD?: { c?: [string] } };
          tick?: { close?: number; last?: number };
        };
        const price =
          payload["hedera-hashgraph"]?.usd ??
          (Number(payload.price) ||
            Number(
              payload.result?.HBARUSD?.c?.[0] ??
                payload.result?.XHBARZUSD?.c?.[0]
            ) ||
            payload.tick?.close ||
            payload.tick?.last);
        if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
      } catch {
        // Try the next public price source.
      } finally {
        window.clearTimeout(timeout);
      }
    }
    return null;
  };

  const loadHashPackBalance = async (accountId: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/accounts/${encodeURIComponent(accountId)}`,
        { signal: controller.signal }
      );
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Could not load the HashPack balance (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as {
      balance?: { balance?: number | string };
      balances?: Array<{ balance?: number | string }>;
    };
    const tinybars = Number(payload.balance?.balance ?? payload.balances?.[0]?.balance);
    if (!Number.isFinite(tinybars)) {
      throw new Error("HashPack connected, but its HBAR balance was unavailable.");
    }
    const hbarBalance = tinybars / 100_000_000;
    const usdPrice = await fetchHbarUsdPrice();
    if (usdPrice !== null) {
      const usdBalance = hbarBalance * usdPrice;
      setHashpackBalance(
        usdBalance.toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: usdBalance < 0.01 ? 6 : 2,
          maximumFractionDigits: usdBalance < 0.01 ? 8 : 6
        })
      );
    } else {
      setHashpackBalance(
        `${hbarBalance.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 8
        })} HBAR`
      );
    }
  };

  useEffect(() => {
    const remembered = window.localStorage.getItem(selectedAccountKey)?.trim();
    if (!remembered) return;

    setHashpackAccountId(remembered);
    void loadHashPackBalance(remembered).catch((error) => {
      setHashpackError(
        error instanceof Error ? error.message : "Could not load HashPack balance."
      );
    });
    // The account key is scoped to the logged-in renter. The balance loader is
    // stable for this mount and should not trigger a second restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountKey]);

  useEffect(() => {
    if (handledPayLink.current || data.loading || !data.room) return;
    const billId = new URLSearchParams(window.location.search).get("pay");
    if (!billId) return;
    handledPayLink.current = true;
    const bill = data.bills.find((item) => item.billId === billId);
    if (!bill) return;
    setSelectedBillId(bill.billId);
    setView("bills");
    if (bill.status === "issued") setPayBillId(bill.billId);
  }, [data.loading, data.room, data.bills]);

  const selectHashPackAccount = (accountId: string) => {
    setHashpackAccountId(accountId);
    setHashpackBalance(null);
    setHashpackError(null);
    setPendingHashPackAccounts([]);
    window.localStorage.setItem(selectedAccountKey, accountId);
    void loadHashPackBalance(accountId).catch((error) => {
      setHashpackError(error instanceof Error ? error.message : "Could not load HashPack balance.");
    });
  };

  const removeHashPackWallet = async () => {
    if (pairingModalOpenRef.current) return;
    setHashpackBusy(true);
    setHashpackError(null);
    try {
      const hashconnect = hashconnectRef.current;
      if (hashconnect) {
        await hashconnect.disconnect();
      }
      window.localStorage.removeItem(selectedAccountKey);
      setHashpackAccountId(null);
      setHashpackBalance(null);
      setPendingHashPackAccounts([]);
    } catch (error) {
      setHashpackError(
        error instanceof Error ? error.message : "Could not remove the HashPack wallet."
      );
    } finally {
      setHashpackBusy(false);
    }
  };

  const connectHashPack = async () => {
    if (connectHashPackPromiseRef.current || pairingModalOpenRef.current) {
      if (connectHashPackPromiseRef.current) {
      await connectHashPackPromiseRef.current;
      }
      return;
    }

    const pairingLock = acquireHashPackPairingLock();
    if (!pairingLock) {
      setHashpackError("A HashPack connection is already opening in another tab.");
      return;
    }

    const connection = (async () => {
      pairingModalOpenRef.current = true;
      setHashpackBusy(true);
      setHashpackError(null);
      const hashconnect = await Promise.race([
        getHashConnect("renter", "ChargeMesh renter portal"),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("HashPack did not respond. Check that the extension is installed and unlocked.")),
            12_000
          )
        )
      ]);
      hashconnectRef.current = hashconnect;

      const remembered = window.localStorage.getItem(selectedAccountKey)?.trim();
      const connectedAccounts = hashconnect.connectedAccountIds.map((accountId) =>
        accountId.toString()
      );
      if (remembered && connectedAccounts.includes(remembered)) {
        selectHashPackAccount(remembered);
        return;
      }

      // Do not open another HashPack tab when an existing session already
      // contains accounts. Let the renter choose one in ChargeMesh, or use
      // the remove button to disconnect and pair a different account.
      if (connectedAccounts.length > 0) {
        // Do not silently inherit an account connected by another login.
        // The renter must explicitly choose the account, which also makes
        // that account the default for this renter.
        setPendingHashPackAccounts(connectedAccounts);
        return;
      }

      // One listener only, even if the renter retries the connection.
      if (pairingListenerRef.current) {
        hashconnect.pairingEvent.off(pairingListenerRef.current);
        pairingListenerRef.current = null;
      }

      const pairingListener = (session: { accountIds?: string[] }) => {
        const accounts = Array.from(
          new Set((session.accountIds ?? []).filter((value): value is string => Boolean(value)))
        );
        if (accounts.length === 0) {
          setHashpackBusy(false);
          return;
        }
        setHashpackBusy(false);

        // Re-use the account this renter already chose so HashPack never
        // asks again, even when it shares every account in the wallet.
        if (accounts.length === 1) {
          selectHashPackAccount(accounts[0]!);
          return;
        }
        // Multiple accounts authorised: ask the renter which one to use.
        setPendingHashPackAccounts(accounts);
      };
      pairingListenerRef.current = pairingListener;
      hashconnect.pairingEvent.on(pairingListener);

      await hashconnect.openPairingModal();
    })()
      .catch((error) => {
        setHashpackError(error instanceof Error ? error.message : "Could not connect HashPack.");
      })
      .finally(() => {
        releaseHashPackPairingLock(pairingLock);
        pairingModalOpenRef.current = false;
        setHashpackBusy(false);
        connectHashPackPromiseRef.current = null;
      });

    connectHashPackPromiseRef.current = connection;
    await connection;
  };

  if (data.loading) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Loading label="Loading your bills…" />
      </div>
    );
  }

  if (!data.room) {
    return <NoRoomScreen user={user} error={data.error} onLogout={onLogout} onRefresh={data.reload} />;
  }

  const currentBill = data.unpaid[0] ?? data.latestBill;
  const defaultBill = data.unpaid[0] ?? data.bills[0];
  const selectedBill = data.bills.find((bill) => bill.billId === selectedBillId) ?? defaultBill;
  const payBill = payBillId ? data.bills.find((bill) => bill.billId === payBillId) : undefined;
  const openIssueFor = (billId: string) =>
    data.disputes.some(
      (dispute) => dispute.status === "open" && disputeBillId(dispute) === billId
    );

  const openBill = (billId: string) => {
    setSelectedBillId(billId);
    setView("bills");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const requestPay = (billId: string) => {
    setSelectedBillId(billId);
    setPayBillId(billId);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans antialiased">
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-16 flex items-center justify-between gap-4 py-2.5">
          <div className="flex items-center gap-5 sm:gap-8 min-w-0">
            <ChargeMeshBrand
              subtitle={`Renter Portal · Room ${data.room.name}`}
              className="shrink-0"
            />

            <nav className="hidden sm:flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button onClick={() => setView("home")} className={navClass(view === "home")}>
                <HomeIcon className="w-3.5 h-3.5" />
                Home
              </button>
              <button onClick={() => setView("bills")} className={navClass(view === "bills")}>
                <Receipt className="w-3.5 h-3.5" />
                Bills
                {data.unpaid.length > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold inline-flex items-center justify-center">
                    {data.unpaid.length}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight max-w-[170px] truncate">
                {user.name}
              </div>
              <div className="text-xs text-slate-500 font-medium max-w-[170px] truncate">
                {data.property?.name ?? "Your building"}
              </div>
            </div>
            <div className="hidden sm:flex w-9 h-9 rounded-full bg-blue-600 text-white items-center justify-center text-sm font-bold">
              {user.name.trim().charAt(0).toUpperCase() || "R"}
            </div>
            <div className="hidden sm:block h-5 w-px bg-slate-200" />
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            {hashpackAccountId ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 max-w-[235px]">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      HashPack Wallet
                    </span>
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-[9px] font-semibold text-amber-700">
                      <Star className="w-2 h-2 fill-amber-500 text-amber-500" />
                      Default
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-600 font-mono truncate" title={hashpackAccountId}>
                    Account: {hashpackAccountId}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-bold text-emerald-700">
                      {hashpackBalance ?? "Loading…"}
                    </span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 uppercase font-semibold">
                      testnet
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeHashPackWallet()}
                  disabled={hashpackBusy}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  aria-label="Remove HashPack wallet"
                  title="Remove HashPack wallet"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void connectHashPack()}
                disabled={hashpackBusy}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-60"
                title={hashpackError ?? undefined}
              >
                <Wallet className="w-3.5 h-3.5" />
                {hashpackBusy ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log out
            </button>
          </div>
        </div>

        <nav className="sm:hidden flex items-center gap-1 px-4 pb-3">
          <button onClick={() => setView("home")} className={navClass(view === "home")}>
            <HomeIcon className="w-3.5 h-3.5" />
            Home
          </button>
          <button onClick={() => setView("bills")} className={navClass(view === "bills")}>
            <Receipt className="w-3.5 h-3.5" />
            Bills
            {data.unpaid.length > 0 && (
              <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold inline-flex items-center justify-center">
                {data.unpaid.length}
              </span>
            )}
          </button>
          <ThemeToggle className="ml-auto" />
        </nav>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {flash && (
          <div className="mb-5">
            <Alert kind="success">{flash}</Alert>
          </div>
        )}
        {data.error && (
          <div className="mb-5">
            <Alert kind="error">Could not refresh your bills: {data.error}</Alert>
          </div>
        )}
        {hashpackError && (
          <div className="mb-5">
            <Alert kind="error">{hashpackError}</Alert>
          </div>
        )}

        {view === "home" ? (
          <HomeView
            user={user}
            data={data}
            onOpenBill={openBill}
            onOpenBills={() => setView("bills")}
            onPay={requestPay}
          />
        ) : (
          <BillsView
            data={data}
            user={user}
            currentBill={currentBill}
            selectedBill={selectedBill}
            onSelectBill={setSelectedBillId}
            onPay={requestPay}
            openIssueFor={openIssueFor}
            onUpdated={data.reload}
            hashconnect={hashconnectRef.current}
            hashpackAccountId={hashpackAccountId}
          />
        )}
      </main>

      <Footer />

      {payBill && (
        <PaymentDialog
          bill={payBill}
          roomName={data.room.name}
          propertyName={data.property?.name}
          onClose={() => setPayBillId(null)}
          onPaid={async () => {
            await data.reload();
            setFlash("Payment recorded. Your bill is now marked as paid.");
          }}
        />
      )}

      {pendingHashPackAccounts.length > 0 && (
        <Modal
          title="Choose one account"
          subtitle="HashPack shared multiple accounts"
          icon={<Wallet className="w-4 h-4" />}
          onClose={() => setPendingHashPackAccounts([])}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-500 leading-relaxed">
              HashPack authorised {pendingHashPackAccounts.length} accounts. Pick the single
              account you want to use with ChargeMesh — only that account will be connected.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pendingHashPackAccounts.map((accountId) => (
                <button
                  key={accountId}
                  type="button"
                  onClick={() => selectHashPackAccount(accountId)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 text-left hover:border-blue-400 hover:bg-blue-100 transition-colors"
                >
                  <span className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900 font-mono truncate">
                      {accountId}
                    </span>
                    <span className="block text-[11px] text-slate-500">Use this account only</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tip: next time, select only one account on the HashPack approval screen to skip this step.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BillsView({
  data,
  user,
  currentBill,
  selectedBill,
  onSelectBill,
  onPay,
  openIssueFor,
  onUpdated,
  hashconnect,
  hashpackAccountId
}: {
  data: ReturnType<typeof useRenterData>;
  user: User;
  currentBill?: Bill;
  selectedBill?: Bill;
  onSelectBill: (billId: string) => void;
  onPay: (billId: string) => void;
  openIssueFor: (billId: string) => boolean;
  onUpdated: () => Promise<void>;
  hashconnect: HashConnect | null;
  hashpackAccountId: string | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold text-blue-600 tracking-wider uppercase mb-1">
          Room {data.room?.name}
          {data.room?.floor ? ` · ${data.room.floor}` : ""}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Bills</h1>
        <p className="text-sm text-slate-500 mt-1">
          Your current bill, full calculation, meter readings and payment in one place.
        </p>
      </div>

      {currentBill && (
        <section
          className={`${cardClass} overflow-hidden`}
          aria-label="Current bill summary"
        >
          <div className="flex flex-col sm:flex-row sm:items-stretch">
            <div className="flex-1 p-5 sm:p-6 border-b sm:border-b-0 sm:border-r border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Current bill
                </span>
                <BillStatusBadge status={badgeStatus(currentBill.status)} />
              </div>
              <div className="text-3xl font-bold text-slate-900 tabular-nums mt-2">
                {npr(amountDue(currentBill))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {period(currentBill.periodStart, currentBill.periodEnd)}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{kwh(currentBill.consumptionKwh)} used</span>
                <span>{npr(currentBill.rateNprPerKwh)} / kWh</span>
                <span>Bill {shortId(currentBill.billId)}</span>
              </div>
            </div>

            <div className="p-5 sm:p-6 sm:w-64 flex flex-col justify-center gap-2.5 bg-slate-50">
              {currentBill.status === "issued" ? (
                <>
                  <button
                    onClick={() => onSelectBill(currentBill.billId)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    View bill & pay
                  </button>
                </>
              ) : currentBill.status === "payment_pending_verification" ? (
                <>
                  <div className="text-xs text-indigo-700 font-semibold text-center">
                    Waiting for landlord to verify your payment
                  </div>
                  <button
                    onClick={() => onSelectBill(currentBill.billId)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    View submitted payment
                  </button>
                </>
              ) : (
                <>
                  <div className="text-xs text-emerald-700 font-semibold text-center">
                    Paid on {dateOnly(currentBill.paidAt)}
                  </div>
                  <button
                    onClick={() => onSelectBill(currentBill.billId)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    View receipt
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {data.bills.length === 0 ? (
        <div className={`${cardClass} p-10 text-center`}>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Receipt className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-4">No bills yet</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
            Your landlord has not sent a bill for Room {data.room?.name} yet. When one is sent, it
            will appear here with its full detail.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-6 items-start">
          <aside className={`${cardClass} overflow-hidden lg:sticky lg:top-28`}>
            <div className="p-5 pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">Bill history</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {data.bills.length} bill{data.bills.length === 1 ? "" : "s"}, newest first.
              </p>
            </div>
            <div className="divide-y divide-slate-100 max-h-[62vh] overflow-y-auto">
              {data.bills.map((bill) => {
                const selected = selectedBill?.billId === bill.billId;
                return (
                  <button
                    key={bill.billId}
                    onClick={() => onSelectBill(bill.billId)}
                    aria-pressed={selected}
                    className={`w-full text-left p-4 transition-colors border-l-4 ${
                      selected
                        ? "bg-blue-50 border-blue-600"
                        : "border-transparent hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {shortId(bill.billId)}
                      </span>
                      <BillStatusBadge status={badgeStatus(bill.status)} />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">
                      {period(bill.periodStart, bill.periodEnd)}
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2">
                      <span className="text-[11px] text-slate-500">{kwh(bill.consumptionKwh)}</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {npr(amountDue(bill))}
                      </span>
                    </div>
                    {openIssueFor(bill.billId) && (
                      <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 mt-1.5">
                        <MessageSquare className="w-3 h-3" />
                        Issue waiting for reply
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          {selectedBill && (
            <BillDetail
              key={selectedBill.billId}
              bill={selectedBill}
              data={data}
              user={user}
              onUpdated={onUpdated}
              hashconnect={hashconnect}
              hashpackAccountId={hashpackAccountId}
              onPay={
                selectedBill.status === "issued"
                  ? () => onPay(selectedBill.billId)
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function NoRoomScreen({
  user,
  error,
  onLogout,
  onRefresh
}: {
  user: User;
  error: string | null;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans antialiased">
      <header className="bg-white border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-4">
          <ChargeMeshBrand subtitle="Renter Portal" />
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10">
        {error && <Alert kind="error">{error}</Alert>}

        <div className={`${cardClass} p-8 max-w-2xl mt-6`}>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <UserPlus className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-4">
            Welcome, {firstName(user.name)}
          </h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Your landlord has not assigned you to a room yet. Once they do, this page will show the
            bills they send for your room, the meter readings behind each one, and a place to raise
            an issue.
          </p>

          <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Give this email to your landlord
            </div>
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <span className="font-mono text-sm text-slate-900 break-all">{user.email}</span>
              <button
                onClick={copyEmail}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <ol className="mt-6 space-y-3 text-sm text-slate-600">
            {[
              "Your landlord adds this email when assigning your room.",
              "Their bills appear here with the full calculation and meter readings.",
              "If a bill looks wrong, write a message on that bill and send it to your landlord."
            ].map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => void onRefresh()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check again
            </button>
            <a
              href={`mailto:?subject=${encodeURIComponent("My ChargeMesh renter email")}&body=${encodeURIComponent(user.email)}`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold rounded-lg transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Email it to my landlord
            </a>
          </div>

          <p className="text-[11px] text-slate-400 mt-5">
            Assigned already? Give it a few seconds and press “Check again”.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
