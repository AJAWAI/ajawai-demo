import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface DashboardProps {
  session: Session;
}

export default function Dashboard({ session }: DashboardProps) {
  const userEmail = session.user.email ?? "User";

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Welcome to AJAWAI</h1>
        <p>You are logged in as {userEmail}.</p>
        <button className="button danger" type="button" onClick={() => void handleLogout()}>
          Logout
        </button>
      </section>
    </main>
  );
}
