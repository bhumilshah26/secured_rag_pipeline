"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { chatStream } from "@/lib/api";
import { useChat, type ChatMessage } from "@/app/components/AskStore";
import { Badge, Button, EmptyState, Input, RiskBadge } from "@/app/components/ui";
import { Icon } from "@/app/components/icons";
import { Markdown } from "@/app/components/Markdown";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

export default function AskPage() {
  const {
    messages,
    setMessages,
    currentId,
    setCurrentId,
    newChat,
    refreshConversations,
    loadingConvo,
  } = useChat();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [paneOpen, setPaneOpen] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  // Restore the sidebar open/closed preference.
  useEffect(() => {
    try {
      if (localStorage.getItem("aegis.chat.pane") === "0") setPaneOpen(false);
    } catch {
      /* ignore */
    }
  }, []);

  const togglePane = () => {
    setPaneOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("aegis.chat.pane", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Auto-run a question handed over from the top-bar mini-ask (?q=…), once.
  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      window.history.replaceState(null, "", window.location.pathname);
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the latest message in view as it streams.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    setQuery("");
    setLoading(true);
    const wasNew = !currentId;

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
    const answerId = uid();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: answerId, role: "assistant", content: "", streaming: true },
    ]);

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === answerId ? fn(m) : m)));

    try {
      // Server is the source of truth for history: it loads prior turns for this
      // conversation, so we only send the conversation id (null = start a new one).
      await chatStream(text, currentId, {
        onConversation: (e) => {
          if (wasNew) setCurrentId(e.conversation_id);
        },
        onMeta: (e) => patch((m) => ({ ...m, model: e.model_used, risk: e.security_risk })),
        onToken: (t) => patch((m) => ({ ...m, content: m.content + t })),
        onBlocked: (d) => patch((m) => ({ ...m, blocked: d, streaming: false })),
        onError: (d) => patch((m) => ({ ...m, error: d, streaming: false })),
        onDone: (e) =>
          patch((m) => ({
            ...m,
            content: e.answer ?? m.content,
            citations: e.citations,
            risk: e.security_risk,
            model: e.model_used,
            streaming: false,
          })),
      });
    } catch (err) {
      patch((m) => ({ ...m, error: (err as Error).message, streaming: false }));
    } finally {
      setLoading(false);
      // Refresh the sidebar so a new thread appears (with its title) and existing
      // threads re-sort by latest activity.
      void refreshConversations();
    }
  }

  return (
    <div className="chat-layout">
      {paneOpen && <ConvoPane disabled={loading} />}

      <div className="chat">
        <div className="chat-head">
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <button
              className="pane-toggle"
              onClick={togglePane}
              title={paneOpen ? "Hide conversations" : "Show conversations"}
              aria-label={paneOpen ? "Hide conversations" : "Show conversations"}
              aria-pressed={paneOpen}
            >
              <Icon name="menu" size={18} />
            </button>
            <div>
              <h1>Ask</h1>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                A conversation grounded in the documents you&apos;re authorized to see. Follow-ups
                keep their context.
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" onClick={newChat} disabled={loading}>
              <Icon name="plus" size={15} /> New chat
            </Button>
          )}
        </div>

        <div className="chat-thread" ref={threadRef}>
          {loadingConvo ? (
            <EmptyState glyph="…" title="Loading conversation">
              Fetching your saved messages.
            </EmptyState>
          ) : messages.length === 0 ? (
            <EmptyState glyph="✦" title="Ask about your company knowledge">
              Upload documents or connect a source, then start a conversation. The assistant
              remembers earlier turns, so you can ask follow-ups naturally.
            </EmptyState>
          ) : (
            messages.map((m) => <ChatRow key={m.id} m={m} />)
          )}
        </div>

        <form
          className="chat-composer row"
          style={{ flexWrap: "nowrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            void send(query);
          }}
        >
          <Input
            autoFocus
            className="grow"
            placeholder="Ask a question, or a follow-up…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={loading} disabled={!query.trim()}>
            <Icon name="ask" size={16} /> Send
          </Button>
        </form>
      </div>
    </div>
  );
}

function ConvoPane({ disabled }: { disabled: boolean }) {
  const { conversations, currentId, selectConversation, newChat, removeConversation, renameConv } =
    useChat();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setEditingId(null);
    const original = conversations.find((c) => c.id === id)?.title;
    if (title && title !== original) {
      try {
        await renameConv(id, title);
      } catch {
        /* keep the old title on failure */
      }
    }
  };

  return (
    <aside className="convo-pane">
      <button className="convo-new" onClick={newChat} disabled={disabled}>
        <Icon name="plus" size={16} /> New chat
      </button>

      <div className="convo-list">
        {conversations.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, padding: "8px 10px" }}>
            No saved conversations yet.
          </p>
        ) : (
          conversations.map((c) => {
            const editing = editingId === c.id;
            return (
              <div
                key={c.id}
                className={`convo-item ${c.id === currentId ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => !disabled && !editing && void selectConversation(c.id)}
                onDoubleClick={() => startRename(c.id, c.title)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !disabled && !editing) {
                    e.preventDefault();
                    void selectConversation(c.id);
                  }
                }}
              >
                {editing ? (
                  <input
                    className="convo-rename"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => void commitRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitRename(c.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <span className="convo-title" title={c.title}>
                      {c.title}
                    </span>
                    <button
                      className="convo-act"
                      title="Rename"
                      aria-label="Rename conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(c.id, c.title);
                      }}
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      className="convo-act convo-del"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this conversation?")) void removeConversation(c.id);
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function ChatRow({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <motion.div
      className={`chat-row ${isUser ? "user" : "assistant"}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span className="chat-avatar">
        <Icon name={isUser ? "user" : "shield"} size={16} />
      </span>
      <div className="chat-bubble">
        {!isUser && (m.risk || m.model) && (
          <div className="cluster chat-meta">
            {m.risk && <RiskBadge risk={m.risk} />}
            {m.model && <Badge>model: {m.model}</Badge>}
            {m.streaming && (
              <Badge tone="primary">
                <span className="spinner" />
              </Badge>
            )}
          </div>
        )}

        {m.blocked ? (
          <div>
            <div className="cluster" style={{ marginBottom: 6 }}>
              <RiskBadge risk="BLOCK" />
            </div>
            <strong>This request was blocked by the security policy.</strong>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{m.blocked}</p>
          </div>
        ) : m.error ? (
          <span style={{ color: "var(--danger)" }}>{m.error}</span>
        ) : isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
        ) : (
          <div style={{ lineHeight: 1.7 }}>
            <Markdown text={m.content} />
            {m.streaming && <span className="caret" />}
          </div>
        )}

        {!isUser && !m.streaming && m.citations && m.citations.length > 0 && (
          <>
            <hr className="divider" />
            <div className="eyebrow">Sources</div>
            <div className="cluster">
              {m.citations.map((c, i) => (
                <motion.span
                  key={i}
                  className="badge"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.04 * i }}
                >
                  <Icon name="file" size={13} /> {c.title}
                </motion.span>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
