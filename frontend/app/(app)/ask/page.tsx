"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { chatStream } from "@/lib/api";
import { EMPTY_ASK, useAsk } from "@/app/components/AskStore";
import { Badge, Button, EmptyState, Input, Panel, RiskBadge } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";
import { Markdown } from "@/app/components/Markdown";

export default function AskPage() {
  const { state, setState } = useAsk();
  const [query, setQuery] = useState(state.query);
  const [loading, setLoading] = useState(false);

  // Prefill + auto-run from the global ask (?q=) once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q !== state.query) { setQuery(q); void run(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(q: string) {
    setLoading(true);
    setState({ ...EMPTY_ASK, query: q });
    try {
      await chatStream(q, {
        onMeta: (e) => setState((s) => ({ ...s, model: e.model_used, risk: e.security_risk })),
        onToken: (t) => setState((s) => ({ ...s, answer: s.answer + t })),
        onBlocked: (d) => setState((s) => ({ ...s, blocked: d, done: true })),
        onError: (d) => setState((s) => ({ ...s, error: d, done: true })),
        onDone: (e) => setState((s) => ({ ...s, answer: e.answer ?? s.answer, citations: e.citations, risk: e.security_risk, model: e.model_used, done: true })),
      });
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message, done: true }));
    } finally {
      setLoading(false);
    }
  }

  const hasResult = state.answer || state.blocked || state.error;

  return (
    <div className="page container reading">
      <div className="page-head">
        <h1>Ask</h1>
        <p className="lead">Answers stream in, grounded in the documents you&apos;re authorized to see, with sources.</p>
      </div>

      <Panel>
        <form className="row" style={{ flexWrap: "nowrap" }}
          onSubmit={(e) => { e.preventDefault(); if (query.trim() && !loading) run(query.trim()); }}>
          <Input autoFocus className="grow" placeholder="e.g. How many annual leave days do employees get?"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="primary" loading={loading} disabled={!query.trim()}>
            <Icon name="ask" size={16} /> Ask
          </Button>
        </form>
      </Panel>

      {!hasResult && !loading && (
        <div style={{ marginTop: 24 }}>
          <EmptyState glyph="✦" title="Ask about your company knowledge">
            Upload documents or connect a source, then ask a question to get a cited answer.
          </EmptyState>
        </div>
      )}

      {state.error && <div className="danger-panel" style={{ marginTop: 16 }}>{state.error}</div>}

      {state.blocked && (
        <motion.div className="danger-panel" style={{ marginTop: 16 }}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><RiskBadge risk="BLOCK" /></div>
          <strong>This request was blocked by the security policy.</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{state.blocked}</p>
        </motion.div>
      )}

      {(state.answer || (loading && !state.blocked && !state.error)) && (
        <Panel style={{ marginTop: 16 }} className="stack">
          <div className="cluster">
            {state.risk && <RiskBadge risk={state.risk} />}
            {state.model && <Badge>model: {state.model}</Badge>}
            {state.done && <Badge>{state.citations.length} {state.citations.length === 1 ? "source" : "sources"}</Badge>}
            {loading && !state.done && <Badge tone="primary"><span className="spinner" /></Badge>}
          </div>
          <div style={{ lineHeight: 1.7 }}>
            <Markdown text={state.answer} />
            {loading && !state.done && <span className="caret" />}
          </div>

          {state.done && state.citations.length > 0 && (
            <>
              <hr className="divider" />
              <div className="eyebrow">Sources</div>
              <div className="cluster">
                {state.citations.map((c, i) => (
                  <motion.span key={i} className="badge"
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.04 * i }}>
                    <Icon name="file" size={13} /> {c.title}
                  </motion.span>
                ))}
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
