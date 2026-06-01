"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Topbar from "@/app/components/Topbar";
import {
  CONNECTOR_KINDS,
  type Connector,
  type ConnectorFile,
  connectConnector,
  connectorStatus,
  deleteConnector,
  getToken,
  ingestSelected,
  listConnectorFiles,
  listConnectors,
  registerConnector,
  updateConnector,
} from "@/lib/api";

const ALL_ROLES = ["ADMIN", "HR", "ANALYST", "MANAGER", "VIEWER"];

const KIND_LABEL: Record<string, string> = {
  gdrive: "Google Drive",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  confluence: "Confluence",
  slack: "Slack",
};
const KIND_ICON: Record<string, string> = {
  gdrive: "📁",
  onedrive: "☁️",
  sharepoint: "🗂️",
  confluence: "📘",
  slack: "💬",
};

const CONFIG_TEMPLATES: Record<string, string> = {
  gdrive: JSON.stringify(
    {
      list_action: "GOOGLEDRIVE_LIST_FILES",
      list_arguments: { page_size: 10 },
      items_path: "data.files",
      id_field: "id",
      title_field: "name",
      mime_field: "mimeType",
      fetch_action: "GOOGLEDRIVE_DOWNLOAD_FILE",
      fetch_id_arg: "file_id",
      fetch_content_path: "data.content",
    },
    null,
    2
  ),
};

export default function ConnectorsPage() {
  const router = useRouter();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [kind, setKind] = useState<string>(CONNECTOR_KINDS[0]);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [configById, setConfigById] = useState<Record<string, string>>({});
  const [filesById, setFilesById] = useState<Record<string, ConnectorFile[]>>({});
  const [selectedById, setSelectedById] = useState<Record<string, Set<string>>>({});
  const [rolesById, setRolesById] = useState<Record<string, string[]>>({});
  const [statusById, setStatusById] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setConnectors(await listConnectors());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    refresh();
  }, [router]);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await registerConnector(kind, displayName || KIND_LABEL[kind] || kind, {});
      setMsg(`Registered ${KIND_LABEL[kind] ?? kind}`);
      setDisplayName("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onConnect(c: Connector) {
    setError("");
    setMsg("");
    setBusy(c.id);
    try {
      const res = await connectConnector(c.id);
      if (res.redirect_url) {
        setMsg("Opening secure authorization in a new tab…");
        window.open(res.redirect_url, "_blank");
      } else {
        setMsg(`Connection initiated (status: ${res.status})`);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function onStatus(c: Connector) {
    setError("");
    setBusy(c.id);
    try {
      const s = await connectorStatus(c.id);
      setStatusById((p) => ({ ...p, [c.id]: s.connected }));
      setMsg(`"${c.display_name}" — ${s.connected ? "connected ✓" : "not connected yet"}`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function onSaveConfig(c: Connector) {
    setError("");
    const text = configById[c.id] ?? CONFIG_TEMPLATES[c.kind] ?? "{}";
    let config: object;
    try {
      config = JSON.parse(text);
    } catch {
      setError(`Config for "${c.display_name}" must be valid JSON`);
      return;
    }
    try {
      await updateConnector(c.id, config);
      setMsg(`Saved config for "${c.display_name}"`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(c: Connector) {
    if (!window.confirm(`Delete "${c.display_name}" and all documents indexed from it?`)) {
      return;
    }
    setError("");
    setBusy(c.id);
    try {
      const r = await deleteConnector(c.id);
      setFilesById((p) => {
        const { [c.id]: _drop, ...rest } = p;
        return rest;
      });
      setMsg(`Deleted "${c.display_name}" — removed ${r.documents_removed} document(s).`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function onListFiles(c: Connector) {
    setError("");
    setBusy(c.id);
    setMsg(`Listing files in "${c.display_name}"…`);
    try {
      const files = await listConnectorFiles(c.id);
      setFilesById((p) => ({ ...p, [c.id]: files }));
      setSelectedById((p) => ({ ...p, [c.id]: new Set() }));
      setMsg(`Found ${files.length} file(s). Select which to index.`);
    } catch (err) {
      setMsg("");
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function toggleFile(sourceId: string, extId: string) {
    setSelectedById((p) => {
      const next = new Set(p[sourceId] ?? []);
      next.has(extId) ? next.delete(extId) : next.add(extId);
      return { ...p, [sourceId]: next };
    });
  }

  function toggleIngestRole(sourceId: string, role: string) {
    setRolesById((p) => {
      const cur = p[sourceId] ?? ["ADMIN", "VIEWER"];
      return {
        ...p,
        [sourceId]: cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role],
      };
    });
  }

  async function onIngestSelected(c: Connector) {
    setError("");
    const ids = Array.from(selectedById[c.id] ?? []);
    if (ids.length === 0) {
      setError("Select at least one file to index.");
      return;
    }
    const roles = rolesById[c.id] ?? ["ADMIN", "VIEWER"];
    setBusy(c.id);
    setMsg(`Indexing ${ids.length} file(s)…`);
    try {
      const r = await ingestSelected(c.id, ids, roles.length ? roles : ["VIEWER"]);
      setMsg(`Indexed ${r.ingested} file(s) from "${c.display_name}". Ask about them in Chat.`);
    } catch (err) {
      setMsg("");
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Topbar />
      <main className="container container-wide">
        <h1 className="title-gradient" style={{ marginBottom: 4 }}>Data Source Connectors</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Connect a workspace, list its files, and index just the ones you choose.
        </p>

        {/* Register */}
        <form onSubmit={onRegister} className="card">
          <div className="section-title">Add a source</div>
          <div className="row">
            <select className="input" style={{ maxWidth: 220 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              {CONNECTOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_ICON[k]} {KIND_LABEL[k] ?? k}
                </option>
              ))}
            </select>
            <input
              className="input grow"
              placeholder="Display name (e.g. Marketing Drive)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary">Register</button>
          </div>
        </form>

        {msg && <div className="toast toast-ok">{msg}</div>}
        {error && <div className="toast toast-err">{error}</div>}

        {connectors.length === 0 && (
          <div className="card muted">No sources yet — register one above to get started.</div>
        )}

        <div className="grid grid-2" style={{ marginTop: 16 }}>
          {connectors.map((c) => {
            const connected = statusById[c.id] ?? c.status === "connected";
            const files = filesById[c.id];
            return (
              <div key={c.id} className="card" style={{ animation: "rise .35s ease both" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="brand" style={{ gap: 8 }}>
                    <span className="logo" style={{ fontSize: 15 }}>{KIND_ICON[c.kind] ?? "🔌"}</span>
                    <div>
                      {c.display_name}
                      <small>{KIND_LABEL[c.kind] ?? c.kind}</small>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`badge ${connected ? "badge-ok" : "badge-warn"}`}>
                      <span className="dot" />{connected ? "connected" : c.status}
                    </span>
                    <button
                      className="btn btn-danger btn-sm"
                      title="Delete source"
                      disabled={busy === c.id}
                      onClick={() => onDelete(c)}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => onConnect(c)}>
                    {busy === c.id ? <span className="spinner" /> : "Connect"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => onStatus(c)}>Check status</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => onListFiles(c)}>
                    List files
                  </button>
                </div>

                {files && (
                  <div style={{ marginTop: 12 }}>
                    <div className="divider" />
                    {files.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No files found.</p>}
                    {files.length > 0 && (
                      <>
                        <div className="scroll">
                          {files.map((f) => (
                            <label key={f.external_id} className="file-row">
                              <input
                                type="checkbox"
                                checked={selectedById[c.id]?.has(f.external_id) ?? false}
                                onChange={() => toggleFile(c.id, f.external_id)}
                              />
                              <span style={{ flex: 1, fontSize: 13 }}>{f.title}</span>
                              <span className="muted" style={{ fontSize: 11 }}>{f.mime_type}</span>
                            </label>
                          ))}
                        </div>
                        <div className="label" style={{ marginTop: 10 }}>Roles allowed to retrieve:</div>
                        <div className="row" style={{ margin: "6px 0 10px" }}>
                          {ALL_ROLES.map((role) => {
                            const active = (rolesById[c.id] ?? ["ADMIN", "VIEWER"]).includes(role);
                            return (
                              <span key={role} className={`chip ${active ? "active" : ""}`} onClick={() => toggleIngestRole(c.id, role)}>
                                {role}
                              </span>
                            );
                          })}
                        </div>
                        <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => onIngestSelected(c)}>
                          Index selected ({selectedById[c.id]?.size ?? 0})
                        </button>
                      </>
                    )}
                  </div>
                )}

                <details style={{ marginTop: 12 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                    Advanced: ingestion config (action slugs &amp; paths)
                  </summary>
                  <textarea
                    className="textarea"
                    style={{ marginTop: 8 }}
                    rows={9}
                    value={configById[c.id] ?? CONFIG_TEMPLATES[c.kind] ?? "{}"}
                    onChange={(e) => setConfigById((p) => ({ ...p, [c.id]: e.target.value }))}
                  />
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => onSaveConfig(c)}>
                    Save config
                  </button>
                </details>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
