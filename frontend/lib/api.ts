// Typed fetch wrapper. JWT kept in localStorage for the MVP (move to httpOnly cookie later).
const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setToken(token: string) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type AuditRow = {
  id: string;
  event_type: string;
  user_id: string | null;
  query_hash: string | null;
  document_ids: string[];
  authz_decision: string | null;
  security_risk: string | null;
  model_used: string | null;
  response_status: string | null;
  created_at: string;
};

export function getAudit(limit = 100) {
  return request<AuditRow[]>(`/admin/audit?limit=${limit}`, { method: "GET" });
}

export function createUser(body: { email: string; password: string; role: string }) {
  return request<{ id: string; email: string; role: string }>("/auth/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function register(body: {
  tenant_name: string;
  tenant_slug: string;
  admin_email: string;
  admin_password: string;
}) {
  return request<{ access_token: string; role: string; tenant_id: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function login(email: string, password: string) {
  // OAuth2 password form
  const body = new URLSearchParams({ username: email, password });
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Invalid credentials");
  return res.json() as Promise<{ access_token: string; role: string; tenant_id: string }>;
}

export type Me = {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
};

export function getMe() {
  return request<Me>("/auth/me", { method: "GET" });
}

export function getHealth() {
  return request<{ status: string; embedding_provider: string; llm_provider: string }>("/health", {
    method: "GET",
  });
}

export function updateProfile(body: { email?: string; password?: string }) {
  return request<Me>("/auth/me", { method: "PATCH", body: JSON.stringify(body) });
}

export type Citation = {
  document_id: string;
  title: string;
  section: string;
  score: number;
  snippet: string;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
  security_risk: string;
  model_used: string;
  conversation_id: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function chat(query: string, conversationId?: string | null) {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ query, conversation_id: conversationId ?? null }),
  });
}

export type StreamHandlers = {
  onConversation?: (e: { conversation_id: string; title: string }) => void;
  onMeta?: (e: { model_used: string; security_risk: string }) => void;
  onToken?: (text: string) => void;
  onDone?: (e: { answer?: string; citations: Citation[]; security_risk: string; model_used: string }) => void;
  onBlocked?: (detail: string) => void;
  onError?: (detail: string) => void;
};

// Consume the SSE stream from POST /chat/stream (EventSource can't POST, so we read the body).
// Pass conversationId to continue an existing thread; omit it to start a new one (the server
// returns the new id via the `conversation` event).
export async function chatStream(
  query: string,
  conversationId: string | null,
  h: StreamHandlers
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, conversation_id: conversationId ?? null }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === "conversation") h.onConversation?.(ev);
      else if (ev.type === "meta") h.onMeta?.(ev);
      else if (ev.type === "token") h.onToken?.(ev.text);
      else if (ev.type === "done") h.onDone?.(ev);
      else if (ev.type === "blocked") h.onBlocked?.(ev.detail);
      else if (ev.type === "error") h.onError?.(ev.detail);
    }
  }
}

// ---- Conversations (saved chat history) ----
export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  security_risk: string | null;
  model_used: string | null;
  created_at: string;
};

export type ConversationDetail = Conversation & { messages: ConversationMessage[] };

export function listConversations() {
  return request<Conversation[]>("/conversations", { method: "GET" });
}

export function getConversation(id: string) {
  return request<ConversationDetail>(`/conversations/${id}`, { method: "GET" });
}

export function renameConversation(id: string, title: string) {
  return request<Conversation>(`/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: string) {
  return request<{ deleted: boolean; conversation_id: string }>(`/conversations/${id}`, {
    method: "DELETE",
  });
}

export type UserRow = {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

export function listUsers() {
  return request<UserRow[]>("/auth/users", { method: "GET" });
}

export function deleteUser(userId: string) {
  return request<{ deleted: boolean; user_id: string }>(`/auth/users/${userId}`, {
    method: "DELETE",
  });
}

export function ingestText(title: string, content: string, allowed_roles: string[]) {
  return request("/documents/text", {
    method: "POST",
    body: JSON.stringify({ title, content, allowed_roles }),
  });
}

export type DocumentOut = {
  id: string;
  title: string;
  status: string;
  chunk_count: number;
  allowed_roles: string[];
  created_at: string;
};

// Upload a local file via multipart/form-data. Don't set Content-Type — the browser
// sets the multipart boundary automatically.
export async function uploadFile(file: File, allowed_roles: string[]): Promise<DocumentOut> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  form.append("allowed_roles", allowed_roles.join(","));
  const res = await fetch(`${BASE}/documents/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<DocumentOut>;
}

export function listDocuments() {
  return request<DocumentOut[]>("/documents", { method: "GET" });
}

export function setDocumentPermissions(docId: string, allowed_roles: string[]) {
  return request<DocumentOut>(`/documents/${docId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ allowed_roles }),
  });
}

export function deleteDocument(docId: string) {
  return request<{ deleted: boolean; document_id: string }>(`/documents/${docId}`, {
    method: "DELETE",
  });
}

// ---- Connectors ----
export const CONNECTOR_KINDS = [
  "gdrive",
  "onedrive",
  "sharepoint",
  "confluence",
  "slack",
] as const;

export type Connector = {
  id: string;
  kind: string;
  display_name: string;
  status: string;
};

export function listConnectors() {
  return request<Connector[]>("/connectors", { method: "GET" });
}

export function registerConnector(kind: string, display_name: string, config: object = {}) {
  return request<{ id: string; kind: string; status: string }>("/connectors", {
    method: "POST",
    body: JSON.stringify({ kind, display_name, config }),
  });
}

export function connectConnector(sourceId: string) {
  // auth_config is resolved server-side per toolkit; no client input needed.
  return request<{ connection_id: string; redirect_url: string; status: string }>(
    `/connectors/${sourceId}/connect`,
    { method: "POST", body: "{}" }
  );
}

export function connectorStatus(sourceId: string) {
  return request<{ connected: boolean; accounts: unknown[] }>(
    `/connectors/${sourceId}/status`,
    { method: "GET" }
  );
}

export type ConnectorFile = {
  external_id: string;
  title: string;
  mime_type: string;
};

export function listConnectorFiles(sourceId: string, q?: string) {
  const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return request<ConnectorFile[]>(`/connectors/${sourceId}/files${qs}`, { method: "GET" });
}

export function ingestSelected(
  sourceId: string,
  external_ids: string[],
  allowed_roles: string[]
) {
  return request<{ ingested: number; document_ids: string[] }>(
    `/connectors/${sourceId}/ingest`,
    { method: "POST", body: JSON.stringify({ external_ids, allowed_roles }) }
  );
}

export function updateConnector(sourceId: string, config: object) {
  return request<{ id: string; config: object; status: string }>(
    `/connectors/${sourceId}`,
    { method: "PATCH", body: JSON.stringify({ config }) }
  );
}

export function deleteConnector(sourceId: string) {
  return request<{ deleted: boolean; documents_removed: number }>(
    `/connectors/${sourceId}`,
    { method: "DELETE" }
  );
}

export function syncConnector(sourceId: string) {
  return request<{ ingested: number; document_ids: string[] }>(
    `/connectors/${sourceId}/sync`,
    { method: "POST" }
  );
}
