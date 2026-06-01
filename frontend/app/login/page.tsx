"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, setToken } from "@/lib/api";

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
      router.replace("/chat");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="logo">🛡️</span>
          <div>
            <span className="title-gradient" style={{ fontSize: 20, fontWeight: 700 }}>
              Secured RAG
            </span>
            <small>Sign in to your workspace</small>
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid" style={{ gap: 14 }}>
          <div className="field">
            <label className="label">Email</label>
            <input
              className="input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <span className="spinner" /> : "Sign in"}
          </button>
          {error && <div className="toast toast-err">{error}</div>}
        </form>

        <p className="muted" style={{ fontSize: 12.5, marginTop: 16, marginBottom: 0 }}>
          New organization? Bootstrap a tenant via <code>POST /auth/register</code> on the API.
        </p>
      </div>
    </main>
  );
}
