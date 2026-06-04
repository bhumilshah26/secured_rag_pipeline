# UI Plan — Information Architecture & Page Layouts

Plan-first deliverable. Defines every page, its layout, the features on it, and the exact
backend endpoint each feature calls. Frontend-only; no backend changes implied. Pages map 1:1
to what the API already supports today (no invented capabilities), with a couple of clearly
flagged "needs a tiny backend addition" notes.

## Backend surface (source of truth for features)

```
auth:        POST /auth/register · POST /auth/login · GET /auth/me · PATCH /auth/me
             POST /auth/users (ADMIN)
documents:   POST /documents/text · POST /documents/upload · GET /documents (role-scoped)
             PUT /documents/{id}/permissions · DELETE /documents/{id}
connectors:  POST /connectors · GET /connectors · PATCH /connectors/{id} · DELETE /connectors/{id}
             POST /connectors/{id}/connect · GET /connectors/{id}/status
             GET /connectors/{id}/files?q= · POST /connectors/{id}/ingest · POST /connectors/{id}/sync
chat:        POST /chat
admin:       GET /admin/audit (ADMIN)
meta:        GET /health
```

Roles & capabilities (drives nav + control visibility):

| Capability        | ADMIN | HR | MANAGER | ANALYST | VIEWER |
|-------------------|:--:|:--:|:--:|:--:|:--:|
| query / chat      | ✅ | ✅ | ✅ | ✅ | ✅ |
| ingest documents  | ✅ | ✅ | ✅ | ❌ | ❌ |
| set permissions   | ✅ | ✅ | ✅ | ❌ | ❌ |
| connect sources   | ✅ | ✅ | ✅ | ❌ | ❌ |
| read audit        | ✅ | ❌ | ❌ | ❌ | ❌ |
| manage users      | ✅ | ❌ | ❌ | ❌ | ❌ |

## App shell (authenticated)

```
┌────────────────────────────────────────────────────────────────────┐
│ TOPBAR: ⛨ Acme Corp        [ Ask anything…  ⌘K ]      ☾  ◌ B ▾       │
├──────────┬─────────────────────────────────────────────────────────┤
│ SIDEBAR  │                                                          │
│  ◆ Overview                  CONTENT REGION                          │
│  ✦ Ask                       (max-width reading col for answers,     │
│  ▤ Knowledge                  full-width for tables)                 │
│  ⇄ Connectors                                                        │
│  ⏞ Audit        (ADMIN)                                              │
│  �people Team    (ADMIN)                                              │
│  ⚙ Settings                                                          │
│  ───────                                                             │
│  role badge: VIEWER                                                  │
└──────────┴─────────────────────────────────────────────────────────┘
```

- Sidebar items render **only if the role has the capability** (Audit/Team are ADMIN-only;
  Connectors hidden for Analyst/Viewer). Active item = Teal left indicator + Teal text.
- Topbar: tenant name (from `/auth/me` tenant), global Ask box (routes to Ask with prefilled
  query / `⌘K` command palette later), **theme toggle**, **profile menu** (email + role,
  Settings, Logout — already built, restyled).
- Collapses to icon-rail < 1024px, off-canvas drawer < 768px.

---

## Pages

### 1. Login  `/login`  (public)
Centered editorial card on Sand canvas; serif display title, brand mark.
- **Features:** email + password → `POST /auth/login`; on success store JWT, route to Overview.
  Link to "Create an organization".
- **States:** idle / submitting (button spinner) / error toast (invalid creds) / disabled
  until fields filled.

### 2. Create organization  `/register`  (public)
Bootstraps a tenant + first ADMIN (today only possible via API — this gives it a UI).
- **Features:** tenant name, slug, admin email, password → `POST /auth/register`; auto-login.
- **States:** slug-taken (409) inline error; password rules hint; submitting.

### 3. Overview (home)  `/overview`  (all roles; default post-login)
A calm operational summary, **not** the hero-metric template. A short "what's here" header +
a compact 2-column panel set sized to the role.
- **Panels:**
  - *Knowledge at a glance* — count + recent indexed docs (`GET /documents`), quick links to
    Ask / upload.
  - *Connected sources* — source chips with status (`GET /connectors`) — ingest roles only.
  - *Security snapshot* (ADMIN) — recent `BLOCK`/`FLAG` events + counts (`GET /admin/audit`),
    link to Audit. Non-admins see a "your access" panel (role + what they can see) instead.
  - *Ask shortcut* — inline question box → Ask.
- **States:** skeleton panels on load; empty states ("No documents yet — upload one") that
  teach the next action.

### 4. Ask (chat)  `/ask`  (query capability — all)
Primary workspace. Reading-calm single column.
```
  Question ▸ [ input ......................................... ] (Ask)
  ── answer ─────────────────────────────────────────────────
  [ALLOW ✓]  [model: claude-sonnet-4-6]  [3 sources]
  Grounded answer text, well-set, 65–75ch …
  ── Sources ───────────────────────────────────────────────
  • Leave Policy  ›  Eligibility        score 0.71   snippet…
  • Handbook      ›  Remote work         score 0.66   snippet…
```
- **Features:** `POST /chat` → `{answer, citations[], security_risk, model_used}`. Risk badge
  (ALLOW/FLAG/BLOCK with label+icon), model badge, source count. Citations as `Title › Section`
  + score + snippet, click to expand. **Blocked** queries render a distinct danger state
  ("Blocked by security policy") instead of an answer. Recent questions list (client-side).
- **States:** thinking (skeleton answer + shimmer), empty ("Ask about your company knowledge"),
  blocked (danger panel), no-results ("Nothing you're authorized to read matches").

### 5. Knowledge (documents)  `/knowledge`  (all; controls gated by capability)
Role-scoped library + ingestion. Table for density.
```
  [ Upload file ▾ ]  [ Paste text ]            search [ ....... ]
  ┌ Title ───────────────── Source ── Chunks ─ Status ─ Roles ───── ⋯ ┐
  │ Leave Policy            upload     12      indexed  ADMIN,HR…     ⋯ │
  │ Q3 Report.pdf           gdrive      40     indexed  ADMIN,MANAGER ⋯ │
```
- **Features:**
  - List (role-scoped) → `GET /documents`. Client search/filter by title/status/role.
  - Upload (PDF/DOCX/XLSX/img/txt) with **role chips** for allowed_roles → `POST /documents/upload`.
  - Paste text doc → `POST /documents/text`.
  - Row menu: **Set permissions** (role chips → `PUT /documents/{id}/permissions`), **Delete**
    (confirm → `DELETE /documents/{id}`, removes embeddings too).
  - Status pill: pending / indexed / failed.
  - Upload/ingest controls hidden for Analyst/Viewer (read-only list).
- **States:** skeleton rows, empty ("No documents you can access yet"), upload progress, OCR
  note for scanned files, per-row delete confirm.

### 6. Connectors  `/connectors`  (connect_source capability)
List of sources as a responsive grid of **panels** (not identical cards — status-driven).
- **Features:** register source (kind select + name) → `POST /connectors`; list → `GET /connectors`;
  per-source: **Connect** (OAuth redirect) → `POST /connectors/{id}/connect`, **Check status**
  → `GET /connectors/{id}/status`, **Delete** → `DELETE /connectors/{id}`, **Advanced config**
  (JSON) → `PATCH /connectors/{id}`. Status badge (registered / connecting / connected).
- Toolkit identity: icon + label per kind (Drive/OneDrive/SharePoint/Confluence/Slack).

### 6b. Connector detail / browse  `/connectors/[id]`  (or expandable panel)
The search-to-index surface.
```
  ← My Drive (Google Drive)   [connected ✓]                 [Delete]
  search files [ resume ............................ ] (Search)
  ☑ Owais_Resume.pdf      application/pdf
  ☐ Q3 plan.docx          …wordprocessingml
  roles to grant: [ADMIN]·[HR]·[MANAGER]·[ANALYST]·[VIEWER]
  [ Index selected (1) ]                         [ Sync all ]
```
- **Features:** search/list → `GET /connectors/{id}/files?q=`; multi-select + role chips →
  `POST /connectors/{id}/ingest`; ingest-all → `POST /connectors/{id}/sync`.
- **States:** not-connected (prompt to Connect), searching skeleton, empty results, indexing
  progress, error surfacing Composio messages (e.g. scope/Access-denied) verbatim but framed.

### 7. Audit log  `/audit`  (ADMIN only)
Dense, filterable security table — the trust surface.
```
  filters: [event ▾] [decision ▾] [risk ▾]   range [ ▾ ]
  ┌ Time ── Event ───── User ── Risk ──── Docs ─ Model ─ Status ┐
  │ 12:04  chat.blocked  u_91…  BLOCK:100  —      —      403     │
  │ 12:03  chat.query    u_91…  ALLOW:0    2 ids  claude  200    │
```
- **Features:** `GET /admin/audit?limit=` table. Columns: time, event_type, user_id,
  query_hash (mono, truncated, copy), document_ids (count → popover of ids), authz_decision,
  security_risk (badge), model_used, response_status. Client filters. Detail drawer per row.
  Explicitly communicates **no raw query/content stored** (hash + ids only) — a small "why"
  affordance reinforcing the privacy design.
- **States:** skeleton table, empty ("No events yet"), filter-no-match.

### 8. Team & roles  `/team`  (ADMIN only)
- **Features:** invite/create user (email, password, role) → `POST /auth/users`. Role
  reference table (capability matrix). *Note:* listing existing users needs a new
  `GET /auth/users` endpoint — flagged as a small backend follow-up; until then the page
  shows the create form + capability matrix only (no fabricated list).
- **States:** created toast, email-exists (409) inline.

### 9. Settings  `/settings`  (all)
Tabbed: **Profile · Appearance · Security**.
- **Profile:** email + password → `PATCH /auth/me` (read `GET /auth/me`).
- **Appearance:** theme toggle (light/dark/system), density (comfortable/compact) — client only.
- **Security/About:** tenant id (mono, copy), role, `GET /health` provider info (embedding/LLM).
- **States:** saved toast, validation, "no changes" guard.

### 10. System states (cross-cutting)
- **403 / Not authorized** page (role lacks capability or hits a gated route).
- **404** page. **Global error boundary**. **Offline / API-unreachable** banner (health check).
- Consistent **toast** for success/error, **skeletons** for loading, **empty states** per page.

---

## Build order (when approved)

1. **Foundation** — `globals.css` tokens (light+dark, OKLCH), fonts, theme provider (no flash),
   primitives (Button/Input/Select/Badge/Chip/Panel/Table/Toast/Skeleton/Dialog), app shell
   (Sidebar + Topbar, role-aware nav).
2. **Auth** — Login, Register (public, no shell).
3. **Ask** — chat workspace (highest-value daily surface).
4. **Knowledge** — documents table + upload/permissions/delete.
5. **Connectors** + detail/browse (search-to-index).
6. **Audit** + **Team** (admin).
7. **Overview** + **Settings** + system states.
8. **Polish/animate pass** + `audit`/`critique` via the skill.

All routes are App-Router pages under `frontend/app/`; shared UI under `frontend/app/components/`
and `frontend/app/(ui)/` primitives; API calls extend `frontend/lib/api.ts` (already typed).
