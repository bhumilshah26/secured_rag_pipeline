"use client";
import { createContext, useContext, useState } from "react";
import type { Citation } from "@/lib/api";

export type AskState = {
  query: string;
  answer: string;
  citations: Citation[];
  risk: string;
  model: string;
  blocked: string | null;
  error: string;
  done: boolean;
};

const EMPTY: AskState = { query: "", answer: "", citations: [], risk: "", model: "", blocked: null, error: "", done: false };

const Ctx = createContext<{
  state: AskState;
  setState: React.Dispatch<React.SetStateAction<AskState>>;
} | null>(null);

// Lives in the (app) layout so the last question + answer survive navigation between pages.
export function AskProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AskState>(EMPTY);
  return <Ctx.Provider value={{ state, setState }}>{children}</Ctx.Provider>;
}

export function useAsk() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAsk must be used within AskProvider");
  return ctx;
}

export const EMPTY_ASK = EMPTY;
