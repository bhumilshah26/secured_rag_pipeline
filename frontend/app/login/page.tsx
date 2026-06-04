"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, setToken } from "@/lib/api";
import { Button, Field, Input, Panel } from "@/app/components/ui";
import { ThemeToggle } from "@/app/components/theme";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      setToken(res.access_token);
      router.replace("/overview");
    } catch (err) {
      setError((err as Error).message || "Invalid credentials");
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
            <h1 style={{ fontSize: 22 }}>Secured RAG</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Sign in to your workspace</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="stack" style={{ gap: 14 }}>
          <Field label="Email">
            <Input type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <div className="danger-panel" style={{ fontSize: 13, padding: 12 }}>{error}</div>}
          <Button type="submit" variant="primary" block loading={loading}>Sign in</Button>
        </form>

        <p className="muted" style={{ fontSize: 13, margin: 0, textAlign: "center" }}>
          New here? <a href="/register">Create an organization</a>
        </p>
      </Panel>
    </main>
  );
}
