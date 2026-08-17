"use client";
import { useState, useEffect } from "react";
import { useToast } from "@/app/components/Toast";
import { useRouter } from "next/navigation";
import { login, setToken, verifyOtp } from "@/lib/api";
import { Button, Field, Input, PasswordInput, Panel } from "@/app/components/ui";
import { ThemeToggle } from "@/app/components/theme";

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();   
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [userPending, setUserPending] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

   useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      if ("pending" in res && res.pending) {
        setUserPending(true);
        setCooldown(30);
      } else {
        setToken(res.access_token);
        router.replace("/overview");
      }
    } catch (err) {
      const e = err as Error & { status?: number };
      if ((e.status ?? 0) >= 500) toast.push(e.message, "error");
      else setError(e.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (cooldown > 0 || loading) return;
    setError("");
    setLoading(true);
    try {
      await login(email, password);   // re-issues and re-emails a fresh code
      toast.push("A new code was sent to your email.", "success");
      setCooldown(30);
    } catch (err) {
      const e = err as Error & { status?: number };
      if ((e.status ?? 0) >= 500) toast.push(e.message, "error");
      else setError(e.message || "Couldn't resend the code.");
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await verifyOtp({ email, code: otp, purpose: "login" });
      setToken(res.access_token);
      router.replace("/overview");
    } catch (err) {
      const e = err as Error & { status?: number };
      if ((e.status ?? 0) >= 500) toast.push("We couldn't verify your code due to a server issue. Please try again.", "error");
      else setError(e.message || "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap">
      <div style={{ position: "fixed", top: 16, right: 16 }}><ThemeToggle /></div>
      <Panel className="auth-card stack">
        <div className="row" style={{ gap: 12 }}>
          <span className="logo" style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-ink)", fontSize: 19 }}>⛨</span>
          <div>
            <h1 style={{ fontSize: 22 }}>Aegis</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Secured RAG · sign in to your workspace</p>
          </div>
        </div>

        <form onSubmit={userPending ? onVerifyOtp : onSubmit} className="stack" style={{ gap: 14 }}>
          <Field label="Email">
            {/* Locked once a code is issued: the challenge is bound to this address. */}
            <Input type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading || userPending} required />
          </Field>
          {!userPending ? (
            <Field label="Password">
              <PasswordInput autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} required />
            </Field>
          ) : (
            <Field label="6-digit code">
              <Input type="text" inputMode="numeric" placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value)} disabled={loading} required />
            </Field>
          )}
          {userPending && <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Enter the code sent to your email to complete sign in.{" "}
            <button type="button" onClick={onResend} disabled={cooldown > 0 || loading}
              style={{ background: "none", border: "none", padding: 0, cursor: cooldown > 0 ? "default" : "pointer",
                       color: cooldown > 0 ? "var(--muted)" : "var(--primary)", font: "inherit", textDecoration: "underline" }}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </p>}
          {error && <div className="danger-panel" style={{ fontSize: 13, padding: 12 }}>{error}</div>}
          <Button type="submit" variant="primary" block loading={loading}>
            {userPending ? "Verify code" : "Sign in"}
          </Button>
        </form>

        <p className="muted" style={{ fontSize: 13, margin: 0, textAlign: "center" }}>
          New here? <a href="/register">Create an organization</a>
        </p>
      </Panel>
    </main>
  );
}
