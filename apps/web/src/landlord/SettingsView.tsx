import React, { useEffect, useRef, useState } from 'react';
import { Magic } from 'magic-sdk';
import { HederaExtension } from '@magic-ext/hedera';
import type { HashConnect } from 'hashconnect';
import { getHashConnect } from '../hashconnect.js';
import {
  Building,
  User,
  Zap,
  Save,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Wallet,
  Trash2,
  Star,
} from 'lucide-react';
import type { UserWallet, WalletType } from '@chargemesh/shared';
import { api } from '../api.js';
import type { PropertySettings } from './types';
import { Modal, inputClass } from '../components/ui.js';

const walletTypeLabel = (type: string) => {
  if (type === 'hashpack') return 'HashPack';
  if (type === 'hedera') return 'Magic';
  return type;
};

const HASH_PACK_ACCOUNT_STORAGE_PREFIX = 'chargemesh_hashpack_main_account:';
const isHederaWallet = (wallet: UserWallet) =>
  wallet.type === 'hashpack' || wallet.type === 'hedera';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hederaAccountId(metadata: { wallets?: Record<string, { publicAddress?: string | null } | undefined> }, publicKeyResult: unknown) {
  const hederaWallet = metadata.wallets?.hedera;
  const result = publicKeyResult && typeof publicKeyResult === 'object'
    ? publicKeyResult as { accountId?: unknown; publicAddress?: unknown }
    : {};
  const candidates = [
    stringValue(hederaWallet?.publicAddress),
    stringValue(result.accountId),
    stringValue(result.publicAddress)
  ];
  return candidates.find((candidate) => candidate && /^\d+\.\d+\.\d+$/.test(candidate));
}

function hederaPublicKey(publicKeyResult: unknown): string | undefined {
  if (typeof publicKeyResult === 'string') return stringValue(publicKeyResult);
  if (!publicKeyResult || typeof publicKeyResult !== 'object') return undefined;
  const result = publicKeyResult as { publicKey?: unknown; key?: unknown };
  return stringValue(result.publicKey) ?? stringValue(result.key) ?? JSON.stringify(publicKeyResult);
}

interface AuditResult {
  valid: boolean;
  count: number;
  headHash?: string;
  brokenAt?: number;
}

interface SettingsViewProps {
  settings: PropertySettings;
  userId: string;
  onUpdateSettings: (newSettings: PropertySettings) => Promise<void>;
  onVerifyAudit: () => Promise<AuditResult>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  userId,
  onUpdateSettings,
  onVerifyAudit,
}) => {
  const [formData, setFormData] = useState<PropertySettings>(settings);
  const [savedToast, setSavedToast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [auditBusy, setAuditBusy] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletForm, setWalletForm] = useState<{
    type: WalletType;
    label: string;
    accountId: string;
    qrDataUrl: string;
    isDefault: boolean;
  }>({ type: 'hashpack', label: '', accountId: '', qrDataUrl: '', isDefault: false });

  const [magicConnecting, setMagicConnecting] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [magicModalOpen, setMagicModalOpen] = useState(false);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [walletChooserOpen, setWalletChooserOpen] = useState(false);
  const [hashpackConnecting, setHashpackConnecting] = useState(false);
  const [hashpackError, setHashpackError] = useState<string | null>(null);
  const [hashpackReady, setHashpackReady] = useState(false);
  const hashconnectRef = useRef<HashConnect | null>(null);
  const walletsRef = useRef<UserWallet[]>([]);
  walletsRef.current = wallets;
  // HashPack can return several authorised accounts at once. Keep the pending
  // list so the user can pick exactly one instead of us silently using [0].
  const [pendingHashPackAccounts, setPendingHashPackAccounts] = useState<string[]>([]);
  const [hashpackSavingAccount, setHashpackSavingAccount] = useState<string | null>(null);
  const saveHashPackWalletRef = useRef<(accountId: string) => void>(() => {});
  const pairingModalOpenRef = useRef(false);
  const awaitingPairingRef = useRef(false);
  const pairingTimeoutRef = useRef<number | null>(null);
  const selectedAccountKey = `${HASH_PACK_ACCOUNT_STORAGE_PREFIX}${userId}`;
  const hasMainWallet = wallets.some(isHederaWallet);

  const refreshWallets = async () => {
    const result = await api.wallets();
    setWallets(result.wallets);
  };

  useEffect(() => {
    let mounted = true;
    let activeHashconnect: any = null;
    let pairingListener: ((sessionData: { accountIds?: string[] }) => void) | null = null;

    void (async () => {
      try {
        const hashconnect = await getHashConnect('landlord', 'ChargeMesh Property Management');
        if (!mounted) return;
        activeHashconnect = hashconnect;
        hashconnectRef.current = hashconnect;
        setHashpackReady(true);

        const handlePairedAccounts = (accountIds: Array<string | { toString(): string }>) => {
          // Ignore sessions restored automatically on page load. Only react
          // after the landlord explicitly asked to connect a wallet.
          if (!awaitingPairingRef.current) return;

          const accounts = Array.from(
            new Set(
              accountIds
                .map((value) => String(value).trim())
                .filter((value): value is string => Boolean(value))
            )
          );
          if (accounts.length === 0) return;

          if (pairingTimeoutRef.current) {
            window.clearTimeout(pairingTimeoutRef.current);
            pairingTimeoutRef.current = null;
          }
          pairingModalOpenRef.current = false;
          awaitingPairingRef.current = false;
          setHashpackConnecting(false);

          const savedWallet = walletsRef.current.find(
            (wallet) => isHederaWallet(wallet) && Boolean(wallet.accountId)
          );
          const remembered = window.localStorage.getItem(selectedAccountKey)?.trim();
          const preferred = savedWallet?.accountId ?? remembered;

          // Re-use the account the landlord already chose. HashPack may keep
          // sharing every account in the wallet, so never prompt a second time.
          if (preferred && accounts.includes(preferred)) {
            saveHashPackWalletRef.current(preferred);
            return;
          }

          // One main wallet per landlord: keep it and ignore extra accounts.
          if (savedWallet?.accountId) {
            setPendingHashPackAccounts([]);
            setWalletChooserOpen(false);
            setHashpackError(
              `Main wallet ${savedWallet.accountId} is already connected. Remove it before connecting a different account.`
            );
            return;
          }

          if (accounts.length === 1) {
            saveHashPackWalletRef.current(accounts[0]!);
            return;
          }

          // Multiple accounts were authorised in one pairing session. Never
          // grab the first one: let the user choose the single account.
          setWalletChooserOpen(false);
          setPendingHashPackAccounts(accounts);
        };

        pairingListener = (sessionData: { accountIds?: string[] }) => {
          handlePairedAccounts(sessionData.accountIds ?? []);
        };
        hashconnect.pairingEvent.on(pairingListener);
      } catch (error) {
        if (mounted) {
          setHashpackError(error instanceof Error ? error.message : 'HashPack is not available.');
          setHashpackReady(false);
        }
      }
    })();

    return () => {
      mounted = false;
      if (pairingTimeoutRef.current) {
        window.clearTimeout(pairingTimeoutRef.current);
        pairingTimeoutRef.current = null;
      }
      if (activeHashconnect && pairingListener) {
        activeHashconnect.pairingEvent.off(pairingListener);
      }
    };
  }, [selectedAccountKey]);

  useEffect(() => {
    // Remove malformed wallet USD cache entries
    try {
      const raw1 = localStorage.getItem('chargemesh_hashpack_usd_cache');
      const raw2 = localStorage.getItem('chargemesh_hashpack_usd_cache_last');
      if (raw1 === 'undefined' || raw1 === 'null') localStorage.removeItem('chargemesh_hashpack_usd_cache');
      if (raw2 === 'undefined' || raw2 === 'null') localStorage.removeItem('chargemesh_hashpack_usd_cache_last');
      if (raw1 && raw1 !== 'undefined' && raw1 !== 'null') {
        try {
          const parsed = JSON.parse(raw1);
          if (typeof parsed === 'object') {
            Object.keys(parsed).forEach((k) => {
              if (parsed[k]?.usd === undefined || parsed[k]?.usd === null || parsed[k]?.usd === 'undefined') {
                delete parsed[k];
              }
            });
            if (Object.keys(parsed).length === 0) {
              localStorage.removeItem('chargemesh_hashpack_usd_cache');
            } else {
              localStorage.setItem('chargemesh_hashpack_usd_cache', JSON.stringify(parsed));
            }
          } else {
            localStorage.removeItem('chargemesh_hashpack_usd_cache');
          }
        } catch {
          localStorage.removeItem('chargemesh_hashpack_usd_cache');
        }
      }
      if (raw2 && raw2 !== 'undefined' && raw2 !== 'null') {
        try {
          const parsed = JSON.parse(raw2);
          if (typeof parsed === 'object') {
            Object.keys(parsed).forEach((k) => {
              if (parsed[k]?.usd === undefined || parsed[k]?.usd === null || parsed[k]?.usd === 'undefined') {
                delete parsed[k];
              }
            });
            if (Object.keys(parsed).length === 0) {
              localStorage.removeItem('chargemesh_hashpack_usd_cache_last');
            } else {
              localStorage.setItem('chargemesh_hashpack_usd_cache_last', JSON.stringify(parsed));
            }
          } else {
            localStorage.removeItem('chargemesh_hashpack_usd_cache_last');
          }
        } catch {
          localStorage.removeItem('chargemesh_hashpack_usd_cache_last');
        }
      }
    } catch {}

    fetchHbarPrice();
    refreshWallets()
      .catch((err) =>
        setWalletError(err instanceof Error ? err.message : 'Could not load payment wallets.')
      )
      .finally(() => setWalletsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readWalletQr = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setWalletError('Only image files are allowed for the QR code.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setWalletError('QR image must be smaller than 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setWalletForm((current) => ({ ...current, qrDataUrl: String(reader.result) }));
      setWalletError(null);
    };
    reader.onerror = () => setWalletError('Could not read the QR image.');
    reader.readAsDataURL(file);
  };

  const handleAddWallet = async () => {
    if (walletBusy) return;
    if (!walletForm.label.trim()) {
      setWalletError('Give this wallet a label, for example "HashPack".');
      return;
    }
    setWalletBusy(true);
    setWalletError(null);
    try {
      await api.createWallet({
        type: walletForm.type,
        label: walletForm.label.trim(),
        accountId: walletForm.accountId.trim() || undefined,
        qrDataUrl: walletForm.qrDataUrl || undefined,
        isDefault: walletForm.isDefault || wallets.length === 0,
      });
      setWalletForm({ type: 'hashpack', label: '', accountId: '', qrDataUrl: '', isDefault: false });
      await refreshWallets();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Could not save this wallet.');
    } finally {
      setWalletBusy(false);
    }
  };

  const [walletBalances, setWalletBalances] = useState<Record<string, { 
    hbar: string; 
    hbarRaw: number | null; 
    usd: string | null; 
    priceError?: boolean; 
    loading?: boolean;
    lastBalanceAt?: number | null;
    lastPriceAt?: number | null;
    stale?: boolean;
    status?: 'ok' | 'stale' | 'unavailable';
    lastValidUsd?: string | null;
    lastValidUsdAt?: number | null;
  }>>({});
  const [hbarUsdPrice, setHbarUsdPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [priceLastUpdated, setPriceLastUpdated] = useState<number | null>(null);
  const priceCacheRef = React.useRef<{ price: number | null; ts: number | null }>({ price: null, ts: null });
  const lastValidUsdByWalletRef = React.useRef<Record<string, { usd: string; ts: number }>>({});

  const fetchWithTimeout = async (input: RequestInfo, init: RequestInit = {}, timeoutMs = 10000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  const fetchHbarPrice = async (force = false) => {
    const now = Date.now();
    // Use cache if recent (2 min) to avoid rate limits
    if (!force && priceCacheRef.current.price && priceCacheRef.current.ts && (now - priceCacheRef.current.ts) < 2 * 60 * 1000) {
      if (hbarUsdPrice !== priceCacheRef.current.price) {
        setHbarUsdPrice(priceCacheRef.current.price);
      }
      setPriceError(false);
      return priceCacheRef.current.price;
    }
    try {
      // Try Huobi first (often works)
      try {
        const res = await fetchWithTimeout('https://api.huobi.pro/market/detail/merged?symbol=hbarusdt', { headers: { 'Accept': 'application/json' } }, 8000);
        console.log('[HBAR_PRICE] Huobi status:', res.status);
        if (res.ok) {
          const data = await res.json();
          const price = data?.tick?.close || data?.tick?.last;
          if (typeof price === 'number' && price > 0 && isFinite(price)) {
            setHbarUsdPrice(price);
            setPriceError(false);
            setPriceLastUpdated(now);
            priceCacheRef.current = { price, ts: now };
            console.log('[HBAR_PRICE] Huobi price:', price);
            return price;
          }
        }
      } catch (e: any) {
        console.log('[HBAR_PRICE] Huobi failed:', e?.message || e);
      }
      // Try CoinGecko
      try {
        const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd', { headers: { 'Accept': 'application/json' } }, 8000);
        console.log('[HBAR_PRICE] CoinGecko status:', res.status);
        if (res.ok) {
          const data = await res.json();
          const price = data?.['hedera-hashgraph']?.usd;
          if (typeof price === 'number' && price > 0 && isFinite(price)) {
            setHbarUsdPrice(price);
            setPriceError(false);
            setPriceLastUpdated(now);
            priceCacheRef.current = { price, ts: now };
            console.log('[HBAR_PRICE] CoinGecko price:', price);
            return price;
          }
        }
      } catch (e: any) {
        console.log('[HBAR_PRICE] CoinGecko failed:', e?.message || e);
      }
      // Try Binance
      try {
        const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT', {}, 8000);
        console.log('[HBAR_PRICE] Binance status:', res.status);
        if (res.ok) {
          const data = await res.json();
          const price = parseFloat(data?.price);
          if (!isNaN(price) && price > 0 && isFinite(price)) {
            setHbarUsdPrice(price);
            setPriceError(false);
            setPriceLastUpdated(now);
            priceCacheRef.current = { price, ts: now };
            console.log('[HBAR_PRICE] Binance price:', price);
            return price;
          }
        }
      } catch (e: any) {
        console.log('[HBAR_PRICE] Binance failed:', e?.message || e);
      }
      // Try Kraken
      try {
        const res = await fetchWithTimeout('https://api.kraken.com/0/public/Ticker?pair=HBARUSD', {}, 8000);
        console.log('[HBAR_PRICE] Kraken status:', res.status);
        if (res.ok) {
          const data = await res.json();
          const pair = data?.result?.XHBARZUSD || data?.result?.HBARUSD;
          const price = parseFloat(pair?.c?.[0]);
          if (!isNaN(price) && price > 0 && isFinite(price)) {
            setHbarUsdPrice(price);
            setPriceError(false);
            setPriceLastUpdated(now);
            priceCacheRef.current = { price, ts: now };
            console.log('[HBAR_PRICE] Kraken price:', price);
            return price;
          }
        }
      } catch (e: any) {
        console.log('[HBAR_PRICE] Kraken failed:', e?.message || e);
      }
      // If we have cached price, keep it but mark error
      if (priceCacheRef.current.price) {
        setPriceError(true);
        console.log('[HBAR_PRICE] All failed, using cached price');
        return priceCacheRef.current.price;
      }
      setPriceError(true);
      console.log('[HBAR_PRICE] All price sources failed');
      return null;
    } catch (e: any) {
      if (priceCacheRef.current.price) {
        setPriceError(true);
        return priceCacheRef.current.price;
      }
      setPriceError(true);
      console.log('[HBAR_PRICE] Error:', e?.message || e);
      return null;
    }
  };

  const fetchBalance = async (accountId: string, walletId: string, network: string = 'testnet', retry = 0) => {
    const start = Date.now();
    console.log('[BALANCE] Fetch start', { accountId, walletId, network, retry, ts: Date.now() });
    setWalletBalances((prev) => ({ 
      ...prev, 
      [walletId]: { 
        ...(prev[walletId] || {}), 
        loading: true
      } as any 
    }));
    try {
      const baseUrl = network === 'mainnet' 
        ? 'https://mainnet.mirrornode.hedera.com'
        : 'https://testnet.mirrornode.hedera.com';
      let balanceTinybars: number | null = null;
      // Try accounts endpoint first
      try {
        const res = await fetchWithTimeout(`${baseUrl}/api/v1/accounts/${accountId}`, {}, 10000);
        if (res.ok) {
          const data = (await res.json()) as {
            balance?: number | string | { balance?: number | string };
            balances?: Array<{ balance?: number | string }>;
          };
          const accountBalance =
            typeof data.balance === 'object'
              ? data.balance?.balance
              : data.balance;
          const parsed = Number(accountBalance ?? data.balances?.[0]?.balance);
          if (Number.isFinite(parsed)) balanceTinybars = parsed;
        }
      } catch (e: any) {
        console.log('[BALANCE] accounts fetch error:', e?.message || e);
      }
      // Fallback to balances endpoint
      if (balanceTinybars === null || isNaN(balanceTinybars)) {
        try {
          const res2 = await fetchWithTimeout(`${baseUrl}/api/v1/balances?account.id=${accountId}`, {}, 10000);
          if (res2.ok) {
            const data2 = (await res2.json()) as {
              balances?: Array<{ balance?: number | string }>;
            };
            const parsed = Number(data2.balances?.[0]?.balance);
            if (Number.isFinite(parsed)) balanceTinybars = parsed;
          }
        } catch (e: any) {
          console.log('[BALANCE] balances fetch error:', e?.message || e);
        }
      }
      if (balanceTinybars !== null && Number.isFinite(balanceTinybars)) {
        const balanceNumHbar = balanceTinybars / 100000000;
        console.log('[BALANCE] HBAR converted:', balanceNumHbar, 'elapsed:', Date.now()-start);
        const hbarStr = balanceNumHbar.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
        // Get price - don't overwrite balance if price fails
        let price = hbarUsdPrice || priceCacheRef.current.price;
        console.log('[BALANCE] price before fetch:', price);
        if (price === null || price === undefined) {
          price = await fetchHbarPrice();
        } else if (priceCacheRef.current.ts && (Date.now() - priceCacheRef.current.ts) > 10 * 60 * 1000) {
          fetchHbarPrice(true).catch(()=>{});
        }
        console.log('[BALANCE] price after fetch:', price, 'provider cached:', priceCacheRef.current);
        let usdStr: string | null = null;
        if (price !== null && typeof price === 'number' && !isNaN(price) && balanceNumHbar !== null && !isNaN(balanceNumHbar)) {
          const usdVal = balanceNumHbar * price;
          console.log('[BALANCE] USD calc:', usdVal);
          if (!isNaN(usdVal) && isFinite(usdVal)) {
            if (usdVal < 0.01) {
              usdStr = '$' + usdVal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
            } else {
              usdStr = '$' + usdVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
            }
            console.log('[BALANCE] USD formatted:', usdStr);
          }
        } else {
          console.log('[BALANCE] USD unavailable - no valid price');
        }
        setWalletBalances((prev) => {
          const nowTs = Date.now();
          const hasValidUsd = usdStr !== null && usdStr !== undefined && usdStr !== 'undefined' && usdStr !== 'null';
          return { 
            ...prev, 
            [walletId]: { 
              hbar: `${hbarStr} ℏ`, 
              hbarRaw: balanceNumHbar,
              usd: hasValidUsd ? usdStr : null,
              priceError: !(price !== null && typeof price === 'number'),
              loading: false,
              lastBalanceAt: nowTs,
              lastPriceAt: priceCacheRef.current.ts || priceLastUpdated || nowTs,
              stale: false,
              status: hasValidUsd ? 'ok' : 'unavailable'
            } 
          };
        });
        console.log('[BALANCE] state updated for', walletId, 'hbar:', balanceNumHbar, 'usd:', usdStr);
      } else {
        console.log('[BALANCE] Balance unavailable - no tinybars found');
        setWalletBalances((prev) => {
          const existing = prev[walletId];
          const lastUsd = lastValidUsdByWalletRef.current[walletId]?.usd;
          // Always keep last valid data if exists
          if (existing?.hbarRaw !== null && existing?.hbarRaw !== undefined) {
            return {
              ...prev,
              [walletId]: {
                ...(existing || { hbar: '0 ℏ', hbarRaw: null }),
                usd: existing?.usd || lastUsd || null,
                hbar: existing?.hbar || (existing?.hbarRaw !== null && existing?.hbarRaw !== undefined ? `${existing.hbarRaw.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:8})} ℏ` : '0 ℏ'),
                hbarRaw: existing?.hbarRaw ?? null,
                priceError: true,
                loading: false,
                stale: true,
                status: 'stale'
              }
            };
          }
          if (retry < 5) {
            const delay = 1000 * Math.pow(2, retry) + Math.random() * 400;
            setTimeout(() => fetchBalance(accountId, walletId, network, retry + 1), delay);
            return { ...prev, [walletId]: { ...(existing || {}), loading: true } as any };
          }
          return { 
            ...prev, 
            [walletId]: { 
              ...(existing || { hbar: '0 ℏ', hbarRaw: null }),
              usd: existing?.usd || lastUsd || null,
              hbar: existing?.hbar || '0 ℏ',
              hbarRaw: existing?.hbarRaw ?? null,
              priceError: true,
              loading: false,
              stale: !!(existing?.usd || lastUsd),
              status: (existing?.usd || lastUsd) ? 'stale' : 'unavailable'
            } 
          };
        });
      }
    } catch (e: any) {
      console.log('[BALANCE] Fatal error:', e?.message || e);
      setWalletBalances((prev) => {
        const existing = prev[walletId];
        const lastUsd = lastValidUsdByWalletRef.current[walletId]?.usd;
        if (existing?.hbarRaw !== null && existing?.hbarRaw !== undefined) {
          return {
            ...prev,
            [walletId]: {
              ...(existing || { hbar: '0 ℏ', hbarRaw: null }),
              usd: existing?.usd || lastUsd || null,
              hbar: existing?.hbar || (existing?.hbarRaw !== null && existing?.hbarRaw !== undefined ? `${existing.hbarRaw.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:8})} ℏ` : '0 ℏ'),
              hbarRaw: existing?.hbarRaw ?? null,
              loading: false,
              stale: true,
              status: 'stale'
            }
          };
        }
        if (retry < 5) {
          const delay = 1000 * Math.pow(2, retry) + Math.random() * 400;
          setTimeout(() => fetchBalance(accountId, walletId, network, retry + 1), delay);
          return { ...prev, [walletId]: { ...(existing || {}), loading: true } as any };
        }
        return { 
          ...prev, 
          [walletId]: { 
            ...(existing || { hbar: '0 ℏ', hbarRaw: null }),
            usd: existing?.usd || lastUsd || null,
            hbar: existing?.hbar || '0 ℏ',
            hbarRaw: existing?.hbarRaw ?? null,
            priceError: true,
            loading: false,
            stale: !!(existing?.usd || lastUsd),
            status: (existing?.usd || lastUsd) ? 'stale' : 'unavailable'
          } 
        };
      });
    }
  };

  useEffect(() => {
    const activeWallets = wallets.filter(
      (wallet) => Boolean(wallet.accountId) && isHederaWallet(wallet)
    );
    if (activeWallets.length === 0) return;

    for (const wallet of activeWallets) {
      const accountId = wallet.accountId!;
      const network = wallet.network || 'testnet';
      void fetchBalance(accountId, wallet.id, network);
    }
    // Balance loading intentionally runs after the API wallet list is in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

  const handleConnectWallet = () => {
    if (hasMainWallet) {
      setWalletError('You already have a main wallet. Remove it before connecting a different account.');
      return;
    }
    setHashpackError(null);
    setMagicError(null);
    setWalletChooserOpen(true);
  };

  const saveHashPackWallet = async (accountId: string) => {
    if (hashpackSavingAccount) return;
    setHashpackSavingAccount(accountId);
    setHashpackError(null);
    try {
      const currentWallets = walletsRef.current;
      const existingMain = currentWallets.find(
        (wallet) => isHederaWallet(wallet) && Boolean(wallet.accountId)
      );

      // A landlord has exactly one main wallet. If a different account was
      // chosen, keep the existing wallet and explain how to switch.
      if (existingMain?.accountId && existingMain.accountId !== accountId) {
        setPendingHashPackAccounts([]);
        setWalletChooserOpen(false);
        setHashpackError(
          `Main wallet ${existingMain.accountId} is already connected. Remove it before connecting a different account.`
        );
        return;
      }

      if (!existingMain) {
        const result = await api.createWallet({
          type: 'hashpack',
          label: `HashPack (${accountId})`,
          accountId,
          network: 'testnet',
          isDefault: currentWallets.length === 0
        });
        await refreshWallets();
        if (result.wallet.id) {
          fetchHbarPrice();
          fetchBalance(accountId, result.wallet.id, 'testnet');
        }
      }

      // Remember the choice so HashPack never asks for an account again.
      window.localStorage.setItem(selectedAccountKey, accountId);
      setPendingHashPackAccounts([]);
      setWalletChooserOpen(false);
      setHashpackConnecting(false);
    } catch (error) {
      setHashpackError(error instanceof Error ? error.message : 'Could not save the HashPack wallet.');
      setHashpackConnecting(false);
    } finally {
      setHashpackSavingAccount(null);
    }
  };
  saveHashPackWalletRef.current = (accountId: string) => {
    void saveHashPackWallet(accountId);
  };

  const handleConnectHashPack = async () => {
    if (hashpackConnecting || pairingModalOpenRef.current || walletBusy) return;
    if (hasMainWallet) {
      setHashpackError('You already have a main wallet. Remove it before connecting a different account.');
      setWalletChooserOpen(false);
      return;
    }
    pairingModalOpenRef.current = true;
    awaitingPairingRef.current = true;
    setHashpackConnecting(true);
    setHashpackError(null);
    if (pairingTimeoutRef.current) window.clearTimeout(pairingTimeoutRef.current);
    // Never leave the button stuck if HashPack is closed without pairing.
    pairingTimeoutRef.current = window.setTimeout(() => {
      pairingModalOpenRef.current = false;
      awaitingPairingRef.current = false;
      pairingTimeoutRef.current = null;
      setHashpackConnecting(false);
      setHashpackError('HashPack connection was cancelled or timed out.');
    }, 20_000);
    try {
      const hashconnect = hashconnectRef.current;
      if (!hashconnect || !hashpackReady || typeof hashconnect.openPairingModal !== 'function') {
        throw new Error(hashpackError || 'HashPack is still initializing. Refresh the page and try again.');
      }
      await hashconnect.openPairingModal();
      // Some HashPack versions resolve the modal promise after approval but
      // before emitting pairingEvent. Read the connected accounts once more.
      const connectedAccounts = hashconnect.connectedAccountIds.map((accountId) =>
        accountId.toString()
      );
      if (connectedAccounts.length > 0 && awaitingPairingRef.current) {
        const accounts = Array.from(new Set(connectedAccounts.filter(Boolean)));
        if (accounts.length === 1) {
          saveHashPackWalletRef.current(accounts[0]!);
        } else {
          pairingModalOpenRef.current = false;
          awaitingPairingRef.current = false;
          if (pairingTimeoutRef.current) {
            window.clearTimeout(pairingTimeoutRef.current);
            pairingTimeoutRef.current = null;
          }
          setHashpackConnecting(false);
          setWalletChooserOpen(false);
          setPendingHashPackAccounts(accounts);
        }
      } else if (awaitingPairingRef.current) {
        pairingModalOpenRef.current = false;
        awaitingPairingRef.current = false;
        if (pairingTimeoutRef.current) {
          window.clearTimeout(pairingTimeoutRef.current);
          pairingTimeoutRef.current = null;
        }
        setHashpackConnecting(false);
      }
    } catch (error) {
      pairingModalOpenRef.current = false;
      awaitingPairingRef.current = false;
      if (pairingTimeoutRef.current) {
        window.clearTimeout(pairingTimeoutRef.current);
        pairingTimeoutRef.current = null;
      }
      setHashpackError(error instanceof Error ? error.message : 'Could not open HashPack.');
      setHashpackConnecting(false);
    }
  };

  const handleConnectMagic = () => {
    setWalletChooserOpen(false);
    setMagicError(null);
    setMagicEmail('');
    setMagicLinkSent(false);
    setMagicModalOpen(true);
  };

  const handleMagicSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (magicConnecting || walletBusy) return;
    if (hasMainWallet) {
      setMagicError('You already have a main wallet. Remove it before connecting a different account.');
      return;
    }
    setMagicConnecting(true);
    setMagicError(null);
    setWalletError(null);
    try {
      const publishableKey = import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY?.trim();
      if (!publishableKey || publishableKey === 'YOUR_PUBLISHABLE_KEY') {
        throw new Error('Set VITE_MAGIC_PUBLISHABLE_KEY in apps/web/.env.local before connecting.');
      }

      const magic = new Magic(publishableKey, {
        extensions: [new HederaExtension({ network: 'testnet' })]
      });
      setMagicLinkSent(true);
      await magic.auth.loginWithMagicLink({ email: magicEmail.trim() });

      const metadata = await magic.user.getInfo();
      const publicKeyResult = await magic.hedera.getPublicKey();
      const publicKey = hederaPublicKey(publicKeyResult);
      const accountId = hederaAccountId(metadata, publicKeyResult);
      if (!publicKey && !accountId) {
        throw new Error(
          'Magic authenticated successfully, but no Hedera wallet address or public key was returned. Check that Hedera is enabled for this Magic app.'
        );
      }
      const res = await api.createWallet({
        type: 'hedera',
        label: 'Magic Embedded Wallet',
        accountId,
        ...(publicKey ? { publicKey } : {}),
        network: 'testnet',
        isDefault: wallets.length === 0,
      });
      await refreshWallets();
      const newWalletId = res.wallet.id;
      if (accountId) window.localStorage.setItem(selectedAccountKey, accountId);
      if (newWalletId) {
        fetchHbarPrice();
        if (accountId) {
          fetchBalance(accountId, newWalletId, 'testnet');
          setTimeout(() => fetchBalance(accountId, newWalletId, 'testnet'), 2000);
          setTimeout(() => fetchBalance(accountId, newWalletId, 'testnet'), 5000);
        }
      }
      setWalletForm({ type: 'hedera', label: '', accountId: '', qrDataUrl: '', isDefault: false });
      setMagicModalOpen(false);
    } catch (err) {
      setMagicLinkSent(false);
      setMagicError(err instanceof Error ? err.message : 'Could not connect with Magic.');
    } finally {
      setMagicConnecting(false);
    }
  };

  const handleSetDefaultWallet = async (walletId: string) => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      await api.updateWallet(walletId, { isDefault: true });
      await refreshWallets();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Could not update this wallet.');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleDeleteWallet = async (walletId: string) => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const removed = wallets.find((wallet) => wallet.id === walletId);
      await api.deleteWallet(walletId);
      // Forget the remembered account so the landlord can pick a new one.
      if (removed?.accountId) {
        const remembered = window.localStorage.getItem(selectedAccountKey);
        if (!remembered || remembered === removed.accountId) {
          window.localStorage.removeItem(selectedAccountKey);
        }
      }
      setPendingHashPackAccounts([]);
      await refreshWallets();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Could not remove this wallet.');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdateSettings(formData);
      const connectedWallet = walletsRef.current.find(
        (wallet) => isHederaWallet(wallet) && Boolean(wallet.accountId)
      );
      if (connectedWallet && !connectedWallet.isDefault) {
        await api.updateWallet(connectedWallet.id, { isDefault: true });
        await refreshWallets();
      }
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setAuditBusy(true);
    setAuditError(null);
    try {
      setAuditResult(await onVerifyAudit());
    } catch (err) {
      setAuditResult(null);
      setAuditError(err instanceof Error ? err.message : 'Could not verify the audit chain.');
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Property &amp; Tariff Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure property address, electricity rate per kWh, and landlord preferences.
        </p>
      </div>

      {savedToast && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Settings saved successfully!</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Property Information */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Property Details
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Property / Complex Name
              </label>
              <input
                type="text"
                value={formData.propertyName}
                onChange={(e) =>
                  setFormData({ ...formData, propertyName: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Address / Sub-District
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* Utility Tariff & Currency */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Zap className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Electricity Billing Tariff
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Tariff per Unit (USD)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={formData.electricityRateNpr}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    electricityRateNpr: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Applied to every room in this property.
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Currency Code
              </label>
              <input
                type="text"
                value={formData.currencySymbol}
                onChange={(e) =>
                  setFormData({ ...formData, currencySymbol: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Billing Cycle Cadence
              </label>
              <input
                type="text"
                value={formData.billingCycle}
                onChange={(e) =>
                  setFormData({ ...formData, billingCycle: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* Landlord Profile */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <User className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Landlord Profile
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={formData.landlordName}
                onChange={(e) =>
                  setFormData({ ...formData, landlordName: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Role Title
              </label>
              <input
                type="text"
                value={formData.landlordRole}
                onChange={(e) =>
                  setFormData({ ...formData, landlordRole: e.target.value })
                }
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* Payment Wallets */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Wallet className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Payment Wallets</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Add your receive details once. Every bill you send shows them automatically.
              </p>
            </div>
          </div>

          {(magicError || hashpackError || walletError) && (
            <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
              {magicError || hashpackError || walletError}
            </div>
          )}

          <button
            type="button"
            onClick={handleConnectWallet}
            disabled={hasMainWallet || magicConnecting || hashpackConnecting || walletBusy}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-2xl text-sm font-bold transition-all shadow-lg hover:shadow-xl disabled:shadow-none"
          >
            {magicConnecting || hashpackConnecting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : hasMainWallet ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <Wallet className="w-5 h-5" />
            )}
            <span>
              {hasMainWallet
                ? 'Main wallet connected'
                : magicConnecting || hashpackConnecting
                  ? 'Connecting to Wallet…'
                  : 'Connect to Wallet'}
            </span>
          </button>
          {hasMainWallet && (
            <p className="text-[11px] text-center text-slate-500">
              One main wallet is allowed. Remove it below to connect a different account.
            </p>
          )}

          {walletsLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading wallets…
            </div>
          ) : wallets.length === 0 ? (
            <p className="text-xs text-slate-500 text-center">
              No wallet connected yet. Click "Connect to Wallet" above to choose a wallet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {wallets.length > 1 && (
                <div className="p-3 bg-amber-50 text-amber-900 text-xs rounded-xl border border-amber-200">
                  Multiple wallet accounts are connected. ChargeMesh uses one main wallet — remove
                  the extra accounts below.
                </div>
              )}
              {[...wallets]
                .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
                .map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md">
                        <Wallet className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-slate-900 truncate">
                            {walletTypeLabel(wallet.type)} Wallet
                          </span>
                          {wallet.isDefault && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-700">
                              <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                              Main
                            </span>
                          )}
                        </div>
                        {wallet.accountId ? (
                          <p className="text-[11px] text-slate-600 font-mono mt-0.5 truncate">
                            Account: {wallet.accountId}
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            Hedera account ID not returned yet
                          </p>
                        )}
                        {wallet.publicKey && (
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate" title={wallet.publicKey}>
                            Public key: {wallet.publicKey}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          <div className="text-sm font-bold text-emerald-700">
                            {(() => {
                              const b = walletBalances[wallet.id];
                              console.log('[RENDER] wallet', wallet.id, 'accountId:', wallet.accountId, 'balance:', b);
                              if (b?.usd) {
                                return (
                                  <span>
                                    {b.usd}
                                  </span>
                                );
                              }
                              if (b?.hbarRaw !== null && b?.hbarRaw !== undefined) {
                                // Show HBAR balance even if USD unavailable
                                return (
                                  <span>
                                    {b.hbar}
                                    <span className="ml-1 text-[9px] text-slate-500">(USD unavailable)</span>
                                  </span>
                                );
                              }
                              if (b?.loading) {
                                return <span className="text-slate-400">Loading…</span>;
                              }
                              return <span className="text-slate-400">Balance unavailable</span>;
                            })()}
                          </div>
                          {(wallet as any).network && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 uppercase font-semibold">
                              {(wallet as any).network}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!wallet.isDefault && (
                        <button
                          type="button"
                          onClick={() => void handleSetDefaultWallet(wallet.id)}
                          disabled={walletBusy}
                          className="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-50"
                        >
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteWallet(wallet.id)}
                        disabled={walletBusy}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        aria-label={`Remove ${wallet.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div className="pt-3 border-t border-slate-100"></div>
        </div>

        {/* Ledger Audit Verification Card */}
        <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Ledger Audit Chain
            </h3>
            <p className="text-xs text-blue-700 mt-0.5">
              Recompute and verify every tamper-evident audit event recorded for this account.
            </p>

            {auditResult && (
              <div
                className={`mt-3 p-2.5 rounded-lg text-xs flex items-start gap-2 border ${
                  auditResult.valid
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                {auditResult.valid ? (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {auditResult.valid
                    ? `Audit chain is intact across ${auditResult.count} events.`
                    : `Audit chain broke at event ${auditResult.brokenAt ?? 'unknown'}.`}
                  {auditResult.headHash && (
                    <span className="block mt-1 font-mono text-[10px] break-all opacity-80">
                      Head: {auditResult.headHash}
                    </span>
                  )}
                </span>
              </div>
            )}

            {auditError && (
              <div className="mt-3 p-2.5 bg-rose-50 text-rose-800 text-xs rounded-lg border border-rose-200">
                {auditError}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={auditBusy}
            className="px-4 py-2 bg-white hover:bg-blue-100 disabled:opacity-60 text-blue-800 font-semibold text-xs rounded-xl border border-blue-200 shadow-2xs transition-colors shrink-0 flex items-center gap-1.5"
          >
            {auditBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>{auditBusy ? 'Verifying…' : 'Verify Audit Chain'}</span>
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving…' : 'Save Settings'}</span>
          </button>
        </div>
      </form>

      {walletChooserOpen && (
        <Modal
          title="Connect a wallet"
          subtitle="Hedera testnet"
          icon={<Wallet className="w-4 h-4" />}
          onClose={() => {
            if (!hashpackConnecting) setWalletChooserOpen(false);
          }}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-500 leading-relaxed">
              Choose how you want to connect your Hedera wallet.
            </p>
            <button
              type="button"
              onClick={() => void handleConnectHashPack()}
              disabled={hashpackConnecting || !hashpackReady}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 text-left hover:border-blue-400 hover:bg-blue-100 disabled:opacity-60 transition-colors"
            >
              <span className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900">
                  {hashpackConnecting ? 'Opening HashPack…' : hashpackReady ? 'HashPack' : 'HashPack unavailable'}
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Connect your existing Hedera testnet account
                </span>
              </span>
              {hashpackConnecting && <Loader2 className="w-4 h-4 ml-auto animate-spin text-blue-600" />}
            </button>
            {!hashpackReady && hashpackError && (
              <div className="p-3 bg-amber-50 text-amber-900 text-xs rounded-xl border border-amber-200">
                {hashpackError}
              </div>
            )}
            <button
              type="button"
              onClick={handleConnectMagic}
              disabled={hashpackConnecting}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 text-left hover:border-blue-400 hover:bg-blue-100 disabled:opacity-60 transition-colors"
            >
              <span className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-900">Magic embedded wallet</span>
                <span className="block text-xs text-slate-500 mt-0.5">Create or access a wallet with email</span>
              </span>
            </button>
            {hashpackError && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
                {hashpackError}
              </div>
            )}
          </div>
        </Modal>
      )}

      {pendingHashPackAccounts.length > 0 && (
        <Modal
          title="Choose one account"
          subtitle="HashPack shared multiple accounts"
          icon={<Wallet className="w-4 h-4" />}
          onClose={() => {
            if (!hashpackSavingAccount) setPendingHashPackAccounts([]);
          }}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-500 leading-relaxed">
              HashPack authorised {pendingHashPackAccounts.length} accounts for this connection.
              ChargeMesh uses one account per wallet, so pick the single account you want to
              receive payments on.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pendingHashPackAccounts.map((accountId) => {
                const alreadySaved = wallets.some((wallet) => wallet.accountId === accountId);
                const savingThis = hashpackSavingAccount === accountId;
                return (
                  <button
                    key={accountId}
                    type="button"
                    onClick={() => void saveHashPackWallet(accountId)}
                    disabled={Boolean(hashpackSavingAccount)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 text-left hover:border-blue-400 hover:bg-blue-100 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-transparent transition-colors"
                  >
                    <span className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-900 font-mono truncate">
                        {accountId}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {alreadySaved ? 'Already added — use this account' : 'Use this account only'}
                      </span>
                    </span>
                    {savingThis && <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {hashpackError && (
              <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">
                {hashpackError}
              </div>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">
              ChargeMesh remembers the account you pick, so you only choose once. Only one main
              wallet can be connected at a time.
            </p>
          </div>
        </Modal>
      )}

      {magicModalOpen && (
        <Modal
          title="Connect your Magic wallet"
          subtitle="Hedera testnet"
          icon={<Wallet className="w-4 h-4" />}
          onClose={() => {
            if (!magicConnecting) setMagicModalOpen(false);
          }}
        >
          {magicLinkSent ? (
            <div className="space-y-5">
              <div className="text-center py-2">
                <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="mt-4 text-base font-bold text-slate-900">Check your email</h4>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  We sent a secure Magic sign-in link to <strong className="text-slate-700">{magicEmail}</strong>.
                  Complete it to finish connecting your Hedera wallet.
                </p>
              </div>
              {magicConnecting && (
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Waiting for secure sign-in…
                </div>
              )}
              {magicError && <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">{magicError}</div>}
              <button
                type="button"
                onClick={() => {
                  setMagicLinkSent(false);
                  setMagicError(null);
                }}
                disabled={magicConnecting}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicSubmit} className="space-y-4">
              <p className="text-sm text-slate-500 leading-relaxed">
                Enter your email to receive a secure Magic sign-in link. Your wallet will be created on Hedera testnet.
              </p>
              <div>
                <label htmlFor="magic-wallet-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email address
                </label>
                <input
                  id="magic-wallet-email"
                  type="email"
                  value={magicEmail}
                  onChange={(event) => setMagicEmail(event.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              {magicError && <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded-xl border border-rose-200">{magicError}</div>}
              <button
                type="submit"
                disabled={magicConnecting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                {magicConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                {magicConnecting ? 'Sending secure link…' : 'Continue with Magic'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
