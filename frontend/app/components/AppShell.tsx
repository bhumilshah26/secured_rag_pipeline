"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getMe, getToken, type Me } from "@/lib/api";
import { can, type Capability } from "@/lib/roles";
import { ThemeToggle } from "./theme";
import { Skeleton } from "./ui";
import { Icon, type IconName } from "./icons";
import { Menu, MenuItem } from "./Menu";

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

type NavItem = { href: string; label: string; icon: IconName; cap?: Capability };
const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: "overview" },
  { href: "/ask", label: "Ask", icon: "ask", cap: "query" },
  { href: "/knowledge", label: "Knowledge", icon: "knowledge" },
  { href: "/connectors", label: "Connectors", icon: "connectors", cap: "connect_source" },
  { href: "/audit", label: "Audit", icon: "audit", cap: "read_audit" },
  { href: "/team", label: "Team", icon: "team", cap: "manage_tenant" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    getMe().then((m) => { setMe(m); setReady(true); })
      .catch(() => { clearToken(); router.replace("/login"); });
  }, [router]);

  if (!ready || !me) {
    return (
      <div className="page" style={{ maxWidth: 520, margin: "10vh auto" }}>
        <div className="stack"><Skeleton h={28} w={220} /><Skeleton h={120} /><Skeleton h={120} /></div>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.cap || can(me.role, n.cap));

  return (
    <MeCtx.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="logo"><Icon name="shield" size={18} /></span>
            <div>
              <div className="name">Aegis</div>
              <div className="sub">Secured Enterprise RAG</div>
            </div>
          </div>
          <nav style={{ display: "grid", gap: 2 }}>
            {items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <button key={n.href} className="nav-item" aria-current={active ? "page" : undefined}
                  onClick={() => router.push(n.href)}>
                  <span className="ico"><Icon name={n.icon} size={18} /></span>
                  <span>{n.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="spacer" />
          <div className="role-tag">Signed in as <strong style={{ color: "var(--ink)" }}>{me.role}</strong></div>
        </aside>

        <div className="main">
          <Topbar me={me} />
          <div className="page-scroll">{children}</div>
        </div>
      </div>
    </MeCtx.Provider>
  );
}

function Topbar({ me }: { me: Me }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <header className="topbar">
      <form className="ask-mini row" style={{ flexWrap: "nowrap" }}
        onSubmit={(e) => { e.preventDefault(); router.push(`/ask${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); }}>
        <span className="faint" style={{ display: "inline-flex", marginRight: -34, zIndex: 1, paddingLeft: 11 }}>
          <Icon name="search" size={16} />
        </span>
        <input className="input grow" style={{ paddingLeft: 36 }} placeholder="Ask your knowledge base…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="grow" />
      <ThemeToggle />
      <Menu align="right" width={230} button={
        <button className="avatar" title={me.email}>{me.email[0]?.toUpperCase() ?? "?"}</button>
      }>
        <div className="head">
          <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{me.email}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{me.role}</div>
        </div>
        <MenuItem icon={<Icon name="settings" size={16} />} onClick={() => router.push("/settings")}>Settings</MenuItem>
        <MenuItem icon={<Icon name="logout" size={16} />} danger onClick={() => { clearToken(); router.replace("/login"); }}>Log out</MenuItem>
      </Menu>
    </header>
  );
}
