"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getMe, updateProfile, type Me } from "@/lib/api";

export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => {});
  }, []);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  const navBtn = (href: string, label: string) => (
    <button
      className={`btn btn-sm ${pathname === href ? "btn-primary" : "btn-ghost"}`}
      onClick={() => router.push(href)}
    >
      {label}
    </button>
  );

  const initial = (me?.email?.[0] ?? "?").toUpperCase();

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo">🛡️</span>
          <div>
            Secured RAG
            <small>Enterprise knowledge, isolated &amp; audited</small>
          </div>
        </div>

        <nav className="nav" style={{ alignItems: "center" }}>
          {navBtn("/chat", "Chat")}
          {navBtn("/connectors", "Connectors")}

          <div className="profile-wrap">
            <div
              className="avatar"
              title={me?.email ?? "Account"}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {initial}
            </div>

            {menuOpen && (
              <>
                <div className="backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu">
                  <div className="head">
                    <div className="email">{me?.email ?? "—"}</div>
                    <div style={{ marginTop: 6 }}>
                      <span className="badge badge-info">
                        <span className="dot" />
                        {me?.role ?? "—"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="item"
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    ⚙️ Profile settings
                  </button>
                  <button className="item danger" onClick={logout}>
                    ⎋ Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </nav>
      </header>

      {settingsOpen && me && (
        <SettingsModal
          me={me}
          onClose={() => setSettingsOpen(false)}
          onSaved={(updated) => {
            setMe(updated);
            setSettingsOpen(false);
          }}
        />
      )}
    </>
  );
}

function SettingsModal({
  me,
  onClose,
  onSaved,
}: {
  me: Me;
  onClose: () => void;
  onSaved: (m: Me) => void;
}) {
  const [email, setEmail] = useState(me.email);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const body: { email?: string; password?: string } = {};
    if (email && email !== me.email) body.email = email;
    if (password) body.password = password;
    if (!body.email && !body.password) {
      setError("Change your email or password before saving.");
      return;
    }
    if (body.password && body.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await updateProfile(body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Profile settings</h2>
          <span className="badge badge-info">
            <span className="dot" />
            {me.role}
          </span>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Tenant <code>{me.tenant_id.slice(0, 8)}…</code>
        </p>

        <div className="grid" style={{ gap: 14 }}>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">New password (leave blank to keep current)</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="toast toast-err">{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
