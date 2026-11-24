#!/usr/bin/env python3

import os
import sys
import json
import time
import ssl
import urllib.request
import urllib.error

# ── Configuration ──────────────────────────────────────────────────────────────
TOKEN   = os.environ.get("GITHUB_TOKEN")
REPO    = "SwiftChainn/SwiftChain_Backend"
API_URL = f"https://api.github.com/repos/{REPO}/issues"

# ── Pre-flight Check ───────────────────────────────────────────────────────────
if not TOKEN:
    print("❌ ERROR: GITHUB_TOKEN environment variable not set.")
    print("   Run: export GITHUB_TOKEN='your-github-token'")
    sys.exit(1)

print("✅ Pre-flight checks passed.")
print(f"📦 Target Repo  : https://github.com/{REPO}")
print(f"🔗 Issues URL   : https://github.com/{REPO}/issues")
print("🚀 Starting issue creation...\n")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode    = ssl.CERT_NONE

ISSUE_TEMPLATE = """## 📁 Implementation Directory
`{directory}`

## 🎯 Goal
{goal}

## 📝 Description
{description}

## 📋 Requirements
{requirements}

## 🔧 Technical Scope
- Node.js / Express
- TypeScript
- MongoDB / Mongoose
- Stellar Soroban RPC

## 🌿 Branch
```bash
git checkout -b {branch}
```

## ✅ Acceptance Criteria
- [ ] **Strict Layered Architecture (Non-Negotiable):** Implement using the Controller -> Service -> Model pattern.
- [ ] **Data Source:** Response data must be retrieved from the database. No Inline Mock Objects or Hardcoded Values usage for integration.
- [ ] **Environment:** Contributors must use the requested `.env` credentials to enable implementation with real-life data.
- [ ] **API Versioning:** API Must Be Versioned (e.g., `/api/v1/...`).
- [ ] **Production Ready:** Code must look production-ready (robust error handling, strong typings).
- [ ] **Proof of Work:** Upload a screenshot of work done (i.e., API Response Success via Postman/Browser, or all unit tests passed successfully).
- [ ] **PR Content:** Must include `Closes #[issue_id]` with a work done summary.

## 📌 PR Requirements
- ⚠️ **Assignment required before starting** — comment on this issue to request assignment.
- PR must comply fully with the [CONTRIBUTING.md](../../backend/CONTRIBUTING.md).
- No Inline Mock Objects or Hardcoded Values usage for integration.
"""

def create_issue(title: str, directory: str, goal: str, description: str, requirements: str, branch: str, labels: str) -> None:
    print(f"\n🆕 Creating: {title}")

    body = ISSUE_TEMPLATE.format(
        directory=directory,
        goal=goal,
        description=description,
        requirements=requirements,
        branch=branch
    )

    payload = json.dumps({
        "title":  title,
        "body":   body,
        "labels": [lbl.strip() for lbl in labels.split(",")]
    }).encode("utf-8")

    req = urllib.request.Request(
        url=API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept":        "application/vnd.github+json",
            "Content-Type":  "application/json",
            "User-Agent":    "SwiftChain-Issue-Creator",
        },
    )

    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                print(f"   ✅ SUCCESS → {result.get('html_url')}")
                break
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            print(f"   ❌ FAILED (HTTP {exc.code}): {body_text}")
            break
        except Exception as exc:
            print(f"   ⚠️  Attempt {attempt}/3 failed: {exc}")
            if attempt < 3:
                print("      Retrying in 5 seconds…")
                time.sleep(5)
            else:
                print("   ❌ ERROR: All 3 attempts failed for this issue.")

    time.sleep(1.5)

ISSUES = [
    # ─────────────────────────── LOW COMPLEXITY (2) ────────────────────────────
    {
        "title": "[Docs] Update README roadmap to reflect completed Phase 1 and Phase 2 implementations",
        "directory": "backend/README.md",
        "goal": "Make the README roadmap accurately reflect the current implementation status of the project.",
        "description": """The README contains a roadmap with Phase 1 (MVP), Phase 2 (Escrow Payment), Phase 3 (Smart Contracts) and Phase 4 (Scaling) sections. Many features listed in Phases 1 and 2 have already been implemented by contributors (escrow funding/release, disputes, webhooks, notifications, driver assignment, DLQ, ETA caching, mutation testing, coverage enforcement, and more), yet all roadmap checkboxes remain unchecked.

This confuses new contributors and makes the project look unfinished. This ticket asks you to walk the actual codebase, verify which features exist, and update the roadmap checkboxes, feature titles, and outdated descriptions so the document matches reality.""",
        "requirements": """- Review the roadmap sections in `README.md` against the actual implementations under `src/` (controllers, services, models, routes, sockets).
- Check off all features that are truly implemented in Phase 1 and Phase 2.
- Update any feature titles or one-line descriptions that no longer match the implementation.
- Add a short "Implemented" note or link to the relevant directory for each completed milestone.
- Leave Phase 3 and Phase 4 items marked as future work/not started.
- Do NOT remove roadmap items; only correct their status and wording.""",
        "branch": "docs/update-readme-roadmap",
        "labels": "backend,docs,low"
    },
    {
        "title": "[Bug] Fix misspelled variable in NotificationPreferenceRepository that breaks strict TypeScript compilation",
        "directory": "backend/src/repositories/NotificationPreferenceRepository.ts",
        "goal": "Fix the undefined-variable reference that causes a strict TypeScript compile failure.",
        "description": """In `NotificationPreferenceRepository.ts`, the device-pruning logic declares a variable (around line 100) and later references it inside an `if` statement with a misspelled identifier (around line 113). Because the typo does not match the declared variable name, the code references an undefined identifier and `pnpm exec tsc --noEmit` / `pnpm run build` fails under strict mode.

This is a small but critical fix because it currently blocks the whole repository from compiling, which in turn blocks CI and every contributor build.""",
        "requirements": """- Locate the misspelled identifier reference (search for the typo) and correct it to match the variable actually declared in that scope.
- Run `pnpm exec tsc --noEmit` to confirm the file and the whole project compile without errors.
- Verify no other typos of the same identifier exist elsewhere in the file.
- Run the notification repository tests or the full `pnpm test` to confirm behavior is unchanged.""",
        "branch": "fix/notification-preference-typo",
        "labels": "backend,bug,low"
    },
    # ─────────────────────────── MEDIUM COMPLEXITY (4) ─────────────────────────
    {
        "title": "[Docs] Expand Swagger/OpenAPI 3.0 documentation to cover all REST endpoints",
        "directory": "backend/src/docs/swagger.ts",
        "goal": "Complete the OpenAPI 3.0 specification so every live endpoint is documented.",
        "description": """The project serves Swagger UI at `/api-docs` from `src/docs/swagger.ts`. Currently the OpenAPI definition only covers a handful of tags (Auth, Deliveries, Delivery Status, Admin), even though the API now exposes many more endpoint groups: Escrow (fund/release/sync), Webhooks (subscriptions, rotate-secret), Fleets (create/invite/members/metrics), Disputes (create/resolve/evidence), Indexer (status, last-processed, ranges), Notifications (list/prefs/devices), Drivers (location, earnings, leaderboard), and Health.

Many route files already carry `@openapi` JSDoc annotations but they are neither grouped into a cohesive schema nor reflected in the swagger tags. This ticket asks you to consolidate the documentation into a single accurate OpenAPI 3.0.3 document.""",
        "requirements": """- Inventory every mounted route from `src/routes/index.ts` and its child route files.
- Add OpenAPI paths, parameters, request bodies, and responses for all missing endpoint groups: Escrow, Webhooks, Fleets, Disputes, Indexer, Notifications, Drivers, Profile, Health, and Admin (DLQ/dashboard/disputes).
- Define reusable components/schemas for shared objects (Delivery, Escrow, User, Fleet, WebhookSubscription, Dispute, PaginationMeta, ApiError).
- Add security schemes (Bearer JWT) and apply them to protected endpoints.
- Keep the current tags but extend them so the UI groups endpoints logically.
- Verify by loading `/api-docs` locally and confirming every mounted route is present.""",
        "branch": "docs/swagger-complete-endpoints",
        "labels": "backend,docs,medium"
    },
    {
        "title": "[Docs] Sync .env.example with the validated Zod environment schema",
        "directory": "backend/.env.example",
        "goal": "Document every environment variable required and used by the application.",
        "description": """Configuration is validated centrally by the Zod schema in `src/config/env.ts` (60+ variables), but `.env.example` only documents a subset. Several variables are used directly via `process.env` in services without being part of the schema, e.g. `INDEXER_LAG_WEBHOOK_URL` (used by `monitorService`) and `ADMIN_DASHBOARD_CACHE_TTL_SECONDS` (used by `dashboardService`). This makes local setup error-prone: contributors copy `.env.example`, hit schema validation failures, and cannot tell which variables are optional or required.

This ticket asks you to make the example file a faithful mirror of the schema so contributors can bootstrap the environment without guessing.""",
        "requirements": """- Read every variable declared in `src/config/env.ts` (names, types, defaults, required/optional flags).
- Update `.env.example` to include ALL variables, grouped by concern (Server, MongoDB, JWT, Redis, Soroban/Stellar, Uploads/S3, FCM, Webhooks, ETA cache, Locations, Shutdown, Logging, Circuit breakers).
- Add inline comments showing default values and a one-line explanation for each variable.
- Note which variables are required vs optional (no default) so contributors know what to fill.
- Grep `src/services` and `src/config` for any `process.env` reads not present in `env.ts` and flag them in a comment (they should later be added to the schema).""",
        "branch": "docs/sync-env-example",
        "labels": "backend,docs,medium"
    },
    {
        "title": "[Refactor] Consolidate the three duplicate authentication middlewares into one canonical implementation",
        "directory": "backend/src/middleware/",
        "goal": "Eliminate the drift between auth.ts, authenticate.ts and authMiddleware.ts.",
        "description": """The codebase has three different JWT authentication middlewares with subtly different behavior:

1. `src/middleware/auth.ts` — verifies the JWT without touching the database and sets `req.user` to the token payload.
2. `src/middleware/authenticate.ts` — DB-backed; loads the full `User` document, blocks suspended/banned users, and sets `req.user` to the full doc. Preferred by admin routes.
3. `src/middlewares/authMiddleware.ts` — lightweight JWT-only verify, similar to (1).

This duplication is dangerous: routes may accidentally be protected by a weaker middleware, and future security fixes have to be applied three times. Route protection behavior is currently inconsistent across the app.""",
        "requirements": """- Decide the canonical behavior: DB-backed verification that also rejects suspended/banned accounts (behavior of `authenticate.ts`).
- Implement a single canonical middleware (suggest `src/middleware/authenticate.ts`), exposing the required factories (`authenticate`, `authorize`, role guards).
- Update `auth.ts` and `authMiddleware.ts` to re-export or delegate to the canonical implementation so existing imports keep working.
- Sweep `src/routes`, `src/middleware`, and `src/middlewares` to ensure every protected route uses the canonical path.
- Add or update unit tests covering: valid token, missing/invalid token, suspended user, banned user, and role authorization.
- Verify `pnpm run lint` and `pnpm test` pass.""",
        "branch": "refactor/consolidate-auth-middleware",
        "labels": "backend,security,medium"
    },
    {
        "title": "[Refactor] Merge the duplicate Zod validation middlewares into a single validator",
        "directory": "backend/src/middleware/validate.ts",
        "goal": "Remove the duplication between validate.ts and validateRequest.ts.",
        "description": """Two validation middlewares exist with overlapping behavior:

1. `src/middleware/validate.ts` — Zod body validation with the standardized response envelope.
2. `src/middlewares/validateRequest.ts` — supports body, query, and params validation.

Having both creates uncertainty about which one routes should import and means fixes (e.g., error-envelope changes) must be made twice. This ticket asks you to merge them into a single canonical validator that supports body, query, and params while preserving the existing response envelope.""",
        "requirements": """- Implement one canonical middleware (suggest extending `validate.ts`) that accepts `{ body?, query?, params? }` Zod schemas.
- Keep the existing standardized error envelope for validation failures.
- Update all route files to import the canonical validator; remove or re-export the deprecated one.
- Sweep `src/routes` for any usage of `validateRequest` and migrate those routes.
- Update validation-related tests so all validation paths are covered.""",
        "branch": "refactor/merge-validation-middleware",
        "labels": "backend,medium"
    },
    # ────────────────────────── HIGH COMPLEXITY (64) ───────────────────────────
    # ── Docs (22) ──
    {
        "title": "[Docs] Create a CONTRIBUTING.md with setup, conventions, and PR workflow",
        "directory": "backend/CONTRIBUTING.md",
        "goal": "Provide contributors with a clear onboarding and contribution playbook.",
        "description": """The repository has no `CONTRIBUTING.md`. Contributors currently rely on issue templates and the README. A dedicated contribution guide reduces invalid PRs and repeated reviewer feedback.

This guide should be the single source of truth for how to contribute: how to set up the local environment, how to pick an issue, how to branch, which architecture rules apply (Controller -> Service -> Repository -> Model), how to run lint/build/test/coverage, and what a complete PR must contain.""",
        "requirements": """- Document prerequisites (Node 22+, pnpm, MongoDB, Redis, Stellar testnet/futurenet access, FCM service account for notification work).
- Document `pnpm install`, `pnpm run lint`, `pnpm run build`, `pnpm test`, and `pnpm test:coverage`.
- Explain the layered architecture (Controller -> Service -> Repository -> Model) and when each layer should be used.
- Define branch naming conventions (`feat/`, `fix/`, `refactor/`, `docs/`, `test/`).
- Define the PR checklist (link to `.github/pull_request_template.md`), including `Closes #issue_id`.
- Define code style expectations (strong typing, no `any`, validation at boundaries, API versioning).
- Add a short troubleshooting section pointing to the existing root-level implementation summary docs.""",
        "branch": "docs/contributing-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Create an architecture overview document with layer diagrams and execution flow",
        "directory": "backend/docs/architecture.md",
        "goal": "Explain the project architecture so contributors understand where code belongs.",
        "description": """New contributors struggle to understand how the many folders fit together: controllers, services, repositories, models, DI container, sockets, indexer handlers, jobs, and utilities. There are also parallel legacy stacks (e.g., `deliveryService.ts` vs `delivery.service.ts`) that must be clearly marked as deprecated.

This document should describe the runtime flow of a request (HTTP request -> route -> middleware -> controller -> service -> repository -> Mongoose model), the WebSocket flow, the job/cron flow, and the Soroban indexer flow, using diagrams where helpful.""",
        "requirements": """- Create `docs/architecture.md` with ASCII or Mermaid diagrams for: HTTP request lifecycle, Socket.IO connection lifecycle, cron/job execution, and Stellar/Soroban event ingestion.
- Document the DI container (`src/di/container.ts`, Awilix) and how services/controllers are registered and resolved.
- Document the repository layer (`src/repositories/BaseRepository.ts` and concrete repositories).
- Clearly mark legacy/parallel stacks as deprecated (e.g., `deliveryService.ts`, old `escrowService.ts`, `deliveryModel.ts`).
- Add a glossary of domain concepts (escrow, lock status, proof of delivery, fleet, indexer ledger, DLQ).""",
        "branch": "docs/architecture-overview",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the authentication and security model (JWT, RBAC, rate limits, idempotency, CORS, CSP)",
        "directory": "backend/docs/security.md",
        "goal": "Describe every security control in the API so contributors follow the same rules.",
        "description": """Security controls are spread across middleware and config: JWT issuing/verification (`authService`, `authenticate.ts`), role-based access control (`requireRole.ts`), rate limiting (`rateLimiter.ts`: authLimiter 10/15min, apiLimiter 200/15min), idempotency keys (`idempotency.ts`), CORS delegate + Helmet CSP/HSTS (`security.ts`), PII masking in the logger, and secret handling.

Without a single reference, contributors either duplicate controls or skip them. This document should be the authoritative checklist for adding a new protected endpoint.""",
        "requirements": """- Document the JWT flow: how tokens are signed (`userId`, `role`), how they are verified (payload-only vs DB-backed), and where refresh/expiry handling lives.
- Document RBAC roles (user/driver/admin/enterprise) and how `requireRole`/`authorize` are applied.
- Document rate-limit groups and their limits, idempotency-key mechanics (including 409/422 responses and replays), CORS delegate behavior, and Helmet options.
- Include a short example showing a route that enforces all relevant controls.
- Document the logger's PII masker and instruct against logging secrets/raw passwords.""",
        "branch": "docs/security-model",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document error-handling and standardized API response conventions",
        "directory": "backend/docs/error-handling.md",
        "goal": "Explain the AppError hierarchy, the global error handler, and the response envelope.",
        "description": """The API standardizes on the `{ success, data, error, message }` response envelope and a global error handler (`src/middleware/errorHandler.ts`) that maps Mongoose CastError/duplicate-key/validation errors, Zod errors, JWT errors, and Multer errors to `AppError` subclasses with proper HTTP status codes.

Contributors need a reference that explains: how to throw errors from services, how the envelope is produced, which status codes different failures map to, and how the handler behaves differently in dev vs prod.""",
        "requirements": """- Document the `AppError` hierarchy in `src/errors/AppError.ts` (NotFound, BadRequest, Unauthorized, Forbidden, Conflict) and its `isOperational` distinction.
- Document the global `errorHandler` mapping table (CastError to 400/404, duplicate key to 409, Zod to 400, JWT to 401, Multer to 400/413).
- Show a worked example of throwing an error from a service and receiving the envelope response.
- Document the dev vs prod error payload difference (stack traces).
- Note that `logger` should be used instead of `console` (no-console lint rule).""",
        "branch": "docs/error-handling-conventions",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write an Escrow API reference (fund, query, sync, release, terminal statuses)",
        "directory": "backend/docs/api/escrow.md",
        "goal": "Document all escrow-related endpoints and behavioral rules.",
        "description": """Escrow is the financial heart of Phase 2. Endpoints live in `src/routes/escrow.routes.ts` (POST `/v1/escrow/fund` requiring an `Idempotency-Key`, GET by delivery/contract, POST sync, POST release) and `src/routes/escrowIndexer.routes.ts`. Behavior includes Redlock distributed locking on release, proof-of-delivery assertion, terminal-status guards, and `tx_bad_seq` recovery in Stellar.

Contributors implementing escrow features need precise documentation of payloads, status transitions, and the locking/idempotency semantics.""",
        "requirements": """- Document every escrow endpoint: method, path, auth, request body, response envelope, error cases, and status codes.
- Document the lock status lifecycle (pending -> locked -> released/refunded/disputed).
- Document the Redlock key naming (`escrow:release:<id>`), idempotency-key requirement on fund, and what happens on 409 conflicts.
- Document the interaction between `releaseEscrow`, proof-of-delivery assertion, and the delivery `COMPLETED` transition.
- Include curl examples for each endpoint.""",
        "branch": "docs/escrow-api-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a Webhook API reference (subscriptions, HMAC signing, retries, events)",
        "directory": "backend/docs/api/webhooks.md",
        "goal": "Document how merchants subscribe to and verify webhook events.",
        "description": """Webhooks notify external merchant servers of delivery status changes. The API surface: `src/routes/webhookRoutes.ts` — POST/GET `/v1/webhooks`, GET/PATCH/DELETE `/v1/webhooks/:id`, POST `/v1/webhooks/:id/rotate-secret`. The service (`webhookService.ts`) signs payloads with HMAC-SHA256, dispatches with exponential backoff + jitter, and runs a retry cron.

Merchants and contributors need a precise spec of the signing scheme, the event list, the retry schedule, and the subscription payloads.""",
        "requirements": """- Document subscription CRUD payloads and the `events[]` enum (from the model's WebhookEvent enum).
- Document the HMAC-SHA256 signature header format, how to compute it, and how to rotate the secret.
- Document the retry/backoff schedule (increments, jitter, max attempts, and the `webhookRetryJob` cron).
- Document the `WebhookDeliveryAttempt` lifecycle (pending to success/failed/exhausted) and `nextRetryAt`.
- Include curl examples and a sample signature-verification snippet for merchants.""",
        "branch": "docs/webhook-api-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a Socket.IO realtime protocol reference (rooms, events, ACKs, token refresh)",
        "directory": "backend/docs/socket-protocol.md",
        "goal": "Document the WebSocket contract used by drivers and merchants.",
        "description": """The active Socket.IO server is initialized in `src/sockets/connectionHandler.ts` and supports typed events. Key events: `join_room`/`leave_room` (rooms like `delivery:<id>`), `driver_location_update` (room broadcast, ack emitted as `location_update_ack`), `location_sync` (offline batches, ack `location_sync_ack`), `message`/`message_ack`, `pong`, and the auth lifecycle with token-expiry grace (`auth_expired`, `refresh_token`).

There is no single reference describing these contracts, which blocks frontend and mobile teams from integrating.""",
        "requirements": """- Document the connection handshake (JWT via handshake auth or query token), including `socketAuth.ts` behavior.
- Document every event: client-to-server and server-to-client payloads, and the ACK contract.
- Document room naming (`delivery:*`), how drivers join, and broadcast semantics per room.
- Document the token-refresh/expiry flow (`auth_refresh`, `auth_expired`) and the grace loop.
- Document offline sync (`location_sync`) batch limits and dedupe rules.
- Include example client code (socket.io) for location streaming.""",
        "branch": "docs/socket-protocol-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a Stellar/Soroban integration guide (RPC, circuit breaker, retries, XDR)",
        "directory": "backend/docs/stellar-integration.md",
        "goal": "Explain how the backend talks to the Soroban smart contract.",
        "description": """The backend integrates with Stellar/Soroban through: `src/config/stellar.ts` (RPC config per network), `src/blockchain/soroban.service.ts` (opossum circuit breaker, retry with exponential backoff, connectivity/ledger/network info), `src/services/transactionService.ts` (builds escrow-lock XDR via `toStroops`), and `src/services/stellarService.ts` (submission, `tx_bad_seq` recovery, DLQ on final failure).

This is the most unfamiliar area for contributors. A clear guide reduces misconfiguration and helps new people understand the transaction flow end to end.""",
        "requirements": """- Document the config surface (`STELLAR_NETWORK`, RPC URL, passphrase, escrow contract id, base fee, timeout).
- Explain circuit-breaker states (closed/open/half-open) for tokens `soroban-rpc` and `soroban-rpc-tx`, and how thresholds/expiry are configured.
- Explain the retry policy (`SOROBAN_RPC_*` env vars) and the `tx_bad_seq` recovery flow (fresh sequence -> rebuild XDR -> re-sign).
- Explain stroops conversion (`toStroops`) and when it is applied.
- Explain DLQ entry creation on unrecoverable failures and how admins retry via the DLQ endpoint.
- Include a step-by-step diagram of: fund -> contract `escrow_lock` call -> submission -> indexed event.""",
        "branch": "docs/stellar-soroban-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the indexer and event-ingestion pipeline",
        "directory": "backend/docs/indexer.md",
        "goal": "Explain ledger polling, event ingestion, deduplication, and lag monitoring.",
        "description": """The indexer consumes Soroban ledger events. Current building blocks: `EventLog` model (dedupe on `{transactionHash, eventType}`), `eventLogService`, handlers in `src/indexer/` (escrow, delivery, dispute, reputation), `escrowIndexerService` (terminal-status guards, idempotent sync), `monitorService` (lag tracking + `IndexerAlert` webhook), and an `eventPoller.ts` stub. `GET /v1/eventlog/...` exposes last-processed/unprocessed/range/transaction lookups.

Contributors need to understand the pipeline shape, the dedupe contract, and where the pending real poller will plug in.""",
        "requirements": """- Document the `EventLog` schema and the `{transactionHash, eventType}` unique index / dedupe semantics.
- Document each indexer handler (`escrow_funded/released/refunded`, delivery events, dispute/reputation) and its topic filters.
- Document `getLastProcessedLedger`, `recordProcessedLedger`, and how `IndexerStatus` is advanced.
- Document lag monitoring (`IndexerAlert`, threshold webhook) and the monitor routes.
- Clearly mark the `eventPoller.ts` stub as the planned replacement point and document the target `getEvents` polling loop (see TODO.md).""",
        "branch": "docs/indexer-pipeline",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write the bulk CSV upload format reference for deliveries",
        "directory": "backend/docs/bulk-upload.md",
        "goal": "Document accepted CSV columns, limits, dedupe rules, and error reporting.",
        "description": """The bulk delivery endpoint (`POST /v1/deliveries/bulk` via `src/routes/bulkDeliveryRoutes.ts` and `bulkDeliveryService.ts`) parses and validates CSV files, dedupes against existing tracking numbers, and performs a partial batch insert (`ordered:false`) when some rows are invalid. Size and row limits are configured via `BULK_UPLOAD_MAX_BYTES` / `BULK_UPLOAD_MAX_ROWS`.

Merchants need a precise spec of the CSV format and the per-line error report to build integrations without trial and error.""",
        "requirements": """- Document the exact CSV header format and allowed column names.
- Document `BULK_UPLOAD_MAX_BYTES` / `BULK_UPLOAD_MAX_ROWS` limits and the response when exceeded.
- Document dedupe behavior (which fields are used for dedupe and how existing deliveries are skipped vs rejected).
- Document the per-line error report structure and status codes (201 partial success, 400 invalid rows).
- Provide a downloadable example CSV and curl example.""",
        "branch": "docs/bulk-upload-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the driver location and geospatial system",
        "directory": "backend/docs/driver-location.md",
        "goal": "Explain the 2dsphere index, proximity queries, TTL expiry, and offline sync.",
        "description": """Real-time and offline location tracking is implemented across `DriverLocation` (unique doc per driver, GeoJSON Point, TTL index, `2dsphere` index), `LocationUpdate` (raw updates, pending/processed/failed), `driverLocationService` (`$geoNear`, radius expansion with `explain` support), `assignmentService` (nearest-driver claim with Redlock), and the socket location/sync services for live and batched updates.

No documentation describes these moving parts, the strict payload validation, or the dedupe/TTL behavior. This ticket fixes that.""",
        "requirements": """- Document the `DriverLocation` schema, GeoJSON Point convention (`[lng, lat]`), availability/status fields, heading/speed/accuracy, `expiresAt` TTL, and `2dsphere` indexes.
- Document `LocationUpdate` ingest rules: `capturedAt` bounds (`LOCATION_MAX_AGE_MS`, future skew), `isOfflineSync`, dedupe TTL (`LOCATION_DEDUP_TTL_SECONDS`), and batch limits (`SYNC_BATCH_SIZE_LIMIT`).
- Document `findNearbyDrivers` ($geoNear) and the radius expansion steps (`ASSIGNMENT_RADIUS_EXPANSION_STEPS`).
- Document the socket `driver_location_update` / `location_sync` flows and their ACKs.
- Include example payloads and DB index creation notes.""",
        "branch": "docs/driver-location-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the Fleet and invitations workflow",
        "directory": "backend/docs/fleet.md",
        "goal": "Explain fleet creation, member roles, invitations, and metrics.",
        "description": """Fleets let enterprise users manage groups of drivers. Key models: `Fleet` (treasury address, owner, members with roles, business metadata), `FleetInvitation` (pending/accepted/declined lifecycle). Routes: `src/routes/fleetRoutes.ts` — create/list fleets, get/update/delete fleet, add/remove members, invite drivers, respond to invitations, and compute fleet metrics.

The behavior (who can invite, role semantics, treasury address validation via `^G[A-Z0-9]{55}$`, owner auto-join) should be documented for contributors extending this module.""",
        "requirements": """- Document fleet CRUD payloads and authorization rules (owner only for admin actions).
- Document member roles (admin/driver/viewer) and the pre-save hook that adds the owner.
- Document the invite lifecycle: create -> pending -> accepted/declined, and the partial unique index on pending invitations.
- Document treasury address validation rules.
- Document the metrics endpoint (`getFleetMetrics`) and what it aggregates.
- Include curl examples for each fleet route.""",
        "branch": "docs/fleet-workflow",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the notification system (FCM, devices, preferences, triggers)",
        "directory": "backend/docs/notifications.md",
        "goal": "Explain how push notifications are sent and managed.",
        "description": """Push notifications use the `IPushProvider` interface with an FCM HTTP v1 implementation (`src/services/push/fcmProvider.ts`): service-account JWT to OAuth2 token (cached), per-token fan-out, permanent-token pruning. The `notificationService` triggers delivery-transition notifications via `STATUS_EVENTS`. Users manage devices and preferences through `src/routes/notificationRoutes.ts` (list, prefs, devices).

Contributors need to understand provider abstraction, device registration semantics (token detach across users), and how to add a new notification trigger.""",
        "requirements": """- Document the `IPushProvider` interface and how to swap/implement providers (FCM today, OneSignal later).
- Document device registration/unregistration semantics including token detach from other users and pruning.
- Document preference types (`pushEnabled`, `enabledEvents[]`) and the default behavior.
- Document the delivery-transition trigger map (`STATUS_EVENTS`) and where new triggers are added.
- Document the `Notification` document lifecycle (sent/failed/skipped, accepted/rejected counts).
- Include local-testing guidance (FCM service account env vars or a mock provider).""",
        "branch": "docs/notification-system",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write the Admin operations runbook (suspend, disputes, DLQ retry, dashboard)",
        "directory": "backend/docs/admin-runbook.md",
        "goal": "Give admins and contributing developers a complete operations reference.",
        "description": """Admin capabilities live across several modules: user management (`adminController`: suspend/ban with reason enforcement), disputes (`GET /v1/admin/disputes`), the dead-letter queue (`GET /v1/admin/dlq`, `POST /v1/admin/dlq/:id/retry`), and the dashboard metrics endpoint (`GET /v1/admin/dashboard`). `AuditLog` records admin actions.

This runbook should document every admin endpoint, the authorization used, and operational guidance (what DLQ retry does, how dispute resolution interacts with escrow, how dashboard caching works).""",
        "requirements": """- Document each admin endpoint: method, path, auth/role requirements, request body, responses, and error cases.
- Document the suspend/ban flow (reason enforcement, status transitions, audit logging).
- Document DLQ: listing, retrying a failed entry, and what happens when retries are exhausted.
- Document dispute listing and resolution semantics (how resolution interacts with escrow release).
- Document dashboard metrics aggregation and the `ADMIN_DASHBOARD_CACHE_TTL_SECONDS` caching.""",
        "branch": "docs/admin-runbook",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Create a database schema and index reference for all Mongoose models",
        "directory": "backend/docs/database-schema.md",
        "goal": "Catalog every model, its fields, and its indexes.",
        "description": """With 22+ Mongoose models, contributors often create duplicate fields or forget critical indexes. There is no single reference listing schemas, key fields, and index strategy (sparse unique, partial unique, TTL, compound, `2dsphere`).

This document should serve as the canonical database reference and be kept in sync whenever models change.""",
        "requirements": """- Document every model in `src/models/` (User, Delivery, Escrow, Dispute, Fleet, FleetInvitation, EventLog, LocationUpdate, DriverLocation, DriverProfile, Notification, NotificationPreference, ChatMessage, AuditLog, DlqEntry, Evidence, IdempotencyRecord, IndexerAlert, IndexerStatus, WebhookSubscription, WebhookDeliveryAttempt, plus legacy `deliveryModel.ts` marked deprecated).
- For each model: purpose, key fields with types, enums, and virtuals.
- List every index (unique/sparse/partial/TTL/compound) and note which are important for hot queries (driver proximity, escrow by delivery/contract, event dedupe, idempotency keys, webhook retry queue).
- Note the dual-delivery-model conflict (`Delivery.ts` vs `deliveryModel.ts`) as a known issue.""",
        "branch": "docs/database-schema",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a deployment guide (Docker, environment, graceful shutdown, log rotation)",
        "directory": "backend/docs/deployment.md",
        "goal": "Document how to deploy and operate the backend in production.",
        "description": """Deployment artifacts exist (`Dockerfile`, `docker-compose.yml`, `DEPLOYMENT_SUMMARY.md`), and the runtime has production hygiene features: graceful shutdown (`gracefulShutdownService`, draining HTTP -> jobs -> sockets -> Mongo transactions), Winston daily log rotation, and Redis/Redlock usage. However, there is no full deployment guide tying these together.

This guide should cover container setup, required volumes, environment variables, health checks, shutdown behavior, and operational monitoring.""",
        "requirements": """- Document the Docker services (app, mongodb, redis) from `docker-compose.yml`, including networks and volumes.
- Document required environment variables (point to `.env.example`) and per-service config.
- Document the `/v1/health` and `/v1/health/circuit-breakers` endpoints and how to use them for health checks.
- Document graceful shutdown behavior: signal handling, drain order, `SHUTDOWN_TIMEOUT_MS`, and expected downtime.
- Document log output locations, rotation policy, and recommended log shipping.
- Document one-off scripts/seed commands and `pnpm start` vs production build steps.""",
        "branch": "docs/deployment-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a development environment setup guide",
        "directory": "backend/docs/development-setup.md",
        "goal": "Let any contributor reach a running local environment quickly.",
        "description": """Local development requires MongoDB, Redis, a Stellar Soroban RPC endpoint (testnet/futurenet), optional FCM service account, and storage config. The setup is currently only implicit in the README and `.env.example`.

A step-by-step guide saves hours of setup time and reduces low-quality setup questions in issues.""",
        "requirements": """- Document installing prerequisites: Node 22+, pnpm, MongoDB (or Docker), Redis.
- Document cloning, installing (`pnpm install`), and copying `.env.example` to `.env` with reasonable defaults.
- Document how to run against Stellar testnet/futurenet RPC (what var to point at, what `STELLAR_NETWORK` value to use) and what to do when Soroban RPC is unavailable (circuit breaker degrade).
- Document running the dev server (`pnpm dev`), lint/build, and tests (`pnpm test`, `pnpm test:coverage`).
- Document common local pitfalls: Redis not running (Redlock), env validation failures, mongodb-memory-server first-run download.""",
        "branch": "docs/dev-setup-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a testing guide (unit vs integration, coverage thresholds, Stryker, load tests)",
        "directory": "backend/docs/testing.md",
        "goal": "Document how to write and run tests at every level.",
        "description": """The project has 57+ test files, coverage thresholds per layer (services 80%, models 70%, routes 60%, global 60%), mutation testing via Stryker (`stryker.conf.json`), and a k6 load-test suite in `load-tests/`. But there is no guide explaining the conventions, so contributors guess where tests belong and what thresholds apply.""",
        "requirements": """- Explain the test layout (`tests/unit`, `tests/integration`, `tests/e2e`) with examples of each.
- Document `mongodb-memory-server` usage (jest.setup.ts) and the 120s timeout in `jest.config.js`.
- Document coverage thresholds and how to check them (`pnpm test:coverage`).
- Document Stryker mutation testing: how to run, scope (`src/services/**`), and break threshold.
- Document the k6 load tests (`load-tests/`) and how to run them (auth-load, deliveries-load, socket-load).
- Provide a template for a new service test so contributors follow the same structure.""",
        "branch": "docs/testing-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the API versioning and endpoint deprecation policy",
        "directory": "backend/docs/api-versioning.md",
        "goal": "Define how APIs are versioned and how legacy endpoints are retired.",
        "description": """All current endpoints are mounted under `/api` and versioned `/v1`. However, there are legacy route files not mounted in `src/routes/index.ts` (e.g., `delivery.ts`, `transactionRoutes.ts`), and the README documents endpoints such as `/v1/transactions/escrow-lock` and uploads that currently return 404, while genuinely useful functionality (indexer status, monitor lag/alerts, upload evidence) is unreachable.

This ticket asks you to define the policy and reflect it in the README so contributors stop tripping over dead or duplicate endpoints.""",
        "requirements": """- Document the versioning convention (`/api/v1/...`) and the rule that new endpoints must be versioned.
- Inventory the README endpoint list and correct any endpoints that are not mounted (404s).
- Define a deprecation policy: how legacy endpoints are flagged, how Deprecated responses/headers are returned, and when they may be removed.
- Update the README API section to only list mounted routes, and mark deprecated any that remain temporarily.
- Add a note describing the legacy `deliveries.ts` status endpoint and its conflicting status enum.""",
        "branch": "docs/api-versioning-policy",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Write a troubleshooting and FAQ document for common issues",
        "directory": "backend/docs/troubleshooting.md",
        "goal": "Provide fixes for the most common environment and build failures.",
        "description": """Common failure modes are not documented: env validation errors from `env.ts` Zod (booleans/numbers as strings), Redis not running (Redlock/`acquireLock`), Stellar RPC timeouts and circuit-breaker open states, `pnpm build` failing on the `indexerService` import of the missing `webSocketService`, `mongodb-memory-server` binary download delays, and Mongo pool connection exhaustion.

A troubleshooting doc dramatically reduces duplicated contributor questions.""",
        "requirements": """- Document the env validation failure output format and how to fix the most common Zod errors.
- Document Redis-down symptoms and fixes (idempotency fallback to Mongo, Redlock errors).
- Document Stellar RPC timeout behavior, circuit-breaker states, and how to reset breakers (`/v1/health/circuit-breakers`).
- Document the known build blocker (missing `webSocketService` import in `indexerService.ts`) and its workaround status.
- Document `mongodb-memory-server` first-run behavior and network requirements.
- Document log locations and how to enable debug logging.""",
        "branch": "docs/troubleshooting-faq",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document the CI/CD pipeline (lint, build, coverage, lcov comments)",
        "directory": "backend/.github/workflows/ci.yml",
        "goal": "Explain what CI runs and how contributors reproduce the checks locally.",
        "description": """CI (`.github/workflows/ci.yml`) runs on Node 22.x with MongoDB 6.0: `pnpm install` -> `pnpm run lint` -> `pnpm run build` -> `pnpm test:coverage`, and posts an lcov coverage comment on PRs. Contributors often push PRs that fail CI for reasons they could have caught locally.

This ticket asks you to document the pipeline and mirror it exactly with local commands so contributors can pre-verify before pushing.""",
        "requirements": """- Document each CI stage and the exact local commands that replicate it (`pnpm run lint`, `pnpm exec tsc --noEmit` / `pnpm run build`, `pnpm test:coverage`).
- Document the coverage-comment behavior (lcov) and the thresholds that fail the build.
- Document the Node/Mongo versions used and how to match them locally.
- Add a checklist at the top of the doc for contributors to verify before opening a PR.
- Note the known gotcha: CI uses pnpm, so lockfile `pnpm-lock.yaml` changes must be committed.""",
        "branch": "docs/ci-pipeline",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Document repository naming conventions to prevent parallel-stack drift",
        "directory": "backend/docs/code-conventions.md",
        "goal": "Define service/controller/model naming so contributors stop creating divergent duplicates.",
        "description": """The repo currently has parallel stacks caused by inconsistent naming: `delivery.service.ts` (canonical) vs `deliveryService.ts` (legacy), `escrow.controller.ts` vs `escrowController.ts`, and duplicate DI tokens resolving ambiguity. This drift is a maintenance hazard.

This ticket asks you to define clear conventions and, crucially, mark the legacy files as deprecated in their headers and in the DI container so new contributors follow the canonical naming.""",
        "requirements": """- Define the canonical file-naming conventions for services (`.service.ts`), controllers, repositories, models, and middlewares.
- Define the export style (named vs default) and DI token naming rules.
- Sweep `src/` and add deprecation banner comments to the legacy variants: `deliveryService.ts`, old `escrowService.ts`, `deliveryModel.ts`, `deliveryController.ts`, `deliveryCrudController.ts`, and the duplicate socket server `sockets/index.ts`.
- Reconcile duplicate DI tokens in `src/di/container.ts` toward the canonical implementations.
- Add a PR checklist item referencing this doc so new code cannot reintroduce duplicates.""",
        "branch": "docs/code-conventions",
        "labels": "backend,docs,high"
    },
    # ── Bugs (10) ──
    {
        "title": "[Bug] Fix broken import of non-existent webSocketService in indexerService",
        "directory": "backend/src/services/indexerService.ts",
        "goal": "Restore `pnpm build` by removing the invalid import.",
        "description": """`src/services/indexerService.ts` imports `./webSocketService` (lines 5 and 63), but no such file exists in the repository. This breaks `tsc` / `pnpm run build` for the entire project and blocks CI. The import appears unused by the indexer logic itself, indicating a leftover from an earlier refactor.""",
        "requirements": """- Confirm the `webSocketService` file does not exist (and has no legitimate replacement to use).
- Determine whether the import is used anywhere in `indexerService.ts`; if unused, remove the import and any references.
- Run `pnpm exec tsc --noEmit` to verify the whole project compiles.
- Run `pnpm run lint` and the indexer-related tests to confirm nothing regressed.""",
        "branch": "fix/indexerservice-broken-import",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Add missing dlqController import to adminRoutes",
        "directory": "backend/src/routes/adminRoutes.ts",
        "goal": "Fix the startup crash of the admin DLQ endpoints.",
        "description": """`src/routes/adminRoutes.ts` registers `GET /v1/admin/dlq` and `POST /v1/admin/dlq/:id/retry` handlers that reference `dlqController`, but the file never imports it (imports are limited to Router, auth middleware, adminController, dashboardController, and UserRole). At application startup the router raises `ReferenceError: dlqController is not defined`, crashing the whole API.""",
        "requirements": """- Import `DlqController` from `../controllers/dlqController` (verify the exact export symbol).
- Ensure the controller methods mapped to the two DLQ routes exist and have matching signatures (`listEntries`, `retryEntry`).
- Start the server locally and hit `GET /v1/admin/dlq` (with admin auth) to confirm no startup crash.
- Add a regression test that mounts `adminRoutes` and asserts the DLQ paths respond with 401/403 (unauth) instead of a server crash.""",
        "branch": "fix/admin-dlq-missing-import",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Unify the dual delivery model to stop legacy status corruption",
        "directory": "backend/src/deliveryModel.ts",
        "goal": "Make `Delivery` the single source of truth and prevent incompatible status writes.",
        "description": """Two delivery models coexist: the canonical `src/models/Delivery.ts` (statuses `PENDING/FUNDED/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED`) and the legacy `src/deliveryModel.ts` (`DeliveryLegacy`, statuses `pending/assigned/picked_up/in_transit/delivered`). The legacy `deliveryStatusController` (used by `PUT /v1/deliveries/:id/status` through `src/routes/deliveries.ts`) writes legacy statuses into the same collection, corrupting the canonical state machine used by escrow release, assignment, and ETA flows.

This is a data-integrity bug that can put deliveries into states no other code understands.""",
        "requirements": """- Analyze both models and all usages of `deliveryModel.ts` / `deliveryStatusController` / `deliveries.ts` route.
- Migrate the legacy status-update endpoint onto the canonical `Delivery` model and its atomic transition logic (`DeliveryRepository.transitionStatus`).
- Add a data-migration path for any existing documents carrying legacy status values (map them to canonical statuses).
- Deprecate `deliveryModel.ts` and the legacy controller once no longer referenced (keep the file with a deprecation banner or remove it if fully unused).
- Add tests asserting that writing status through the canonical model rejects legacy enum values.""",
        "branch": "fix/unify-dual-delivery-model",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Remove or wire the dead Socket.IO server in sockets/index.ts",
        "directory": "backend/src/sockets/index.ts",
        "goal": "Eliminate the second, never-started Socket.IO server and its confusion.",
        "description": """Two Socket.IO servers exist: `src/sockets/connectionHandler.ts` (the one `server.ts` starts) and `src/sockets/index.ts`, which initializes a server on the `/api/v1/realtime` namespace and exports `emitDeliveryStatusUpdated`. The latter is never started, so it is dead code — yet its presence suggests there is a second realtime API and it duplicates the socket infrastructure.

Keeping it risks someone fixing the wrong server and wastes maintenance effort on code that never runs.""",
        "requirements": """- Confirm `server.ts` and `app.ts` never import or start `sockets/index.ts`.
- Check whether any route/service imports `emitDeliveryStatusUpdated` from it; if notifications/status updates should use the live connection handler instead, migrate those usages.
- If nothing depends on it, remove `src/sockets/index.ts` (and any now-unused socket chat code) or keep it with a clear deprecation banner explaining why it exists.
- Add a comment in `connectionHandler.ts` noting it is the single live Socket.IO entry point.
- Verify socket tests still pass.""",
        "branch": "fix/remove-dead-socket-server",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Add INDEXER_LAG_WEBHOOK_URL to the validated env schema",
        "directory": "backend/src/config/env.ts",
        "goal": "Make the indexer-lag alert URL a first-class, validated config value.",
        "description": """`monitorService.ts` reads `process.env.INDEXER_LAG_WEBHOOK_URL` directly, but that variable is not part of the Zod schema in `src/config/env.ts`. As a result: the value is invisible to the validated `env` object, it can silently be unset (alert webhooks fail), and contributors cannot discover it from `.env.example`.""",
        "requirements": """- Add `INDEXER_LAG_WEBHOOK_URL` to the Zod schema in `env.ts` (string, optional with a safe default or required-if-alerts-enabled pattern).
- Update `monitorService.ts` to read the value from the validated `env` object instead of `process.env`.
- Update `.env.example` with the new variable and a comment.
- Add a unit test asserting the schema parses with and without the variable and that the service uses the validated value.""",
        "branch": "fix/indexer-lag-webhook-env",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Add ADMIN_DASHBOARD_CACHE_TTL_SECONDS to the validated env schema",
        "directory": "backend/src/config/env.ts",
        "goal": "Stop unvalidated direct process.env reads in the dashboard service.",
        "description": """`dashboardService.ts` reads `process.env.ADMIN_DASHBOARD_CACHE_TTL_SECONDS` directly instead of using the centralized validated `env` object from `src/config/env.ts`. This value is absent from the Zod schema and from `.env.example`, breaking the project's config-validation convention and leaving the dashboard cache TTL undocumented.""",
        "requirements": """- Add `ADMIN_DASHBOARD_CACHE_TTL_SECONDS` to the Zod schema in `env.ts` (positive integer, with a sensible default, e.g., 60).
- Refactor `dashboardService.ts` to read from the validated `env` object.
- Update `.env.example` with the variable and a comment.
- Add a test asserting default and custom values are parsed correctly.""",
        "branch": "fix/dashboard-cache-ttl-env",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Clean duplicate registration tokens in the DI container",
        "directory": "backend/src/di/container.ts",
        "goal": "Make dependency resolution deterministic for delivery and escrow services.",
        "description": """The Awilix DI container in `src/di/container.ts` registers duplicate tokens such as `delivery_service` (both canonical and legacy), `escrow_service`, `delivery_controller`, and `escrow_controller`. Depending on registration order, consumers may be injected the legacy implementation instead of the canonical one, causing inconsistent behavior between routes that use DI and those that import services directly.

This ambiguity is a correctness hazard and should be resolved to a single canonical binding per token.""",
        "requirements": """- Map every duplicate token registered in `container.ts` to the canonical implementation (see the code-conventions doc naming rules).
- Update the legacy registrations so they either are removed or registered under distinct, clearly deprecated tokens (e.g., `delivery_service_legacy`) with a deprecation comment.
- Update all consumers (controllers resolved via the container) to depend on the canonical tokens.
- Run the DI container tests and the full suites for delivery/escrow to confirm behavior is unchanged (or fixed).""",
        "branch": "fix/di-duplicate-tokens",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Decide the fate of seven orphaned route files never mounted in the app",
        "directory": "backend/src/routes/",
        "goal": "Eliminate dead endpoints and the 404 gap between README and reality.",
        "description": """Seven route files exist but are never mounted in `src/routes/index.ts`: `delivery.ts`, `escrowRoutes.ts`, `indexer.routes.ts`, `indexerRoutes.ts`, `monitorRoutes.ts`, `transactionRoutes.ts`, and `uploadRoutes.ts`. The README documents some of their endpoints (e.g., `/v1/transactions/escrow-lock`, uploads) that currently return 404, while admins cannot reach genuinely useful functionality (indexer status, monitor lag/alerts, upload evidence).

This orphaned surface area must be reconciled: either mount the valuable endpoints or delete/mark the dead files as deprecated.""",
        "requirements": """- Audit each orphaned route file: list its endpoints and whether the required controller/service methods exist and work.
- For valuable endpoints (indexer status, monitor lag/alerts, evidence upload, transaction XDR build/submit), mount them in `src/routes/index.ts` — versioned under `/api/v1` — with proper auth.
- For routes that duplicate existing functionality (e.g., old CRUD `delivery.ts`), delete them or leave with a deprecation banner after confirming nothing imports them.
- Update the README API list to match the final mounted surface.
- Add a route-mount smoke test (see the route testing issue) so future orphans are caught automatically.""",
        "branch": "fix/orphaned-routes",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Fix device-token detach edge case in NotificationPreferenceRepository",
        "directory": "backend/src/repositories/NotificationPreferenceRepository.ts",
        "goal": "Make concurrent device registration safe and idempotent.",
        "description": """`registerDevice` detaches a device token from any other user before attaching it to the current user (to ensure one token maps to one active account). Under concurrent registrations, a race could detach the token that a parallel request just registered, or leave the token attached to the stale user. The pruning must be atomic per token.

This race can cause notifications to be delivered to the wrong user or dropped entirely.""",
        "requirements": """- Refactor `registerDevice` so the token-detach-and-attach happens atomically per token (e.g., an atomic update on the old user then set on the new user within the same transaction/session, or a unique-index-driven upsert).
- Add a guard so a device already registered to the requesting user is not detached/re-registered unnecessarily.
- Add concurrent-registration unit tests (Promise.all of two users registering the same token) asserting exactly one user ends up owning the token.
- Run notification preference tests and the full `pnpm test`.""",
        "branch": "fix/device-token-detach-race",
        "labels": "backend,bug,high"
    },
    # ── Refactor (7) ──
    {
        "title": "[Refactor] Collapse the dual escrow service stacks into a single canonical service",
        "directory": "backend/src/services/",
        "goal": "Remove the escrow service duplication and its conflicting behavior.",
        "description": """Two escrow service implementations exist: `src/services/escrow.service.ts` (canonical: funding records, idempotent sync, Redlock release, proof-of-delivery) and `src/services/escrowService.ts` (older: `scanForExpiredEscrows`, `getFlaggedEscrows`, `resolveEscrow` — currently commented out as not yet implemented). Duplicate DI tokens make it easy to wire the wrong one.

This refactor merges the two into one service with a clean, complete surface, moving the commented-out expiry/dispute methods into a real implementation (see the related enhancement tickets).""",
        "requirements": """- Merge `escrowService.ts` into `escrow.service.ts` (or a single `escrowService.ts` if cleaner), preserving all currently working behavior.
- Implement (not just uncomment) `scanForExpiredEscrows`, `getFlaggedEscrows`, and `resolveEscrow` as functional methods operating on the canonical model (add `EXPIRED` status and `expiresAt` as needed).
- Update the DI container to register exactly one canonical escrow token and update all consumers.
- Ensure the existing escrow tests, model tests, and e2e tests still pass.
- Run `pnpm exec tsc --noEmit`, `pnpm run lint`, and `pnpm test`.""",
        "branch": "refactor/collapse-escrow-services",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Collapse the triple delivery controllers into one canonical controller",
        "directory": "backend/src/controllers/",
        "goal": "Remove duplicated delivery controller logic and route ambiguity.",
        "description": """Three delivery controllers exist: `delivery.controller.ts` (canonical), `deliveryController.ts` (older), and `deliveryCrudController.ts`. They duplicate CRUD logic, create confusion about which one routes should import, and are wired inconsistently in the DI container.

This refactor consolidates them into a single canonical controller with thin compatibility re-exports so existing imports keep working during the migration.""",
        "requirements": """- Consolidate the logic of the three controllers into `delivery.controller.ts` (the canonical one), preserving all current endpoints/behavior.
- Update `src/routes/` files to import from the canonical controller only.
- Keep `deliveryController.ts` and `deliveryCrudController.ts` as thin re-export shims with deprecation banners, or remove them once no imports remain.
- Reconcile the duplicate `delivery_controller` DI tokens to the canonical binding.
- Run the delivery route/unit/e2e tests and confirm parity with current behavior.""",
        "branch": "refactor/collapse-delivery-controllers",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Replace `as unknown as` casts with typed projections and DTO mapping",
        "directory": "backend/src/services/authService.ts",
        "goal": "Eliminate unsafe type assertions in service returns.",
        "description": """Several services cast query results with `as unknown as X` (e.g., `authService.getUserById` casting a Mongoose lean document to `IUser`). These casts hide schema drift and can produce incorrect runtime shapes when models change.

This refactor replaces the casts with explicit typed projections and DTO mapping functions so the compiler verifies the shape.""",
        "requirements": """- Grep `src/services`, `src/controllers`, and `src/repositories` for `as unknown as` and `as any`.
- For each occurrence, define a typed projection (`.select(...)`), a DTO mapper, or proper generic typing so no unsafe cast is needed.
- Preserve the exact JSON shape consumers already expect (verify with existing tests).
- Add or update tests asserting the returned objects have exactly the expected fields.
- Run `pnpm exec tsc --noEmit`, `pnpm run lint`, and `pnpm test`.""",
        "branch": "refactor/remove-unsafe-casts",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Roll out the query middleware consistently across all list endpoints",
        "directory": "backend/src/middlewares/queryMiddleware.ts",
        "goal": "Unify pagination, filtering, and sorting across every list API.",
        "description": """`queryMiddleware.ts` / `buildQueryOptions` provide whitelisted filters (eq/ne/gt/gte/lt/lte/in/nin), pagination clamping (page/limit <= 100), and sort handling. However, not every list endpoint uses it: deliveries, users, disputes, fleets, webhooks, and notifications each implement their own query handling, leading to inconsistent pagination meta and filter behavior.

This refactor applies the middleware consistently and documents the shared query contract.""",
        "requirements": """- Audit all list endpoints and identify which do not use `buildQueryOptions`.
- Migrate delivery, user, dispute, fleet, webhook, notification, and event-log list endpoints to the shared middleware.
- Standardize the pagination metadata shape returned to clients.
- Add integration tests asserting that all migrated endpoints accept `page`, `limit`, `sort`, and whitelisted filters and return identical meta structures.
- Update swagger/docs for the shared query parameters.""",
        "branch": "refactor/unified-query-middleware",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Extract external SDK clients behind interfaces for testability",
        "directory": "backend/src/services/",
        "goal": "Make Google Maps, storage, and Stellar RPC clients mockable.",
        "description": """Only push notifications use the provider-interface pattern (`IPushProvider`). Other external integrations — Google Maps Directions (used by `routingService`), storage drivers (already partially abstracted), and the Soroban RPC client — are called directly, which makes unit tests slow, flaky, or impossible without real credentials.

This refactor extracts each external SDK behind a small interface (mirroring `IPushProvider`) so services can be tested with fakes.""",
        "requirements": """- Define interfaces: `IRoutingProvider` (directions), `IImagesStorage` (if needed), `ISorobanRpcClient` (getEvents, connectivity, ledger).
- Implement the real adapters wrapping the existing SDKs and register them in the DI container.
- Refactor `routingService`, `stellarService`, and `storage.service` consumers to depend on the interfaces.
- Update/add unit tests that inject fakes and verify fallback/error paths without network calls.
- Run the full test suite.""",
        "branch": "refactor/external-sdk-interfaces",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Restructure seed.ts and one-off scripts into a maintainable scripts layout",
        "directory": "backend/src/seed.ts",
        "goal": "Make scripting operations safe, documented, and repeatable.",
        "description": """`src/seed.ts` currently inserts a single hardcoded test delivery and has no options. The repo also holds many root-level implementation summary markdown files and one-off runs that are not scripted. This makes reproducing environments and data demos inconsistent.

This refactor structures the scripts with clear modules and safe flags.""",
        "requirements": """- Move `seed.ts` into `scripts/` (or keep in `src/scripts/`) with named, documented commands: `seed:users`, `seed:deliveries`, `seed:demo`, `seed:clear`.
- Add `--dry-run` and `--force` flags where destructive, and validate env before writing.
- Add idempotent behavior (skip or update existing business IDs instead of duplicating).
- Document usage in the development setup guide and `package.json` scripts section.
- Keep `pnpm seed` working as before to avoid breaking existing workflows.""",
        "branch": "refactor/seed-scripts-layout",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Replace the eventPoller stub with a proper polling-loop abstraction",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Give the indexer a real, configurable event polling loop.",
        "description": """`src/services/eventPoller.ts` is a stub that only logs Started/Stopped. TODO.md documents the intended steps (EventLog done, poller next, then server integration, verification). The polling loop is a prerequisite for several indexer features.

This refactor establishes the loop abstraction (start/stop/poll tick/config), even if the actual Soroban `getEvents` ingestion is completed in a separate feature ticket, so the pipeline can be tested with fakes.""",
        "requirements": """- Design an `EventPoller` class (or function factory) with `start/stop`, `isRunning`, configurable tick interval, and a `fetchNextEvents(lastLedger)` dependency injected.
- Wire start/stop into `server.ts` lifecycle (start on boot, drain on shutdown), consistent with other jobs.
- Replace the stub's inline logging with the real loop skeleton calling the injected fetcher; keep behavior no-op-safe when no fetcher is configured.
- Add unit tests with a fake fetcher verifying tick cadence, error tolerance (catch + continue), and clean stop.
- Update TODO.md to reflect completion of the loop step.""",
        "branch": "refactor/event-poller-loop",
        "labels": "backend,high"
    },
    # ── Testing (12) ──
    {
        "title": "[Testing] Write unit tests for the webhookService (HMAC, retries, backoff, event filtering)",
        "directory": "backend/tests/unit/services/webhookService.test.ts",
        "goal": "Cover the webhook service which currently has no test coverage.",
        "description": """`webhookService.ts` implements subscription CRUD, HMAC-SHA256 signature verification, dispatch with exponential backoff + jitter, and `retryDueAttempts` for the retry cron. There are NO tests for it today, and the CI coverage thresholds require services to be at 80% covered.

This ticket asks for a complete unit suite using an injected HTTP client fake so no real network calls occur.""",
        "requirements": """- Test signature computation/verification helper and wrong-secret rejection.
- Test dispatch success, non-2xx handling, network exceptions, and the scheduling of retries with `nextRetryAt`.
- Test backoff progression + jitter bounds and max-attempts exhaustion (status transition to `exhausted`).
- Test event filtering (`events[]` subscription) and that unsubscribed events are skipped.
- Test `rotate-secret` invalidates old signatures and updates the subscription.

Check coverage with `pnpm test:coverage webhook` and aim for 80%+ on the service.""",
        "branch": "test/webhook-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write unit tests for the assignmentService (nearest driver, radius expansion, Redlock)",
        "directory": "backend/tests/unit/services/assignmentService.test.ts",
        "goal": "Cover driver assignment logic which currently has no test coverage.",
        "description": """`assignmentService.ts` implements `assignNearestDriver` (Redlock-wrapped), `claimFirstAvailable`, `releaseClaim`, and `autoAssignPendingDeliveries` (used by the cron). There are no tests, and regressing the assignment logic would silently misroute deliveries.

This ticket asks for tests using injected location-service and lock fakes.""",
        "requirements": """- Test nearest-driver selection returns the closest available driver.
- Test radius expansion: no driver at base radius triggers stepwise expansion up to the configured steps.
- Test race handling: when `claimFirstAvailable` fails on contention, the driver is skipped, not double-assigned.
- Test `releaseClaim` releases the Redlock and clears the driver's current delivery.
- Test `autoAssignPendingDeliveries` batch behavior and that locked/failed deliveries are skipped.
- Verify `pnpm test:coverage assignment` at 80%+.""",
        "branch": "test/assignment-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write tests for the driverEarningsService aggregation",
        "directory": "backend/tests/unit/services/driverEarningsService.test.ts",
        "goal": "Cover earnings aggregation from released escrows.",
        "description": """`driverEarningsService.ts` aggregates driver earnings from RELEASED escrows via a `$lookup` into deliveries, grouped by day/week/month. There is no coverage for this aggregation, and it underpins a public endpoint (`GET /v1/drivers/:id/earnings`).

Price calculation bugs here directly affect driver payouts, so the grouping and totals must be tested.""",
        "requirements": """- Seed escrow/delivery fixtures across several days and assert daily grouping totals.
- Assert weekly and monthly boundaries (week start/end definitions) match the documented behavior.
- Assert zero-earnings drivers return an empty/zeroed response rather than errors.
- Assert only RELEASED (settled) escrows are counted and disputed/refunded ones are excluded.
- Run `pnpm test:coverage driverEarnings` at 80%+.""",
        "branch": "test/driver-earnings-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write tests for the escrowIndexerService (terminal guards, idempotent sync)",
        "directory": "backend/tests/unit/services/escrowIndexerService.test.ts",
        "goal": "Cover indexer sync handlers for released/refunded escrows.",
        "description": """`escrowIndexerService.ts` handles `escrow_released` / `escrow_refunded` events: it guards against terminal statuses, syncs the escrow document, and records the processed ledger. It also dedupes against the `transactions.hash` unique index. There is no test coverage.

A bug here could double-settle an escrow or leave it stuck in a wrong state.""",
        "requirements": """- Test that a released event on a non-terminal escrow transitions it correctly and appends the transaction.
- Test the terminal-status guard: repeated/mismatched events after settle are rejected or no-oped.
- Test refunded handling mirrors released behavior.
- Test idempotency: the same transaction hash ingested twice does not double-apply (assert single transaction entry).
- Test `getEscrowByEscrowId` and missing-document behavior.
- Run `pnpm test:coverage escrowIndexer` at 80%+.""",
        "branch": "test/escrow-indexer-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write tests for the idempotency service (NXP, 409 conflicts, replay, Mongo fallback)",
        "directory": "backend/tests/unit/services/idempotency.service.test.ts",
        "goal": "Cover the idempotency store critical for escrow funding safety.",
        "description": """`idempotency.service.ts` implements the Redis-primary/Mongo-fallback idempotency store: `markProcessing` (NX semantics -> 409 on concurrent), `markCompleted`, and `markFailed`, with stored response replay. Escrow funding depends on it to prevent duplicate charges.

This is high-value coverage because a regression here creates financial duplicates.""",
        "requirements": """- Test `markProcessing` succeeds for a new key and returns the conflict outcome for an in-flight key.
- Test `markCompleted` stores the response and a subsequent request replays it (same status/body).
- Test `markFailed` allows retry after failure.
- Test the Mongo fallback path by simulating Redis being unavailable.
- Test TTL/expiry of keys and behavior after expiry.
- Run `pnpm test:coverage idempotency` at 80%+.""",
        "branch": "test/idempotency-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write tests for the NotificationPreferenceRepository (device attach, detach, prune)",
        "directory": "backend/tests/unit/repositories/notificationPreferenceRepository.test.ts",
        "goal": "Cover repository logic for devices, preferences, and token pruning.",
        "description": """`NotificationPreferenceRepository.ts` implements `findOrCreateByUserId`, `updateForUser`, `registerDevice` (detaches token from other users), `removeDevice`, and `pruneTokens`. Beyond the typo bug already filed, the repository has no dedicated tests and nuances like cross-user token detach and pruning behavior are easy to regress.""",
        "requirements": """- Test `registerDevice` attaches a token to the user and detaches it from any other user.
- Test re-registering an already-owned token is idempotent (no duplicate entries).
- Test `removeDevice` removes only the specified token.
- Test `pruneTokens` removes stale tokens based on `lastSeenAt`.
- Test `findOrCreateByUserId` creates defaults on first call.
- Run `pnpm test:coverage notificationPreference` at 80%+.""",
        "branch": "test/notification-preference-repo",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write integration tests for the fleet routes (create, members, invites, metrics)",
        "directory": "backend/tests/integration/fleetRoutes.test.ts",
        "goal": "Cover the fleet module end to end, which currently has no route tests.",
        "description": """`fleetRoutes.ts` implements fleet CRUD, member add/remove, driver invitations (create + accept/decline), and the metrics endpoint. There are no route-level tests, so authorization mistakes and lifecycle bugs go unnoticed.

This ticket asks for supertest-based integration tests with the in-memory Mongo and the real auth middleware.""",
        "requirements": """- Test creating a fleet as an authenticated owner and as a non-owner (403).
- Test adding/removing members enforces role rules.
- Test the invite lifecycle: create -> pending; invitee accepts -> member added; invitee declines -> no membership; duplicate pending invite rejected.
- Test the metrics endpoint aggregates members/drivers correctly.
- Cover 404 for missing fleets and validation errors (invalid treasury address format).
- Run the suite and confirm full green with `pnpm test`.""",
        "branch": "test/fleet-routes",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write integration tests for the admin DLQ routes (list, retry, exhaustion)",
        "directory": "backend/tests/integration/adminDlqRoutes.test.ts",
        "goal": "Cover the dead-letter queue admin endpoints.",
        "description": """`adminRoutes.ts` exposes `GET /v1/admin/dlq` and `POST /v1/admin/dlq/:id/retry` (backed by `dlqController`). These endpoints allow re-running failed blockchain/stellar operations (escrow release failures). There is no coverage, and the missing-import crash bug shows this area was never exercised.

This ticket asks for route-level tests covering the happy path as well as retry failure and exhaustion behaviors.""",
        "requirements": """- Test listing DLQ entries (empty, populated, paginated).
- Test retrying an entry: on Stellar success the entry resolves; on repeated failure the retry count increments.
- Test exhaustion: after `maxAttempts` the entry is marked exhausted and further retries are rejected.
- Test auth/role gating (non-admin forbidden).
- Mock the Stellar service (do not make real network calls).
- Run `pnpm test:coverage adminDlq` at 80%+.""",
        "branch": "test/admin-dlq-routes",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write unit tests for the proofOfDeliveryService (MIME allow-list, size cap, assertion)",
        "directory": "backend/tests/unit/services/proofOfDeliveryService.test.ts",
        "goal": "Cover proof-of-delivery upload and assertion logic.",
        "description": """`proofOfDeliveryService.ts` validates uploads (driver-or-admin only, MIME allow-list, size cap), stores the file, and exposes `assertProofOfDeliveryExists`, which the escrow release flow calls before settling. No tests exist.

A bug here could allow settling without proof or block legitimate settlements — both financially sensitive.""",
        "requirements": """- Test allowed MIME types pass and disallowed types are rejected.
- Test files over `PROOF_OF_DELIVERY_MAX_SIZE_MB` are rejected.
- Test the upload flow stores metadata and links to the delivery.
- Test `assertProofOfDeliveryExists` passes when proof exists and throws the correct error when missing (and that the escrow release path honors it).
- Test authorization: non-driver/non-admin cannot upload.
- Run `pnpm test:coverage proofOfDelivery` at 80%+.""",
        "branch": "test/proof-of-delivery-service",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write tests for profilePicture.service and storage.service (local/S3, resize, signed URLs)",
        "directory": "backend/tests/unit/services/storage.service.test.ts",
        "goal": "Cover image storage drivers and profile-picture processing.",
        "description": """`profilePicture.service.ts` resizes/compresses images with Sharp (500px, JPEG q85) and delegates storage to `storage.service.ts` (LocalStorageDriver and S3StorageDriver with signed URLs). Neither has test coverage, and S3 failures are currently untested.

This ticket asks for tests covering both drivers (local real FS in tmp dir, S3 via fakes/contract) and the resize/compress pipeline.""",
        "requirements": """- Test LocalStorageDriver: save/load/delete round-trip using a temp directory; path traversal rejected.
- Test S3StorageDriver: signed URL generation, upload, delete, and error propagation using a mocked AWS client.
- Test `getStorageDriver` factory selects the driver from config.
- Test Sharp pipeline: oversized images are resized to 500px and compressed to JPEG; non-image input rejected.
- Test delete/cleanup behavior and the profile-picture replace flow (old key removed).
- Run `pnpm test:coverage storage profilePicture` at 80%+.""",
        "branch": "test/storage-profile-picture",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write unit tests for admin user management (suspend, reactivate, ban enforcement)",
        "directory": "backend/tests/unit/controllers/adminController.test.ts",
        "goal": "Cover admin user-moderation logic end to end.",
        "description": """`adminController.ts` handles `PUT /v1/admin/users/:id/suspend` with reason enforcement and ban boolean, and `adminService.ts` performs status transitions with conflict handling. There is no unit coverage for the controller flow (suspend require reason, ban must be boolean, already-suspended conflict).""",
        "requirements": """- Test suspend succeeds with a reason and fails without one (400).
- Test ban must be a boolean (400 otherwise) and that banning suspends immediately.
- Test conflict when the user is already in the desired status (409).
- Test the audit log records each admin action with actor and reason.
- Test 404 for unknown user IDs and 403 for non-admin actors.
- Run `pnpm test:coverage adminController` at 80%+.""",
        "branch": "test/admin-user-management",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Add a route-mount smoke test that fails on orphaned or unimported handlers",
        "directory": "backend/tests/unit/routes/mountSmoke.test.ts",
        "goal": "Catch future broken route wiring automatically in CI.",
        "description": """The admin DLQ missing-import bug and the seven orphaned route files show that the app currently starts or documents routes that are broken or never mounted. A smoke test that iterates every mounted route and asserts a structured 4xx/5xx (never a crash) catches these regressions for good.""",
        "requirements": """- Build the Express app (mocked DB/logger) and collect all mounted routes from the router stack.
- For each route, issue a `GET` (and where safe a `POST` with empty body) with no auth and assert the response is a structured JSON envelope (4xx/5xx) and never a 500 crash caused by an unimported handler.
- Assert every controller referenced by the route file is imported (static import check over `src/routes`).
- Add a CI-friendly assertion that no route file in `src/routes/` is both unimported by `routes/index.ts` and documented in the README (parity check).
- Wire the test into `pnpm test`.""",
        "branch": "test/route-mount-smoke",
        "labels": "backend,testing,high"
    },
    # ── Enhancements (7) ──
    {
        "title": "[Enhancement] Implement the real Soroban event poller ingesting events into EventLog",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Replace the poller stub with live ledger-to-EventLog ingestion.",
        "description": """After the loop abstraction (refactor ticket), the poller must actually fetch Soroban events via the RPC `getEvents` call (topic-filtered per `escrowIndexerConfig`), record them into `EventLog` (dedupe on `{transactionHash, eventType}`), then dispatch to the relevant indexer handler (escrow/delivery/dispute/reputation) and advance `IndexerStatus.lastProcessedLedger`. Today the poller is a stub and TODO.md documents this work as pending.""",
        "requirements": """- Use the polling loop abstraction and the Soroban RPC client `getEvents` with topic filters and `startLedger`/`endLedger` paging.
- Ingest each new event idempotently into `EventLog` (respect the unique index), skipping duplicates.
- Dispatch ingested events to the matching handler in `src/indexer/` using the event type; handle handler failures by marking the `EventLog` entry failed (with `errorMessage`) for later retry.
- Advance `IndexerStatus` after processing and emit metrics (lag computed by `monitorService`).
- Add integration tests with a fake RPC client: new events ingested, duplicates skipped, handler failures marked failed, ledger advanced.
- Update TODO.md and the indexer docs.""",
        "branch": "feat/event-poller-ingestion",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Implement escrow expiry with EXPIRED status, expiresAt, and monitor cron actions",
        "directory": "backend/src/models/Escrow.ts",
        "goal": "Make expired escrows automatically detected and cancellable.",
        "description": """The `escrowMonitor` cron and `scanForExpiredEscrows` exist, but the Escrow model has no `EXPIRED` status or `expiresAt`, and the scan body is commented out as not implemented. As a result, escrows that were funded but never released can remain locked forever.

This enhancement completes the expiry flow: configurable funding deadline at creation, automatic transition to `EXPIRED`, notification of stakeholders, and a clean path to cancel the delivery.""",
        "requirements": """- Add `EXPIRED` to the lock-status enum and add `expiresAt`/`expiredAt` fields.
- Implement `scanForExpiredEscrows` (cron-driven) that transitions eligible lock-statuses to `EXPIRED`.
- Implement the delivery-cancel side effect (cancel delivery, notify customer/driver via existing notification + webhook paths).
- Expose an admin-safe retry path: re-fund an expired escrow or fully cancel it.
- Add model, service, and cron-level tests covering the expiry boundaries.
- Update escrow docs and the admin runbook.""",
        "branch": "feat/escrow-expiry",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Implement admin flagged-escrow resolution endpoints and mount the escrow admin routes",
        "directory": "backend/src/controllers/escrowController.ts",
        "goal": "Enable admins to review and resolve flagged/disputed escrows.",
        "description": """`getFlaggedEscrows` and `resolveEscrow` in the older `escrowService.ts` are commented out, and `escrowRoutes.ts` (GET `/v1/admin/escrows/flagged`, PATCH `/v1/admin/escrows/:id/resolve`) is never mounted. Admins therefore cannot review disputed or unusual escrows through the API.

This enhancement implements the underlying queries/resolution logic and mounts the routes under the admin surface with full RBAC and audit logging.""",
        "requirements": """- Implement `getFlaggedEscrows` with filters (disputed, expired, suspicious) and pagination via the shared query middleware.
- Implement `resolveEscrow` with allowed resolutions (release to driver, refund to payer, keep locked) that respect terminal statuses and use Redlock.
- Mount the routes in `src/routes/index.ts` under `/api/v1/admin/escrows` guarded by `authenticate` + `requireRole(admin)`.
- Audit-log every resolution with actor, escrow id, and reason.
- Add integration tests covering listing, resolving to each outcome, and RBAC denials.""",
        "branch": "feat/admin-escrow-resolution",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Implement profile-picture cleanup (delete previous image on replace and on delete)",
        "directory": "backend/src/services/profilePicture.service.ts",
        "goal": "Stop orphaned files accumulating in storage.",
        "description": """`profilePicture.service.ts` contains TODO markers for cleaning up the previous picture when replaced (and when the profile is deleted). Today, replacing a picture leaves the old file orphaned in local storage or S3, growing storage usage and leaking user data retention.""",
        "requirements": """- On replace: after a successful new upload, delete the previous storage key (both local and S3 paths via `storage.service`).
- On profile/user delete: delete the profile picture file.
- Handle delete failures gracefully (log, do not fail the request).
- Add tests covering replace-with-cleanup and delete-with-cleanup for both storage drivers.
- Update the storage/profile docs.""",
        "branch": "feat/profile-picture-cleanup",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Scope socket chat messages to delivery rooms instead of a single global room",
        "directory": "backend/src/sockets/",
        "goal": "Make realtime chat per-delivery and private between participants.",
        "description": """The active Socket.IO server currently handles a generic `message` event without routing to a delivery-scoped room, so messages are not naturally isolated per delivery. This limits the realtime experience for delivery discussions (driver/customer/merchant).

This enhancement scopes chat to `delivery:<id>` rooms and reuses the existing room join/leave infrastructure.""",
        "requirements": """- Require clients to `join_room` (`delivery:<id>`) before sending chat messages; enforce membership (participant or staff) on join.
- Route `message` events to the delivery room only, tagging messages with `deliveryId` and sender metadata.
- Persist via `ChatMessage` with the delivery reference and expose paginated history per delivery.
- Emit typing/read-receipt events scoped to the room.
- Update `docs/socket-protocol.md` and add socket integration tests for isolation (a user outside the room must not receive messages).""",
        "branch": "feat/delivery-scoped-chat",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Add retry tracking and an admin retry endpoint for failed EventLog entries",
        "directory": "backend/src/models/EventLog.ts",
        "goal": "Close the loop on indexer event failures.",
        "description": """`EventLog` entries can be marked `failed` with an `errorMessage`, but there is no retry mechanism and no retry metadata. Failed indexer events are currently dead-end records, and re-processing requires manual DB pokes.

This enhancement adds `retries`/`lastError`/`nextRetryAt` fields and an admin endpoint to re-queue failed entries through the poller pipeline.""",
        "requirements": """- Extend the `EventLog` schema with `retries`, `lastError`, and `nextRetryAt` (indexed for the retry job).
- Add a job that re-queues `failed` entries past their backoff window (bounded attempts).
- Add an admin endpoint (GET failed list, POST retry by id) with RBAC and audit logging.
- Re-run failed entries through the same dispatch path as the poller, marking success or escalating to DLQ after exhaustion.
- Add tests for the retry lifecycle (failure -> scheduled -> success; failure -> exhausted).""",
        "branch": "feat/eventlog-retry",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Add webhook payload versioning and optional event batching",
        "directory": "backend/src/services/webhookService.ts",
        "goal": "Make the webhook contract evolvable and efficient for high-volume merchants.",
        "description": """Webhook payloads currently carry no schema version, so changing the payload shape breaks all subscribers at once. High-volume merchants also receive one HTTP request per event, which can be costly.

This enhancement adds a `schemaVersion` field to payloads and optional batched delivery (a `delivery.batch` event containing multiple position updates/statuses) for subscribers who opt in.""",
        "requirements": """- Add `schemaVersion` to the signed payload and document backwards-compat rules (payload migration table in docs).
- Add a subscription flag `allowBatch` and a batched event shape that ships multiple events in one request while still signing the payload.
- Group events per merchant per flush window (configurable) before dispatch, preserving per-event tracking in `WebhookDeliveryAttempt`.
- Add tests: version field present and signed; batched mode groups events and honours the flush window; per-event attempts still recorded.
- Update webhook docs.""",
        "branch": "feat/webhook-versioning-batching",
        "labels": "backend,high"
    },
    # ── Features (7) ──
    {
        "title": "[Feature] Add delivery-scoped chat messages with unread counts and paginated history",
        "directory": "backend/src/models/ChatMessage.ts",
        "goal": "Give every delivery a first-class chat conversation.",
        "description": """Today `ChatMessage` stores `content`, `sender`, and `createdAt` without delivery context or read tracking. Combined with the socket routing enhancement, this feature makes chat a real per-delivery feature: participants can browse history with pagination and see unread counts.""",
        "requirements": """- Add `deliveryId` (indexed) and `recipients`/`readBy` tracking to `ChatMessage`; add indexes for the per-delivery history query.
- Add REST endpoints: GET `/v1/deliveries/:id/messages` (paginated, participants only) and GET unread count / PATCH mark-read.
- Compute unread counts from `readBy` timestamps for the requesting user.
- Keep the socket path (delivery-scoped rooms) as the write path, persisting the same schema.
- Add route + socket tests with multi-participant scenarios and unread transitions.""",
        "branch": "feat/delivery-chat-messages",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Stream structured delivery milestone events to webhooks, sockets, and the indexer",
        "directory": "backend/src/services/delivery.service.ts",
        "goal": "Create one ordered, reusable event log for the delivery lifecycle.",
        "description": """Delivery status transitions currently fan out to notifications and webhooks ad hoc in `delivery.service.ts`. There is no single ordered record of milestone events (created -> funded -> assigned -> in_progress -> completed/cancelled) that all consumers can rely on.

This feature introduces a `DeliveryEvent` records collection + `emitMilestone` service that writes the event and dispatches to webhooks, sockets (`emitDeliveryStatusUpdated`), and optional indexer hooks in a controlled order.""",
        "requirements": """- Add a `DeliveryEvent` model (delivery ref, event name, from/to status, payload, actor, occurredAt, seq).
- Add `emitMilestone(delivery, event, actor)` in the delivery service that persists the record and fans out: notification -> webhook -> socket broadcast.
- Emit on every allowed transition of the canonical state machine, with `seq` ordering per delivery.
- Expose an API to list milestone events per delivery (participants and admins).
- Add tests asserting ordering, fan-out calls, and that consumers cannot break the transaction (fire-after-commit).""",
        "branch": "feat/delivery-milestones",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add merchant/enterprise onboarding flow with wallet binding and webhook bootstrap",
        "directory": "backend/src/services/onboardingService.ts",
        "goal": "Let merchants self-serve setup for escrow-funded deliveries.",
        "description": """Merchants today must be created through internal flows, and there is no guided onboarding that binds a Stellar wallet, registers fleet metadata (reusing `Fleet.businessMetadata`), and bootstraps webhook subscriptions.

This feature adds a step-by-step onboarding API: register intent -> validate business metadata -> bind treasury wallet -> create default webhook subscription -> create first admin user.""",
        "requirements": """- Add `POST /v1/onboarding/merchant` accepting business metadata, treasury address, and contact details; validate Stellar address format.
- Add a wallet-binding step (`PUT /v1/onboarding/merchant/wallet`) with ownership proof (signed challenge) before activation.
- Automatically create a `Fleet`, an owner user (enterprise role), and a default `WebhookSubscription` for milestone events.
- Emit an onboarding-complete notification and audit-log the creation.
- Add tests covering each step, validation failures, and the wallet-proof rejection path.""",
        "branch": "feat/merchant-onboarding",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add an escrow funding window with automatic cancel on lapse",
        "directory": "backend/src/services/escrow.service.ts",
        "goal": "Auto-cancel deliveries whose escrow was never funded in time.",
        "description": """Deliveries can sit in `FUNDED`-pending limbo: created with an escrow amount but never funded. There is no deadline. This feature adds a configurable `fundBy` deadline stored at creation and an automatic cancellation flow when the window lapses (complementing the escrow-expiry enhancement).""",
        "requirements": """- Add `fundBy` and `cancellationReason` to the Delivery schema; default `fundBy` (e.g., `ESCROW_FUNDING_WINDOW_SECONDS` env) at creation when an escrow is configured.
- On lapse (cron or in-line on fund request), transition the delivery to `CANCELLED` with reason and notify the customer.
- If the customer later funds a cancelled delivery, reject with a clear error (or resurrect per policy to be decided and documented).
- Emit a `funding_window_lapsed` milestone and audit-log.
- Add cron + service tests for lapse boundaries and the reject-after-cancel path.""",
        "branch": "feat/escrow-funding-window",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a Prometheus-format operations metrics endpoint",
        "directory": "backend/src/controllers/metricsController.ts",
        "goal": "Expose operational metrics for standard monitoring tooling.",
        "description": """The project has `GET /v1/socket-metrics` (JSON) and health/circuit-breaker endpoints, but no Prometheus-format output for standard monitoring stacks (Grafana, Datadog agent, k8s probes). Operators must parse custom JSON.

This feature exposes `GET /metrics` in Prometheus text format: request counts, latency histogram buckets (reusing `socketMetricsService` patterns), Mongo pool stats, Redis health, Soroban circuit-breaker states, and indexer lag.""",
        "requirements": """- Implement a metrics collector aggregating: per-route request counts, latency percentiles, MongoDB pool usage, Redis ping, circuit-breaker states (from `circuitBreakerController` data), and indexer lag (from `monitorService`).
- Render Prometheus text format (`# TYPE ...` and `# HELP ...`) with stable metric names.
- Secure the endpoint (admin token auth) and optionally gate it behind `ENABLE_METRICS` env.
- Add tests asserting the output format and metric presence with faked collectors.
- Document the endpoint in the deployment guide and operations docs.""",
        "branch": "feat/prometheus-metrics",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a feature-flag system gating tier-2 behavior via validated env config",
        "directory": "backend/src/config/flags.ts",
        "goal": "Toggle optional features without redeploys or code forks.",
        "description": """Several features (delivery pooling, webhook batching, milestones, chat) are tier-2 optional behaviors. There is no flag system, so each feature would ship hard-wired and need code deploys to toggle.

This feature adds a validated `src/config/flags.ts` derived from the env schema (`FEATURE_FLAGS` comma list or individual `FEATURE_*` booleans) with typed helpers to check flags in services.""",
        "requirements": """- Add `FEATURE_FLAGS` (or individual `FEATURE_*_ENABLED` vars) to the env schema in `env.ts`.
- Create `src/config/flags.ts` exporting typed boolean getters (e.g., `isEnabled('webhookBatching')`) and a registry of known flags with defaults.
- Add the flag checks at the entry points of the affected services (webhook batching, pooling, chat, milestones) so they no-op when disabled.
- Add tests for flag parsing, defaults, and unknown-flag rejection.
- Document each flag in the deployment guide and `.env.example`.""",
        "branch": "feat/feature-flags",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add an admin driver search and filter endpoint",
        "directory": "backend/src/controllers/driverController.ts",
        "goal": "Give admins the ability to search and filter drivers at scale.",
        "description": """Driver search/filtering exists nowhere today: only deliveries support search. Admins managing fleets and logistics need to query drivers by tier, vehicle capacity, reputation range, availability, and completed-delivery count (fields that already exist on `DriverProfile`/`User`).

This feature adds an admin-only, query-middleware-compliant search endpoint over the driver population.""",
        "requirements": """- Add `GET /v1/admin/drivers` (admin RBAC) supporting search on name/email, and filters for tier, vehicle capacity (min), reputation range, availability status, and delivery volume.
- Use `buildQueryOptions` / `queryMiddleware` for pagination, filtering, and sorting consistency.
- Aggregate `DriverProfile` + `User` data and return a flattened driver DTO (no password/hash fields).
- Add tests covering search terms, each filter, pagination meta, and RBAC denial.
- Document the endpoint in the admin runbook and swagger.""",
        "branch": "feat/admin-driver-search",
        "labels": "backend,high"
    },
    ]

print("\n════════════════════════════════════════════════════")
print("  📋 GENERATING SWIFTCHAIN BACKEND ISSUES (PHASE 1 & 2 ROBUSTNESS — BATCH 02)")
print("════════════════════════════════════════════════════")

for issue in ISSUES:
    create_issue(
        title=issue["title"],
        directory=issue["directory"],
        goal=issue["goal"],
        description=issue["description"],
        requirements=issue["requirements"],
        branch=issue["branch"],
        labels=issue["labels"]
    )

print("\n\n════════════════════════════════════════════════════")
print(f"  🎉  All {len(ISSUES)} Issues Creation Attempted!")
print(f"  📌  Repo  : https://github.com/{REPO}/issues")
print("  ✅  Review your issues and assign contributors.")
print("════════════════════════════════════════════════════")