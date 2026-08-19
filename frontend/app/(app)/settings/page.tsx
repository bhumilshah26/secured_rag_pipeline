"use client";
import { useEffect, useState } from "react";
import { getHealth, updateProfile } from "@/lib/api";
import { useMe } from "@/app/components/AppShell";
import { useTheme } from "@/app/components/theme";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Field, Input, PasswordInput, Panel } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";

type Tab = "profile" | "appearance" | "security";

function strength(p: string): { pct: number; label: string; tone: string } {
  if (!p) return { pct: 0, label: "", tone: "var(--border)" };
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  const pct = (s / 5) * 100;
  if (s <= 2) return { pct, label: "weak", tone: "var(--danger)" };
  if (s <= 3) return { pct, label: "okay", tone: "var(--warning)" };
  return { pct, label: "strong", tone: "var(--success)" };
}

export default function SettingsPage() {
  const me = useMe();
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("profile");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ embedding_provider: string; llm_provider: string } | null>(null);

  useEffect(() => { if (me) setEmail(me.email); }, [me]);
  useEffect(() => { getHealth().then(setHealth).catch(() => {}); }, []);

  async function saveProfile() {
    const body: { email?: string; password?: string } = {};
    if (me && email !== me.email) body.email = email;
    if (password) body.password = password;
    if (!body.email && !body.password) { toast.push("Nothing to change.", "info"); return; }
    if (body.password && body.password.length < 8) { toast.push("Password must be at least 8 characters.", "error"); return; }
    setBusy(true);
    try {
      await updateProfile(body);
      setPassword("");
      toast.push(body.password ? "Password updated — you're all set." : "Profile updated", "success");
      if (body.password) window.location.assign("/overview"); 
    }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button className={`nav-item ${tab === id ? "" : ""}`} aria-current={tab === id ? "page" : undefined}
      onClick={() => setTab(id)} style={{ width: "auto" }}>{label}</button>
  );

  return (
    <div className="page container reading">
      <div className="page-head"><h1>Settings</h1></div>
      <Panel className="set-id" style={{ marginBottom: 16 }}>
        <span className="avatar" style={{ width: 44, height: 44, fontSize: 17 }}>
          {me?.email?.[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.email}</div>
          <div className="faint" style={{ fontSize: 12 }}>Member of tenant <span className="mono">{me?.tenant_id?.slice(0, 8)}…</span></div>
        </div>
        <Badge tone="primary">{me?.role}</Badge>
      </Panel>
      {me?.must_change_password && (
        <Panel className="danger-panel" style={{ marginBottom: 16, fontSize: 13.5 }}>
          You&apos;re signed in with a temporary password. Set a new password below to continue using your workspace.
        </Panel>
      )}
      <div className="row" style={{ gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
        <TabBtn id="profile" label="Profile" />
        <TabBtn id="appearance" label="Appearance" />
        <TabBtn id="security" label="Security &amp; about" />
      </div>

      {tab === "profile" && (
        <Panel className="stack" style={{ maxWidth: 440 }}>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} /></Field>
          <Field label="New password" hint="Leave blank to keep your current password.">
            <PasswordInput autoFocus={!!me?.must_change_password} autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </Field>
          {password && (
            <div className="set-strength" aria-live="polite">
              <span className="bar"><span style={{ width: `${strength(password).pct}%`, background: strength(password).tone }} /></span>
              <span className="mono" style={{ color: strength(password).tone }}>{strength(password).label}</span>
            </div>
          )}
          <div className="row"><Button variant="primary" loading={busy} onClick={saveProfile}>Save changes</Button></div>
        </Panel>
      )}

      {tab === "appearance" && (
        <Panel className="stack" style={{ maxWidth: 440 }}>
          <span className="label">Theme</span>
          <div className="row" style={{ gap: 12 }}>
            {(["light", "dark"] as const).map((t) => (
              <button key={t} type="button" data-theme={t}
                className={`set-swatch ${theme === t ? "on" : ""}`}
                onClick={() => setTheme(t)} aria-pressed={theme === t}>
                <span className="sw-bg">
                  <span className="sw-bar" />
                  <span className="sw-line" />
                  <span className="sw-line short" />
                  <span className="sw-btn" />
                </span>
                <span className="sw-name">{t === "light" ? "Light" : "Dark"}</span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ margin: 0 }}>Your choice is remembered on this device.</p>
        </Panel>
      )}

      {tab === "security" && (
        <Panel className="stack" style={{ maxWidth: 520 }}>
          <div className="row-between"><span className="label">Role</span><Badge tone="primary">{me?.role}</Badge></div>
          <div className="row-between">
            <span className="label">Tenant ID</span>
            <button type="button" className="set-copy mono" title="Copy tenant ID"
              onClick={() => { void navigator.clipboard.writeText(me?.tenant_id ?? ""); toast.push("Tenant ID copied", "success"); }}>
              {me?.tenant_id?.slice(0, 13)} <Icon name="copy" size={12} />
            </button>
          </div>
          <hr className="divider" />
          <div className="row-between"><span className="label">Embedding provider</span><Badge>{health?.embedding_provider ?? "…"}</Badge></div>
          <div className="row-between"><span className="label">LLM provider</span><Badge>{health?.llm_provider ?? "…"}</Badge></div>
          <div className="row-between"><span className="label">Prompt guard</span><Badge tone="success">regex triage + LLM judge</Badge></div>
        </Panel>
      )}
    </div>
  );
}
