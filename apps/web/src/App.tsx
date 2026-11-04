import { useEffect, useState } from "react";
import { api, type User } from "./api.js";
import { AuthScreen } from "./components/AuthScreen.js";
import { LandingPage } from "./components/LandingPage.js";
import { Loading } from "./components/ui.js";
import { LandlordApp } from "./landlord/LandlordApp.js";
import { RenterApp } from "./renter/RenterApp.js";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setAuthMode(null);
      setUser(null);
    }
  };

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loading label="Loading ChargeMesh…" />
      </div>
    );
  }

  if (user === null) {
    if (!authMode) {
      return (
        <LandingPage
          onLogin={() => setAuthMode("login")}
          onSignup={() => setAuthMode("register")}
        />
      );
    }
    return (
      <AuthScreen
        key={authMode}
        initialMode={authMode}
        onSignedIn={setUser}
        onBack={() => setAuthMode(null)}
      />
    );
  }

  if (user.role === "renter") return <RenterApp user={user} onLogout={logout} onUserChange={setUser} />;
  return <LandlordApp user={user} onLogout={logout} onUserChange={setUser} />;
}
