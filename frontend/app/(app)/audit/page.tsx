"use client";
import { useEffect, useMemo, useState } from "react";
import { getAudit, type AuditRow } from "@/lib/api";
import { can } from "@/lib/roles";
import { TIME_OPTIONS, withinRange, type TimeRange } from "@/lib/time";
import { useMe } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { Badge, EmptyState, Input, Panel, RiskBadge, Select, Skeleton } from "@/app/components/ui";

function riskOf(s: string | null) {
  if (!s) return "";
  return s.split(":")[0];
}

export default function AuditPage() {
  const me = useMe();
  const toast = useToast();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [event, setEvent] = useState("");
  const [risk, setRisk] = useState("");
  const [text, setText] = useState("");
  const [range, setRange] = useState<TimeRange>("all");

  useEffect(() => {
    if (!can(me?.role, "read_audit")) return;
    getAudit(200).then(setRows).catch((e) => toast.push((e as Error).message, "error"));
    /* eslint-disable-next-line */
  }, [me]);

  const eventTypes = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.event_type))).sort(), [rows]);

  const shown = (rows ?? []).filter((r) => {
    if (!withinRange(r.created_at, range)) return false;
    if (event && r.event_type !== event) return false;
    if (risk && riskOf(r.security_risk) !== risk) return false;
    if (text) {
      const hay = `${r.event_type} ${r.user_id} ${r.query_hash} ${r.model_used} ${r.response_status}`.toLowerCase();
      if (!hay.includes(text.toLowerCase())) return false;
    }
    return true;
  });

  if (!can(me?.role, "read_audit")) {
    return <div className="page container"><Panel><EmptyState glyph="🔒" title="Admins only">
      The audit log is restricted to the Admin role.</EmptyState></Panel></div>;
  }

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Audit log</h1>
        <p className="lead">
          Every sensitive action, content-free by design: query <span className="mono">hashes</span> and document IDs only — never raw text or PII.
        </p>
      </div>

      <Panel className="panel-pad-sm" style={{ marginBottom: 12 }}>
        <div className="row">
          <Select value={event} onChange={(e) => setEvent(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All events</option>
            {eventTypes.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
          <Select value={risk} onChange={(e) => setRisk(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All risk</option>
            <option value="ALLOW">Allowed</option>
            <option value="FLAG">Flagged</option>
            <option value="BLOCK">Blocked</option>
          </Select>
          <Select value={range} onChange={(e) => setRange(e.target.value as TimeRange)} style={{ maxWidth: 170 }}>
            {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input className="grow" placeholder="Filter by user, hash, model, status…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </Panel>

      {!rows && <Panel className="stack"><Skeleton h={16} /><Skeleton h={16} /><Skeleton h={16} /><Skeleton h={16} /></Panel>}

      {rows && shown.length === 0 && (
        <Panel><EmptyState glyph="⏞" title="No events">Nothing matches these filters yet.</EmptyState></Panel>
      )}

      {rows && shown.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>
              <th>Time</th><th>Event</th><th>User</th><th>Risk</th><th>Docs</th><th>Model</th><th>Status</th><th>Query hash</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="faint" style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td><span className="mono" style={{ fontSize: 12.5 }}>{r.event_type}</span></td>
                  <td className="mono faint" title={r.user_id ?? ""}>{r.user_id ? r.user_id.slice(0, 8) : "—"}</td>
                  <td>{r.security_risk ? <RiskBadge risk={riskOf(r.security_risk)} /> : "—"}</td>
                  <td className="faint">{r.document_ids?.length ?? 0}</td>
                  <td className="faint">{r.model_used ?? "—"}</td>
                  <td>{r.response_status ? <Badge tone={r.response_status === "200" || r.response_status === "201" ? "success" : "danger"}>{r.response_status}</Badge> : "—"}</td>
                  <td className="mono faint" title={r.query_hash ?? ""}>{r.query_hash ? r.query_hash.slice(0, 12) + "…" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
