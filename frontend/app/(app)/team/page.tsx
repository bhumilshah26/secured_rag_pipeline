"use client";
import { useEffect, useState } from "react";
import { createUser, listUsers, type UserRow } from "@/lib/api";
import { ALL_ROLES, CAPABILITY_MATRIX, can, type Role } from "@/lib/roles";
import { useMe } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { Badge, Button, Dialog, EmptyState, Field, Input, Panel, Select, Skeleton } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";

// Authority order, highest first.
const HIERARCHY: Role[] = ["ADMIN", "MANAGER", "HR", "ANALYST", "VIEWER"];
const ROLE_BLURB: Record<Role, string> = {
  ADMIN: "Full control: users, sources, audit, knowledge",
  MANAGER: "Connect sources, ingest, set permissions, query",
  HR: "Connect sources, ingest, set permissions, query",
  ANALYST: "Query the knowledge they're authorized to see",
  VIEWER: "Query the knowledge they're authorized to see",
};

export default function TeamPage() {
  const me = useMe();
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setUsers(await listUsers()); }
    catch (e) { toast.push((e as Error).message, "error"); }
  }
  useEffect(() => { if (can(me?.role, "manage_tenant")) refresh(); /* eslint-disable-next-line */ }, [me]);

  if (!can(me?.role, "manage_tenant")) {
    return <div className="page container"><Panel><EmptyState glyph="🔒" title="Admins only">
      Managing team members is restricted to the Admin role.</EmptyState></Panel></div>;
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.push("Password must be at least 8 characters.", "error"); return; }
    setBusy(true);
    try {
      const u = await createUser({ email, password, role });
      toast.push(`Added ${u.email} (${u.role})`, "success");
      setEmail(""); setPassword(""); setRole("VIEWER"); setOpen(false); refresh();
    } catch (err) { toast.push((err as Error).message, "error"); }
    finally { setBusy(false); }
  }

  const byRole = (r: Role) => (users ?? []).filter((u) => u.role === r);

  return (
    <div className="page container">
      <div className="page-head row-between">
        <div>
          <h1>Team &amp; roles</h1>
          <p className="lead">Members of your workspace, organized by authority. Roles determine what each person can do.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Add member</Button>
      </div>

      {!users && <Panel className="stack"><Skeleton h={18} /><Skeleton h={40} /><Skeleton h={40} /></Panel>}

      {users && (
        <div className="stack" style={{ gap: 18 }}>
          {HIERARCHY.map((r, tier) => {
            const members = byRole(r);
            return (
              <div key={r}>
                <div className="row" style={{ gap: 10, marginBottom: 8 }}>
                  <span className="tier-rail" data-tier={tier} />
                  <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 15 }}>{r}</h3>
                  <Badge>{members.length}</Badge>
                  <span className="faint" style={{ fontSize: 12.5 }}>{ROLE_BLURB[r]}</span>
                </div>
                {members.length === 0 ? (
                  <p className="faint" style={{ fontSize: 13, margin: "0 0 0 22px" }}>No members with this role.</p>
                ) : (
                  <div className="grid" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", marginLeft: 22 }}>
                    {members.map((u) => (
                      <Panel key={u.id} className="panel-pad-sm row" style={{ gap: 10 }}>
                        <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{u.email[0]?.toUpperCase()}</span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                          <div className="faint" style={{ fontSize: 11 }}>
                            {u.id === me?.id ? "you · " : ""}{new Date(u.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        {!u.is_active && <Badge tone="warning">inactive</Badge>}
                      </Panel>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <details style={{ marginTop: 24 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>What each role can do</summary>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>Capability</th>{ALL_ROLES.map((r) => <th key={r} style={{ textAlign: "center" }}>{r}</th>)}</tr></thead>
            <tbody>
              {CAPABILITY_MATRIX.map((row) => (
                <tr key={row.cap}>
                  <td>{row.cap}</td>
                  {ALL_ROLES.map((r) => (
                    <td key={r} style={{ textAlign: "center" }}>
                      {row.roles.includes(r) ? <span style={{ color: "var(--success)", display: "inline-flex" }}><Icon name="check" size={15} /></span> : <span className="faint">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add a team member"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onCreate as any}>Create member</Button></>}>
        <form onSubmit={onCreate} className="stack" style={{ gap: 12 }}>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" required /></Field>
          <Field label="Temporary password" hint="At least 8 characters."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
        </form>
      </Dialog>
    </div>
  );
}
