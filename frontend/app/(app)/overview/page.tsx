"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAudit, listConnectors, listDocuments,
  type AuditRow, type Connector, type DocumentOut,
} from "@/lib/api";
import { can } from "@/lib/roles";
import { useMe } from "@/app/components/AppShell";
import { Badge, Button, EmptyState, Input, Panel, RiskBadge, Skeleton } from "@/app/components/ui";
import { KIND_LABEL, KindIcon } from "../connectors/kinds";

const SOURCE_IMAGES: Record<string, string> = {
  gdrive: "/drive.png",
  onedrive: "/onedrive.png",
  sharepoint: "/sharepoint.png",
  confluence: "/confluence.png",
  slack: "/slack.png",
};

/* ---- small helpers ------------------------------------------------------- */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "BLOCK:75:instruction_override,exfiltration" -> { decision, cats } */
function parseRisk(risk: string | null | undefined) {
  const [decision = "", , cats = ""] = (risk ?? "").split(":");
  return { decision, cats: cats.split(",").filter(Boolean) };
}

const EVENT_TONE: Record<string, string> = {
  "chat.blocked": "var(--danger)",
  "chat.query": "var(--success)",
};

/* ---- page ---------------------------------------------------------------- */

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
  const totalChunks = (docs ?? []).reduce((n, d) => n + (d.chunk_count ?? 0), 0);
  const connectedSourceTypes = Object.entries(
    (sources ?? [])
      .filter((s) => s.status === "connected")
      .reduce<Record<string, number>>((counts, s) => {
        counts[s.kind] = (counts[s.kind] ?? 0) + 1;
        return counts;
      }, {})
  ).slice(0, 5);
  const connectedCount = (sources ?? []).filter((s) => s.status === "connected").length;

  const firstName = me?.email?.split("@")[0]?.split(/[._-]/)[0] ?? "";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });

  /* Suggested prompts, built from what is actually indexed. */
  const suggestions = useMemo(() => {
    const out: string[] = [];
    const titles = (docs ?? []).map((d) => d.title);
    if (titles[0]) out.push(`Summarize "${titles[0]}"`);
    if (titles.length >= 2) out.push(`What do "${titles[0]}" and "${titles[1]}" have in common?`);
    if (out.length < 3) out.push("What documents can my role read?");
    return out.slice(0, 3);
  }, [docs]);

  const ask = (text: string) =>
    router.push(`/ask${text.trim() ? `?q=${encodeURIComponent(text.trim())}` : ""}`);

  return (
    <div className="page container">
      {/* ---------------- header ---------------- */}
      <div className="page-head ov-head">
        <div>
          <h1>
            {greeting()}{firstName ? `, ${firstName}` : ""}
            {me?.role && <span className="ov-role mono">{me.role}</span>}
          </h1>
          <p className="lead">Your company knowledge, ready to query — under your role&apos;s access.</p>
        </div>
        <span className="ov-date mono">{today}</span>
      </div>

      {/* ---------------- command bar ---------------- */}
      <Panel className="stack" style={{ marginBottom: 16, gap: 10 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <Input className="grow" placeholder="Ask a question about your knowledge…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="primary">Ask</Button>
        </form>
        <div className="ov-suggest">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ov-chip" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      </Panel>

      {/* ---------------- stat strip ---------------- */}
      <div className="ov-stats">
        <div className="ov-stat">
          <span className="n mono">{docs ? docs.length : "–"}</span>
          <span className="l">documents uploaded</span>
        </div>
        <div className="ov-stat">
          <span className="n mono">{docs ? totalChunks : "–"}</span>
          <span className="l">chunks indexed</span>
        </div>
        {canConnect && (
          <div className="ov-stat">
            <span className="n mono">{connectedCount}</span>
            <span className="l">sources connected</span>
          </div>
        )}
        {isAdmin ? (
          <div className="ov-stat">
            <span className="n mono" style={{ color: security.length ? "var(--warning)" : "var(--success)" }}>
              {events ? security.length : "–"}
            </span>
            <span className="l">queries flagged / blocked</span>
          </div>
        ) : (
          <div className="ov-stat">
            <span className="n mono" style={{ fontSize: 15 }}>{me?.role ?? "–"}</span>
            <span className="l">your role</span>
          </div>
        )}
      </div>

      {/* ---------------- cards ---------------- */}
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
            <div key={d.id} className="row" style={{ fontSize: 13.5, gap: 8 }}>
              {d.source_kind && d.source_kind !== "upload" && <KindIcon kind={d.source_kind} size={13} />}
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
              {sources && <Badge>{connectedCount}</Badge>}
            </div>
            {!sources && <><Skeleton h={14} /><Skeleton h={14} w="60%" /></>}
            {sources && connectedSourceTypes.length === 0 && (
              <EmptyState glyph="⇄" title="No sources">Connect Drive, Confluence, Slack…</EmptyState>
            )}
            <div className="ov-sources">
              {connectedSourceTypes.map(([kind, count]) => (
                <div key={kind} className="ov-source" title={KIND_LABEL[kind] ?? kind}>
                  {SOURCE_IMAGES[kind]
                    ? <img src={SOURCE_IMAGES[kind]} alt={KIND_LABEL[kind] ?? kind} width={26} height={26} style={{ objectFit: "contain" }} />
                    : <KindIcon kind={kind} size={22} />}
                  <span className="name">{KIND_LABEL[kind] ?? kind}</span>
                  {count > 1 && <span className="count mono">{count}</span>}
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
            {events && security.length === 0 && (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>No flagged or blocked queries recently.</p>
            )}
            {security.slice(0, 4).map((e) => {
              const r = parseRisk(e.security_risk);
              return (
                <div key={e.id} className="ov-sec-row">
                  <RiskBadge risk={r.decision} />
                  <span className="who" title={e.user_email ?? undefined}>
                    {e.user_email?.split("@")[0] ?? "unknown"}
                  </span>
                  <span className="faint mono t">{new Date(e.created_at).toLocaleTimeString()}</span>
                </div>
              );
            })}
            <div className="row"><Button size="sm" variant="ghost" onClick={() => router.push("/audit")}>Open audit log →</Button></div>
          </Panel>
        ) : (
          <Panel className="stack">
            <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Your access</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              You&apos;re signed in as <strong style={{ color: "var(--ink)" }}>{me?.role}</strong>. You can see documents shared
              with your role and ask questions grounded in them.
            </p>
            <div className="row"><Button size="sm" variant="ghost" onClick={() => router.push("/ask")}>Ask a question →</Button></div>
          </Panel>
        )}
      </div>

      {/* ---------------- recent activity (admin) ---------------- */}
      {isAdmin && events && events.length > 0 && (
        <Panel className="stack" style={{ marginTop: 16 }}>
          <div className="row-between">
            <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16 }}>Recent activity</h3>
            <Button size="sm" variant="ghost" onClick={() => router.push("/audit")}>See everything →</Button>
          </div>
          <div className="ov-feed">
            <div className="ov-feed-row ov-feed-head" aria-hidden="true">
              <span>Time</span>
              <span>User</span>
              <span>Event</span>
              <span>Detail</span>
            </div>
            {events.slice(0, 6).map((e) => {
              const r = parseRisk(e.security_risk);
              return (
                <div key={e.id} className="ov-feed-row">
                  <span className="mono t">
                    {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="mono who">{e.user_email ?? "system"}</span>
                  <span className="mono ev" style={{ color: EVENT_TONE[e.event_type] ?? "var(--primary)" }}>
                    {e.event_type}
                  </span>
                  <span className="mono detail">
                    {[r.decision || null, e.model_used, e.document_ids?.length ? `${e.document_ids.length} docs` : null]
                      .filter(Boolean).join(" · ")}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}