// Mirrors backend app/security/rbac.py capabilities (frontend gating only; server still enforces).
export type Role = "ADMIN" | "HR" | "ANALYST" | "MANAGER" | "VIEWER";
export const ALL_ROLES: Role[] = ["ADMIN", "HR", "ANALYST", "MANAGER", "VIEWER"];

export type Capability =
  | "query" | "ingest" | "set_permissions" | "connect_source" | "read_audit" | "manage_tenant";

const CAPS: Record<Capability, Role[]> = {
  query: ["ADMIN", "HR", "ANALYST", "MANAGER", "VIEWER"],
  ingest: ["ADMIN", "HR", "MANAGER"],
  set_permissions: ["ADMIN", "HR", "MANAGER"],
  connect_source: ["ADMIN", "HR", "MANAGER"],
  read_audit: ["ADMIN"],
  manage_tenant: ["ADMIN"],
};

export function can(role: string | undefined, cap: Capability): boolean {
  if (!role) return false;
  if (role === "ADMIN") return true;
  return CAPS[cap].includes(role as Role);
}

export const CAPABILITY_MATRIX: { cap: string; roles: Role[] }[] = [
  { cap: "Query / chat", roles: CAPS.query },
  { cap: "Ingest documents", roles: CAPS.ingest },
  { cap: "Set permissions", roles: CAPS.set_permissions },
  { cap: "Connect sources", roles: CAPS.connect_source },
  { cap: "Read audit log", roles: CAPS.read_audit },
  { cap: "Manage users", roles: CAPS.manage_tenant },
];
