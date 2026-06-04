"use client";
import { useEffect, useRef, useState } from "react";
import {
  deleteDocument, ingestText, listDocuments, setDocumentPermissions, uploadFile,
  type DocumentOut,
} from "@/lib/api";
import { ALL_ROLES, can } from "@/lib/roles";
import { TIME_OPTIONS, withinRange, type TimeRange } from "@/lib/time";
import { useMe } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Chip, Dialog, EmptyState, Field, Input, Panel, Select, Skeleton, Textarea } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";

function RoleChips({ value, onChange }: { value: string[]; onChange: (r: string[]) => void }) {
  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  return (
    <div className="cluster">
      {ALL_ROLES.map((r) => <Chip key={r} active={value.includes(r)} onClick={() => toggle(r)}>{r}</Chip>)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "indexed" ? "success" : status === "failed" ? "danger" : "warning";
  return <Badge tone={tone as any}>{status}</Badge>;
}

export default function KnowledgePage() {
  const me = useMe();
  const toast = useToast();
  const canIngest = can(me?.role, "ingest");
  const canPerms = can(me?.role, "set_permissions");

  const [docs, setDocs] = useState<DocumentOut[] | null>(null);
  const [filter, setFilter] = useState("");
  const [range, setRange] = useState<TimeRange>("all");
  const [uploadRoles, setUploadRoles] = useState<string[]>(["ADMIN", "VIEWER"]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pTitle, setPTitle] = useState(""); const [pBody, setPBody] = useState("");
  const [pRoles, setPRoles] = useState<string[]>(["ADMIN", "VIEWER"]);

  const [permDoc, setPermDoc] = useState<DocumentOut | null>(null);
  const [permRoles, setPermRoles] = useState<string[]>([]);
  const [delDoc, setDelDoc] = useState<DocumentOut | null>(null);

  async function refresh() {
    try { setDocs(await listDocuments()); }
    catch (e) { toast.push((e as Error).message, "error"); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const d = await uploadFile(file, uploadRoles.length ? uploadRoles : ["VIEWER"]);
      toast.push(`Indexed "${d.title}" (${d.chunk_count} chunks)`, "success");
      refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function onPaste() {
    if (!pTitle.trim() || !pBody.trim()) return;
    setBusy(true);
    try {
      await ingestText(pTitle, pBody, pRoles.length ? pRoles : ["VIEWER"]);
      toast.push("Document indexed", "success");
      setPasteOpen(false); setPTitle(""); setPBody(""); refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); }
  }

  async function onSavePerms() {
    if (!permDoc) return;
    setBusy(true);
    try {
      await setDocumentPermissions(permDoc.id, permRoles.length ? permRoles : ["VIEWER"]);
      toast.push("Permissions updated", "success");
      setPermDoc(null); refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); }
  }

  async function onDelete() {
    if (!delDoc) return;
    setBusy(true);
    try {
      await deleteDocument(delDoc.id);
      toast.push(`Deleted "${delDoc.title}"`, "success");
      setDelDoc(null); refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); }
  }

  const shown = (docs ?? []).filter((d) =>
    withinRange(d.created_at, range) &&
    (!filter || d.title.toLowerCase().includes(filter.toLowerCase()) || d.status.includes(filter.toLowerCase())));

  return (
    <div className="page container">
      <div className="page-head row-between">
        <div>
          <h1>Knowledge</h1>
          <p className="lead">Documents you&apos;re authorized to see. {canIngest ? "Upload or paste to add more." : "Read-only for your role."}</p>
        </div>
        {canIngest && (
          <div className="row">
            <Button variant="secondary" onClick={() => setPasteOpen(true)}>Paste text</Button>
            <Button variant="primary" loading={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Upload file</Button>
            <input ref={fileRef} type="file" hidden accept=".txt,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.tiff" onChange={onUpload} />
          </div>
        )}
      </div>

      {canIngest && (
        <Panel className="panel-pad-sm" style={{ marginBottom: 14 }}>
          <div className="row-between">
            <span className="hint">New uploads are retrievable by:</span>
            <RoleChips value={uploadRoles} onChange={setUploadRoles} />
          </div>
        </Panel>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <Input className="grow" placeholder="Filter by title or status…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Select value={range} onChange={(e) => setRange(e.target.value as TimeRange)} style={{ maxWidth: 170 }}>
          {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {!docs && <Panel className="stack"><Skeleton h={16} /><Skeleton h={16} /><Skeleton h={16} /></Panel>}

      {docs && shown.length === 0 && (
        <Panel><EmptyState glyph="▤" title={filter ? "No matches" : "No documents yet"}>
          {filter ? "Try a different filter." : canIngest ? "Upload a file or paste text to build your knowledge base." : "Nothing has been shared with your role yet."}
        </EmptyState></Panel>
      )}

      {docs && shown.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>Title</th><th>Chunks</th><th>Status</th><th>Roles</th>{(canPerms) && <th style={{ width: 1 }}></th>}
            </tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td><strong style={{ fontWeight: 550 }}>{d.title}</strong></td>
                  <td className="mono faint">{d.chunk_count}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td><span className="muted" style={{ fontSize: 12.5 }}>{d.allowed_roles.join(", ")}</span></td>
                  {canPerms && (
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => { setPermDoc(d); setPermRoles(d.allowed_roles); }}>Permissions</Button>
                        <Button size="sm" variant="danger" onClick={() => setDelDoc(d)} aria-label="Delete"><Icon name="trash" size={15} /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paste text */}
      <Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} title="Add a text document"
        footer={<><Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onPaste}>Index document</Button></>}>
        <Field label="Title"><Input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Leave Policy" /></Field>
        <Field label="Content"><Textarea rows={6} value={pBody} onChange={(e) => setPBody(e.target.value)} placeholder="Paste document text…" /></Field>
        <Field label="Roles allowed to retrieve"><RoleChips value={pRoles} onChange={setPRoles} /></Field>
      </Dialog>

      {/* Permissions */}
      <Dialog open={!!permDoc} onClose={() => setPermDoc(null)} title={`Permissions — ${permDoc?.title ?? ""}`}
        footer={<><Button variant="ghost" onClick={() => setPermDoc(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onSavePerms}>Save permissions</Button></>}>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Choose which roles can retrieve this document. ADMIN always has access.</p>
        <RoleChips value={permRoles} onChange={setPermRoles} />
      </Dialog>

      {/* Delete */}
      <Dialog open={!!delDoc} onClose={() => setDelDoc(null)} title="Delete document?"
        footer={<><Button variant="ghost" onClick={() => setDelDoc(null)}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={onDelete}>Delete &amp; remove embeddings</Button></>}>
        <p style={{ marginTop: 0 }}>This permanently removes <strong>{delDoc?.title}</strong> and its vector embeddings. This can&apos;t be undone.</p>
      </Dialog>
    </div>
  );
}
