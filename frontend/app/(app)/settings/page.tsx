"use client";
import { useEffect, useState } from "react";
import { getHealth, updateProfile } from "@/lib/api";
import { useMe } from "@/app/components/AppShell";
import { useTheme } from "@/app/components/theme";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Field, Input, Panel } from "@/app/components/ui";

type Tab = "profile" | "appearance" | "security";

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
    try { await updateProfile(body); setPassword(""); toast.push("Profile updated", "success"); }
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

      <div className="row" style={{ gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
        <TabBtn id="profile" label="Profile" />
        <TabBtn id="appearance" label="Appearance" />
        <TabBtn id="security" label="Security &amp; about" />
      </div>

      {tab === "profile" && (
        <Panel className="stack" style={{ maxWidth: 440 }}>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="New password" hint="Leave blank to keep your current password.">
            <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="row"><Button variant="primary" loading={busy} onClick={saveProfile}>Save changes</Button></div>
        </Panel>
      )}

      {tab === "appearance" && (
        <Panel className="stack" style={{ maxWidth: 440 }}>
          <span className="label">Theme</span>
          <div className="row">
            <Button variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>☀ Light</Button>
            <Button variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>☾ Dark</Button>
          </div>
          <p className="hint" style={{ margin: 0 }}>Your choice is remembered on this device.</p>
        </Panel>
      )}

      {tab === "security" && (
        <Panel className="stack" style={{ maxWidth: 520 }}>
          <div className="row-between"><span className="label">Role</span><Badge tone="primary">{me?.role}</Badge></div>
          <div className="row-between"><span className="label">Tenant ID</span><span className="mono faint" style={{ fontSize: 12 }}>{me?.tenant_id}</span></div>
          <hr className="divider" />
          <div className="row-between"><span className="label">Embedding provider</span><Badge>{health?.embedding_provider ?? "…"}</Badge></div>
          <div className="row-between"><span className="label">LLM provider</span><Badge>{health?.llm_provider ?? "…"}</Badge></div>
          <p className="hint" style={{ margin: 0 }}>
            Your queries are logged as content-free hashes; documents are isolated to this tenant and your role.
          </p>
        </Panel>
      )}
    </div>
  );
}
