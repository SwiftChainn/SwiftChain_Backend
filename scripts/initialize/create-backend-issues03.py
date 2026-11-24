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
    # ────────────────────────── HIGH COMPLEXITY DOCS (21) ──────────────────────
    {
        "title": "[Docs] Contributor walkthrough — add a new API endpoint end-to-end",
        "directory": "backend/docs/walkthrough-new-endpoint.md",
        "goal": "Give a first-time contributor a complete worked example of adding an endpoint through all layers.",
        "description": """CONTRIBUTING.md covers process, but not the actual code journey. This document walks through adding one example endpoint (e.g., `GET /v1/sample`) through the full request stack: route file -> controller -> service -> repository -> model -> Zod validator -> query middleware -> Swagger `@openapi` block -> unit/integration test.

It should reference the real files in the codebase as the patterns to copy: `src/routes/webhookRoutes.ts` as the route template, `src/middlewares/queryMiddleware.ts` for pagination/filtering, `src/repositories/BaseRepository.ts` for data access, and `src/di/container.ts` for dependency wiring. This gives a contributor everything needed to implement their first issue without hunting for patterns.""",
        "requirements": """- Write a step-by-step guide numbered 1-10 for adding a new endpoint, from route registration to test coverage.
- Use real file names/paths as examples (specify which existing files to open and mimic).
- Show the minimal code for each layer (route, controller method, service method, repository method, validator, swagger annotation).
- Explain how the endpoint becomes reachable: mounting the route file in `src/routes/index.ts` and (if needed) registering the controller in the DI container.
- Include how to run lint, build, and the specific test for the change.
- Add a "Common Pitfalls" section: forgetting the route mount, missing API version prefix, bypassing the response envelope, and using `any` types.""",
        "branch": "docs/contributor-walkthrough-endpoint",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Driver and DriverProfile API reference",
        "directory": "backend/docs/api/drivers.md",
        "goal": "Document every driver-facing endpoint and the reputation/vehicle model.",
        "description": """The driver module spans `driverController`, `driverLocationController`, `driverVehicleDetails` (PATCH `/v1/drivers/me/vehicle`), `driverEarningsController` (GET `/v1/drivers/:id/earnings`), and the leaderboard (GET `/v1/drivers/leaderboard`). Behaviors like the location update flow (PUT `/v1/drivers/me/location`) and the proximity explain endpoint (GET `/v1/drivers/nearby/explain`) have no documentation.

Drivers are a primary Phase 1/2 actor; a complete API reference is required so client teams and future contributors can integrate correctly.""",
        "requirements": """- Document each driver endpoint: method, path, auth, request body/query, response envelope, and error cases.
- Document the `DriverProfile` schema: `reputationPoints`, `tier` (bronze/silver/gold/platinum), `totalDeliveries`, `completedDeliveries`, `vehicleDetails` (make/model/year/plate/capacityKg).
- Document the vehicle update endpoint and its validation rules.
- Document the earnings endpoint: aggregation by day/week/month from RELEASED escrows.
- Document the leaderboard endpoint and the score inputs it uses.
- Document the location update and nearby/explain endpoints, referencing the geospatial guide for index details.
- Include curl examples for every documented endpoint.""",
        "branch": "docs/driver-api-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] User and profile API reference (wallet, picture, password, soft-delete)",
        "directory": "backend/docs/api/users.md",
        "goal": "Document account management endpoints for users and drivers.",
        "description": """This reference covers account management: PUT `/v1/users/wallet` (Stellar address binding), GET `/v1/users/deleted` and POST `/:id/restore` (soft-delete lifecycle), PUT `/:id/password`, the profile picture endpoints (GET `/v1/profile`, POST `/v1/profile/picture`), and the `User` status model (active/suspended/banned).

It must reconcile the Stellar wallet binding (`^G[A-Z0-9]{55}$`), the soft-delete semantics (`isDeleted`, `deletedAt`, restore), password change behavior, and how suspension blocks login via the DB-backed auth middleware.""",
        "requirements": """- Document each endpoint: method, path, auth, body, responses, and error cases.
- Document the `User` status lifecycle: active -> suspended (with reason) -> banned, and how each status affects auth.
- Document the wallet update endpoint, the Stellar address format validation, and what happens when a wallet is already bound.
- Document soft-delete vs hard-delete: which collections soft-delete, what `GET /v1/users/deleted` returns, and how restore works.
- Document the password change endpoint, including old-password verification.
- Document the profile picture flow (upload/resize/delete) referencing the storage reference doc.
- Include curl examples for each endpoint.""",
        "branch": "docs/user-api-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Dispute API reference and arbitration workflow",
        "directory": "backend/docs/api/disputes.md",
        "goal": "Document the full dispute lifecycle and its interaction with escrow.",
        "description": """The dispute module is `disputeRoutes.ts`: POST/GET `/v1/disputes`, GET `/:id`, PATCH `/:id/evidence`, PATCH `/:id/resolve`, PATCH `/:id`. The `Dispute` model has states (open -> under_review -> resolved/rejected), `raisedBy`, `reason` enums (damaged_package, late_delivery, wrong_item, non_delivery, other), `evidenceUrls[]`, and `raisedAtLedger` (on-chain linkage from the indexer's `disputeHandlers.ts`).

This doc must explain the full arbitration flow, including how resolution interacts with the escrow `DISPUTED` lock status and the `AuditLog`.""",
        "requirements": """- Document every dispute endpoint: method, path, auth/roles, body, responses, and error cases.
- Include a state diagram for the dispute lifecycle and the allowed transitions.
- Document the `reason` enum values and the evidence upload flow (PATCH `/:id/evidence`).
- Explain how a resolved/rejected dispute interacts with the escrow lock status and the delivery state machine.
- Document permissions: who can raise, who can resolve (admin), and how `raisedBy` is determined.
- Document the on-chain linkage (`raisedAtLedger`) produced by the indexer handlers.
- Include curl examples.""",
        "branch": "docs/dispute-api-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Idempotency-key integrator specification",
        "directory": "backend/docs/idempotency.md",
        "goal": "Give integrators a precise, implementable contract for the Idempotency-Key header.",
        "description": """Escrow funding (POST `/v1/escrow/fund`) requires an `Idempotency-Key`. The middleware (`src/middleware/idempotency.ts`) returns 422 when missing, 409 on concurrent in-flight requests, replays stored responses for completed keys, and uses the Redis-primary/Mongo-fallback store (`idempotency.service.ts`) with TTL expiry.

This is the canonical contract for client SDKs building against the escrow endpoints, so it must be precise about header format, key scope, and retry semantics.""",
        "requirements": """- Document how to generate and send the `Idempotency-Key` header (recommend UUIDv4; one key per logical operation).
- Document key scope: the same key cannot be reused across different endpoints/payloads; state what is included in scope.
- Provide a response-semantics table: 422 (missing), 409 (concurrent/in-flight), replayed response (prior completed result), and 2xx/4xx on first execution.
- Document TTL/key-expiry behavior and what happens when a client retries after expiry.
- Document safe retry after network failure (same key) vs after failure (new key).
- Include curl examples showing fund with the header and the replay case.""",
        "branch": "docs/idempotency-spec",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Storage and upload reference (local vs S3, signed URLs, MIME allow-lists)",
        "directory": "backend/docs/storage-uploads.md",
        "goal": "Document all upload paths, storage drivers, and limits.",
        "description": """The app has multiple upload surfaces: profile pictures (`profilePicture.service.ts`, Sharp 500px/JPEG q85), dispute evidence (`Evidence` model, `evidenceService`), proof of delivery (`proofOfDeliveryService`, `PROOF_OF_DELIVERY_MAX_SIZE_MB`), plus a factory in `storage.service.ts` (LocalStorageDriver vs S3StorageDriver with signed URLs). Each has MIME allow-lists and size caps. No single document covers them.""",
        "requirements": """- Document each upload surface: who may upload, allowed MIME types, size caps, and which storage driver is used.
- Document the S3 signed-URL mechanics and expiry behavior versus the local storage layout.
- Document the `getStorageDriver` factory and how to switch drivers via env config (`STORAGE_DRIVER`, `AWS_*`).
- Document profile picture processing (Sharp resize to 500px, JPEG q85) and the cleanup behavior on replace/delete.
- Document proof-of-delivery and evidence upload validation rules and error codes.
- List every relevant env var (`UPLOAD_*`, `AWS_*`, `PROOF_OF_DELIVERY_MAX_SIZE_MB`, `PROFILE_PICTURE_*`).""",
        "branch": "docs/storage-uploads-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Jobs and scheduled cron reference",
        "directory": "backend/docs/jobs.md",
        "goal": "Catalog every background job: schedules, responsibilities, and ad-hoc execution.",
        "description": """The app runs several jobs wired in `server.ts`: `autoAssignmentJob` (auto-assigns pending deliveries, `AUTO_ASSIGNMENT_CRON`), `escrowMonitor` (`scanForExpiredEscrows`, `ESCROW_MONITOR_CRON`), `webhookRetryJob` (`retryDueAttempts`), and the `eventPoller` stub (upcoming real ingestion). Jobs drain gracefully on shutdown via `gracefulShutdownService`.

There is no single reference for what runs when, making operations and debugging harder.""",
        "requirements": """- Create a table of every job: file path, cron schedule, env override variable, what it does, and its idempotency guarantees.
- Document the log markers each job emits for observability.
- Document how to run a job manually for debugging (with example commands).
- Document the graceful-shutdown interaction: how jobs are stopped during drain and the ordering.
- Clearly mark the `eventPoller` status (stub today, real ingestion planned) and link the related feature issue/doc.""",
        "branch": "docs/jobs-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Runtime lifecycle and graceful shutdown reference",
        "directory": "backend/docs/lifecycle.md",
        "goal": "Explain process boot, job startup, and shutdown drain order.",
        "description": """`gracefulShutdownService.ts` orchestrates: stop accepting HTTP -> stop scheduled jobs -> drain in-flight requests (via `requestTracker`) -> drain Socket.IO connections -> wait for MongoDB active transactions (`waitForActiveTransactions`) -> exit, bounded by `SHUTDOWN_TIMEOUT_MS`.

Operators and contributors need this contract to reason about deploys, restarts, socket timeouts, and why the process lingers before exiting.""",
        "requirements": """- Document the boot sequence: config validation -> Mongo pool -> Redis -> DI container -> HTTP server -> Socket.IO -> scheduled jobs.
- Document the shutdown sequence with a diagram and the exact drain order.
- Document `SHUTDOWN_TIMEOUT_MS` semantics and what happens when the timeout is exceeded (forced exit).
- Document signal handling (SIGTERM/SIGINT) and where handlers are registered.
- Document expected downtime during a rolled deploy and how in-flight requests are completed.
- Include notes on what to check when shutdown appears stuck (open connections, active transactions).""",
        "branch": "docs/lifecycle-graceful-shutdown",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Resilience and circuit-breaker operations guide",
        "directory": "backend/docs/resilience.md",
        "goal": "Explain every circuit breaker and failure-fallback path for operations.",
        "description": """The system guards external dependencies: opossum circuit breakers protect Soroban RPC (`soroban-rpc`) and transaction submission (`soroban-rpc-tx`); `routingService` falls back from Google Maps Directions to Haversine (anti-meridian safe); the idempotency store falls back from Redis to Mongo; and Soroban connectivity has a degraded mode. `GET /v1/health/circuit-breakers` exposes breaker states.

Operations need to know each breaker's thresholds, how to reset it, and what log markers indicate trouble.""",
        "requirements": """- Document each circuit breaker: token name, states (closed/open/half-open), thresholds, and reset behavior.
- Document the tuning env vars (`CB_SOROBAN_*`) with recommended production values.
- Document the routing fallback chain (Google Maps -> Haversine) and when each is used.
- Document the Redis -> Mongo idempotency fallback and its consistency trade-off.
- Document the Soroban connectivity degraded mode and how services behave when the RPC is unreachable.
- Document the reset endpoint (`POST /v1/health/circuit-breakers/:name/reset` if present) and monitoring guidance.""",
        "branch": "docs/resilience-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Redis usage and caching architecture reference",
        "directory": "backend/docs/redis.md",
        "goal": "Catalog every Redis consumer: keys, TTLs, and failure behavior.",
        "description": """Redis powers multiple subsystems: the ETA geohash cache (`etaCacheService`, `ETA_CACHE_TTL_SECONDS`), the idempotency store (with Mongo fallback), Redlock distributed locks (`escrow:release:<id>`, driver assignment claims via `src/config/redis.ts`), socket message queues, and the admin dashboard cache.

This doc defines key namespace conventions and what happens when Redis is available versus down.""",
        "requirements": """- Document every Redis consumer with its key patterns and TTLs (cache keys, lock keys, queue keys).
- Document the Redlock usage: which operations take locks, lock TTLs, and retry behavior when a lock is held.
- Document failure behavior: what degrades when Redis is unavailable (idempotency to Mongo, no caching, locks fail-safe vs fail-open) — be precise per subsystem.
- Define a key-namespace naming convention for new features (e.g., `prefix:entity:id:field`).
- Document the `initializeRedis`/`disconnectRedis` lifecycle and connection settings.
- Include a troubleshooting table for common Redis errors (connection refused, lock timeout, memory eviction).""",
        "branch": "docs/redis-reference",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] MongoDB performance and connection-pooling guidelines",
        "directory": "backend/docs/mongodb-performance.md",
        "goal": "Teach contributors the project's MongoDB performance conventions.",
        "description": """The database layer uses a connection pool (max 10 / min 2), repositories encourage `.lean()`, projections, and explicit indexes (sparse/partial/TTL/`2dsphere`/compound). Hot queries — driver proximity, escrow by contract/delivery, event dedupe, webhook retry queue, idempotency keys — depend on indexes that must not be dropped.

This document codifies the rules so contributors do not introduce N+1 queries or full-collection scans.""",
        "requirements": """- Document the pool configuration and connection lifecycle (`src/config/database.ts`).
- Document `.lean()`/projection best practices and when they are required.
- Document the canonical index list per model and which hot queries each index serves.
- Document the `$lookup` guidance using `driverEarningsService` as the reference pattern (and its index implications).
- Document `ordered:false` bulk-insert semantics used by the bulk CSV service.
- Document how to verify query plans, using `explainProximityQuery` (GET `/v1/drivers/nearby/explain`) as a worked example.
- Add a checklist of review items for PRs touching queries/models.""",
        "branch": "docs/mongodb-performance",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] DI container and dependency wiring guide (Awilix)",
        "directory": "backend/docs/dependency-injection.md",
        "goal": "Teach contributors how to register services and controllers in the container.",
        "description": """The Awilix container (`src/di/container.ts`) registers services, models, and controllers as singletons with `PROXY` injection. This guide explains token naming (and the `.service.ts` naming rules), how to add a new service/controller, how to break circular dependencies (the `dlqService` dynamic-import pattern), and warns against the duplicate-token problems that previously existed.""",
        "requirements": """- Provide a step-by-step worked example: add a new service and controller to the container (`container.ts`), including registration and resolution.
- Document token naming rules and how they map to the `.service.ts` file-naming conventions.
- Document the `PROXY` injection pattern and singleton lifecycle.
- Document how to break circular dependencies (reference the `dlqService` dynamic import as the established pattern).
- Document the `di.container` test and how to verify registration validity.
- Add a warning section about duplicate tokens (the historic `delivery_service`/`escrow_service` problem) and how to check for them.""",
        "branch": "docs/di-container-guide",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Data contracts and conventions for frontend/mobile clients",
        "directory": "backend/docs/data-contracts.md",
        "goal": "Define field-level conventions so client teams integrate consistently.",
        "description": """Cross-cutting conventions repeatedly trip up client teams: money represented in stroops (`toStroops`) vs display units, UTC ISO-8601 timestamps, GeoJSON `[lng, lat]` ordering, business `deliveryId` vs Mongo `_id`, the canonical status enums, the `{ success, data, error, message }` envelope, and pagination metadata.

The README documents endpoints but not these contracts. This document is the single source of truth for client integrations.""",
        "requirements": """- Define the money convention: stroops as integers on the wire, display-unit conversion rule, and which endpoints return stroops.
- Define the timestamp convention: UTC ISO-8601, and the rule that timezone conversion happens client-side only.
- Define the GeoJSON coordinate ordering (`[lng, lat]`) and warn about the common lat/lng swap bug.
- Define the dual identifier convention: business `deliveryId` vs Mongo `_id`, and when each is used.
- List the canonical status enums (delivery, escrow lock status, dispute, fleet invitation, webhook attempt, indexer status).
- Define the response envelope and pagination metadata fields (page, limit, total, totalPages).
- Include a short example response for each convention.""",
        "branch": "docs/data-contracts",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Push notification event catalog and payload contract",
        "directory": "backend/docs/notification-events.md",
        "goal": "Publish the complete catalog of notification events and their payloads.",
        "description": """The notification system triggers on delivery transitions via `STATUS_EVENTS` and ships through FCM (`fcmProvider.ts`: service-account JWT to OAuth2 token, per-token fan-out, permanent-token pruning). This document lists every event name, when it fires, the resulting `Notification` document (title/body/data), and the FCM payload shape so client teams can route and display them correctly.""",
        "requirements": """- Create an event catalog table: event name, trigger (which delivery transition), and a payload example.
- Document the `Notification` document shape (event, channel, title, body, data, status, accepted/rejected counts).
- Document notification preferences: `pushEnabled` and `enabledEvents[]`, and how preference filtering works.
- Document the FCM message shape and per-token fan-out behavior.
- Document the device registration semantics (one token, one user) and pruning of stale tokens.
- Document how to add a new notification event end to end (trigger -> service -> payload -> docs).""",
        "branch": "docs/notification-events",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Driver reputation, leaderboard, and fleet metrics formulas",
        "directory": "backend/docs/reputation-metrics.md",
        "goal": "Document exactly how reputation, tiers, leaderboard, and fleet metrics are computed.",
        "description": """`DriverProfile` carries `reputationPoints` and tier (bronze -> silver -> gold -> platinum). The leaderboard endpoint and fleet metrics (`getFleetMetrics`) aggregate drivers/members. The exact formulas and data sources are currently undocumented, so contributors and admins cannot reason about scores or verify correctness.""",
        "requirements": """- Document tier thresholds and how reputation points increase/decrease (completed deliveries, cancellations, delays, penalties).
- Document the leaderboard ranking inputs and tie-breaking rules.
- Document `getFleetMetrics` definitions: which fields count members, drivers, online drivers, and deliveries.
- Show which models/queries each number comes from (e.g., `DriverProfile`, `DriverLocation`, `Delivery`).
- Document the reputation index (`reputationPoints` desc) and the profile tier index.
- Include worked numeric examples for tier promotion and fleet metric computation.""",
        "branch": "docs/reputation-metrics",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Data retention and privacy reference (soft-delete, PII masking, log retention)",
        "directory": "backend/docs/privacy-data-retention.md",
        "goal": "Document how user data is deleted, masked, and retained.",
        "description": """The codebase has mechanics relevant to privacy: User/Delivery soft-delete with restore endpoints, the logger PII masker (`piiMasker`, `maskPiiFormat`), Winston daily rotating logs (`LOG_DIR`, `LOG_MAX_*`), profile-picture cleanup TODOs, evidence retention, and audit logs.

This document answers "what happens to data when an account is deleted" and supports compliance reviews.""",
        "requirements": """- Document soft-delete vs hard-delete: which collections soft-delete, what restore does, and which data is never hard-deleted through the API.
- Document what is retained in logs and how PII is masked via the logger PII masker.
- Document log rotation and retention settings (daily files, max size/files, zipped archives, `DISABLE_FILE`).
- Document evidence and audit-log retention periods and any automatic cleanup (or note the gap).
- Document the known cleanup gaps (e.g., profile picture files on account delete) and link the related feature ticket.
- Include a short policy statement template that operations can adopt.""",
        "branch": "docs/privacy-data-retention",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Security policy and responsible disclosure (SECURITY.md)",
        "directory": "backend/SECURITY.md",
        "goal": "Establish vulnerability reporting and secret-handling rules.",
        "description": """Distinct from the technical security-model reference, this is the process document: supported versions, how to privately report a vulnerability, secret-handling rules (never commit `.env`), the `select:false` password fields, rate-limit and abuse contacts, and expected response times. GitHub surfaces `SECURITY.md` prominently to security researchers.""",
        "requirements": """- Add a `SECURITY.md` at the repository root with: supported versions/backport policy.
- Define the private reporting path (e.g., GitHub private vulnerability reporting or a dedicated email) and what to include in a report.
- Define the disclosure timeline (e.g., acknowledgment within X days, fix within Y, coordinated public disclosure).
- Document secret hygiene: never commit `.env`/credentials, use `select:false` for password fields, rotate exposed secrets immediately.
- Link the technical security-model doc (`docs/security.md`) for architecture-level controls.
- Add a list of known sensitive areas (escrow funding, auth, admin endpoints, webhooks, uploads).""",
        "branch": "docs/security-policy",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Environment configuration matrix (dev / test / staging / prod)",
        "directory": "backend/docs/environment-matrix.md",
        "goal": "Explain which config values differ per environment and how they are injected.",
        "description": """`env.ts` validates 60+ variables; some must differ between dev, test (CI), staging, and production: the Soroban network/passphrase, FCM credentials, S3 keys, `STELLAR_NETWORK`, circuit-breaker tuning, and future feature flags. CI runs Node 22 + MongoDB 6 + mongodb-memory-server with rate limiting disabled in tests.

The matrix prevents the classic "works locally, broken in CI" PR problem.""",
        "requirements": """- Create an environment matrix table: variable per environment (dev/test/staging/prod) with example values.
- Document where CI injects values (`.github/workflows/ci.yml`) and how tests differ (rate limiting disabled, in-memory Mongo, memory server).
- Document how `NODE_ENV` changes runtime behavior (error handler verbosity, logger format, CORS).
- Document the checklist for adding a new env var: add to `env.ts` schema -> `.env.example` -> matrix doc -> CI if needed.
- Note which values must NEVER be committed and how they are injected in production (deploy platform secrets).""",
        "branch": "docs/environment-matrix",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Data migration and backfill runbook",
        "directory": "backend/docs/data-migrations.md",
        "goal": "Establish safe procedures for schema migrations and backfills.",
        "description": """Phase 1/2 work leaves known migration needs: legacy delivery statuses (`picked_up/in_transit/delivered`) mapped to canonical statuses, `EventLog` backfill from on-chain history, index rebuilds (sparse/partial/TTL), and re-seeding via `seed.ts`.

This runbook documents how to run migrations safely (backup -> dry run -> throttle -> verify) and where they plug into the deployment flow.""",
        "requirements": """- Document the migration checklist: backup, dry-run, throttle, verify parity, rollback plan.
- Provide the legacy delivery-status mapping table (legacy -> canonical) and the migration script outline.
- Document the `EventLog` backfill procedure from on-chain history and how dedupe is preserved.
- Document index rebuild commands for the sparse/partial/TTL/`2dsphere` indexes.
- Document how `seed.ts` is used for re-seeding demo environments and its idempotency behavior.
- Document rollback steps and validation queries to run before/after each migration.""",
        "branch": "docs/data-migrations",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Release, versioning, and changelog process",
        "directory": "backend/docs/releases.md",
        "goal": "Define how changes become releases and how the changelog is kept.",
        "description": """With many issues merged per batch, contributors need a predictable release process: semantic versioning, PR labels driving the changelog, release branches/tags, and how deprecations (legacy endpoints/models) are announced per the versioning policy. Currently none of this is documented.""",
        "requirements": """- Document semantic versioning rules for this API-driven service (major/minor/patch triggers).
- Define the changelog format and where it lives (e.g., `CHANGELOG.md`) and how PR labels feed it.
- Document the release checklist: lint -> build -> coverage -> migration steps -> deploy -> health check.
- Document tag/branch conventions (release branches, tags, hotfix flow).
- Document how deprecated endpoints/models are announced (per the API versioning policy) before removal.
- Include a worked example of cutting a release from merged PRs.""",
        "branch": "docs/releases-process",
        "labels": "backend,docs,high"
    },
    {
        "title": "[Docs] Health, observability, and metrics reference",
        "directory": "backend/docs/observability.md",
        "goal": "Explain every operational endpoint and log format for monitoring stacks.",
        "description": """Beyond the Swagger docs, operations needs this reference: `GET /v1/health` and `/v1/health/circuit-breakers`, `GET /v1/socket-metrics` (latency p50/p95/p99, connection counts, memory), `GET /v1/stellar/health|network|ledger/latest`, the Winston log formats, and `IndexerAlert` lag webhooks. It defines what to monitor, alert thresholds, and how to correlate logs with requests.""",
        "requirements": """- Document each operational endpoint with sample responses: health, health/circuit-breakers, socket-metrics, stellar health/network/ledger, monitor routes, indexer alert routes.
- Document the Winston log format (dev vs prod), log levels, and how request IDs/trackers can correlate logs (referencing `requestLogger`/`requestTracker`).
- Document the PII masking behavior in log output.
- Recommend alert thresholds: indexer lag (ledgers behind), circuit breaker open, Mongo pool pressure, Redis down.
- Document where `INDEXER_LAG_WEBHOOK_URL` is used and how to configure alert sinks.
- Provide sample Grafana/Datadog dashboard layouts covering these metrics.""",
        "branch": "docs/observability-reference",
        "labels": "backend,docs,high"
    },
]

print("\n════════════════════════════════════════════════════")
print("  📋 GENERATING SWIFTCHAIN BACKEND ISSUES (PHASE 1 & 2 — DOCS BATCH 03)")
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