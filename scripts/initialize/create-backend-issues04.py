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
    # ══════════════════════════════════════════════════════════════════════════
    #   MILESTONE 1 — SOROBAN SMART CONTRACT INTERACTION (FULL E2E TESTING)
    # ══════════════════════════════════════════════════════════════════════════
    {
        "title": "[Feature] Soroban network abstraction layer (mainnet/testnet/standalone)",
        "directory": "backend/src/services/providers/sorobanRpcClient.ts",
        "goal": "Let the indexer and services run against any Soroban environment purely via configuration.",
        "description": """The backend currently talks to Soroban through a single hard-coded RPC target and contract IDs. Running the same code against mainnet, testnet, or a local standalone container requires code edits, which makes local development and CI integration with a devnet container painful and error-prone.

This issue introduces a network-aware abstraction layer: a configured RPC client plus a contract-ID selector that resolves the active network (from env) and returns the correct client and contract addresses. After this change, switching environments is a configuration change only.""",
        "requirements": """- Define a `SorobanNetwork` enum (mainnet/testnet/standalone) and a config resolver that reads the active network from validated env (`STELLAR_NETWORK`).
- Introduce a network-aware `ISorobanRpcClient` provider that builds the correct RPC endpoint and network passphrase from the selected network.
- Provide a contract-ID selector (`resolveContract(activeNetwork, contractKey)`) backed by a per-network address map (see contract registry issue).
- Refactor existing Soroban call sites (indexer, transaction builder, escrow service) to use the abstraction instead of direct config reads.
- Add unit tests that assert the correct endpoint/passphrase/contract are selected per network and that unknown networks fail fast.""",
        "branch": "feat/soroban-network-abstraction",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Atomic ledger checkpoint persistence",
        "directory": "backend/src/services/eventLogService.ts",
        "goal": "Guarantee the last processed ledger is persisted atomically with the ingested batch.",
        "description": """Today the indexer records processed events and then advances the `IndexerStatus.lastProcessedLedger` in separate write steps. A crash between the two can re-ingest already-processed events (duplicate mutations) or skip a ledger gap. Both failure modes are unacceptable for a financial pipeline.

This enhancement makes the batch write and the ledger checkpoint part of one atomic operation (a MongoDB transaction or, on standalone, a single-document upsert strategy) so a crash can never leave the two out of sync.""",
        "requirements": """- Refactor the ingestion write path so each ledger batch and its checkpoint advance commit atomically (use a session/transaction; document the standalone fallback).
- Ensure `EventLog` dedupe (unique index on `{transactionHash, eventType}`) still protects against duplicate writes outside the transaction.
- Add crash-recovery tests simulating a failure between event insert and checkpoint advance and assert exactly-once semantics.
- Keep the existing `getLastProcessedLedger` / `recordProcessedLedger` interfaces backward compatible.""",
        "branch": "enhance/atomic-ledger-checkpoint",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Batch event ingestion across multiple ledgers per poll tick",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Reduce RPC round-trips by ingesting a range of ledgers in one polling pass.",
        "description": """The planned poller fetches one ledger's worth of events per tick, which is inefficient and slow to catch up after downtime. Soroban's `getEvents` supports filtering by a ledger range, so one request can cover several ledgers.

This feature extends ingestion to pull events from a configurable ledger range per tick and dispatch them in ascending ledger order, keeping per-event ordering and the dedupe contract intact.""",
        "requirements": """- Extend the fetch step to request a ledger range (`startLedger`..`endLedger`) bounded by `INDEXER_BATCH_LEDGERS` config.
- Dispatch events in ascending `(ledger, eventIndex)` order so handlers observe deterministic ordering.
- Keep checkpointing atomic per batch (see atomic checkpoint issue) and cap the range to avoid oversized RPC responses.
- Add integration tests with a fake RPC client: a multi-ledger range is fetched, ordered correctly, and partially failing ranges are retried without gaps.""",
        "branch": "feat/batch-event-ingestion",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Configurable poll interval with randomized jitter",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Add per-environment tick config plus jitter to avoid synchronized RPC bursts.",
        "description": """Multiple backend instances polling the same Soroban RPC on a fixed cadence can burst into a synchronized thundering herd. The poll interval is also hard-coded today, so operators cannot tune it per environment (aggressive in dev, conservative in prod).

This enhancement adds a validated `INDEXER_POLL_INTERVAL_MS` config and random jitter to each tick so instances naturally de-synchronize, and documents safe ranges.""",
        "requirements": """- Add `INDEXER_POLL_INTERVAL_MS` (and jitter percentage) to the validated env schema with sensible defaults.
- Apply randomized jitter around the base interval on every tick.
- Log the effective interval at startup for observability.
- Add unit tests asserting ticks occur within the jittered window and that config validation rejects invalid values.""",
        "branch": "enhance/poll-interval-jitter",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Contract address registry for all SwiftChain contracts",
        "directory": "backend/src/config/contractRegistry.ts",
        "goal": "Centralize delivery, escrow, dispute, and reputation contract IDs per network.",
        "description": """Contract IDs for delivery, escrow, dispute, and reputation smart contracts are scattered across config and call sites, making redeploys and multi-network support error-prone.

This feature introduces a typed contract registry mapping each contract key to its address per Soroban network, with validation helpers, so every service resolves contract IDs from one source of truth.""",
        "requirements": """- Create a typed `ContractRegistry` namespace keyed by contract (delivery, escrow, dispute, reputation, token) and network (mainnet/testnet/standalone).
- Seed it from validated env with per-contract overrides and fail fast on missing addresses for the active network.
- Add `resolveContract(name, network?)` and validation helpers (address format, network prefix) used across services.
- Replace hard-coded contract addresses in services with registry lookups.
- Add unit tests for resolution, overrides, and unknown-contract/network errors.""",
        "branch": "feat/contract-address-registry",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Full lifecycle E2E suite against a Soroban standalone container",
        "directory": "backend/tests/e2e/sorobanStandalone.test.ts",
        "goal": "Deploy all contracts to a devnet container and prove end-to-end event ingestion.",
        "description": """There is currently no end-to-end test that runs the actual contracts and asserts the backend ingests their events. Integration relies on mocked RPC clients, which cannot catch contract/ABI drift.

This issue adds an E2E suite that boots a Soroban standalone (devnet) container, deploys the delivery, escrow, dispute, and reputation contracts, emits real lifecycle events, and asserts the indexer records them into the local models with correct dedupe and ledger progression.""",
        "requirements": """- Add a script that spins up a Soroban standalone container and deploys all SwiftChain contracts, writing addresses to a temp config.
- Boot the backend/test app pointed at the standalone network with the real poller.
- Emit contract events for each lifecycle (escrow funded/released/refunded, delivery created/status, dispute opened/resolved, reputation submitted) and assert the corresponding models/EventLog entries appear.
- Assert dedupe: re-delivering an event does not double-apply.
- Wire the suite into `pnpm test` behind an env flag so CI can opt in when the container is available.""",
        "branch": "test/soroban-standalone-e2e",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Testing] Chaos tests for RPC timeouts, resets, and partial batch failures",
        "directory": "backend/tests/e2e/indexerChaos.test.ts",
        "goal": "Prove the ingestion pipeline tolerates RPC chaos without corruption or loss.",
        "description": """The indexer must be resilient to the realities of public RPC: timeouts, connection resets, and responses that fail mid-batch. None of these paths are currently exercised, so a production outage could reveal double-processing or skipped events.

This issue adds chaos tests that simulate RPC timeouts, resets, and partial batch failures and assert the pipeline catches, retries, and continues without corrupting state or losing events.""",
        "requirements": """- Build a flaky fake RPC client that can inject timeout, reset, and partial-response failures on demand.
- Test: a timeout mid-tick is caught and the tick is retried; a reset after ingest does not double-apply; a partial batch is re-fetched without order breaks.
- Assert no unhandled rejection crashes the poller and circuit breaker/failover behavior engages on repeated failures.
- Assert the checkpoint never advances past an incompletely processed range.""",
        "branch": "test/indexer-chaos",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Testing] Malformed/truncated XDR fuzz test corpus",
        "directory": "backend/tests/unit/utils/xdrFuzz.test.ts",
        "goal": "Ensure the XDR decoder rejects malformed payloads gracefully.",
        "description": """The event decoder parses XDR payloads from `getEvents`. Malformed, truncated, or non-base64 payloads can be produced by bugs, interference, or adversarial RPC responses. Today there is no test proving the decoder fails safely.

This issue adds a fuzz-style test corpus feeding malformed, truncated, mutated, and non-base64 inputs through the decoder and asserting graceful, logged rejection without throwing out of the pipeline.""",
        "requirements": """- Generate a corpus covering: invalid base64, truncated XDR, unknown enum variants, missing fields, and oversized buffers.
- Assert each input is rejected with a typed decode error (not a raw crash) and is logged with input metadata.
- Assert a malformed event in a batch skips only that event and does not poison the rest of the batch.
- Add regression tests for the two most likely real-world malformed shapes.""",
        "branch": "test/xdr-fuzz-corpus",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Testing] High-throughput ingestion soak test (50k+ events)",
        "directory": "backend/load-tests/indexer-ingestion.js",
        "goal": "Verify ingestion throughput, latency, and memory under sustained load.",
        "description": """No load test measures how many events the indexer can ingest before checkpointing falls behind or memory climbs. For a logistics platform that can see many deliveries per minute, the poller must keep up.

This issue adds a soak test that streams 50,000+ events through the ingestion path and asserts bounded throughput, latency, memory, and that checkpoint lag remains stable.""",
        "requirements": """- Reuse the fake RPC client to emit 50k+ events across many ledgers at a fast cadence.
- Instrument and assert: events/sec throughput, p95 ingest latency, heap usage ceiling, and EventLog/checkpoint convergence.
- Assert no duplicate mutations and that the high-water lag metric stays within a configured bound.
- Add a CI-friendly reduced variant (e.g., 5k events) that runs quickly.""",
        "branch": "test/indexer-soak",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] RPC multi-endpoint failover with health-based selection",
        "directory": "backend/src/services/providers/sorobanRpcClient.ts",
        "goal": "Fail over between multiple Soroban RPC endpoints based on measured health.",
        "description": """A single RPC endpoint is a single point of failure. When it degrades, the whole indexer stalls and the circuit breaker opens. Public Soroban RPC services are community operated and intermittently unreliable.

This feature adds multi-endpoint support: the client is configured with several endpoints, measures their health (connectivity check and recent error rate), and fails over to the healthiest available endpoint automatically.""",
        "requirements": """- Allow configuring multiple RPC endpoints (comma-separated `SOROBAN_RPC_URLS` or registry) with a primary preference.
- Implement health scoring (recent failures, latency) and endpoint selection per request; quarantine unhealthy endpoints for a backoff window.
- Preserve the existing circuit-breaker semantics at the app level and re-check endpoints on recovery.
- Add unit tests: healthy primary used, primary outage fails over transparently, endpoint recovery is re-admitted, and all-down raises a clear error.""",
        "branch": "feat/rpc-multi-endpoint-failover",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Contract state reader service (typed getLedgerEntry wrapper)",
        "directory": "backend/src/services/contractStateService.ts",
        "goal": "Read contract state through typed, validated ledger-entry parsing.",
        "description": """Reading Soroban contract state today means manually calling `getLedgerEntry` and parsing raw XDR, which is fragile and duplicated across services. There is no typed reader returning validated, domain-shaped data.

This feature adds a `ContractStateService` wrapping `getLedgerEntry` with typed, Zod-validated parsing for escrow, delivery, dispute, and reputation storage, so services consume clean objects instead of raw ledger entries.""",
        "requirements": """- Define typed interfaces for each contract's state shape (escrow status/balance, delivery status, dispute state, reputation aggregate).
- Implement cached `getLedgerEntry` reading with typed decoders and Zod validation, converting Soroban types (i128/u64/Address/duration) to JS values.
- Handle absent-state (contract not found) vs malformed-state distinctly with typed errors.
- Add unit tests covering every state shape and the conversion edge cases.""",
        "branch": "feat/contract-state-reader",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Soroban fee/gas estimation helper",
        "directory": "backend/src/services/sorobanFees.ts",
        "goal": "Estimate and bound transaction fees for contract calls.",
        "description": """Transaction fee handling for Soroban contract calls is ad hoc: workers guess a fee and hope it suffices. Oversized fees waste funds; undersized ones fail with `tx_fee_insufficient`.

This enhancement adds a fee/gas estimation helper that computes a safe bound for a given operation, applies configurable overrides and buffers, and is used consistently across the transaction builder and submission paths.""",
        "requirements": """- Implement `estimateTransactionFee(operationKind, payload)` returning a bounded estimate using the configured base fee and a safety multiplier.
- Add validated env overrides (`SOROBAN_FEE_*`) and per-operation-kind defaults.
- Wire the helper into transaction build and submission paths and log the applied fee.
- Add unit tests for each operation kind, override behavior, and edge cases (zero payload, maximum bounds).""",
        "branch": "enhance/soroban-fee-helper",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Escrow transaction builder service (fund/release/refund)",
        "directory": "backend/src/services/transactionService.ts",
        "goal": "Build signed Soroban transactions for the escrow lifecycle in one testable place.",
        "description": """Transaction construction for the escrow contract (fund, release, refund) is currently entangled with submission logic and configuration, making it hard to unit test and easy to break sequencing.

This feature extracts a dedicated `EscrowTransactionBuilder` that assembles signed Soroban transactions for each escrow lifecycle action with correct encoding, sequence handling, and fee application, self-contained and fully unit-testable.""",
        "requirements": """- Add builder methods `buildFund`, `buildRelease`, `buildRefund` taking domain inputs (escrow, amount, parties, network) and returning a signed `TransactionBuilder`/XDR envelope.
- Centralize sequencing (sequence number source, `tx_bad_seq` retry support) and fee application via the fee helper.
- Emit typed errors for validation failures (bad amount, wrong signer, missing contract).
- Refactor the escrow service to consume the builder; add unit tests for encoding, signing, and sequence edge cases (see companion testing issue).""",
        "branch": "feat/escrow-transaction-builder",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Unit tests for transaction builder (encoding, signing, sequence handling)",
        "directory": "backend/tests/unit/services/transactionService.test.ts",
        "goal": "Cover the new escrow transaction builder thoroughly.",
        "description": """The new `EscrowTransactionBuilder` produces real Stellar transactions that move money. Encoding, signing, and sequence-number handling all have edge cases, and a mistake means failed submissions or, worse, misdirected funds.

This issue requires a complete unit suite for the builder using captured testnet keys and Stellar SDK utilities, with no network calls.""",
        "requirements": """- Test `buildFund`/`buildRelease`/`buildRefund` produce correct operation types, destinations, and amounts (stroops) for native and issued assets.
- Test signature assembly with correct signers and that the built envelope verifies against the public key.
- Test sequence handling: given sequence applied, `tx_bad_seq` retry rebuilds with a fresh sequence.
- Test validation failures (invalid signer, zero/negative amount, mismatched network passphrase).
- Run `pnpm test:coverage transactionService` at 80%+.""",
        "branch": "test/transaction-builder",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Event correlation layer (tx hash + ledger seq → off-chain entities)",
        "directory": "backend/src/services/eventCorrelationService.ts",
        "goal": "Map every ingested on-chain transaction back to the entity it mutated.",
        "description": """Ingested events reference transaction hashes and ledger sequences, but there is no service that resolves those back to the delivery, escrow, dispute, or reputation record they mutated. Support and audit workflows must do this by hand today.

This feature adds an event correlation service that, given a transaction hash or ledger range, returns the affected off-chain entities and the exact events that touched them.""",
        "requirements": """- Define a correlation index mapping on-chain `(contract, txHash, ledgerSeq, eventType)` to `(entityType, entityId)`.
- Populate the index during ingestion and keep it queryable via dedicated lookups (`getEntitiesForTx`, `getEventsForEntity`).
- Expose the correlation in the event-log and admin explorer APIs.
- Add tests asserting correct correlation for all event families and correct behavior for unknown hashes.""",
        "branch": "feat/event-correlation-layer",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Structured indexer logs with ledger context",
        "directory": "backend/src/services/indexerService.ts",
        "goal": "Give every indexer log line standard ledger and event context.",
        "description": """Indexer logs are free-form today, making it hard to trace what happened to a given ledger range or event during an incident.

This enhancement standardizes the log shape: every ingestion, dedupe, error, and checkpoint message carries `ledgerSeq`, `eventType`, `contractId`, and `entityId` fields so operators can filter and trace reliably.""",
        "requirements": """- Add a structured logging helper for indexer paths that includes `ledger`, `eventType`, `contract`, `entityId` context.
- Apply it across ingestion, handler dispatch, dedupe skips, errors, and checkpoint advances.
- Keep log volume sane (no per-event success spam; use debug level for routine lines).
- Add tests asserting the presence and correctness of context fields on key log lines.""",
        "branch": "enhance/indexer-structured-logs",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Event-hash deduplication index",
        "directory": "backend/src/models/EventLog.ts",
        "goal": "Guard against duplicate processing across restarts using a stable event hash.",
        "description": """Dedupe currently relies on the `{transactionHash, eventType}` unique index. That covers identical re-delivery, but two distinct events in the same transaction (or a re-wrapped event) are hard to distinguish, and the correlation between different handlers is manual.

This feature computes a stable content hash per contract event and enforces it with a unique index, giving a stronger, content-addressed dedupe guarantee across restarts and retries.""",
        "requirements": """- Compute a stable `eventHash` from `(contractId, topic, payload) + ledgerContext` at decode time.
- Add the field to `EventLog` with a unique index; keep the legacy index during a migration window.
- On collision, return the existing record (idempotent replay) rather than erroring.
- Add unit/integration tests proving the same event delivered twice (plus after restart) is processed exactly once.""",
        "branch": "feat/event-hash-dedup",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Admin contract deploy/initialize endpoint (feature-flagged)",
        "directory": "backend/src/controllers/adminContractController.ts",
        "goal": "Let admins deploy and initialize contracts on test networks from the API.",
        "description": """Staging and demo environments need contracts deployed and initialized, but this currently requires manual CLI work outside the backend.

This feature adds an admin-only, feature-flagged endpoint to deploy and initialize contracts on test/standalone networks (never mainnet), so staging and demos can be set up repeatably from the API.""",
        "requirements": """- Add routes `POST /v1/admin/contracts/deploy` and `POST /v1/admin/contracts/init` guarded by `authenticate` + `requireRole(admin)` and the `FEATURE_FLAGS.adminContractOps` flag.
- Restrict execution to mainnet-forbidden networks (reject mainnet outright) and validate inputs via Zod.
- Record deploy/init transactions and results in a contract-operations audit log.
- Add tests covering happy path, mainnet rejection, RBAC denial, and flag-disabled no-op.""",
        "branch": "feat/admin-contract-deploy",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Prometheus counters for ingestion (processed events, errors, lag high-water mark)",
        "directory": "backend/src/services/metricsService.ts",
        "goal": "Expose ingestion metrics so ops can watch throughput and drift.",
        "description": """Operators have no real-time visibility into indexer health: how many events are processed, how many fail, and how far behind the poller is.

This enhancement adds Prometheus counters and gauges for processed events (by type), ingestion errors, and the lag high-water mark, wired into the existing metrics infrastructure.""",
        "requirements": """- Add counters: `indexer_events_processed_total{eventType}`, `indexer_events_failed_total{eventType}`, `indexer_ingestion_errors_total`.
- Add gauges: `indexer_last_processed_ledger`, `indexer_lag_ledgers` (high-water mark and current).
- Export them on the `/metrics` endpoint and document names/labels.
- Add tests asserting counter increments for processed/failed events and lag gauge updates.""",
        "branch": "enhance/indexer-prometheus-metrics",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] Indexer restart recovery tests (crash mid-batch, cold start)",
        "directory": "backend/tests/e2e/indexerRecovery.test.ts",
        "goal": "Prove the indexer resumes exactly from its checkpoint after crashes.",
        "description": """A crash mid-batch or a cold start after downtime must not double-process or skip events. With the atomic checkpoint in place, this needs explicit proof.

This issue adds restart/recovery tests that kill the ingestion process at controlled points (mid-batch insert, post-checkpoint) and assert exact resume behavior.""",
        "requirements": """- Test crash mid-batch: simulate a kill between event write and checkpoint advance; on restart assert no duplicates and the batch is re-processed from the checkpoint.
- Test crash post-checkpoint: assert events are not re-processed after restart.
- Test cold start from a persisted `IndexerStatus`: the poller resumes at `lastProcessedLedger + 1`.
- Assert the `IndexerAlert`/lag monitor reports correctly after recovery.""",
        "branch": "test/indexer-restart-recovery",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Testing] Event re-delivery idempotency tests",
        "directory": "backend/tests/unit/services/indexerIdempotency.test.ts",
        "goal": "Assert duplicate event delivery never causes conflicting mutations.",
        "description": """RPC responses can repeat events (same hash, same ledger), and results can be re-fetched on retry. Every event family must be safe to deliver twice.

This issue adds idempotency tests proving the identical event, delivered twice (and after restart), produces no duplicate or conflicting local mutations for every handler family.""",
        "requirements": """- For each event family (escrow funded/released/refunded, delivery status, dispute, reputation), deliver the identical event twice and assert exactly one mutation and one `EventLog` record.
- Assert duplicate delivery after restart (fresh container from persisted state) is still a no-op.
- Assert conflicting late replays (same hash, mutated payload) are detected/rejected.
- Integrate with the event-hash dedupe index where implemented.""",
        "branch": "test/indexer-idempotency",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Zod validation for every event payload before handler dispatch",
        "directory": "backend/src/validators/eventSchemas.ts",
        "goal": "Reject and log malformed contract events before they reach handlers.",
        "description": """Decoded event payloads are passed to handlers with minimal shape checking. A malformed or unexpectedly-shaped payload can trigger confusing handler bugs or partial writes.

This feature adds Zod schemas for every contract-event payload family and a dispatch guard that validates before handlers run, rejecting and logging malformed events with the offending fields.""",
        "requirements": """- Define Zod schemas for each event family (escrow, delivery, dispute, reputation) matching the contract's emitted payloads.
- Add a validation step in the dispatch path; on failure, log the event with a typed error and mark the `EventLog` entry failed (do not dispatch).
- Ensure validation failures are recoverable (retry after contract fix) and do not block the ledger checkpoint of unrelated events.
- Add unit tests: valid payloads pass, each malformed shape is rejected with a clear error.""",
        "branch": "feat/event-payload-validation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Contract ABI/interface version negotiation",
        "directory": "backend/src/services/contractAbiService.ts",
        "goal": "Detect contract interface versions at startup and warn on mismatch.",
        "description": """If the deployed contract changes its interface (new event topics, changed payloads) while the code expects the old shape, ingestion silently degrades or fails cryptically.

This enhancement adds ABI/interface version detection: at startup (and periodically), read the contract's version marker, compare it with the code's supported version, and warn, or block ingestion, on mismatch.""",
        "requirements": """- Define a version contract (e.g., a `version` extended data entry) each contract should expose and the supported ranges in config.
- At startup and on a configurable interval, read each contract's version and compare; emit a structured warning log or enter a paused state on hard mismatch.
- Expose current vs expected versions on the indexer status endpoints.
- Add unit tests for match, minor mismatch (warn), and hard mismatch (pause) behaviors.""",
        "branch": "enhance/contract-abi-negotiation",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] E2E payment-path contract operations (mint + pay + release)",
        "directory": "backend/tests/e2e/sorobanPaymentPath.test.ts",
        "goal": "Test minting and payment-path transfers through the contract end to end.",
        "description": """Escrow transactions move assets along payment paths (native and issued tokens). No end-to-end test exercises minting an asset, paying into an escrow, and releasing it, asserting balances at each step.

This issue adds an E2E test on the standalone network covering the full payment path for native XLM and a custom issued asset.""",
        "requirements": """- Boot the standalone container with a test asset contract; mint a known amount to a funding account.
- Drive the flow: fund escrow → assert contract balance; release → assert recipient balance and escrow zeroed.
- Repeat for issued assets, asserting stroop-accurate balances (no rounding drift).
- Assert balances after each step with explicit expected values.""",
        "branch": "test/soroban-payment-path",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Event cold-storage archiving beyond EventLog retention",
        "directory": "backend/src/services/eventArchiveService.ts",
        "goal": "Archive processed raw events to durable storage for audit and discovery.",
        "description": """`EventLog` has a finite retention window. Raw contract events that predate retention are lost, limiting audits, legal discovery, and historical analytics.

This feature adds an archiving service that moves processed raw events to durable storage (S3/local archive) with the same hash/dedupe metadata, plus a retrieval API for archived events.""",
        "requirements": """- Archive raw decoded events to storage after `EventLog` retention with an object-key scheme by ledger/date.
- Record archive manifests (file, range, count, checksums) for verifiability.
- Add a read path to fetch archived events by ledger range/entity when no longer in `EventLog`.
- Add tests covering archiving, manifest integrity, and retrieval boundaries.""",
        "branch": "feat/event-cold-storage",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] E2E contract revert/rollback integrity test",
        "directory": "backend/tests/e2e/contractRevert.test.ts",
        "goal": "Assert local state stays consistent with on-chain reality after contract reverts.",
        "description": """A contract call can revert after emitting partial state or after the backend has optimistically updated local records. If local state and chain state disagree, the escrow/delivery is inconsistent.

This issue adds an E2E test that forces a contract revert mid-flight and asserts the backend's local state remains consistent with on-chain reality (reconciliation detects and corrects drift).""",
        "requirements": """- Force a revert path (invalid operation/insufficient funds) and verify the contract state is unchanged on-chain.
- Assert the reconciliation job flags/repairs any optimistic drift the backend made.
- Verify the event correlation and activity timeline reflect the revert accurately (no phantom release).
- Add the scenario to the reconciliation service tests for unit-level coverage.""",
        "branch": "test/contract-revert-integrity",
        "labels": "backend,testing,smart-contract,high"
    },

    # ══════════════════════════════════════════════════════════════════════════
    #   MILESTONE 2 — ON-CHAIN ESCROW VERIFICATION
    # ══════════════════════════════════════════════════════════════════════════
    {
        "title": "[Feature] Escrow verification endpoint with on-chain proof payload",
        "directory": "backend/src/controllers/escrowController.ts",
        "goal": "Let the UI show verified-on-chain escrow status for any escrow.",
        "description": """The frontend roadmap requires "on-chain escrow verification displays in UI". Today the backend links escrows to transaction hashes but exposes no endpoint that returns the on-chain proof — ledger sequence, transaction hash, and confirmed timestamp — for an escrow state.

This feature adds a verification endpoint returning a proof payload (status, ledger seq, tx hash, confirmed timestamp, confirmation count) that the UI can render as "verified on-chain".""",
        "requirements": """- Add `GET /v1/escrows/:id/verify` returning status, on-chain ledger sequence, transaction hash(es), confirmed timestamps, and confirmation count.
- Derive the proof from `EventLog`/escrow transaction correlation; flag states with no on-chain backing as `unverified`.
- Cache recent verified payloads (see proof-cache enhancement) and version the DTO.
- Add unit + integration tests covering every escrow state and the unverified branch.""",
        "branch": "feat/escrow-verification-endpoint",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Off-chain/on-chain escrow reconciliation job",
        "directory": "backend/src/services/escrowReconciliationService.ts",
        "goal": "Detect drift between local escrow records and contract state automatically.",
        "description": """Local escrow documents can drift from the contract's actual state — a release that never confirmed on-chain, a stale status after a refund, or a dispute mis-settled. Currently no job detects this drift.

This feature adds a scheduled reconciliation job comparing local escrow status/balance against contract state (via the contract state reader) and flagging mismatches for admin review.""",
        "requirements": """- Implement a periodic job iterating active escrows and comparing local status/balance against the on-chain value.
- Only auto-repair safe, idempotent fields (e.g., balance, ledger references); flag ambiguous drift as `mismatch` for admin review.
- Record reconciliation outcomes in an audit log and expose them on an admin endpoint.
- Add unit tests for drift detection, terminal race handling, and non-destructive behavior (see companion testing issue).""",
        "branch": "feat/escrow-reconciliation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Signed escrow status attestation (digest + signature)",
        "directory": "backend/src/services/attestationService.ts",
        "goal": "Produce tamper-evident, signed proof snapshots of escrow status.",
        "description": """A verification page is only meaningful if the payload cannot be forged. A plain JSON status returned by the API proves nothing to a third party.

This feature adds signed attestations: a canonical digest of the escrow proof (status, balances, ledger, timestamps) signed by the backend's attestation key, so verification pages and dispute evidence can be independently validated.""",
        "requirements": """- Define the canonical attestation digest (stable field ordering, serialized in a documented format) and a signing service using the configured key.
- Return `{ payload, digest, signature, algorithm, publicKeyFingerprint }` from verification endpoints.
- Provide a public verification helper that validates the attestation signature/digest.
- Add tests: valid digest verifies, tampered payload fails, unknown key fingerprint rejected.""",
        "branch": "feat/escrow-status-attestation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Escrow asset/balance verification against contract balance",
        "directory": "backend/src/services/escrowVerificationService.ts",
        "goal": "Verify locked asset and balance match the contract's stored balance.",
        "description": """Verifying an escrow should confirm not just status but also that the asset and locked amount match what the contract actually holds. Today the backend trusts its own records.

This enhancement reads the contract balance for the escrow and compares it to the local record, exposing the comparison and alerting on mismatch.""",
        "requirements": """- On verification, read the contract balance for the escrow's asset and compare with the local locked amount.
- Expose `balanceMatch` (true/mismatch/unavailable) in the verification payload.
- Emit a metric + log entry on mismatch and surface mismatches in the admin review endpoint.
- Add unit tests for matching, mismatch, and RPC-unavailable outcomes.""",
        "branch": "enhance/escrow-balance-verification",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Escrow activity timeline API (fund → release/refund with proofs)",
        "directory": "backend/src/services/escrowTimelineService.ts",
        "goal": "Expose a chronological, proof-bearing timeline of every escrow transition.",
        "description": """Customers, drivers, and admins currently see only the current escrow state, not the history of how it got there. The roadmap's verification displays need the full on-chain story.

This feature adds an activity timeline API aggregating every escrow transition (created, funded, disputed, released/refunded) with on-chain proof (ledger, tx hash, confirmation count) in chronological order.""",
        "requirements": """- Aggregate transitions from the event correlation layer and escrow transaction history into a canonical timeline.
- Order events by `(ledgerSeq, eventIndex)` and dedupe repeated transitions.
- Attach proof payloads to each transition and format the response as a versioned, paginated DTO.
- Add tests covering ordering, dedupe, proof attachment, and large timelines (see companion testing issue).""",
        "branch": "feat/escrow-activity-timeline",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Reconciliation service unit tests (drift detection, terminal race)",
        "directory": "backend/tests/unit/services/escrowReconciliationService.test.ts",
        "goal": "Cover the reconciliation job's drift and race handling.",
        "description": """The reconciliation job moves money-state; subtle bugs could auto-correct the wrong direction or interfere with an in-flight release.

This issue requires comprehensive unit tests for the reconciliation service using fake contract-state readers.""",
        "requirements": """- Test drift detection: local vs on-chain mismatch in status and balance are each detected and flagged.
- Test terminal race: reconciliation does not mutate an escrow mid-release (locked by Redlock) and never downgrades status.
- Test safe auto-repair of references/balances and the admin-flag path for ambiguous drift.
- Test that healthy escrows are skipped without writes.
- Run `pnpm test:coverage escrowReconciliation` at 80%+.""",
        "branch": "test/escrow-reconciliation",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Escrow release pre-approval signature endpoint (QR-handoff-triggered)",
        "directory": "backend/src/controllers/escrowController.ts",
        "goal": "Generate a signed release pre-approval for QR-handoff-triggered releases.",
        "description": """The recommended flow connects a successful QR handoff to an automatic escrow release. The frontend needs a signed token it can present to trigger release without re-entering authorization warily.

This feature adds an endpoint generating a short-lived, signed release pre-approval bound to a delivery/escrow after handoff verification, which the release flow redeems exactly once.""",
        "requirements": """- Add `POST /v1/escrows/:id/release/preapprove` requiring verified handoff proof; mint a short-lived signed token bound to the escrow and a nonce.
- Ensure one-time use (token consumed on redeem), Redis-backed TTL, and replay rejection.
- Integrate with the existing Redlock release path so pre-approval redeem and manual release cannot race.
- Add tests for issue, redemption, expiry, reuse rejection, and RBAC.""",
        "branch": "feat/escrow-release-preapproval",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Redis cache for confirmed escrow proofs (short TTL)",
        "directory": "backend/src/services/escrowProofCache.ts",
        "goal": "Absorb fan-in on heavy verification endpoints.",
        "description": """Dashboards polling verification endpoints for many escrows produce repeated expensive RPC reads. Verified proof payloads are short-lived by nature but can be cached briefly.

This enhancement adds a Redis cache keyed per escrow+state with a short TTL, invalidated on new on-chain confirmation, to absorb fan-in without serving stale data.""",
        "requirements": """- Implement a Redis cache with a short configurable TTL (`ESCROW_PROOF_CACHE_TTL_SECONDS`) keyed by `escrow:{id}:proof`.
- Invalidate/refresh when a newer on-chain confirmation is observed (see auto-refresh enhancement).
- Fall back to live verification on cache errors (fail-open, logged).
- Add tests for cache hit, miss, expiry, and invalidation paths.""",
        "branch": "enhance/escrow-proof-cache",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Dispute escalation with on-chain evidence hash reference",
        "directory": "backend/src/services/disputeService.ts",
        "goal": "Make uploaded dispute evidence verifiable against an on-chain hash.",
        "description": """Dispute evidence is uploaded and stored off-chain, but nothing anchors it on-chain, so an escalated dispute has no tamper-evident link between the evidence and the blockchain record.

This feature records the content hash of each uploaded evidence item in the dispute record and exposes it so escalation is verifiable (complementing the PoD photo-hash attestation work).""",
        "requirements": """- Compute and persist a stable content hash for each `Evidence` item at upload time.
- Expose evidence hashes on dispute detail endpoints and include them in the signed dispute attestation when present.
- Add a verification helper that recomputes and compares the hash on read.
- Add tests covering hash computation, tamper detection, and hash reporting in API responses.""",
        "branch": "feat/dispute-evidence-hash",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Contract-state parser unit tests (funded/released/refunded/expired)",
        "directory": "backend/tests/unit/services/contractStateParser.test.ts",
        "goal": "Cover every escrow contract-state representation the verification layer decodes.",
        "description": """The verification layer decodes contract state into domain shapes; any parser bug silently misreports the escrow's true status.

This issue requires exhaustive parser tests for every escrow contract-state representation (funded, released, refunded, expired, disputed) and edge encodings.""",
        "requirements": """- Feed fixtures for each status state and assert the decoded domain shape (status, balance, parties, deadline) is correct.
- Test edge encodings: zero balances, max i128 values, absent optional fields, unknown future variants (decode with explicit unknown marker).
- Assert malformed state raises typed errors rather than returning fabricated status.
- Run `pnpm test:coverage contractStateParser` at 80%+.""",
        "branch": "test/contract-state-parser",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Multi-asset escrow verification (native + issued assets)",
        "directory": "backend/src/services/escrowVerificationService.ts",
        "goal": "Verify escrows funded in XLM and custom assets consistently.",
        "description": """Escrows can be funded in native XLM or issued assets. Verification must handle both, including the different balance representations and any conversion needed for display.

This feature extends the verification and balance-check paths to support native and issued assets with accurate stroop-to-display conversions.""",
        "requirements": """- Detect the escrow asset type (native vs issuer+code) from stored/config data and read the correct contract balance.
- Normalize amounts to display units with documented stroop precision and an explicit `display` field in verification payloads.
- Add per-asset conversion helpers and edge handling (no issuer metadata, unknown asset).
- Add tests covering native, issued, and unknown-asset verification.""",
        "branch": "feat/multi-asset-escrow-verification",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Standardized escrow verification response schema (DTO)",
        "directory": "backend/src/interfaces/escrowVerification.ts",
        "goal": "Define and apply a typed, versioned verification response DTO for all callers.",
        "description": """Several endpoints return escrow verification data in slightly different shapes, forcing clients to guess. A single, versioned DTO makes the contract explicit.

This enhancement defines a canonical `EscrowVerificationResponse` DTO (status, proof, timestamps, balances, attestation) and applies it across every verification-related endpoint.""",
        "requirements": """- Define the DTO with Zod schema and a version field; document the field semantics.
- Apply the DTO (and its serialization) to all verification endpoints and the timeline proof attachments.
- Add a migration note for any internal consumers that parse the old ad-hoc shapes.
- Add conformance tests asserting every endpoint returns exactly the DTO shape.""",
        "branch": "enhance/escrow-verification-dto",
        "labels": "backend,enhancement,smart-contract,medium"
    },
    {
        "title": "[Testing] Verification behavior under RPC lag and stale ledger data",
        "directory": "backend/tests/unit/services/escrowVerificationService.test.ts",
        "goal": "Assert verification fails safe when RPC returns stale-ledger data.",
        "description": """When the RPC endpoint lags behind the latest ledger, a verification response can be deceptively fresh even though it reflects an old state. The verification layer must distinguish and fail safe.

This issue adds tests for verification under RPC lag and stale ledger data.""",
        "requirements": """- Simulate an RPC response lagging behind the latest known ledger and assert the verification payload is marked `stale`.
- Assert the layer refuses to attest stale data (no signed attestation for stale proofs).
- Test recovery when the RPC catches up (stale marker clears).
- Assert clear, structured errors when the RPC is unreachable rather than silent failures.""",
        "branch": "test/escrow-verification-stale-rpc",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Socket + push notifications on on-chain escrow confirmed/released",
        "directory": "backend/src/sockets/connectionHandler.ts",
        "goal": "Notify customers and drivers the instant the contract confirms a lock or release.",
        "description": """Users learn about escrow confirmations only by polling. The roadmap calls for real-time on-chain visibility.

This feature emits socket events and push notifications the moment the indexer confirms an escrow lock or release, to the customers and drivers involved.""",
        "requirements": """- Emit typed socket events (`escrow_locked`, `escrow_released`) to the delivery room and the parties' notification channels.
- Send FCM push notifications to involved users on confirmation, reusing the existing notification service.
- Include the on-chain proof payload (ledger, tx hash, confirmation count) in the event payload.
- Fire merchant webhooks for the confirmed/released escrow (see webhook-events feature).
- Add socket integration tests: lock and release notifications reach the right rooms only.""",
        "branch": "feat/escrow-onchain-notifications",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Merchant webhooks for escrow verified/released events",
        "directory": "backend/src/services/webhookService.ts",
        "goal": "Add escrow-verification event types to the webhook dispatch system for merchant servers.",
        "description": """Merchants rely on webhooks for business events, but the dispatch system still lacks escrow lifecycle event types (`escrow.verified`, `escrow.released`). Merchants cannot automate against their escrow states.

This feature adds the event types to the subscription model and dispatches them with the on-chain proof payload, signed with the existing HMAC scheme.""",
        "requirements": """- Add `escrow.verified` and `escrow.released` to the `WebhookEvent` enum and the subscription model.
- Dispatch these events from the escrow verification and indexer-confirm paths with proof payloads.
- Keep the existing HMAC signing, retry/backoff, and `WebhookDeliveryAttempt` tracking.
- Add tests covering subscription to the new events, dispatch, and signature verification.""",
        "branch": "feat/escrow-webhook-events",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] E2E: lock → on-chain verify → release → re-verify flow",
        "directory": "backend/tests/e2e/escrowVerifyFlow.test.ts",
        "goal": "Full acceptance path with proof assertions at each escrow transition.",
        "description": """No end-to-end test walks the entire escrow verification journey: lock funds, verify on-chain, release, then re-verify the terminal state.

This issue adds that E2E flow on the standalone network, asserting the proof payload at each step.""",
        "requirements": """- On the standalone network: fund escrow → verify (assert status/balance/proof) → release → re-verify (assert released/zero balance).
- Assert the verification endpoint and attestation remain valid at each step.
- Assert the activity timeline shows the correct ordered transitions with proofs.
- Wire into `pnpm test` behind the standalone-network flag.""",
        "branch": "test/escrow-verify-flow-e2e",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Public proof-page verification endpoint (no auth)",
        "directory": "backend/src/controllers/escrowController.ts",
        "goal": "Let anyone with a proof token verify an escrow's on-chain status without logging in.",
        "description": """Customers and third parties may need to verify an escrow's on-chain status without an account (a shared proof link or an audit party).

This feature adds a public, unauthenticated verification endpoint gated by a proof token, returning signed, immutable responses that cannot be forged.""",
        "requirements": """- Add `GET /v1/public/escrow-proofs/:token` accepting a signed proof token issued from the escrow detail/export flow.
- Validate the token signature/expiry and return the (already signed) attestation payload; revoked tokens are rejected.
- Ensure the endpoint leaks nothing beyond the signed payload (no PII beyond proof fields) and is rate-limited.
- Add tests for valid, expired, tampered, and revoked tokens.""",
        "branch": "feat/public-escrow-proof-page",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Contract ID format and network-prefix validation",
        "directory": "backend/src/config/contractRegistry.ts",
        "goal": "Validate contract IDs and reject mismatched-network addresses at escrow creation time.",
        "description": """Escrows can be created holding a contract ID from the wrong network (e.g., a testnet address in mainnet), silently breaking verification and release later.

This enhancement adds contract-ID format and network-prefix validation at escrow creation time and in the registry resolver.""",
        "requirements": """- Implement format validation for Soroban contract IDs (G-prefix, length) and network-prefix inference where determinable.
- Validate contract IDs referenced at escrow creation and reject mismatched-network addresses with a clear 400.
- Apply the same check in the registry resolver for all contract keys.
- Add tests for valid, malformed, and cross-network contract references.""",
        "branch": "enhance/contract-id-validation",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Admin escrow ledger explorer (on-chain transactions per escrow)",
        "directory": "backend/src/controllers/adminEscrowController.ts",
        "goal": "List all on-chain transactions and events tied to one escrow for audit and support.",
        "description": """Support teams need to see every on-chain transaction and event for an escrow to answer "what happened" without manual RPC spelunking.

This feature adds an admin explorer endpoint returning all correlated on-chain transactions/events for a given escrow, with ledger details and confirmations.""",
        "requirements": """- Add `GET /v1/admin/escrows/:id/ledger` returning correlated transactions and events (source: event correlation layer + `EventLog`).
- Include ledger sequence, tx hash, event type, confirmation count, and timestamps; paginated.
- Guard with admin RBAC and audit-log explorer access.
- Add tests for populated, empty, and unknown escrow outcomes.""",
        "branch": "feat/admin-escrow-ledger-explorer",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Escrow activity timeline aggregation tests",
        "directory": "backend/tests/unit/services/escrowTimelineService.test.ts",
        "goal": "Test ordering, deduplication, and proof attachment in timeline output at scale.",
        "description": """The activity timeline must stay correct as it grows: ordering across ledgers, dedupe of repeated events, and proof attachment to each transition.

This issue requires thorough tests for the timeline aggregation service.""",
        "requirements": """- Seed seeded transitions across several ledgers and assert strict chronological ordering by `(ledgerSeq, eventIndex)`.
- Assert duplicate/re-delivered events collapse into one timeline entry.
- Assert every entry carries its proof payload (tx hash, ledger, confirmations) and the DTO shape is version-stable.
- Test pagination and large-timeline performance boundaries.
- Run `pnpm test:coverage escrowTimeline` at 80%+.""",
        "branch": "test/escrow-timeline",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Enhancement] Auto-refresh policy for stale escrow proofs",
        "directory": "backend/src/services/escrowProofCache.ts",
        "goal": "Automatically re-verify and refresh expired certs instead of serving stale confirmations.",
        "description": """Cached escrow proofs can go stale between TTL expiry and the next request, silently showing outdated confirmations.

This enhancement adds an auto-refresh policy: expired cache entries trigger an asynchronous re-verification so the next read serves fresh data, with a configurable staleness tolerance.""",
        "requirements": """- On cache expiry, treat reads as stale and kick off background re-verification (dedupe concurrent refreshes per key).
- Serve the previous value if within a `MAX_STALE_TOLERANCE` window, flagged `stale`, else block until verified.
- Integrate with ledger-confirmation changes to invalidate earlier than TTL when a newer confirmation lands.
- Add tests for refresh, stale-serving, and concurrent-refresh dedupe.""",
        "branch": "enhance/escrow-proof-autorefresh",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Escrow proof export (JSON/PDF snapshot)",
        "directory": "backend/src/services/escrowProofExportService.ts",
        "goal": "Generate downloadable, signed proof snapshots for customers and dispute records.",
        "description": """Customers and dispute arbiters need a human-readable, immutable proof of an escrow's on-chain state that can be saved or attached to records.

This feature adds a proof-export endpoint producing a signed JSON snapshot and a printable PDF summary of the escrow's verification state.""",
        "requirements": """- Add `GET /v1/escrows/:id/proof/export?format=json|pdf` returning the signed attestation payload as JSON or a rendered PDF.
- Include a scannable verification code on the PDF linking to the public proof endpoint.
- Rate-limit and audit-log exports; tie PDF generation to a templating service.
- Add tests covering both formats, signing, and auth gating.""",
        "branch": "feat/escrow-proof-export",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] E2E funding-window lapse → cancel → refund path",
        "directory": "backend/tests/e2e/escrowFundingWindow.test.ts",
        "goal": "Verify a lapsed funding window auto-cancels the delivery and refunds on-chain.",
        "description": """When an escrow funding window lapses, the backend must cancel the delivery and, where funds were partly confirmed, refund on-chain. This path is untested end to end.

This issue adds an E2E test for the lapse → cancel → refund journey on the standalone network.""",
        "requirements": """- Configure a short funding window; drive a delivery past the deadline and assert it transitions to cancelled with reason.
- Where funds were confirmed, assert an on-chain refund and the resulting verification state.
- Assert notifications/webhooks for cancellation fire for involved parties.
- Assert idempotent behavior when the lapse job re-runs.
- Wire into the standalone-network test gate.""",
        "branch": "test/escrow-funding-window-e2e",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Enhancement] Verification audit log (who verified what proof, when)",
        "directory": "backend/src/services/auditService.ts",
        "goal": "Record every verification request and proof view for compliance and forensics.",
        "description": """Proof verification requests have no audit trail, so it is impossible to know who verified which escrow proof and when. For compliance (and to detect scraping), every verification view should be logged.

This enhancement records verification requests and proof views in the audit log with actor, escrow, proof version, and outcome.""",
        "requirements": """- Log a structured audit entry for every verification request (public and authenticated), proof view, and export.
- Include actor (or token), escrow id, proof digest, outcome, and inferred IP/UA for public calls.
- Expose an admin query for the trail, filtered and paginated.
- Add tests for authenticated, public, and export audit events.""",
        "branch": "enhance/verification-audit-log",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Bulk escrow verification endpoint for fleets/enterprise",
        "directory": "backend/src/controllers/fleetController.ts",
        "goal": "Verify many escrows against on-chain state in one paginated request for dashboards.",
        "description": """Fleet dashboards may display dozens of active escrows; verifying each via individual HTTP calls is slow and RPC-heavy.

This feature adds a bulk verification endpoint (by fleet or delivery list) returning a concise per-escrow verification summary with pagination.""",
        "requirements": """- Add `GET /v1/fleets/:id/escrows/verify` returning a paginated list of `{ escrow, status, verified, balanceMatch?, ledger }` summaries.
- Bound the batch size and reuse the proof cache to absorb fan-in.
- Apply fleet-scoped authorization so a fleet sees only its own escrows.
- Add tests for bulk output, pagination, cache usage, and RBAC.""",
        "branch": "feat/bulk-escrow-verification",
        "labels": "backend,smart-contract,high"
    },

    # ══════════════════════════════════════════════════════════════════════════
    #   MILESTONE 3 — DELIVERY PROOF VERIFICATION ON-CHAIN (QR HANDOFF ↔ CONTRACT)
    # ══════════════════════════════════════════════════════════════════════════
    {
        "title": "[Feature] Contract-linked QR handoff token (v2)",
        "directory": "backend/src/services/deliveryQrService.ts",
        "goal": "Produce a v2 QR token embedding contract and network context.",
        "description": """The current QR handoff token encodes the delivery id and an HMAC but carries no contract or network context, so it cannot be validated against the smart contract by the scanning party.

This feature introduces a v2 token format embedding the contract address, network context, delivery reference, and a nonce, signed and versioned.""",
        "requirements": """- Define the v2 token payload (version, contract address, network, delivery ref, nonce, issued-at, expiry) with a canonical serialization.
- Sign the token and expose `generateHandoffQrV2` alongside the existing v1 generator.
- Retain v1 verification for backward compatibility during rollout.
- Add unit tests for token encoding/decoding, forging resistance, and version handling.""",
        "branch": "feat/qr-handoff-token-v2",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] On-chain handoff verification on recipient scan",
        "directory": "backend/src/controllers/delivery.controller.ts",
        "goal": "Verify QR tokens against contract state when a recipient scans.",
        "description": """When a recipient scans a QR, the backend currently checks only the local token signature. The roadmap requires token validity to be verified against contract state before any status change.

This feature verifies the scanned token against the contract (delivery created/assigned on-chain) before allowing any transition.""",
        "requirements": """- On scan, resolve the token's delivery/contract and cross-check the on-chain delivery state via the contract state reader.
- Only proceed if the token is valid AND the contract state matches expectations (e.g., delivery exists, not completed).
- Return a typed outcome (verified / mismatch / invalid) with a structured error for failed scans.
- Add tests: valid scans pass, contract mismatch blocks the transition, invalid token rejected.""",
        "branch": "feat/onchain-handoff-verification",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Backend-orchestrated on-chain completion submission on successful handoff",
        "directory": "backend/src/services/deliveryProofService.ts",
        "goal": "Automatically submit the handoff-complete transaction once QR verification succeeds.",
        "description": """After a successful handoff verification, the delivery completion should be recorded on-chain automatically, not left to a manual operation.

This feature automates submitting the completion transaction to the contract when handoff verification succeeds (using the transaction builder), with retry/DLQ handling.""",
        "requirements": """- Trigger the on-chain completion submission on verified handoff using the escrow/delivery transaction builder.
- Handle submission retries and DLQ escalation on failure; never mark the delivery completed locally without (eventual) on-chain success unless policy says otherwise (document it).
- Correlate the submitted tx in the activity timeline and fire notifications on completion.
- Add tests (with fake RPC) for success, transient failure+retry, and unrecoverable failure to DLQ.""",
        "branch": "feat/onchain-completion-submission",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Link proof-of-delivery uploads to contract attestation (photo hash on-chain)",
        "directory": "backend/src/services/proofOfDeliveryService.ts",
        "goal": "Stamp the content hash of uploaded delivery proof onto the contract as attestation.",
        "description": """Proof-of-delivery photos are stored off-chain with no on-chain anchor, so there is no tamper-evident link between the photo and the delivery record.

This feature computes the content hash of uploaded PoD files and records the attestation (hash on the contract or bound to the delivery's on-chain record) at upload time.""",
        "requirements": """- Compute a stable content hash per PoD upload and persist it with the proof record.
- Submit the hash as an on-chain attestation (or bind it into the completion submission) using the transaction builder.
- Expose the hash and its attestation status on delivery/proof endpoints.
- Add tests for hash computation, tamper detection, and attestation submission/recovery.""",
        "branch": "feat/pod-onchain-attestation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] E2E: QR scan → on-chain attestation → escrow release automation",
        "directory": "backend/tests/e2e/qrHandoffRelease.test.ts",
        "goal": "Match the roadmap's recommended flow end to end: handoff to release.",
        "description": """The roadmap's recommended flow — successful QR handoff verified by the backend automatically releases escrow — has no end-to-end proof.

This issue adds that E2E flow on the standalone network: scan → verify on-chain → attest → release, asserting funds move.""",
        "requirements": """- Drive the full path: generate v2 QR, scan, on-chain verification, PoD attestation, completion submission, and escrow release.
- Assert the escrow verification state reflects released and balances move correctly.
- Assert idempotency: a replayed scan cannot re-release.
- Wire into the standalone-network test gate.""",
        "branch": "test/qr-handoff-release-e2e",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Enhancement] QR token lifecycle states (issued/verified/expired/reused)",
        "directory": "backend/src/models/HandoffToken.ts",
        "goal": "Model and enforce token state transitions, exposing state via API.",
        "description": """Handoff tokens have no lifecycle model, so the backend cannot tell if a token was already used, expired, or revoked.

This enhancement adds a `HandoffToken` lifecycle (issued → verified / expired / revoked; reused guard) with state machine enforcement and an API to query current state.""",
        "requirements": """- Add a `HandoffToken` model with states and transition guards (verify only from issued; reject reused/expired/revoked).
- Persist each scan attempt and expose token state on the handoff status API.
- Enforce one-time verification per token with audit logging.
- Add tests for every allowed and denied transition.""",
        "branch": "enhance/qr-token-lifecycle",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] One-time-use anti-replay handoff token with nonce",
        "directory": "backend/src/services/deliveryQrService.ts",
        "goal": "Guarantee each token can be redeemed exactly once.",
        "description": """A captured QR screenshot could be replayed to trigger multiple actions. Tokens need a one-time-use guarantee backed by a distributed nonce check.

This feature enforces single redemption via a nonce stored in Redis/Mongo with atomic claim semantics: reuse attempts are rejected and logged.""",
        "requirements": """- Add a nonce per token and an atomic claim (Redis SETNX with fallback unique index) so only the first redeem succeeds.
- Reject and log reuse attempts with metadata (token, device, time).
- Integrate with the token lifecycle states so claim aligns with the verified/expired transitions.
- Add concurrency tests proving only one of N parallel redeems wins.""",
        "branch": "feat/antireplay-handoff-token",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] QR crypto utility tests (signature, expiry, revocation)",
        "directory": "backend/tests/unit/services/deliveryQrService.test.ts",
        "goal": "Cover the QR token crypto and lifecycle utility paths.",
        "description": """The QR token utilities (signing, verification, expiry, revocation) are central to handoff integrity and currently lack coverage.

This issue requires a full unit suite for the QR token crypto layer.""",
        "requirements": """- Test signing/verification round-trip and tampered-payload rejection.
- Test expiry: expired tokens are rejected with a typed error; TTL boundaries are exact.
- Test revocation: revoked tokens are rejected even before expiry.
- Test version handling (v1 vs v2) and nonce/uniqueness behavior.
- Run `pnpm test:coverage deliveryQrService` at 80%+.""",
        "branch": "test/qr-token-crypto",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Driver handoff confirmation with location + timestamp on-chain",
        "directory": "backend/src/services/driverHandoffService.ts",
        "goal": "Record driver-confirmed handoff location and time alongside the on-chain proof.",
        "description": """Drivers confirm handoffs, but the backend does not persist the confirmation location/time nor bind it to the on-chain proof record.

This feature records driver handoff confirmations (geolocation + timestamp) and attaches them to the on-chain completion/attestation flow.""",
        "requirements": """- Add a confirmation capture flow: driver confirms handoff with location + timestamp, validated and stored with the delivery proof record.
- Bind the confirmation into the completion submission payload/attestation.
- Expose confirmation details on delivery/proof endpoints for participants.
- Add tests for capture, validation, binding, and missing-location handling.""",
        "branch": "feat/driver-handoff-confirmation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] QR expiry policy and safe regeneration",
        "directory": "backend/src/services/deliveryQrService.ts",
        "goal": "Add configurable token TTL, renewal rules, and safe regeneration.",
        "description": """QR tokens have an ad hoc expiry with no policy for renewal or regeneration. Expired tokens may strand a handoff, and regeneration could invalidate a token mid-flight.

This enhancement formalizes the expiry policy (configurable TTL), renewal rules, and safe re-issue (regenerating invalidates the previous token atomically).""",
        "requirements": """- Add validated `QR_TOKEN_TTL_SECONDS` config and enforce expiry in verification.
- Define renewal: regenerate only before verification, atomically invalidating the prior token.
- Log every regeneration with reason and audit trail.
- Add tests for TTL borders, renewal invalidation, and concurrent regeneration safety.""",
        "branch": "enhance/qr-expiry-regeneration",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Delivery completion gating on verified on-chain proof",
        "directory": "backend/src/services/delivery.service.ts",
        "goal": "Prevent COMPLETED status unless a valid, verified on-chain handoff proof exists.",
        "description": """A delivery can currently be marked COMPLETED through status transitions without any on-chain proof that the handoff happened. The roadmap's model requires proof-gated completion.

This feature gates the canonical `COMPLETED` transition: it requires a verified on-chain handoff/attestation proof.""",
        "requirements": """- Add a completion gate in the delivery state machine: `COMPLETED` requires a verified on-chain handoff proof (or explicit admin override with reason).
- Expose the verification status on delivery detail so callers can see why completion is blocked.
- Keep a documented override path (admin/enterprise) with audit logging.
- Add tests covering every blocked and allowed transition (see companion testing issue).""",
        "branch": "feat/completion-proof-gate",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Proof-of-delivery content-hash integrity tests",
        "directory": "backend/tests/unit/services/proofOfDeliveryHash.test.ts",
        "goal": "Verify photo payload hashes match what is stored and asserted on-chain.",
        "description": """PoD hash integrity underpins the attestation; a mismatch between the stored file and its hash would undermine the whole proof model.

This issue adds integrity tests covering hash computation, storage, and on-chain assertion.""",
        "requirements": """- Assert the content hash of an uploaded fixture matches the persisted hash and the on-chain attestation value.
- Test tampered content (bit flip) fails recomputation comparison.
- Test the attestation path with a fake RPC: submission success, retry, and failure-to-DLQ.
- Run `pnpm test:coverage proofOfDelivery` at 80%+.""",
        "branch": "test/pod-content-hash",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Signed proof-of-delivery payload (metadata + location + time)",
        "directory": "backend/src/services/proofOfDeliveryService.ts",
        "goal": "Produce signed payloads combining proof metadata, coordinates, and timestamp.",
        "description": """Beyond the photo itself, a full PoD proof needs a signed payload binding metadata (delivery, driver), location, and timestamp so the handoff is tamper-evident as a whole.

This feature produces signed PoD payloads combining photo reference/hash, metadata, coordinates, and timestamp.""",
        "requirements": """- Build a canonical PoD payload (delivery ref, driver, photo hash, location, timestamp) and sign it with the attestation key.
- Persist the signed payload and expose it with a verification helper for third parties.
- Bind it into the completion/attestation flow described in the proof-gate feature.
- Add tests for signing, tamper detection, and payload schema stability.""",
        "branch": "feat/signed-pod-payload",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Handoff verification audit trail",
        "directory": "backend/src/services/auditService.ts",
        "goal": "Immutable log of every scan attempt, token, device, and IP.",
        "description": """Handoff scan attempts (success and failure) are not systematically audited, so abuse patterns and failed handoffs are invisible.

This enhancement records every scan attempt: token, outcome, device fingerprint, IP, and time, in the audit trail with admin query support.""",
        "requirements": """- Log every scan attempt with token, outcome (verified/invalid/expired/reused), device, IP, and timestamp.
- Batch-write attempts to avoid slowing the scan path; expose admin filtering/pagination.
- Add anomaly visibility (e.g., repeated-failure counts per token/IP).
- Add tests for write path, admin query, and data completeness.""",
        "branch": "enhance/handoff-audit-trail",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Enhancement] QR content specification v2 (versioned, contract-aware)",
        "directory": "backend/docs/qr-handoff-spec.md",
        "goal": "Document the machine-readable v2 token format with versioning and migration notes.",
        "description": """The v2 QR token format needs a written specification so scanners, frontends, and integrators can implement against it without reverse-engineering.

This enhancement writes the QR content specification v2: field layout, canonical serialization, signing, expiry, versioning, and v1→v2 migration notes.""",
        "requirements": """- Write `docs/qr-handoff-spec.md` specifying v2 fields, serialization, signature format, expiry, and version negotiation.
- Document the v1 compatibility path and rollout/deprecation plan.
- Include example tokens and verification pseudocode for scanners.
- Cross-reference the implementation and update the API/roadmap docs.""",
        "branch": "docs/qr-handoff-spec-v2",
        "labels": "backend,smart-contract,medium"
    },
    {
        "title": "[Testing] E2E replay and stale-token rejection",
        "directory": "backend/tests/e2e/qrReplayRejection.test.ts",
        "goal": "Assert reused, expired, and forged tokens are rejected end to end.",
        "description": """Anti-replay, expiry, and tamper defenses must hold not just in unit tests but across the real HTTP/socket path.

This issue adds E2E tests proving replay, stale, and forged token rejection through the actual endpoints.""",
        "requirements": """- Replay a successfully redeemed token and assert rejection with a typed error.
- Submit an expired token and a forged (bad signature) token; both must be rejected.
- Assert rejected scans are audited and do not mutate delivery state.
- Wire into the standalone-network test gate where applicable.""",
        "branch": "test/qr-replay-stale-rejection",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Public proof verification endpoint with signed content URL",
        "directory": "backend/src/controllers/proofController.ts",
        "goal": "Issue signed URLs that render verified delivery-proof pages to anyone with the link.",
        "description": """Third parties may need to view verified delivery proof (insurance, audit) without an account. Day-one this needs a shareable, verifiable proof experience.

This feature issues short-lived signed content URLs that render a verified PoD page (photo + signed metadata) to anyone with the link.""",
        "requirements": """- Add `POST /v1/deliveries/:id/proof/share` issuing a signed, expiring share URL (participant/admin only).
- The public view validates the URL signature and renders the signed PoD payload (photo + metadata) without auth.
- Enforce quota on issued links per delivery; revoke support added later.
- Add tests for issue, expiry, tamper, revocation, and RBAC gating.""",
        "branch": "feat/public-pod-share-link",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Handoff verification notifications (customer, fleet, driver)",
        "directory": "backend/src/services/notificationService.ts",
        "goal": "Notify all parties of successful and failed handoff attempts.",
        "description": """Parties currently discover handoff outcomes by polling. Real-time notice of success (and failure) improves trust and speeds resolution.

This enhancement sends push/socket notifications to customers, fleet operators, and drivers on handoff success and failure.""",
        "requirements": """- Emit notifications on handoff verified (success) and handoff failed (with reason) to the involved parties.
- Include proof/verification references in the notification payload; reuse the existing notification service and preference filters.
- Fire merchant webhooks for handoff events (add event types).
- Add tests asserting recipients, preferences, and payload fields.""",
        "branch": "enhance/handoff-notifications",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] Completion-gating unit tests across all status transitions",
        "directory": "backend/tests/unit/services/deliveryServiceCompleteness.test.ts",
        "goal": "Exhaustive coverage of transitions blocked by the proof gate.",
        "description": """The completion proof gate must be exhaustively tested: every allowed path completes correctly and every unproven path is blocked, including admin overrides.

This issue requires a comprehensive unit suite over the state machine gate.""",
        "requirements": """- Test each valid path to COMPLETED with verified proof (manual, QR, wallet-signature confirmations).
- Test every unproven transition to COMPLETED is blocked with the correct error and reason exposed.
- Test admin override completes with audit logging and reason required.
- Test that other statuses (CANCELLED etc.) are unaffected by the gate.
- Run `pnpm test:coverage deliveryService` at 80%+.""",
        "branch": "test/completion-gate-transitions",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Multi-package and bulk evidence bundle attestation",
        "directory": "backend/src/services/bundleAttestationService.ts",
        "goal": "Attest and verify multiple proof items for pooled or batch deliveries in one operation.",
        "description": """Pooled/batch deliveries produce multiple proof items (several photos/handoffs) that should be attested as one bundle, not one-by-one.

This feature attests a bundle of proof hashes in a single on-chain operation and exposes bundle-level verification.""",
        "requirements": """- Define a bundle attestation payload (ordered list of item hashes + metadata) and submit it in one transaction.
- Expose bundle verification (all items verifiable, list intact) and per-item status.
- Integrate with delivery completion gating for pooled deliveries.
- Add tests for bundle hash integrity, tamper, and submission paths.""",
        "branch": "feat/bundle-attestation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Recipient wallet-signature receipt confirmation (on-chain)",
        "directory": "backend/src/controllers/delivery.controller.ts",
        "goal": "Let recipients confirm receipt by signing with their Stellar wallet, stored on-chain.",
        "description": """Handoff verification currently relies on the QR path only. A stronger receipt confirmation lets the recipient cryptographically sign acceptance with their Stellar wallet (Freighter), stored as part of the on-chain record.

This feature integrates wallet-signature receipt confirmation into the completion proof flow.""",
        "requirements": """- Add a receipt-confirmation endpoint: recipient signs a message (delivery ref + timestamp) with their wallet; the backend verifies the signature.
- Bind the signed receipt into the completion submission/attestation and persist it.
- Support it as an alternate (or additional) trigger for the completion gate.
- Add tests for valid/expired/forged signatures and integration with the completion flow.""",
        "branch": "feat/wallet-receipt-confirmation",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Integration: handoff contract event → delivery status transition",
        "directory": "backend/tests/integration/handoffEventTransition.test.ts",
        "goal": "Verify the indexer translates verified-handoff events into correct local status changes.",
        "description": """When the contract emits a handoff-verified event, the indexer must translate it into the correct local delivery transition. This integration is untested.

This issue adds integration tests covering the handoff contract event → local status change path.""",
        "requirements": """- Emit a verified-handoff contract event (fake RPC) and assert the indexer maps it to the correct local transition (e.g., proof-verified state, eligible for completion).
- Assert dedupe: duplicate handoff events do not double-transition.
- Assert malformed handoff events are rejected without corrupting delivery state.
- Run `pnpm test` and iterate until green.""",
        "branch": "test/handoff-event-transition",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Testing] Concurrency/load test for simultaneous handoff verifications",
        "directory": "backend/load-tests/handoff-verification.js",
        "goal": "Ensure hundreds of concurrent scans verify without race or timeout.",
        "description": """Multiple drivers/recipients may scan different tokens concurrently; the anti-replay and verification paths must hold under load.

This issue adds a concurrency/load test for simultaneous handoff verifications.""",
        "requirements": """- Drive hundreds of concurrent scan requests against the verification endpoint with distinct tokens.
- Assert all succeed within latency bounds, no 5xx under load, and no cross-token interference.
- Assert the anti-replay claim remains exactly-once under race (single winner per token).
- Add a CI-friendly reduced variant.""",
        "branch": "test/handoff-concurrency-load",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Handoff verification status API for UI (issued/verified/expired)",
        "directory": "backend/src/controllers/handoffController.ts",
        "goal": "Let frontend dashboards display the on-chain handoff verification state per delivery.",
        "description": """The QR handoff system tracks token states (issued/verified/expired/reused) internally, but no query endpoint exposes that state. Frontend and mobile dashboards therefore cannot show drivers, customers, or fleet admins whether a handoff proof has been verified on-chain.

This feature adds a query API that returns the current handoff verification status for a delivery together with the associated on-chain proof context (ledger sequence, transaction hash, confirmation count, signature).""",
        "requirements": """- Add `GET /v1/handoff/deliveries/:id/status` returning the token lifecycle state (issued/verified/expired/reused) with timestamps and actor.
- Include the on-chain proof payload when verified: contract id, ledger sequence, transaction hash, and confirmation count (# style consistent with the escrow verification endpoint).
- Enforce participants-only access (customer, driver, fleet owner/admin) and reject cross-tenant lookups.
- Return 404 for deliveries with no handoff token and 409 for unverified/lapsed tokens with a structured explanation.
- Add route + service tests covering each lifecycle state, RBAC, and missing-token behavior.""",
        "branch": "feat/handoff-status-api",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Backward compatibility of QR payloads (v1 HMAC ↔ v2)",
        "directory": "backend/src/services/qrTokenService.ts",
        "goal": "Accept existing v1 tokens during the v2 rollout with deprecation logging.",
        "description": """The v2 contract-linked token format (contract address, network prefix, delivery reference, nonce) replaces the current v1 HMAC tokens. Until all clients regenerate tokens, the verification layer must continue accepting valid v1 tokens to avoid breaking in-flight deliveries.

This enhancement adds versioned payload parsing that validates v1 HMAC tokens alongside v2 tokens, marks them as legacy in responses, and logs deprecation warnings for observability of the migration.""",
        "requirements": """- Introduce a payload `version` discriminator and route v1 vs v2 validation paths, preserving the exact v1 HMAC scheme already in production.
- Keep v1 acceptance feature-flagged (`QR_V1_ALLOWED=true` by default) so the flag can be switched off once migration completes.
- Emit a structured `qr_v1_legacy_used` log/metric on every v1 verification for deprecation tracking.
- Document the migration path (v2 rollout steps and v1 sunset date policy) in the QR content spec and add tests covering mixed v1/v2 verification.""",
        "branch": "enhance/qr-v1-backward-compat",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Proof-verification health metrics for admins",
        "directory": "backend/src/services/metricsService.ts",
        "goal": "Surface handoff proof-verification success rates, failure reasons, and expiry patterns to admins.",
        "description": """Admins currently cannot see how the QR/proof verification system is behaving in production: success rates, failure reasons (forged, expired, reused, malformed), or expiry patterns. Incidents (e.g., a surge of forged tokens) become visible only through support channels.

This feature aggregates verification telemetry into an admin dashboard/API surface plus Prometheus counters.""",
        "requirements": """- Track counters per outcome: success, forged, expired, reused, malformed, and network-failure.
- Expose an admin endpoint `GET /v1/admin/proof-metrics` (admin RBAC, interval query params) summarizing rates and top failure reasons.
- Publish Prometheus metrics (`handoff_verifications_total{outcome}`, `handoff_token_lifetime_seconds` histogram) on the `/metrics` endpoint.
- Add tests asserting counters increment correctly and the admin aggregation matches the recorded events.
- Document the new metrics in the admin runbook and operations docs.""",
        "branch": "feat/proof-health-metrics",
        "labels": "backend,smart-contract,high"
    },

    # ══════════════════════════════════════════════════════════════════════════
    #   MILESTONE 4 — BLOCKCHAIN EVENT LISTENERS (WEBSOCKET FEEDS FROM EVENTS)
    # ══════════════════════════════════════════════════════════════════════════
    {
        "title": "[Feature] Live Soroban contract-event feed over WebSocket",
        "directory": "backend/src/sockets/connectionHandler.ts",
        "goal": "Stream decoded, typed on-chain events to connected clients.",
        "description": """Clients cannot currently receive on-chain events (escrow, delivery, dispute, reputation) in real time; they must poll REST endpoints.

This feature adds a live WebSocket feed streaming decoded, typed contract events to connected clients as the indexer confirms them.""",
        "requirements": """- Add a socket event (`contract_event`) broadcasting decoded on-chain events with proof context (ledger, tx hash, confirmation count).
- Scope delivery by auth/role: users only receive events they are party to (fleet-scoped scoping in a companion issue).
- Preserve client-visible ordering by ledger sequence and version payloads.
- Add socket integration tests for emission, ordering, and unauthorized exclusion.""",
        "branch": "feat/live-token-event-feed",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Per-delivery socket rooms for on-chain event fan-out",
        "directory": "backend/src/sockets/deliveryRooms.ts",
        "goal": "Scope on-chain events to delivery rooms so clients only receive relevant events.",
        "description": """Broadcasting every on-chain event to every client leaks unrelated activity and wastes bandwidth. Clients should only receive events for deliveries they participate in.

This feature scopes on-chain event fan-out to `delivery:<id>` rooms, so a client receives events only for its own deliveries and escrows.""",
        "requirements": """- Emit on-chain events into `delivery:<id>` rooms after ingestion, alongside any global admin-only channels.
- Enforce room membership on join (participant, driver, fleet member, or staff) using the existing join/leave infrastructure.
- Keep ordering by ledger within each room and include proof context in the payload.
- Add socket integration tests: events fan out to the right room only; non-members receive nothing.""",
        "branch": "feat/delivery-scoped-event-rooms",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Feature] Confirmation-count metadata on streamed events (pending vs confirmed)",
        "directory": "backend/src/services/eventFeedService.ts",
        "goal": "Tag streamed events with confirmation count so clients can tell tentative from final.",
        "description": """Soroban events can be observed before final confirmation; streaming them without context can mislead clients into acting on unconfirmed state.

This feature tracks and tags each streamed event with its current confirmation count and a `pending`/`confirmed` verdict, re-broadcasting when the count crosses the confirmation threshold.""",
        "requirements": """- Track confirmation counts per event (from the ledger view) and emit an initial `pending` frame plus a `confirmed` update when the threshold is reached.
- Include `confirmations`, `requiredConfirmations`, and verdict in the event payload and typed contract.
- Send a `contract_event_updated` frame on confirmation change; dedupe clients' handling via a stable event id.
- Add tests for pending→confirmed transitions, ordering, and idempotent client handling.""",
        "branch": "feat/event-confirmation-metadata",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Typed socket event contract for on-chain events",
        "directory": "backend/src/sockets/eventContracts.ts",
        "goal": "Define and enforce a typed, versioned payload schema for every streamed event.",
        "description": """Streamed on-chain events have no formal payload contract, so clients and servers can drift silently.

This enhancement defines a typed, versioned socket event contract (canonical field names, versions, validation on emit) enforced at emission and on the client-facing documentation.""",
        "requirements": """- Define Zod schemas and TS types for every streamed event family with a `version` field.
- Validate frames at emission (reject/log non-conforming payloads) and expose the contract for clients.
- Keep an enum of event names and document payloads in the socket protocol docs.
- Add conformance tests that validate emitted frames against the contracts.""",
        "branch": "enhance/typed-socket-event-contract",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] Socket event payload contract conformance tests",
        "directory": "backend/tests/unit/sockets/eventContracts.test.ts",
        "goal": "Validate all emitted on-chain frames against the typed contracts.",
        "description": """With typed socket contracts in place, emission must be conformance-tested so refactors cannot silently break the wire format.

This issue adds automated conformance tests validating every emitted on-chain event frame against its schema.""",
        "requirements": """- Emit each event family through the feed and assert the frame validates and carries the expected fields/version.
- Test rejection logging for non-conforming payloads (fault injection) and that emission is blocked or flagged.
- Assert version transitions (v1 vs v2) are handled and compatible.
- Run `pnpm test:coverage eventContracts` at 80%+.""",
        "branch": "test/socket-event-conformance",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Topic-based subscribe/unsubscribe (event type + contract filters)",
        "directory": "backend/src/sockets/connectionHandler.ts",
        "goal": "Let clients subscribe to specific on-chain event topics.",
        "description": """Clients currently receive the full room stream; many only care about a subset (e.g., only `escrow_released` for one contract).

This feature adds topic-based subscribe/unsubscribe: clients subscribe to specific (event type + contract) topics and receive only filtered frames.""",
        "requirements": """- Add socket events `subscribe`/`unsubscribe` accepting topic specs (event type, optional contract id) with validation.
- Maintain per-connection topic filters applied before fan-out; enforce a per-connection topic budget (see rate-limit enhancement).
- Return an ACK with the effective subscription list and errors for invalid specs.
- Add tests for filtering, ACK payloads, and boundary specs.""",
        "branch": "feat/topic-subscription",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Backpressure handling for slow consumers",
        "directory": "backend/src/sockets/backpressure.ts",
        "goal": "Detect slow consumers and protect the feed without harming others.",
        "description": """A slow socket consumer can buffer unboundedly and eventually degrade the Node process. The feed needs backpressure handling.

This enhancement detects slow consumers (growing send backlog), applies policy (buffer with cap, back off, or disconnect), and protects other subscribers.""",
        "requirements": """- Track per-connection send backlog and latency; define thresholds in config.
- Apply escalating policy: buffer (capped) → back off topic delivery → disconnect with a typed reason, per connection only.
- Log backpressure events and expose metrics (per-connection drops).
- Add behavior tests matching the policy thresholds and clean recovery (see companion testing issue).""",
        "branch": "enhance/socket-backpressure",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Cursor-based replay of missed on-chain events on reconnection",
        "directory": "backend/src/services/eventFeedService.ts",
        "goal": "Let reconnecting clients resume from their last cursor without gaps.",
        "description": """Clients that disconnect miss events; on reconnect they have no way to catch up without scraping REST endpoints.

This feature adds cursor-based replay: the server persists a per-client cursor, and on reconnect the client provides a cursor to receive missed events in order before live frames resume.""",
        "requirements": """- Issue opaque, per-connection cursors (ledger seq + event index) on connect and after each event.
- On reconnect with a cursor, replay missed events from the event log/archive in order, then resume live.
- Validate cursors (reject stale/forged) and bound replay size with pagination if huge.
- Add tests for ordered, gapless replay and cursor validation (see companion testing issue).""",
        "branch": "feat/event-cursor-replay",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Reconnect replay tests (ordering + no gaps)",
        "directory": "backend/tests/integration/sockets/reconnectReplay.test.ts",
        "goal": "Simulate disconnects and assert gapless, ordered replay from the cursor.",
        "description": """Cursor replay must be proven: simulated disconnects at arbitrary points must result in exactly-once, in-order recovery.

This issue adds integration tests for reconnect replay behavior.""",
        "requirements": """- Simulate disconnects after 0, 1, and k events and assert replay covers exactly the missed set in order.
- Assert no duplicate or skipped events across multiple reconnect cycles (end state equals live-connection baseline).
- Test stale/forged cursor rejection and replay cap behavior (pagination).
- Run the socket integration tests until green.""",
        "branch": "test/reconnect-replay",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Fleet-scoped multi-tenant isolation on event streams",
        "directory": "backend/src/sockets/multiTenancy.ts",
        "goal": "Guarantee a fleet only receives events for its own deliveries and escrows.",
        "description": """A fleet operator must never receive another tenant's on-chain events. Membership rules must be enforced at the stream level.

This feature enforces fleet-scoped multi-tenant isolation: every event frame is filtered by the recipient's fleet/delivery membership before fan-out.""",
        "requirements": """- Resolve a client's fleet(s) and delivery memberships at connect and classify each event's tenant scope.
- Filter all fan-out against the tenant scope; treat unknown scope as non-deliverable (no leak).
- Cover driver-at-multiple-fleets and admin staff (global, audited) edge cases.
- Add multi-tenant isolation tests: cross-fleet events never delivered, and RBAC denials with logs.""",
        "branch": "feat/fleet-scoped-event-streams",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Rate limiting and subscription budget per connection",
        "directory": "backend/src/sockets/rateLimit.ts",
        "goal": "Protect the event feed with per-connection topic and message budgets.",
        "description": """The event feed can be abused by clients subscribing to unbounded topics or flooding control messages.

This enhancement enforces per-connection limits: max topics, max messages/sec, and max backlog, with typed rejection responses and logging.""",
        "requirements": """- Add validated config for max topics/connection, message rate, and backlog caps.
- Enforce at subscribe and at emit boundaries; return typed errors for violations.
- Log violations and expose aggregate metrics; allow admin exemptions for whitelisted service accounts.
- Add tests for each limit boundary and exemption path.""",
        "branch": "enhance/event-stream-rate-limit",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Admin live channel (ingestion lag, processed counts, errors)",
        "directory": "backend/src/sockets/adminChannel.ts",
        "goal": "Broadcast indexer health to admins in real time.",
        "description": """Admins monitor the indexer via polling endpoints today; a live operations channel gives instant visibility into ingestion health.

This feature adds an admin-only WebSocket channel broadcasting ingestion lag, processed counts, and errors in real time.""",
        "requirements": """- Add an admin-only channel emitting `indexer_lag`, `indexer_processed`, and `indexer_error` frames from metrics sources.
- Enforce admin role on connect/join; audit channel access.
- Tie frame cadence to metric updates (not a busy loop) and version payloads.
- Add tests for authorization and payload contents.""",
        "branch": "feat/admin-live-channel",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] E2E: on-chain events (lock/release/dispute/reputation) delivered over socket",
        "directory": "backend/tests/e2e/socketEventDelivery.test.ts",
        "goal": "Full path from contract emission to client-visible socket frame per event family.",
        "description": """Each on-chain event family (escrow lock/release, dispute, reputation) must flow from contract emission through the indexer to a client-visible socket frame.

This issue adds an E2E test for that full path across all families.""",
        "requirements": """- On the standalone network, emit each family's contract event and assert the client socket receives the expected frame (correct room, payload, proof context).
- Assert ordering and the pending→confirmed transition metadata on each.
- Assert a non-participant client receives nothing for the same events.
- Wire into the standalone-network test gate.""",
        "branch": "test/socket-event-delivery-e2e",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Presence/heartbeat linked to on-chain activity status",
        "directory": "backend/src/sockets/presenceService.ts",
        "goal": "Expose online/active status enriched with latest on-chain activity.",
        "description": """Basic presence (online/offline) exists, but nothing links a user's activity to their latest on-chain state.

This feature extends presence with on-chain activity context: drivers' presence payload includes their latest delivery/escrow event status (e.g., awaiting release), enabling richer dashboards.""",
        "requirements": """- Extend presence payloads with a computed `activityStatus` from the latest correlated on-chain event per participant.
- Update activity status on event ingestion and push presence updates to subscribers.
- Keep status derivation fast (cached) and fall back to simple online/offline on errors.
- Add tests for status derivation, updates, and fallback.""",
        "branch": "feat/presence-onchain-activity",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Event serialization versioning (forward-compatible)",
        "directory": "backend/src/sockets/eventContracts.ts",
        "goal": "Version event payloads so clients can detect and adapt to schema changes.",
        "description": """Streamed payloads change as features evolve; without versioning, old clients break silently.

This enhancement formalizes payload versioning: every event family carries a version, old versions remain decodable, and new versions are additive.""",
        "requirements": """- Include `schemaVersion` in every emitted payload and document the family by version.
- Keep decoders for prior versions for a defined window (configurable) and log deprecation when old versions are served.
- Ensure new fields are additive (never reorder/rename existing fields) per the documented contract.
- Add tests for multi-version decode and forward compatibility.""",
        "branch": "enhance/event-versioning",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Feature] Webhook-to-socket bridge (optional WS delivery of webhook events)",
        "directory": "backend/src/services/webhookSocketBridge.ts",
        "goal": "Deliver webhook events over WebSocket for clients that prefer one realtime channel.",
        "description": """Merchants currently receive business events via HTTP webhooks; some integrators prefer a single WebSocket channel.

This feature adds an optional bridge: subscribed webhook events are also delivered over WebSocket for opted-in clients, sharing the same event contract and signing envelope.""",
        "requirements": """- Add an opt-in per client/subscription to receive webhook events over the socket bridge.
- Forward dispatched webhook events to the socket feed with the same typed contract (plus delivery-attempt metadata).
- Enforce scoping/tenant rules and rate limits on the bridge; keep HTTP webhook delivery unchanged.
- Add tests for opt-in behavior, scoping, and concurrent delivery parity.""",
        "branch": "feat/webhook-socket-bridge",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Load test: 10k concurrent consumers on the event feed",
        "directory": "backend/load-tests/socket-event-feed.js",
        "goal": "Prove the feed sustains 10,000 concurrent subscribers with bounded latency and no dropped frames.",
        "description": """The roadmap's scaling concerns call out socket load explicitly, yet no load test measures the on-chain event feed at scale.

This issue adds a load test with 10,000 concurrent consumers asserting bounded latency, memory, and zero dropped frames under sustained event volume.""",
        "requirements": """- Spin up 10k simulated consumers across delivery rooms with a sustained event stream.
- Assert p95 frame latency below a defined budget, no dropped frames, and bounded memory.
- Assert room isolation stays correct under load (no cross-room leakage).
- Provide a CI-friendly reduced variant (e.g., 1k consumers).""",
        "branch": "test/event-feed-load-10k",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Event stream compaction for redundant status events",
        "directory": "backend/src/services/eventFeedService.ts",
        "goal": "Coalesce consecutive redundant status events to reduce fan-out volume.",
        "description": """Repeated identical status updates (e.g., several `in_progress` heartbeats) create redundant frames that add little value and consume bandwidth.

This feature compacts the stream: consecutive redundant status events for the same entity coalesce into one latest-state frame, with a configurable window.""",
        "requirements": """- Define compactable families (stateful status events) vs always-emit events (transitions) per contract.
- Coalesce within a window while preserving ordering of non-compactable events and final state correctness.
- Emit a `compacted` marker on coalesced frames; never lose the terminal event.
- Add tests asserting correct coalescing, final-state delivery, and non-compactable passthrough.""",
        "branch": "feat/event-stream-compaction",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Fine-grained socket auth scopes for subscription tokens",
        "directory": "backend/src/sockets/socketAuth.ts",
        "goal": "Subscription tokens scoped to specific topics and expiry, enforced on connect.",
        "description": """Socket subscriptions currently inherit the full JWT and its permissions. There is no way to issue a bounded, transient subscription credential.

This enhancement adds scoped subscription tokens: short-lived credentials bound to specific topics/rooms and expiry, enforced at connect.""",
        "requirements": """- Issue scoped subscription tokens (topics, rooms, expiry) reducible from an authenticated user or admin.
- Enforce the scope at connect/join (topic requests outside scope are rejected with typed errors).
- Support revocation (Redis deny-list) and rotation.
- Add tests for scope enforcement, expiry, revocation, and rotation.""",
        "branch": "enhance/scoped-subscription-tokens",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] Deduplication tests across WS and webhook consumers",
        "directory": "backend/tests/integration/consumerDedupe.test.ts",
        "goal": "Assert the same event delivered via socket and webhook is processed idempotently.",
        "description": """Consumers may receive the same event over both the socket feed and HTTP webhooks; downstream processing must be idempotent.

This issue adds tests proving an event delivered through both channels is handled exactly once downstream.""",
        "requirements": """- Deliver the same event via socket and webhook to an in-memory consumer and assert single processing (idempotent guard downstream).
- Assert event ids stable across channels and delivery-attempt records dedupe correctly.
- Test partial failure (one channel drops, other delivers) ends in the same final state.
- Wire into `pnpm test`.""",
        "branch": "test/consumer-dedupe",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Snapshot + live replay for newly subscribing clients",
        "directory": "backend/src/services/eventFeedService.ts",
        "goal": "Give new subscribers current entity state then live events.",
        "description": """A client subscribing mid-life sees only subsequent events and must fetch current state separately. A snapshot+live pattern solves this.

This feature sends a current snapshot (entity states for the subscribed topics) immediately after subscribe, followed by live events, so the client converges without extra REST calls.""",
        "requirements": """- On subscribe, build and send a snapshot payload per topic (current state of relevant entities) before live frames.
- Version and bound snapshot size (paginate for large topics), and retry failed snapshot delivery.
- Keep snapshot and live stream consistent at the boundary (no gap/duplicate between snapshot end and live start).
- Add tests for snapshot correctness, boundaries, and pagination.""",
        "branch": "feat/snapshot-live-replay",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Enhancement] Graceful event-stream drain on shutdown",
        "directory": "backend/src/sockets/connectionHandler.ts",
        "goal": "Flush in-flight frames and cursors before the server exits to prevent loss.",
        "description": """On shutdown, in-flight socket frames can be lost and cursors not persisted, causing clients to miss events they should have gotten.

This enhancement drains the event stream on shutdown: stop ingesting, flush buffered frames, persist cursors, then close cleanly within the shutdown timeout.""",
        "requirements": """- Integrate the event feed into the graceful shutdown service (stop ingestion → flush streams → persist cursors → close sockets).
- Flush within `SHUTDOWN_TIMEOUT_MS` and log any dropped tail with a clear marker.
- Persist client cursors atomically so reconnect replay covers the drained tail.
- Add tests simulating shutdown mid-stream and asserting flushed/cursor behavior.""",
        "branch": "enhance/event-stream-graceful-drain",
        "labels": "backend,enhancement,smart-contract,high"
    },
    {
        "title": "[Testing] Slow-consumer backpressure behavioral tests",
        "directory": "backend/tests/unit/sockets/backpressure.test.ts",
        "goal": "Verify backpressure policy triggers at thresholds and recovery is clean.",
        "description": """Backpressure policies must be behavior-tested: exactly when buffer/backoff/disconnect triggers, and how connections recover.

This issue adds unit behavioral tests for the backpressure handler.""",
        "requirements": """- Test buffer-capped writes trigger at the configured cap; backoff engages and disconnects above the disconnect threshold.
- Test recovery: a connection that clears its backlog returns to normal delivery with no dropped final events.
- Test per-connection isolation (one slow consumer never affects others) and metric emission.
- Run `pnpm test:coverage backpressure` at 80%+.""",
        "branch": "test/backpressure-behavior",
        "labels": "backend,testing,smart-contract,high"
    },
    {
        "title": "[Feature] Prometheus metrics for per-topic consumption lag",
        "directory": "backend/src/services/metricsService.ts",
        "goal": "Expose stream lag and consumer health metrics per topic for ops dashboards.",
        "description": """Operators cannot currently see per-topic consumption lag or consumer health for the event feed.

This feature adds Prometheus metrics: per-topic lag (latest event vs last delivered), active consumers, and delivery failure counts.""",
        "requirements": """- Add metrics: `event_feed_last_emitted_offset{topic}`, `event_feed_consumer_lag{topic}`, `event_feed_active_consumers{topic}`, `event_feed_delivery_failures_total{topic}`.
- Emit on the `/metrics` endpoint with documented labels; update admin live channel frames accordingly.
- Add tests asserting metric presence/values under simulated lag and consumer churn.""",
        "branch": "feat/event-topic-lag-metrics",
        "labels": "backend,smart-contract,high"
    },
    {
        "title": "[Testing] Chaos: RPC outage → stream recovery and resync",
        "directory": "backend/tests/e2e/socketRpcOutage.test.ts",
        "goal": "Simulate RPC failure during live streaming and verify automatic recovery, no gaps.",
        "description": """If Soroban RPC fails while clients are live, the feed should pause gracefully, resume on recovery, and resync missed events for subscribers.

This issue adds a chaos E2E test for RPC outage → stream recovery → resync.""",
        "requirements": """- Simulate an RPC outage mid-stream; assert the feed stops cleanly (no partial frames) and clients are notified of a paused state.
- Restore RPC; assert automatic resume and gapless resync for consumers (cursor replay covers the outage window).
- Assert ingestion metrics/lag recover and alerts clear after resync.
- Wire into the standalone-network test gate.""",
        "branch": "test/rpc-outage-stream-recovery",
        "labels": "backend,testing,smart-contract,high"
    },
]

print("\n════════════════════════════════════════════════════")
print("  📋 GENERATING SWIFTCHAIN BACKEND ISSUES (PHASE 3 — SMART CONTRACT INTEGRATION — BATCH 04)")
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