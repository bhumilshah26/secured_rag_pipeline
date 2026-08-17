"use client";
import { useState, useEffect } from "react";
import { useToast } from "@/app/components/Toast";
import { useRouter } from "next/navigation";
import { register, setToken, verifyOtp } from "@/lib/api";
import { Button, Field, Input, PasswordInput, Panel } from "@/app/components/ui";
import { ThemeToggle } from "@/app/components/theme";
import { OtpInput } from "@/app/components/OtpInput";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast()
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
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
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      const res = await register({
        tenant_name: name,
        tenant_slug: slug || slugify(name),
        admin_email: email,
        admin_password: password,
      });
      if ("pending" in res && res.pending) {
        setPending(true);
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
      await register({
        tenant_name: name,
        tenant_slug: slug || slugify(name),
        admin_email: email,
        admin_password: password,
      });
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

  async function verifyCode(code: string) {
    if (loading || code.length < 6) return;
    setError("");
    setLoading(true);
    try {
      const res = await verifyOtp({ email, code, purpose: "login" });
      setToken(res.access_token);
      router.replace("/overview");
    } catch (err) {
      const e = err as Error & { status?: number };
      if ((e.status ?? 0) >= 500) toast.push("We couldn't verify your code due to a server issue. Please try again.", "error");
      else setError(e.message || "Invalid or expired code.");
      setLoading(false);   // only reset on failure; on success we're navigating away
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    verifyCode(otp);
  }

  return (
    <main className="auth-wrap">
      <div style={{ position: "fixed", top: 16, right: 16 }}><ThemeToggle /></div>
      <Panel className="auth-card stack">
        <div>
          <h1 style={{ fontSize: 22 }}>Create your organization</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Sets up a new tenant and its first admin account.
          </p>
        </div>

        <form onSubmit={pending ? onVerifyOtp : onSubmit} className="stack" style={{ gap: 14 }}>
          {!pending ? (
            <>
              <Field label="Organization name">
                <Input placeholder="Acme Corporation" value={name} disabled={loading}
                  onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} required />
              </Field>
              <Field label="Workspace slug" hint="Lowercase identifier, unique across the platform.">
                <Input className="mono" placeholder="acme" value={slug} disabled={loading}
                  onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)); }} required />
              </Field>
              <Field label="Admin email">
                <Input type="email" placeholder="admin@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} required />
              </Field>
              <Field label="Admin password" hint="At least 8 characters.">
                <PasswordInput autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} required />
              </Field>
            </>
          ) : (
            <Field label="6-digit code">
              <OtpInput value={otp} onChange={setOtp} onComplete={verifyCode} disabled={loading} />
            </Field>
          )}
          {pending && <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Enter the code sent to your email to complete registration.{" "}
            <button type="button" onClick={onResend} disabled={cooldown > 0 || loading}
              style={{ background: "none", border: "none", padding: 0, cursor: cooldown > 0 ? "default" : "pointer",
                       color: cooldown > 0 ? "var(--muted)" : "var(--primary)", font: "inherit", textDecoration: "underline" }}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </p>}
          {error && <div className="danger-panel" style={{ fontSize: 13, padding: 12 }}>{error}</div>}
          <Button type="submit" variant="primary" block loading={loading}>
            {pending ? "Verify code" : "Create organization"}
          </Button>
        </form>

        <p className="muted" style={{ fontSize: 13, margin: 0, textAlign: "center" }}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </Panel>
    </main>
  );
}
