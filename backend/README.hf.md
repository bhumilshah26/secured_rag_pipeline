---
title: Aegis Backend
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Aegis — Secured Enterprise RAG (backend)

FastAPI backend for the Aegis secure multi-tenant RAG platform. This directory is the
source of truth for the Hugging Face Space; its **contents** are published at the Space
repo root, so `Dockerfile` and this `README.md` must stay at this level.

The Space builds the root `Dockerfile`, runs as uid 1000, and serves uvicorn on **7860**
(matching `app_port` above). `GET /` is the health endpoint and answers as soon as the
process starts; it reports whether the database and vector-store bootstrap succeeded:

```json
{ "status": "ok", "bootstrap": { "database": "ready", "vector_store": "ready" }, ... }
```

If a bootstrap step says `failed: ...`, the Space is up and the message names the cause.

## Space settings

Set these under **Settings → Variables and secrets**. Anything omitted falls back to the
defaults in `app/config.py`, which point at `localhost` and will not resolve here.

| Key | Notes |
|---|---|
| `APP_ENV` | `production` |
| `SECRET_KEY` | JWT signing key (secret) |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | hosted Postgres |
| `POSTGRES_SSLMODE` | `require` for Neon / Supabase / RDS |
| `QDRANT_URL` / `QDRANT_API_KEY` | Qdrant Cloud endpoint |
| `CORS_ALLOW_ORIGINS` | comma-separated frontend origins; required once `APP_ENV=production` |
| `LLM_PROVIDER` + `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | defaults to `echo` |
| `MAIL_PROVIDER` | leave unset (`auto`); see below |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `SMTP_FROM` | 2FA code delivery |
| `COMPOSIO_API_KEY`, `COMPOSIO_AUTHCONFIG_*` | connector OAuth |

## Mail (2FA codes)

Spaces block outbound SMTP ports (25/465/587), so SMTP fails here with
`OSError: [Errno 101] Network is unreachable`. Pick one of:

- **Gmail API** (recommended) — sends from your own Gmail to **any** recipient over HTTPS
  on 443, with no domain to verify. Run `scripts/gmail_refresh_token.py` once locally,
  then set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
  `SMTP_FROM` to the Gmail address you authorised. `MAIL_PROVIDER=auto` selects it as soon
  as the refresh token is present. Free Gmail allows roughly 500 messages a day.
- **`RESEND_API_KEY`** — also HTTPS on 443, but with no verified domain Resend only accepts
  `onboarding@resend.dev` as the sender and only delivers to your own account address, so
  a second test user never receives a code.
- **`MAIL_PROVIDER=console`** — writes the code to the Space logs instead of sending it.
  Fine for a demo; anyone who can read the logs can sign in.
- **`OTP_ENABLED=false`** — skips the second factor entirely, so `/auth/login` and
  `/auth/register` return a token directly. Password auth still applies.

`GET /` reports `mail_provider` (what `auto` resolved to) and `otp_enabled`, so you can
confirm the Space picked up the change. When a code cannot be delivered, `/auth/login`
returns **503** and the reason goes to the logs, rather than a 500.

## Registration

`POST /auth/register` holds the signup in `pending_registrations` and emails a code; the
tenant and its first ADMIN are created only when `POST /auth/verify-otp` succeeds with
`purpose=register`. An abandoned signup therefore never claims a slug.

## Schema changes

`init_db()` runs `create_all`, which adds missing **tables** on boot but never alters an
existing type. Adding a role means an explicit migration against the live database:

```sql
ALTER TYPE role ADD VALUE IF NOT EXISTS 'DEVELOPER';
```

`FASTEMBED_MODEL` is baked into the image at build time (`BAAI/bge-large-en-v1.5`).
Overriding it at runtime forces a ~1 GB download on first use; change the `FASTEMBED_MODEL`
build arg instead, and note that a different dimension recreates the Qdrant collection and
drops existing vectors.
