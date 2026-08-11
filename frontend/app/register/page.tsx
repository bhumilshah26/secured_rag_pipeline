"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { register, setToken, verifyOtp } from "@/lib/api";
import { Button, Field, Input, Panel } from "@/app/components/ui";
import { ThemeToggle } from "@/app/components/theme";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      } else {
        setToken(res.access_token);
        router.replace("/overview");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await verifyOtp({ email, code: otp, purpose: "register" });
      setToken(res.access_token);
      router.replace("/overview");
    } catch (err) {
      setError((err as Error).message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
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
                <Input placeholder="Acme Corporation" value={name}
                  onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} required />
              </Field>
              <Field label="Workspace slug" hint="Lowercase identifier, unique across the platform.">
                <Input className="mono" placeholder="acme" value={slug}
                  onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)); }} required />
              </Field>
              <Field label="Admin email">
                <Input type="email" placeholder="admin@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Admin password" hint="At least 8 characters.">
                <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          ) : (
            <Field label="6-digit code">
              <Input type="text" inputMode="numeric" placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value)} required />
            </Field>
          )}
          {pending && <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Enter the code sent to your email to complete registration.
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
