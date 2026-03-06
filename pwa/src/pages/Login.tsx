import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PRODUCTION_DASHBOARD_URL,
  PRODUCTION_LOGIN_URL
} from "../constants/module3";
import { supabase } from "../lib/supabase";

const SIGNUP_REDIRECT_URL = PRODUCTION_DASHBOARD_URL;
const PASSWORD_RESET_REDIRECT_URL = PRODUCTION_LOGIN_URL;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
      password,
      options: {
        emailRedirectTo: SIGNUP_REDIRECT_URL
      }
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      setMessage("Signup successful. You are now logged in.");
      navigate("/dashboard", { replace: true });
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

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    setMessage("Login successful.");
    if (data.session) {
      navigate("/dashboard", { replace: true });
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Enter your email to reset your password.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: PASSWORD_RESET_REDIRECT_URL
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setMessage("Password reset email sent. Check your inbox.");
    setLoading(false);
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      setError("Enter your email to resend confirmation.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: SIGNUP_REDIRECT_URL
      }
    });

    if (resendError) {
      setError(resendError.message);
      setLoading(false);
      return;
    }

    setMessage("Confirmation email resent. Check your inbox.");
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
        <div className="auth-actions">
          <button
            className="auth-link-button"
            type="button"
            onClick={() => void handleForgotPassword()}
            disabled={loading}
          >
            Forgot password?
          </button>
          <button
            className="auth-link-button"
            type="button"
            onClick={() => void handleResendConfirmation()}
            disabled={loading}
          >
            Resend confirmation email
          </button>
        </div>

        {message && <p className="auth-message">{message}</p>}
        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  );
}
