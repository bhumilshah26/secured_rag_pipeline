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
import { KindIcon } from "../connectors/kinds";

function RoleChips({
  value, onChange, disabled,
}: { value: string[]; onChange: (r: string[]) => void; disabled?: boolean }) {
  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  return (
    <div className="cluster">
      {ALL_ROLES.map((r) => (
        <Chip key={r} active={value.includes(r)} onClick={() => toggle(r)} disabled={disabled}>{r}</Chip>
      ))}
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

  const [dragOver, setDragOver] = useState(false);
  const [roleLens, setRoleLens] = useState<string>("ALL");

  async function refresh() {
    try { setDocs(await listDocuments()); }
    catch (e) { toast.push((e as Error).message, "error"); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  async function ingestFile(file: File) {
    // ← move the existing body of onUpload here, replacing its `file` variable
    //   (the setBusy/uploadFile/toast/refresh sequence), unchanged otherwise
    setBusy(true);
    try {
      const d = await uploadFile(file, uploadRoles.length ? uploadRoles : ["VIEWER"]);
      toast.push(`Indexed "${d.title}" (${d.chunk_count} chunks)`, "success");
      refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); }
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await ingestFile(f);
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
    (!filter || d.title.toLowerCase().includes(filter.toLowerCase()) || d.status.includes(filter.toLowerCase())))
    .filter((d) => roleLens === "ALL" || roleLens === "ADMIN" || d.allowed_roles.includes(roleLens));

  return (
    <div
      className="page container"
      onDragOver={(e) => { if (canIngest) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => {
        if (!canIngest) return;
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void ingestFile(f);
      }}
    >
      {dragOver && (
        <div className="kn-dropveil">
          <div className="kn-dropcard">
            <Icon name="upload" size={22} />
            <strong>Drop to index</strong>
            <span>PDF · Word · Excel · text — retrievable by: {uploadRoles.join(", ") || "VIEWER"}</span>
          </div>
        </div>
      )}
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
      {docs && docs.length > 0 && (
        <div className="ov-stats">
          <div className="ov-stat">
            <span className="n mono">{docs.filter((d) => d.status === "indexed").length}</span>
            <span className="l">indexed</span>
          </div>
          <div className="ov-stat">
            <span className="n mono">{docs.reduce((n, d) => n + (d.chunk_count ?? 0), 0)}</span>
            <span className="l">chunks in the vector store</span>
          </div>
          <div className="ov-stat">
            <span className="n mono">{new Set(docs.map((d) => d.source_name ?? "upload")).size}</span>
            <span className="l">sources</span>
          </div>
          {docs.some((d) => d.status === "failed") && (
            <div className="ov-stat">
              <span className="n mono" style={{ color: "var(--danger)" }}>
                {docs.filter((d) => d.status === "failed").length}
              </span>
              <span className="l">failed</span>
            </div>
          )}
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <Input className="grow" placeholder="Filter by title or status…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Select value={range} onChange={(v) => setRange(v as TimeRange)} ariaLabel="Time range" style={{ maxWidth: 180 }}
          options={TIME_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <Select value={roleLens} onChange={(v) => setRoleLens(v)} ariaLabel="Visible to role" style={{ maxWidth: 160 }}
          options={[{ value: "ALL", label: "All roles" }, ...ALL_ROLES.map((r) => ({ value: r, label: `Visible to ${r}` }))]} />
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
              <th>Title</th><th>Source</th><th>Chunks</th><th>Status</th><th>Roles</th>{(canPerms) && <th style={{ width: 1 }}></th>}
            </tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td><strong style={{ fontWeight: 550 }}>{d.title}</strong></td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {d.source_kind && d.source_kind !== "upload" && <KindIcon kind={d.source_kind} size={14} />}
                      <span className="muted" style={{ fontSize: 12.5 }}>{d.source_name ?? "Direct upload"}</span>
                    </span>
                  </td>
                  <td className="mono faint">{d.chunk_count}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td>
                    <span className="cluster" style={{ gap: 4 }}>
                      {d.allowed_roles.map((r) => <span key={r} className="kn-role mono">{r}</span>)}
                    </span>
                  </td>
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
        <Field label="Title"><Input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Leave Policy" disabled={busy} /></Field>
        <Field label="Content"><Textarea rows={6} value={pBody} onChange={(e) => setPBody(e.target.value)} placeholder="Paste document text…" disabled={busy} /></Field>
        <Field label="Roles allowed to retrieve"><RoleChips value={pRoles} onChange={setPRoles} disabled={busy} /></Field>
      </Dialog>

      {/* Permissions */}
      <Dialog open={!!permDoc} onClose={() => setPermDoc(null)} title={`Permissions — ${permDoc?.title ?? ""}`}
        footer={<><Button variant="ghost" onClick={() => setPermDoc(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onSavePerms}>Save permissions</Button></>}>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Choose which roles can retrieve this document. ADMIN always has access.</p>
        <RoleChips value={permRoles} onChange={setPermRoles} disabled={busy} />
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
