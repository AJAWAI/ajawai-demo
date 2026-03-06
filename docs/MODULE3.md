# AJAWAI Module 3 (Local-First AI OS)

Module 3 introduces a local-first operating system with two internal agents:

- **Secretary Phi** (primary conversational AI, President-facing)
- **Manager Pico Claw** (workflow execution and orchestration engine)

## Local-first architecture

- Core features run from IndexedDB using Dexie.
- Secretary Phi runs in-browser through local inference:
  - `@huggingface/transformers` with WebGPU, fallback to WASM.
  - deterministic fallback parser if model load is unavailable.
- Supabase is used for:
  - authentication
  - optional sync (last-write-wins by `updated_at`)
- Relay handles online integrations (Gmail sending).

## Agent interaction model

President -> Secretary Phi -> Manager Pico Claw -> tools/workflows

The President never interacts with Pico directly.

## Manager Pico Claw engines

- Task Engine
- Approval Engine
- Gmail Connector
- Timeline Logger
- Memory Manager

## Gmail flow

1. President requests email action.
2. Secretary Phi drafts + structures intent.
3. Pico creates approval request (`send_email`).
4. President approves.
5. Pico calls relay `/send/email`.
6. Timeline records completion.

## Local schema (IndexedDB)

Tables:

- `profiles`
- `projects`
- `tasks`
- `contacts`
- `notes`
- `approvals`
- `timeline`
- `memory`
- `messages`
- `settings`

See `pwa/src/storage/db.ts` for concrete local schema.

## Supabase schema

Use SQL in `docs/supabase/module3_schema.sql`.
