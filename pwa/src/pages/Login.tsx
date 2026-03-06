import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateForm = (): boolean => {
    if (!email || !password) {
      setError("Email and password are required.");
      return false;
    }
    return true;
  };

  const handleSignup = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      setMessage("Signup successful. You are now logged in.");
    } else {
      setMessage("Signup successful. Check your email for the confirmation link.");
    }
    setLoading(false);
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    setMessage("Login successful.");
    setLoading(false);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>AJAWAI Login</h1>
        <p>Sign up or log in with your email.</p>

        <form className="stack" onSubmit={handleLogin}>
          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Please wait..." : "Log in"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void handleSignup()}
            disabled={loading}
          >
            {loading ? "Please wait..." : "Sign up"}
          </button>
        </form>

        {message && <p className="auth-message">{message}</p>}
        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  );
}
