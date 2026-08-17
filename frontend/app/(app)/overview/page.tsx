"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAudit, listConnectors, listDocuments,
  type AuditRow, type Connector, type DocumentOut,
} from "@/lib/api";
import { can } from "@/lib/roles";
import { useMe } from "@/app/components/AppShell";
import { Badge, Button, EmptyState, Input, Panel, RiskBadge, Skeleton } from "@/app/components/ui";
import { KIND_LABEL } from "../connectors/kinds";

const SOURCE_IMAGES: Record<string, string> = {
  gdrive: "/drive.png",
  onedrive: "/onedrive.png",
  sharepoint: "/sharepoint.png",
  confluence: "/confluence.png",
  slack: "/slack.png",
};

export default function OverviewPage() {
  const me = useMe();
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentOut[] | null>(null);
  const [sources, setSources] = useState<Connector[] | null>(null);
  const [events, setEvents] = useState<AuditRow[] | null>(null);
  const [q, setQ] = useState("");

  const canConnect = can(me?.role, "connect_source");
  const isAdmin = can(me?.role, "read_audit");

  useEffect(() => {
    listDocuments().then(setDocs).catch(() => setDocs([]));
    if (canConnect) listConnectors().then(setSources).catch(() => setSources([]));
    if (isAdmin) getAudit(50).then(setEvents).catch(() => setEvents([]));
    /* eslint-disable-next-line */
  }, [me]);

  const security = (events ?? []).filter((e) => /BLOCK|FLAG/.test(e.security_risk ?? ""));
  const connectedSourceTypes = Object.entries(
    (sources ?? [])
      .filter((source) => source.status === "connected")
      .reduce<Record<string, number>>((counts, source) => {
        counts[source.kind] = (counts[source.kind] ?? 0) + 1;
        return counts;
      }, {})
  ).slice(0, 5);

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Welcome back</h1>
        <p className="lead">Your company knowledge, ready to query — under your role&apos;s access.</p>
      </div>

      <Panel className="row" style={{ marginBottom: 16 }}>
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); router.push(`/ask${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); }}>
          <Input className="grow" placeholder="Ask a question about your knowledge…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="primary">Ask</Button>
        </form>
      </Panel>

      <div className="grid ov-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        {/* Knowledge */}
        <Panel className="stack">
          <div className="row-between">
            <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Knowledge</h3>
            {docs && <Badge>{docs.length} indexed</Badge>}
          </div>
          {!docs && <><Skeleton h={14} /><Skeleton h={14} w="70%" /></>}
          {docs && docs.length === 0 && <EmptyState glyph="▤" title="No documents yet">Upload a file to get started.</EmptyState>}
          {docs && docs.slice(0, 5).map((d) => (
            <div key={d.id} className="row-between" style={{ fontSize: 13.5 }}>
              <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
              <span className="faint mono" style={{ fontSize: 11 }}>{d.chunk_count}c</span>
            </div>
          ))}
          <div className="row"><Button size="sm" variant="ghost" onClick={() => router.push("/knowledge")}>Manage knowledge →</Button></div>
        </Panel>

        {/* Sources */}
        {canConnect && (
          <Panel className="stack">
            <div className="row-between">
              <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Connected sources</h3>
              {sources && <Badge>{sources.length}</Badge>}
            </div>
            {!sources && <><Skeleton h={14} /><Skeleton h={14} w="60%" /></>}
            {sources && connectedSourceTypes.length === 0 && (<EmptyState glyph="⇄" title="No sources">Connect Drive, Confluence, Slack…</EmptyState>)}
            <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, max-content)",
              gap: "14px 28px",
              padding: "8px 0",
              justifyContent: "start",
            }}
          >
            {connectedSourceTypes.map(([kind, count]) => (
              <div
                key={kind}
                title={KIND_LABEL[kind] ?? kind}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {SOURCE_IMAGES[kind] ? (
                  <img
                    src={SOURCE_IMAGES[kind]}
                    alt={KIND_LABEL[kind] ?? kind}
                    width={60}
                    height={60}
                    style={{ objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 32, lineHeight: "40px" }}>⇄</span>
                )}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 26,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink)",
                    background: "color-mix(in srgb, var(--ink) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--ink) 15%, transparent)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
            <div className="row"><Button size="sm" variant="ghost" onClick={() => router.push("/connectors")}>Manage connectors →</Button></div>
          </Panel>
        )}

        {/* Security (admin) or Access (others) */}
        {isAdmin ? (
          <Panel className="stack">
            <div className="row-between">
              <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Security</h3>
              {events && <Badge tone={security.length ? "warning" : "success"}>{security.length} flagged/blocked</Badge>}
            </div>
            {!events && <><Skeleton h={14} /><Skeleton h={14} w="50%" /></>}
            {events && security.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>No flagged or blocked queries recently.</p>}
            {security.slice(0, 4).map((e) => (
              <div key={e.id} className="row-between" style={{ fontSize: 13 }}>
                <RiskBadge risk={(e.security_risk ?? "").split(":")[0]} />
                <span className="faint">{new Date(e.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
            <div className="row"><Button size="sm" variant="ghost" onClick={() => router.push("/audit")}>Open audit log →</Button></div>
          </Panel>
        ) : (
          <Panel className="stack">
            <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Your access</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              You&apos;re signed in as <strong style={{ color: "var(--ink)" }}>{me?.role}</strong>. You can see documents shared
              with your role and ask questions grounded in them.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
