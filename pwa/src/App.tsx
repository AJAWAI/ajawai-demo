import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { supabase } from "./lib/supabase";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!error) {
        setSession(data.session);
      }
      setLoading(false);
    };

    void loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>AJAWAI</h1>
          <p>Loading session...</p>
        </section>
      </main>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={session ? "/dashboard" : "/login"} replace />}
        />
        <Route
          path="/login"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/dashboard"
          element={session ? <Dashboard session={session} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="*"
          element={<Navigate to={session ? "/dashboard" : "/login"} replace />}
        />
      </Routes>
    </HashRouter>
  );
}
