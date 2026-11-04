import { useState, type FormEvent } from "react";
import { ArrowLeft, Building2, Home } from "lucide-react";
import { api, type User } from "../api.js";
import { messageOf } from "../lib/model.js";
import { ChargeMeshBrand } from "./Brand.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { Alert, PrimaryButton, inputClass, labelClass } from "./ui.js";

export function AuthScreen({
  onSignedIn,
  initialMode = "login",
  onBack
}: {
  onSignedIn: (user: User) => void;
  initialMode?: "login" | "register";
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"landlord" | "renter">("landlord");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api.register({ name: name.trim(), email: email.trim(), password, role });
      }
      const { user } = await api.login(email.trim(), password);
      onSignedIn(user);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans antialiased">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-4">
          <ChargeMeshBrand subtitle="Electricity & Rent Billing" className="shrink-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <ThemeToggle />
            {onBack && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Back to home</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-slate-500 mt-1.5">
              {mode === "login"
                ? "Log in to open your ChargeMesh portal."
                : "Start managing rooms and bills in a few minutes."}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl mb-6">
              {(["login", "register"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                  aria-pressed={mode === value}
                  className={`flex-1 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    mode === value ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                >
                  {value === "login" ? "Log in" : "Create account"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === "register" && (
                <>
                  <div>
                    <span className={labelClass}>I am a</span>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { value: "landlord", label: "Landlord", hint: "I rent out rooms", Icon: Building2 },
                        { value: "renter", label: "Renter", hint: "I rent a room", Icon: Home }
                      ] as const).map(({ value, label, hint, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRole(value)}
                          aria-pressed={role === value}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            role === value
                              ? "bg-blue-50 border-blue-400 ring-2 ring-blue-500/20"
                              : "bg-white border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <Icon className="w-4 h-4 text-blue-600 mb-1" />
                          <div className="text-xs font-bold text-slate-900">{label}</div>
                          <div className="text-[11px] text-slate-500">{hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="name">
                      Full name
                    </label>
                    <input
                      id="name"
                      className={inputClass}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
                </>
              )}
              <div>
                <label className={labelClass} htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "register" ? 8 : undefined}
                  placeholder={mode === "register" ? "At least 8 characters" : undefined}
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <Alert kind="error">{error}</Alert>}

              <PrimaryButton type="submit" disabled={busy} className="w-full py-3">
                {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
              </PrimaryButton>

              {mode === "register" && role === "renter" && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  After you register, give your email address to your landlord so they can assign you
                  to your room.
                </p>
              )}
            </form>
          </div>

          <p className="text-center text-[11px] text-slate-400 mt-5">
            {mode === "login" ? "New to ChargeMesh? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              {mode === "login" ? "Create an account" : "Log in instead"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
