"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  connectConnector, connectorStatus, ingestSelected, listConnectorFiles, listConnectors,
  updateConnector, type Connector, type ConnectorFile,
} from "@/lib/api";
import { ALL_ROLES, can } from "@/lib/roles";
import { useMe } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Chip, EmptyState, Input, Panel, Skeleton, Textarea } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";
import { KIND_LABEL, KindIcon } from "../kinds";

export default function ConnectorDetailPage() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();

  const [source, setSource] = useState<Connector | null>(null);
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<ConnectorFile[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<string[]>(["ADMIN", "VIEWER"]);
  const [busy, setBusy] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgText, setCfgText] = useState("{}");

  useEffect(() => {
    listConnectors().then((all) => setSource(all.find((c) => c.id === id) ?? null)).catch(() => {});
    connectorStatus(id).then((s) => setConnected(s.connected)).catch(() => setConnected(false));
  }, [id]);

  if (!can(me?.role, "connect_source")) {
    return <div className="page container"><Panel><EmptyState glyph="🔒" title="Not authorized" /></Panel></div>;
  }

  async function search() {
    setBusy("list");
    try {
      const f = await listConnectorFiles(id, q);
      setFiles(f); setSelected(new Set());
      toast.push(`Found ${f.length} item(s)`, "info");
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  async function connect() {
    setBusy("connect");
    try {
      const res = await connectConnector(id);
      if (res.redirect_url) { window.open(res.redirect_url, "_blank"); toast.push("Authorize in the new tab, then re-check.", "info"); }
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  function toggle(extId: string) {
    setSelected((p) => { const n = new Set(p); n.has(extId) ? n.delete(extId) : n.add(extId); return n; });
  }
  function toggleRole(r: string) {
    setRoles((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r]);
  }

  async function indexSelected() {
    const ids = [...selected];
    if (!ids.length) { toast.push("Select at least one item", "error"); return; }
    setBusy("ingest");
    try {
      const r = await ingestSelected(id, ids, roles.length ? roles : ["VIEWER"]);
      toast.push(`Indexed ${r.ingested} item(s). Ask about them in Ask.`, "success");
      setSelected(new Set());
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  async function saveConfig() {
    let parsed: object;
    try { parsed = JSON.parse(cfgText); } catch { toast.push("Config must be valid JSON", "error"); return; }
    setBusy("cfg");
    try { await updateConnector(id, parsed); toast.push("Config saved", "success"); setCfgOpen(false); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  return (
    <div className="page container">
      <div className="page-head">
        <button className="btn btn-ghost btn-sm" onClick={() => router.push("/connectors")} style={{ marginBottom: 10 }}>← Connectors</button>
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span className="kind-badge">{source ? <KindIcon kind={source.kind} size={20} /> : <Icon name="connectors" size={20} />}</span>
            <div>
              <h1 style={{ fontSize: 1.5 + "rem" }}>{source?.display_name ?? "Source"}</h1>
              <p className="lead" style={{ margin: 0 }}>{source ? KIND_LABEL[source.kind] : ""}</p>
            </div>
          </div>
          <div className="row">
            {connected !== null && <Badge tone={connected ? "success" : "warning"}>{connected ? "connected" : "not connected"}</Badge>}
            {!connected && <Button size="sm" variant="primary" loading={busy === "connect"} onClick={connect}>Connect</Button>}
            <Button size="sm" variant="ghost" onClick={() => setCfgOpen((v) => !v)}>Advanced</Button>
          </div>
        </div>
      </div>

      {cfgOpen && (
        <Panel className="stack" style={{ marginBottom: 14 }}>
          <span className="label">Ingestion config (action slugs &amp; response paths) — overrides built-in defaults</span>
          <Textarea className="mono" rows={8} value={cfgText} onChange={(e) => setCfgText(e.target.value)} placeholder='{ "list_action": "...", "items_path": "data.files" }' />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="secondary" loading={busy === "cfg"} onClick={saveConfig}>Save config</Button>
          </div>
        </Panel>
      )}

      <Panel className="stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <Input className="grow" placeholder="Search files / pages / channels by name (blank lists all)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="primary" loading={busy === "list"}>Search</Button>
        </form>

        {files === null && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Search or list items to choose what to index.</p>}
        {files && files.length === 0 && <EmptyState glyph="🔍" title="No items found">Try a different search, or check the connection.</EmptyState>}

        {files && files.length > 0 && (
          <>
            <div className="scroll-y" style={{ display: "grid", gap: 2 }}>
              {files.map((f) => (
                <label key={f.external_id} className="row" style={{ padding: "7px 8px", borderRadius: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(f.external_id)} onChange={() => toggle(f.external_id)} />
                  <span className="grow" style={{ fontSize: 13.5 }}>{f.title}</span>
                  <span className="mono faint" style={{ fontSize: 11 }}>{f.mime_type}</span>
                </label>
              ))}
            </div>
            <hr className="divider" />
            <span className="label">Roles allowed to retrieve indexed items</span>
            <div className="cluster">
              {ALL_ROLES.map((r) => <Chip key={r} active={roles.includes(r)} onClick={() => toggleRole(r)}>{r}</Chip>)}
            </div>
            <div className="row">
              <Button variant="primary" loading={busy === "ingest"} onClick={indexSelected}>Index selected ({selected.size})</Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
