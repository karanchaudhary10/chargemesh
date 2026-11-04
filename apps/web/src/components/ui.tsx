import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, LogOut, User as UserIcon, X } from "lucide-react";
import { ChargeMeshBrand } from "./Brand.js";

export function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
  wide = false
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div
        className={`bg-white rounded-2xl w-full ${wide ? "max-w-lg" : "max-w-md"} p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">{icon}</div>
            )}
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "bg-rose-50 text-rose-800 border-rose-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    info: "bg-blue-50 text-blue-900 border-blue-100"
  }[kind];
  const Icon = kind === "error" ? AlertTriangle : CheckCircle2;
  return (
    <div className={`p-3 text-xs rounded-xl border flex items-start gap-2 ${styles}`} role={kind === "error" ? "alert" : "status"}>
      <Icon className="w-4 h-4 shrink-0 mt-px" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

/** A message that clears itself after a few seconds. */
export function useFlash(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flash = (next: string) => {
    setMessage(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [message, flash];
}

const BILL_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600 border border-slate-200" },
  issued: { label: "Sent", className: "bg-blue-50 text-blue-700 border border-blue-100" },
  unpaid: { label: "Unpaid", className: "bg-amber-50 text-amber-700 border border-amber-100" },
  payment_pending_verification: {
    label: "Pending verification",
    className: "bg-indigo-50 text-indigo-700 border border-indigo-100"
  },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border border-emerald-100" }
};

export function BillStatusBadge({ status }: { status: string }) {
  const style = BILL_STATUS[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return <span className={`px-2.5 py-0.5 rounded text-[11px] font-medium ${style.className}`}>{style.label}</span>;
}

export function MeterDot({ status }: { status: string }) {
  const color = status === "Working" ? "bg-blue-600" : status === "Offline" ? "bg-amber-500" : "bg-slate-400";
  return <span className={`w-1.5 h-1.5 rounded-full ${color}`} />;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div>
      {eyebrow && <div className="text-xs font-semibold text-blue-600 tracking-wider uppercase mb-1">{eyebrow}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
  className = ""
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white";

export const labelClass = "block text-xs font-semibold text-slate-700 mb-1.5";

export const cardClass = "bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  badge?: number;
}

export function Navbar<T extends string>({
  items,
  moreItems = [],
  active,
  onSelect,
  userName,
  userRole,
  onLogout,
  extra
}: {
  items: NavItem<T>[];
  moreItems?: Array<NavItem<T> & { icon?: ReactNode; onClick?: () => void }>;
  active: T;
  onSelect: (id: T) => void;
  userName: string;
  userRole: string;
  onLogout: () => void;
  extra?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const tabClass = (selected: boolean) =>
    `px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap relative ${
      selected ? "bg-blue-100 text-blue-900 font-semibold" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
    }`;
  const moreBadge = moreItems.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const moreActive = moreItems.some((item) => item.id === active);

  return (
    <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-6">
        <ChargeMeshBrand
          subtitle="Electricity & Rent Billing"
          onClick={() => onSelect(items[0]!.id)}
          className="shrink-0"
        />

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {items.map((item) => (
            <button key={item.id} onClick={() => onSelect(item.id)} className={tabClass(active === item.id)}>
              {item.label}
              {!!item.badge && (
                <span className="ml-1.5 bg-amber-100 text-amber-800 text-[11px] font-semibold px-1.5 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
          {moreItems.length > 0 && (
            <div className="relative" ref={ref}>
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={`flex items-center gap-1 ${tabClass(moreActive || moreOpen)}`}
              >
                <span>More</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
                {moreBadge > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 ml-0.5" />}
              </button>
              {moreOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200/90 py-2 z-50">
                  {moreItems.map((item) => (
                    <button
                      key={item.id + item.label}
                      onClick={() => {
                        if (item.onClick) item.onClick();
                        else onSelect(item.id);
                        setMoreOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-100 hover:text-blue-900 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2.5">
                        {item.icon}
                        <span className="font-medium">{item.label}</span>
                      </span>
                      {!!item.badge && (
                        <span className="bg-amber-100 text-amber-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                          {item.badge} open
                        </span>
                      )}
                    </button>
                  ))}
                  {extra && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <div className="px-4 py-2 text-[11px] text-slate-400">{extra}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          <div className="hidden sm:flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight">{userName}</div>
              <div className="text-xs text-slate-500 font-medium">{userRole}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <UserIcon className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="hidden sm:block h-5 w-px bg-slate-200" />
          <button
            onClick={onLogout}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap flex items-center gap-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
          <button
            className="md:hidden text-xs font-semibold text-slate-700 px-2 py-1 rounded-lg border border-slate-200"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            Menu
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav className="md:hidden border-t border-slate-100 px-4 py-2 flex flex-col text-sm">
          {[...items, ...moreItems].map((item: NavItem<T> & { onClick?: () => void }) => (
            <button
              key={item.id + item.label}
              onClick={() => {
                if (item.onClick) item.onClick();
                else onSelect(item.id);
                setMobileOpen(false);
              }}
              className={`text-left ${tabClass(active === item.id)}`}
            >
              {item.label}
              {!!item.badge && <span className="ml-2 text-amber-700 text-xs">({item.badge})</span>}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200/80 bg-white py-6">
      <div className="max-w-[1440px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <span>ChargeMesh — Straightforward utility &amp; rent management</span>
        <span>Bills are calculated only from signed meter readings.</span>
      </div>
    </footer>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-slate-400">{label}</div>;
}
