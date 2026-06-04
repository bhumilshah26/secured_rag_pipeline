"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONNECTOR_KINDS, connectConnector, connectorStatus, deleteConnector,
  listConnectors, registerConnector, type Connector,
} from "@/lib/api";
import { can } from "@/lib/roles";
import { useMe } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Dialog, EmptyState, Field, Input, Panel, Select, Skeleton } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";
import { KIND_LABEL, KindIcon } from "./kinds";

export default function ConnectorsPage() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<Connector[] | null>(null);
  const [kind, setKind] = useState<string>(CONNECTOR_KINDS[0]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [delSrc, setDelSrc] = useState<Connector | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});

  async function refresh() {
    try { setList(await listConnectors()); }
    catch (e) { toast.push((e as Error).message, "error"); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  if (!can(me?.role, "connect_source")) {
    return <div className="page container"><Panel><EmptyState glyph="🔒" title="Not authorized">
      Connecting data sources requires an Admin, HR, or Manager role.</EmptyState></Panel></div>;
  }

  async function onRegister() {
    setBusy("register");
    try {
      await registerConnector(kind, name || KIND_LABEL[kind], {});
      toast.push(`Added ${KIND_LABEL[kind]}`, "success");
      setAddOpen(false); setName(""); refresh();
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  async function onConnect(c: Connector) {
    setBusy(c.id);
    try {
      const res = await connectConnector(c.id);
      if (res.redirect_url) { window.open(res.redirect_url, "_blank"); toast.push("Authorize the connection in the new tab, then Check status.", "info"); }
      else toast.push(`Status: ${res.status}`, "info");
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  async function onStatus(c: Connector) {
    setBusy(c.id);
    try {
      const s = await connectorStatus(c.id);
      setConnected((p) => ({ ...p, [c.id]: s.connected }));
      toast.push(s.connected ? `${c.display_name} is connected` : `${c.display_name} not connected yet`, s.connected ? "success" : "info");
      refresh();
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  async function onDelete() {
    if (!delSrc) return;
    setBusy(delSrc.id);
    try {
      const r = await deleteConnector(delSrc.id);
      toast.push(`Deleted ${delSrc.display_name} (removed ${r.documents_removed} docs)`, "success");
      setDelSrc(null); refresh();
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(""); }
  }

  const isConnected = (c: Connector) => connected[c.id] ?? c.status === "connected";

  return (
    <div className="page container">
      <div className="page-head row-between">
        <div>
          <h1>Connectors</h1>
          <p className="lead">Connect a workspace, then browse and index just the files you choose.</p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={16} /> Add source</Button>
      </div>

      {!list && <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <Panel><Skeleton h={60} /></Panel><Panel><Skeleton h={60} /></Panel></div>}

      {list && list.length === 0 && (
        <Panel><EmptyState glyph="⇄" title="No sources connected">
          Add Google Drive, OneDrive, SharePoint, Confluence, or Slack to pull in company knowledge.
        </EmptyState></Panel>
      )}

      {list && list.length > 0 && (
        <div className="grid" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
          {list.map((c) => (
            <Panel key={c.id} className="stack">
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <span className="kind-badge"><KindIcon kind={c.kind} size={18} /></span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.display_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{KIND_LABEL[c.kind] ?? c.kind}</div>
                  </div>
                </div>
                <Badge tone={isConnected(c) ? "success" : "warning"}>{isConnected(c) ? "connected" : c.status}</Badge>
              </div>
              <div className="row">
                <Button size="sm" variant="primary" loading={busy === c.id} onClick={() => onConnect(c)}>Connect</Button>
                <Button size="sm" variant="secondary" onClick={() => onStatus(c)}>Check status</Button>
                <Button size="sm" variant="ghost" onClick={() => router.push(`/connectors/${c.id}`)}>Browse &amp; index →</Button>
                <div className="grow" />
                <Button size="sm" variant="danger" onClick={() => setDelSrc(c)} aria-label="Delete"><Icon name="trash" size={15} /></Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add a data source"
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={busy === "register"} onClick={onRegister}>Add source</Button></>}>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {CONNECTOR_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
          </Select>
        </Field>
        <Field label="Display name" hint="A label for this source in your workspace.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND_LABEL[kind]} />
        </Field>
      </Dialog>

      <Dialog open={!!delSrc} onClose={() => setDelSrc(null)} title="Delete source?"
        footer={<><Button variant="ghost" onClick={() => setDelSrc(null)}>Cancel</Button>
          <Button variant="danger" loading={busy === delSrc?.id} onClick={onDelete}>Delete source</Button></>}>
        <p style={{ marginTop: 0 }}>Removes <strong>{delSrc?.display_name}</strong> and every document indexed from it (including embeddings).</p>
      </Dialog>
    </div>
  );
}
