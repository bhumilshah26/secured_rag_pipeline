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
};

export function chat(query: string) {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ query }),
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
