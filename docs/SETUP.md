# AJAWAI Demo Monorepo Setup

This repository contains:

- `/pwa`: Vite + React + TypeScript installable PWA
- `/relay`: Fastify + TypeScript relay for Gmail send and webhook ingestion
- `/shared`: shared TypeScript types + zod schemas

Module 3 adds a local-first AI operating system with:

- Secretary Phi (local model in browser)
- Manager Pico Claw (task/approval/orchestration engine)
- IndexedDB local schema + optional Supabase sync

## Prerequisites

- Node.js 20+
- npm 10+

## Install

From repo root:

```bash
npm install
```

## Development

### Run PWA only

```bash
npm run dev:pwa
```

PWA default URL: `http://localhost:5173`

### Run Relay only

```bash
npm run dev:relay
```

Relay default URL: `http://localhost:8787`

### Run both

```bash
npm run dev
```

## Relay environment variables

Set these in your shell or `.env` before starting relay:

```bash
PORT=8787
HOST=0.0.0.0

# Optional Gmail OAuth for live send
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_REDIRECT_URI=
GMAIL_SENDER=sender@example.com
```

If Gmail OAuth variables are missing, `/send/email` returns a successful **stub** response for local demo usage.

For OAuth connect URL endpoint (`/gmail/connect-url`), set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

## PWA environment variables

Optional:

```bash
VITE_RELAY_BASE_URL=http://localhost:8787
```

Without this, the PWA defaults to `http://localhost:8787`.

## Relay API

### `GET /health`

Health check:

```bash
curl http://localhost:8787/health
```

### `POST /send/email`

Send email through Gmail (or stub response if OAuth env is missing):

```bash
curl -X POST http://localhost:8787/send/email \
  -H "content-type: application/json" \
  -d '{
    "to": "demo@example.com",
    "subject": "AJAWAI test",
    "body": "Hello from AJAWAI relay"
  }'
```

### `POST /webhook/gmail`

Receives Gmail webhook events:

```bash
curl -X POST http://localhost:8787/webhook/gmail \
  -H "content-type: application/json" \
  -d '{"message":{"messageId":"123"},"subscription":"gmail-sub"}'
```

### `GET /gmail/status`

Returns whether relay has active Gmail credential configuration.

### `GET /gmail/connect-url`

Returns a generated OAuth URL when Google OAuth env vars are configured.

## Useful scripts

From repo root:

- `npm run dev:pwa`
- `npm run dev:relay`
- `npm run dev`
- `npm run typecheck`
- `npm run build`

## Notes

- PWA is mobile-first and installable (service worker + web manifest via `vite-plugin-pwa`).
- Secretary Phi runs locally in-browser (Transformers.js WebGPU/WASM path + fallback parser).
- Core app functionality is local-first and available offline except Gmail sending.
- IndexedDB stores profiles, projects, tasks, contacts, notes, approvals, timeline, memory, and agent messages.
- Supabase sync is optional and uses last-write-wins (`updated_at`).
- Supabase Module 3 table SQL is in `docs/supabase/module3_schema.sql`.
