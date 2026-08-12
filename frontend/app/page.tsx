"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken } from "@/lib/api";
import { ALL_ROLES, CAPABILITY_MATRIX } from "@/lib/roles";
import { Icon } from "@/app/components/icons";
import { ThemeToggle } from "@/app/components/theme";
import { KIND_LABEL, KindIcon } from "@/app/(app)/connectors/kinds";

/* One request, end to end — the same path described in the sections below. */
const TRACE: { k: string; v: string; tone: string; mono?: boolean }[] = [
  { k: "query", v: "“Which vendors are approved for cloud hosting?”", tone: "var(--ink-faint)" },
  { k: "guard", v: "ALLOW · risk 6 / 100", tone: "var(--success)", mono: true },
  { k: "filter", v: "must[ tenant_id = northwind, allowed_roles ∋ ANALYST ]", tone: "var(--primary)", mono: true },
  { k: "retrieve", v: "4 passages · 2 documents", tone: "var(--primary)", mono: true },
  { k: "answer", v: "Written from the retrieved text, with a citation per claim", tone: "var(--success)" },
  { k: "audit", v: "query_hash · doc_ids · decision · model", tone: "var(--accent)", mono: true },
];

const STEPS = [
  {
    n: "01",
    title: "The guard scores the question",
    body:
      "Each query is scored across instruction override, role manipulation, jailbreak patterns and exfiltration signals. Anything past the block threshold stops here and lands in the audit log.",
  },
  {
    n: "02",
    title: "Retrieval is filtered before it runs",
    body:
      "The vector search carries a filter assembled from your signed token: your tenant, plus the roles each document grants. Widening it takes a different token, not a different request body.",
  },
  {
    n: "03",
    title: "Context enters as data",
    body:
      "Retrieved passages drop into a fixed slot in an immutable prompt template, where the model treats them as material to quote rather than instructions to follow.",
  },
  {
    n: "04",
    title: "The answer arrives with sources",
    body:
      "You get the answer plus the documents behind it, so any claim can be traced back to the passage it came from and checked.",
  },
];

const LAYERS = [
  {
    code: "jwt",
    body: "Tenant and role are read from the signed token on every request. Nothing in the request body can set them.",
  },
  {
    code: "postgres",
    body: "Documents, permissions and audit rows are scoped to the caller's tenant before any query executes.",
  },
  {
    code: "qdrant",
    body: "Each search pins tenant_id and allowed_roles in the payload filter, built server side on the way in.",
  },
];

const SOURCES = ["gdrive", "onedrive", "sharepoint", "confluence", "slack"];

export default function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(!!getToken()), []);

  const primaryHref = signedIn ? "/overview" : "/register";
  const primaryLabel = signedIn ? "Open your workspace" : "Create an organization";

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-brand">
            <span className="logo"><Icon name="shield" size={17} /></span>
            <span className="name">Aegis</span>
          </Link>
          <nav className="lp-navlinks">
            <a className="lp-navlink" href="#path">How it works</a>
            <a className="lp-navlink" href="#isolation">Isolation</a>
            <a className="lp-navlink" href="#roles">Roles</a>
          </nav>
          <div className="grow" />
          <ThemeToggle />
          {signedIn ? (
            <Link href="/overview" className="btn btn-primary">Open workspace</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">Sign in</Link>
              <Link href="/register" className="btn btn-primary">Get started</Link>
            </>
          )}
        </div>
      </header>

      <main>
        {/* ---------------- hero ---------------- */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <h1 className="lp-h1 lp-rise">
                Answers from your own documents, filtered by who is asking.
              </h1>
              <p className="lp-lead lp-rise" style={{ animationDelay: "80ms" }}>
                Aegis is a multi-tenant RAG platform for company knowledge. Connect Drive, SharePoint,
                Confluence or Slack, ask in plain language, and read answers grounded in citations you
                can open.
              </p>
              <div className="lp-hero-cta lp-rise" style={{ animationDelay: "160ms" }}>
                <Link href={primaryHref} className="btn btn-primary btn-lg">{primaryLabel}</Link>
                {!signedIn && <Link href="/login" className="btn btn-secondary btn-lg">Sign in</Link>}
              </div>
              <p className="lp-note lp-rise" style={{ animationDelay: "220ms" }}>
                Postgres for records, Qdrant for vectors, pluggable embedding and model providers.
              </p>
            </div>

            <div className="lp-trace lp-rise" style={{ animationDelay: "260ms" }} aria-label="Example of one query travelling through the pipeline">
              <div className="lp-trace-head">
                <span className="path">POST /chat</span>
                <span className="grow" />
                <span className="badge badge-success" style={{ fontSize: 11 }}><span className="dot" />grounded</span>
              </div>
              {TRACE.map((r, i) => (
                <div className="lp-row" key={r.k}>
                  <span
                    className="lp-pip"
                    style={{ "--tone": r.tone, animationDelay: `${i * 0.5}s` } as React.CSSProperties}
                  />
                  <span className="lp-k">{r.k}</span>
                  <span className={`lp-v${r.mono ? " mono" : ""}`}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- request path ---------------- */}
        <section className="lp-section" id="path">
          <div className="lp-wrap">
            <h2 className="lp-h2">How a question travels</h2>
            <p className="lp-sub">
              Four checkpoints sit between the question and the answer. None of them can be skipped from
              the client, because each one runs from the token rather than the payload.
            </p>
            <div className="lp-steps">
              {STEPS.map((s) => (
                <article className="lp-step" key={s.n}>
                  <span className="n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- isolation + sources ---------------- */}
        <section className="lp-section" id="isolation">
          <div className="lp-wrap lp-split">
            <div>
              <h2 className="lp-h2">Where tenant isolation is enforced</h2>
              <p className="lp-sub">
                One company&apos;s knowledge never reaches another&apos;s query. That holds in three separate
                places, so a mistake in one still leaves two.
              </p>
              <div className="lp-layers">
                {LAYERS.map((l) => (
                  <div className="lp-layer" key={l.code}>
                    <code className="mono">{l.code}</code>
                    <p>{l.body}</p>
                  </div>
                ))}
              </div>
              <p className="lp-note">
                Audit rows keep the user, tenant, decision, model and document ids. Questions are hashed
                and PII is masked before anything is written.
              </p>
            </div>

            <div>
              <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 16.5, fontWeight: 650, letterSpacing: 0 }}>
                Bring your own sources
              </h3>
              <p className="lp-sub" style={{ fontSize: 14.5, marginTop: 8 }}>
                Files are extracted, chunked, embedded and indexed with the roles allowed to read them.
                Direct uploads follow the same path.
              </p>
              <div className="lp-sources">
                {SOURCES.map((k) => (
                  <div className="lp-source" key={k}>
                    <span className="ico"><KindIcon kind={k} size={17} /></span>
                    {KIND_LABEL[k]}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- roles ---------------- */}
        <section className="lp-section" id="roles">
          <div className="lp-wrap">
            <h2 className="lp-h2">What each role can do</h2>
            <p className="lp-sub">
              Five roles ship by default. The API enforces them, the vector filter enforces them again, and
              the interface only shows what the token already allows.
            </p>
            <div className="lp-matrix table-wrap" style={{ marginTop: 28 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Capability</th>
                    {ALL_ROLES.map((r) => <th key={r}>{r}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITY_MATRIX.map((row) => (
                    <tr key={row.cap}>
                      <td>{row.cap}</td>
                      {ALL_ROLES.map((r) => {
                        const allowed = r === "ADMIN" || row.roles.includes(r);
                        return (
                          <td key={r}>
                            {allowed
                              ? <span className="yes" title="Allowed"><Icon name="check" size={15} /></span>
                              : <span className="no" aria-label="Not allowed">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---------------- cta ---------------- */}
        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-cta">
              <h2>Start with your own documents</h2>
              <p>
                Registering creates your tenant and its first admin. Invite the rest of your team, set who
                reads what, and ask your first question.
              </p>
              <div className="row">
                <Link href={primaryHref} className="btn btn-lg btn-invert">{primaryLabel}</Link>
                {!signedIn && <Link href="/login" className="btn btn-lg btn-outline-invert">Sign in</Link>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <span>Aegis · Secured Enterprise RAG</span>
          <span className="row" style={{ gap: 18 }}>
            <a href="#path">How it works</a>
            <a href="#roles">Roles</a>
            {signedIn ? <Link href="/overview">Workspace</Link> : <Link href="/login">Sign in</Link>}
          </span>
        </div>
      </footer>
    </div>
  );
}
