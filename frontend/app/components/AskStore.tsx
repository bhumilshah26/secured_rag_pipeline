"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  type Citation,
  type Conversation,
} from "@/lib/api";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  citations?: Citation[];
  risk?: string;
  model?: string;
  blocked?: string | null;
  error?: string;
  streaming?: boolean;
};

// Remembers which conversation the user was last viewing, so a reload reopens it.
const ACTIVE_KEY = "aegis.chat.active.v2";

type AskContext = {
  conversations: Conversation[];
  currentId: string | null;
  messages: ChatMessage[];
  loadingConvo: boolean;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setCurrentId: (id: string | null) => void;
  newChat: () => void;
  selectConversation: (id: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  renameConv: (id: string, title: string) => Promise<void>;
};

const Ctx = createContext<AskContext | null>(null);

// Lives in the (app) layout so the active conversation survives navigation between pages.
// Conversations themselves are persisted server-side (source of truth); we only keep the
// id of the active thread in localStorage to reopen it on reload.
export function AskProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConvo, setLoadingConvo] = useState(false);

  const setCurrentId = (id: string | null) => {
    setCurrentIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* private mode — non-fatal */
    }
  };

  const refreshConversations = async () => {
    try {
      setConversations(await listConversations());
    } catch {
      /* unauthenticated or offline — leave list as-is */
    }
  };

  const selectConversation = async (id: string) => {
    setCurrentId(id);
    setLoadingConvo(true);
    try {
      const detail = await getConversation(id);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          risk: m.security_risk ?? undefined,
          model: m.model_used ?? undefined,
        }))
      );
    } catch {
      // Conversation gone (e.g. deleted elsewhere) — fall back to a fresh thread.
      setMessages([]);
      setCurrentId(null);
    } finally {
      setLoadingConvo(false);
    }
  };

  const newChat = () => {
    setCurrentId(null);
    setMessages([]);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === currentId) newChat();
  };

  const renameConv = async (id: string, title: string) => {
    const updated = await renameConversation(id, title);
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  };

  // On mount: load the list and reopen the last active conversation if one is stored.
  useEffect(() => {
    void refreshConversations();
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    if (stored) void selectConversation(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider
      value={{
        conversations,
        currentId,
        messages,
        loadingConvo,
        setMessages,
        setCurrentId,
        newChat,
        selectConversation,
        refreshConversations,
        removeConversation,
        renameConv,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat must be used within AskProvider");
  return ctx;
}
