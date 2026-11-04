import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  Gauge,
  Home,
  Menu,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Zap
} from "lucide-react";
import { ChargeMeshLogo } from "./Brand.js";
import { ThemeToggle } from "./ThemeToggle.js";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "For landlords", href: "#roles" },
  { label: "For renters", href: "#roles" }
];

const FEATURES = [
  {
    icon: Gauge,
    title: "Signed meter readings",
    body: "Every reading is verified before it reaches a bill, so the number on the invoice matches the meter."
  },
  {
    icon: Receipt,
    title: "Room-by-room bills",
    body: "Split a property cleanly. Each room gets its own usage, rate, and transparent calculation."
  },
  {
    icon: Activity,
    title: "Live usage graphs",
    body: "Watch power draw update every few seconds and switch between rooms from one overview."
  },
  {
    icon: Camera,
    title: "Scan-to-pay wallet QR",
    body: "Renters point the in-app camera at their wallet QR. The scan is stored with the bill and the landlord sees it instantly."
  },
  {
    icon: MessageSquare,
    title: "Issues, not arguments",
    body: "Renters can question a bill in writing. Replies and resolutions stay attached to the charge."
  },
  {
    icon: ShieldCheck,
    title: "Audit-ready records",
    body: "Keep a clean history of readings, bills, and payments, with an optional Hedera audit trail."
  }
];

const LANDLORD_POINTS = [
  "Add properties, rooms, and sub-meters",
  "See live usage for every room",
  "Send bills with the full calculation",
  "Resolve renter questions in one place"
];

const RENTER_POINTS = [
  "Open your bill and scan your wallet QR",
  "Check the readings behind every charge",
  "Pay and keep a receipt",
  "Raise an issue without a phone call"
];

function Navbar({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-18 flex items-center justify-between gap-2 sm:gap-4">
        <a href="#top" className="flex items-center gap-2 sm:gap-2.5 shrink-0 group">
          <ChargeMeshLogo size={32} className="sm:hidden" />
          <ChargeMeshLogo size={36} className="hidden sm:block" />
          <span className="flex flex-col text-left min-w-0">
            <span className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors">
              ChargeMesh
            </span>
            <span className="hidden sm:block text-xs text-slate-500 font-medium -mt-0.5 truncate">
              Electricity &amp; Rent Billing
            </span>
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-1 text-sm">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="px-3.5 py-2 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex">
            <ThemeToggle />
          </span>
          <button
            onClick={onLogin}
            className="hidden sm:inline-flex px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            Log in
          </button>
          <button
            onClick={onSignup}
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <span className="sm:hidden">Sign up</span>
            <span className="hidden sm:inline">Get started</span>
            <ArrowRight className="hidden sm:block w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="lg:hidden border-t border-slate-100 bg-white px-4 py-3 flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {link.label}
            </a>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              onLogin();
            }}
            className="text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-blue-600 hover:bg-blue-100"
          >
            Log in
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              onSignup();
            }}
            className="text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Create an account
          </button>
          <div className="mt-1.5 pt-2 border-t border-slate-100">
            <ThemeToggle showLabel className="w-full justify-between px-3" />
          </div>
        </nav>
      )}
    </header>
  );
}

function UsagePreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="absolute -inset-3 sm:-inset-5 rounded-[2rem] bg-blue-100 rotate-2" />

      <div className="relative rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">Room 204</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Himalaya Apartments · M-204</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Amount due
              </div>
              <div className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums mt-0.5">
                USD 2,480.50
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[10px] font-bold text-amber-700">
              Payment due
            </span>
          </div>

          <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-3">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
              <span>Live usage</span>
              <span className="tabular-nums">412 W now</span>
            </div>
            <svg viewBox="0 0 320 96" className="w-full h-auto mt-2" aria-hidden="true">
              <defs>
                <linearGradient id="landing-chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[24, 48, 72].map((y) => (
                <line key={y} x1="0" x2="320" y1={y} y2={y} className="stroke-slate-200" strokeDasharray="3 4" />
              ))}
              <path
                d="M0 74 C22 70 30 54 52 55 C74 56 82 38 104 42 C126 46 132 62 154 58 C176 54 184 30 206 32 C228 34 236 22 258 26 C280 30 294 16 320 12 L320 96 L0 96 Z"
                fill="url(#landing-chart-fill)"
              />
              <path
                d="M0 74 C22 70 30 54 52 55 C74 56 82 38 104 42 C126 46 132 62 154 58 C176 54 184 30 206 32 C228 34 236 22 258 26 C280 30 294 16 320 12"
                fill="none"
                stroke="#2563EB"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="320" cy="12" r="4" fill="#2563EB" stroke="#fff" strokeWidth="2" />
            </svg>
            <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400 tabular-nums">
              <span>12:20</span>
              <span>12:25</span>
              <span>12:30</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <div className="rounded-xl border border-slate-100 px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Used</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">42.6 kWh</div>
            </div>
            <div className="rounded-xl border border-slate-100 px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Rate</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">USD 12.50</div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-3 sm:-left-7 hidden sm:flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-lg">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[11px] font-bold text-slate-900">Reading verified</div>
          <div className="text-[10px] text-slate-500">Signed by the sub-meter</div>
        </div>
      </div>

      <div className="absolute -top-4 -right-2 sm:-right-6 hidden sm:flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-lg">
        <Camera className="w-4 h-4 text-blue-600" />
        <span className="text-[11px] font-bold text-slate-800">Scan to pay</span>
      </div>
    </div>
  );
}

export function LandingPage({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div id="top" className="min-h-screen bg-white text-slate-900 font-sans antialiased">
      <Navbar onLogin={onLogin} onSignup={onSignup} />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 -right-24 w-[34rem] h-[34rem] rounded-full bg-blue-100 blur-3xl" />
          <div className="pointer-events-none absolute top-40 -left-32 w-[26rem] h-[26rem] rounded-full bg-amber-100/40 blur-3xl" />

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 lg:py-24">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-center gap-14 lg:gap-16">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[11px] font-bold text-blue-700 uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5" />
                  Fair, metered billing
                </span>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 mt-5 leading-[1.05]">
                  Electricity bills
                  <br />
                  <span className="text-blue-600">without the guesswork.</span>
                </h1>

                <p className="text-base sm:text-lg text-slate-600 mt-5 leading-relaxed max-w-xl">
                  ChargeMesh turns signed sub-meter readings into clear room-by-room bills. Landlords
                  see live usage. Renters see exactly what they are paying for.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={onSignup}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors"
                  >
                    Create free account
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onLogin}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-sm font-semibold transition-colors"
                  >
                    Log in to your portal
                  </button>
                </div>

                <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 text-xs text-slate-600">
                  {["Signed meter readings", "Per-room bills", "Wallet QR scan", "Issue resolution"].map(
                    (item) => (
                      <li key={item} className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        {item}
                      </li>
                    )
                  )}
                </ul>
              </div>

              <UsagePreview />
            </div>
          </div>
        </section>

        {/* Feature strip */}
        <section className="border-y border-slate-200/80 bg-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-10 text-xs font-semibold text-slate-500">
            <span className="inline-flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              Built for sub-meter billing
            </span>
            <span className="hidden sm:inline text-slate-300">•</span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Verified readings, not estimates
            </span>
            <span className="hidden sm:inline text-slate-300">•</span>
            <span className="inline-flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-600" />
              One portal for both sides
            </span>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 scroll-mt-20">
          <div className="max-w-2xl">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600">Everything in one place</div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">
              From meter reading to settled bill.
            </h2>
            <p className="text-sm sm:text-base text-slate-600 mt-3 leading-relaxed">
              No more photos of meters, manual arithmetic, or “I’ll check with the landlord.” Every
              step is visible to the people it affects.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-10">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 mt-4">{title}</h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="bg-slate-50 border-y border-slate-200/80 py-20 scroll-mt-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600">How it works</div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">
                Three steps to a bill everyone trusts.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 mt-3">
                Set up once. After that, readings and bills do the talking.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-10">
              {[
                {
                  icon: Building2,
                  title: "Add your property",
                  body: "Create rooms, connect sub-meters, and invite renters with their email address."
                },
                {
                  icon: Activity,
                  title: "Readings arrive",
                  body: "Meters send signed readings. ChargeMesh verifies them and shows live usage per room."
                },
                {
                  icon: Receipt,
                  title: "Send and settle",
                  body: "Generate clear bills, scan the renter's wallet QR, and keep every question attached to the charge."
                }
              ].map(({ icon: Icon, title, body }, index) => (
                <div key={title} className="relative rounded-2xl border border-slate-200/80 bg-white p-6">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-3xl font-bold text-slate-200 tabular-nums">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-4">{title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="py-20 scroll-mt-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600">Built for both sides</div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2">
                One source of truth for the whole building.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 mt-3">
                Landlords get an operations view. Renters get a clear bill and a direct line for
                questions.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-10">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-4">For landlords</h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  Run the property from one dashboard, with live data and a clean paper trail.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {LANDLORD_POINTS.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      {point}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={onSignup}
                  className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  Start as a landlord
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Home className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-4">For renters</h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  See your meter, your bill, and the math behind it — then pay or ask a question.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {RENTER_POINTS.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      {point}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={onSignup}
                  className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-lg text-xs font-bold transition-colors"
                >
                  Start as a renter
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 sm:px-6 pb-20">
          <div className="max-w-6xl mx-auto relative overflow-hidden rounded-3xl bg-blue-600 px-6 py-12 sm:px-12 sm:py-14 text-white">
            <div className="pointer-events-none absolute -right-20 -top-24 w-72 h-72 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 w-64 h-64 rounded-full bg-blue-400/30 blur-3xl" />
            <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Ready to make your next bill boring?
                </h2>
                <p className="text-sm text-blue-100 mt-2 leading-relaxed">
                  Create an account, add a room, and see the difference a verified reading makes.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <button
                  onClick={onSignup}
                  className="cm-on-dark inline-flex items-center justify-center gap-2 px-5 py-3 bg-white hover:bg-slate-100 text-blue-700 rounded-xl text-sm font-bold transition-colors"
                >
                  Create free account
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={onLogin}
                  className="inline-flex items-center justify-center px-5 py-3 border border-white/25 hover:bg-white/10 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  Log in
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ChargeMeshLogo size={28} />
            <div>
              <div className="text-sm font-bold text-slate-900">ChargeMesh</div>
              <div className="text-[11px] text-slate-500">Electricity &amp; Rent Billing</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 text-center sm:text-right">
            Bills calculated from signed meter readings.
            <br className="sm:hidden" /> © {new Date().getFullYear()} ChargeMesh
          </p>
        </div>
      </footer>
    </div>
  );
}
