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
- [ ] **Using an AI Agent to submit a PR is DISALLOWED.**
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
- AI Agent submissions are **DISALLOWED** and will be closed without review.
- No Inline Mock Objects or Hardcoded Values usage for integration.
"""

def create_issue(title: str, directory: str, goal: str, requirements: str, branch: str, labels: str) -> None:
    print(f"\n🆕 Creating: {title}")

    body = ISSUE_TEMPLATE.format(
        directory=directory,
        goal=goal,
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
    # Low Complexity
    {
        "title": "[Feature] Add a comprehensive /health endpoint that checks MongoDB connectivity and Stellar RPC status",
        "directory": "backend/src/controllers/healthController.ts",
        "goal": "Provide a comprehensive health check endpoint for monitoring.",
        "requirements": "- Create GET /health.\\n- Check MongoDB connection status.\\n- Check Stellar RPC connection.\\n- Return 200 if all healthy, 503 if services are down.",
        "branch": "feat/health-endpoint",
        "labels": "backend,low"
    },
    {
        "title": "[Refactor] Standardize API JSON response wrappers across all controllers",
        "directory": "backend/src/utils/responseWrapper.ts",
        "goal": "Ensure all API responses follow a strict { success, data, error, message } format.",
        "requirements": "- Create a standard response utility.\\n- Refactor existing controllers to use this utility.\\n- Ensure consistent JSON structure across the app.",
        "branch": "refactor/standardize-api-responses",
        "labels": "backend,low"
    },
    # Medium Complexity
    {
        "title": "[Enhancement] Implement Rate Limiting and Brute Force protection",
        "directory": "backend/src/middlewares/rateLimiter.ts",
        "goal": "Protect specific endpoints like Auth and Escrow against brute-force attacks.",
        "requirements": "- Install and configure `express-rate-limit`.\\n- Apply strict limits to Auth endpoints.\\n- Apply rate limits to Escrow endpoints.",
        "branch": "feat/rate-limiting-auth-escrow",
        "labels": "backend,security,medium"
    },
    {
        "title": "[Enhancement] Set up Swagger/OpenAPI 3.0 documentation for all REST endpoints",
        "directory": "backend/src/docs/swagger.ts",
        "goal": "Provide comprehensive API documentation.",
        "requirements": "- Define OpenAPI 3.0 specs for all REST endpoints.\\n- Serve the documentation via Swagger UI at `/api-docs`.",
        "branch": "feat/swagger-openapi-docs",
        "labels": "backend,medium"
    },
    {
        "title": "[Refactor] Create a standardized pagination, sorting, and filtering middleware",
        "directory": "backend/src/middlewares/queryMiddleware.ts",
        "goal": "Abstract MongoDB query logic for pagination, sorting, and filtering.",
        "requirements": "- Implement middleware to parse `page`, `limit`, `sort`, and filters from req.query.\\n- Apply to Deliveries and Users endpoints.\\n- Return metadata like total pages and counts.",
        "branch": "refactor/pagination-middleware",
        "labels": "backend,medium"
    },
    {
        "title": "[Enhancement] Implement a centralized Audit Log system to track Admin actions",
        "directory": "backend/src/models/AuditLog.ts",
        "goal": "Keep a strict record of all administrative actions.",
        "requirements": "- Create an AuditLog schema.\\n- Log actions like suspensions, refunds, and role changes.\\n- Include admin ID, action type, target ID, and timestamp.",
        "branch": "feat/admin-audit-log",
        "labels": "backend,medium"
    },
    # High Complexity - Testing
    {
        "title": "[Testing] Write End-to-End (E2E) tests for the complete Escrow lifecycle",
        "directory": "backend/tests/e2e/escrow.test.ts",
        "goal": "Ensure the escrow process works from creation to release/refund.",
        "requirements": "- Simulate the Escrow lifecycle (Create -> Fund -> Release/Refund).\\n- Mock Soroban smart contract interactions.\\n- Validate database states at each step.",
        "branch": "test/e2e-escrow-lifecycle",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Implement E2E integration tests for Driver Location Socket.io events",
        "directory": "backend/tests/integration/socketLocation.test.ts",
        "goal": "Test real-time location updates via WebSockets.",
        "requirements": "- Connect test clients to Socket.io.\\n- Emit `driver_location_update` events.\\n- Verify broadcasts are received by clients in the correct delivery room.",
        "branch": "test/socket-location-events",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Create load tests for Socket.io to ensure handling of 10,000 concurrent updates",
        "directory": "backend/load-tests/socket.js",
        "goal": "Verify WebSocket performance under heavy load.",
        "requirements": "- Use Artillery or k6 to simulate up to 10,000 concurrent driver connections.\\n- Send periodic location updates.\\n- Measure latency and memory usage.",
        "branch": "test/socket-load-testing",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Implement integration tests for the Delivery ETA calculation",
        "directory": "backend/tests/integration/deliveryEta.test.ts",
        "goal": "Verify distance and ETA calculation accuracy.",
        "requirements": "- Test Google Maps API integration with mocked responses.\\n- Test the Haversine fallback logic.\\n- Compare outputs against expected ETA bounds.",
        "branch": "test/delivery-eta-calculation",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Add Mutation Testing (e.g., Stryker) to the Jest test suite",
        "directory": "backend/stryker.conf.json",
        "goal": "Ensure high test quality and catch false positives.",
        "requirements": "- Integrate Stryker mutator.\\n- Configure to run against core business logic services.\\n- Achieve an acceptable mutation score.",
        "branch": "test/mutation-testing-stryker",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Write unit tests for all Mongoose schema pre/post hooks",
        "directory": "backend/tests/unit/models/",
        "goal": "Ensure database hooks behave correctly.",
        "requirements": "- Test password hashing on User save/update.\\n- Test soft delete cascading logic.\\n- Validate timestamps and indexing.",
        "branch": "test/mongoose-schema-hooks",
        "labels": "backend,testing,high"
    },
    {
        "title": "[Testing] Implement automated test coverage enforcement in CI/CD",
        "directory": ".github/workflows/ci.yml",
        "goal": "Enforce code coverage metrics for all PRs.",
        "requirements": "- Configure Jest coverage thresholds (minimum 80%).\\n- Update GitHub Actions CI pipeline to fail if coverage drops below the threshold.\\n- Generate coverage reports.",
        "branch": "feat/ci-coverage-enforcement",
        "labels": "backend,testing,high"
    },
    # High Complexity - Refactoring
    {
        "title": "[Refactor] Decouple Socket.io event handlers into isolated, fully testable service classes",
        "directory": "backend/src/sockets/",
        "goal": "Improve WebSocket code maintainability and testability.",
        "requirements": "- Move business logic out of socket event listeners.\\n- Create dedicated service classes for handling socket events.\\n- Write unit tests for the extracted logic.",
        "branch": "refactor/socket-event-handlers",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Implement a Repository Pattern to abstract direct Mongoose DB calls",
        "directory": "backend/src/repositories/",
        "goal": "Separate business logic from database access logic.",
        "requirements": "- Create Repository classes for Deliveries, Users, and Escrows.\\n- Refactor Services to use Repositories instead of direct Mongoose models.\\n- Standardize CRUD operations.",
        "branch": "refactor/repository-pattern",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Refactor the Stellar/Soroban service to handle network timeouts and retries",
        "directory": "backend/src/services/stellarService.ts",
        "goal": "Make blockchain interactions more resilient.",
        "requirements": "- Implement Exponential Backoff strategy for RPC calls.\\n- Handle network timeouts gracefully.\\n- Log failed attempts and recovery.",
        "branch": "refactor/stellar-retry-backoff",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Migrate all scattered hardcoded environment variables into the centralized zod schema",
        "directory": "backend/src/config/env.ts",
        "goal": "Ensure all configurations are strongly typed and validated.",
        "requirements": "- Identify hardcoded `process.env` calls.\\n- Move them to the Zod schema in `env.ts`.\\n- Update codebase to use the validated `env` object.",
        "branch": "refactor/centralize-env-vars",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Implement a unified Logging Interface (Winston/Pino) with log rotation and PII masking",
        "directory": "backend/src/config/logger.ts",
        "goal": "Standardize logging and secure sensitive information.",
        "requirements": "- Set up Winston or Pino.\\n- Configure log rotation for file outputs.\\n- Implement a format to mask PII (emails, passwords, keys) before logging.",
        "branch": "refactor/unified-logging-pii",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Optimize MongoDB geospatial indexes (2dsphere) for driver proximity queries",
        "directory": "backend/src/models/DriverLocation.ts",
        "goal": "Speed up geospatial queries for driver assignments.",
        "requirements": "- Review current schema for location data.\\n- Add or optimize `2dsphere` indexes.\\n- Profile query performance to ensure fast proximity lookups.",
        "branch": "refactor/optimize-geospatial-indexes",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Implement a Dependency Injection (DI) container (TSyringe or Awilix)",
        "directory": "backend/src/di/",
        "goal": "Manage service dependencies cleanly and improve testability.",
        "requirements": "- Setup a DI container.\\n- Register Repositories, Services, and Controllers.\\n- Refactor application initialization to use the container.",
        "branch": "refactor/dependency-injection",
        "labels": "backend,high"
    },
    {
        "title": "[Refactor] Extract JWT authentication logic to support HttpOnly cookies",
        "directory": "backend/src/middlewares/auth.ts",
        "goal": "Enhance XSS protection by using HttpOnly cookies.",
        "requirements": "- Modify login endpoints to set HttpOnly cookies for JWTs.\\n- Update auth middleware to read from cookies.\\n- Ensure CSRF protections are in place.",
        "branch": "refactor/jwt-httponly-cookies",
        "labels": "backend,security,high"
    },
    # High Complexity - Features
    {
        "title": "[Feature] Implement a Refresh Token mechanism to handle prolonged sessions",
        "directory": "backend/src/controllers/authController.ts",
        "goal": "Provide secure, long-lived sessions for drivers and users.",
        "requirements": "- Issue a short-lived access token and a long-lived refresh token.\\n- Create an endpoint to refresh access tokens.\\n- Store refresh tokens securely and handle revocation.",
        "branch": "feat/refresh-tokens",
        "labels": "backend,security,high"
    },
    {
        "title": "[Feature] Add Two-Factor Authentication (2FA) via Authenticator App",
        "directory": "backend/src/controllers/twoFactorController.ts",
        "goal": "Increase security for Admin and Merchant accounts.",
        "requirements": "- Implement TOTP generation and verification (e.g., using `speakeasy`).\\n- Provide QR code for setup.\\n- Enforce 2FA during login for specific roles.",
        "branch": "feat/2fa-authenticator",
        "labels": "backend,security,high"
    },
    {
        "title": "[Feature] Implement a Webhook dispatch system to notify external merchant servers",
        "directory": "backend/src/services/webhookService.ts",
        "goal": "Allow merchants to receive real-time delivery updates.",
        "requirements": "- Create a webhook registry for merchants.\\n- Dispatch HTTP POST requests on delivery state changes.\\n- Implement retry logic and signature verification.",
        "branch": "feat/webhook-dispatch",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Create a geospatial search algorithm to assign the nearest available driver",
        "directory": "backend/src/services/assignmentService.ts",
        "goal": "Automate driver assignment based on proximity.",
        "requirements": "- Query `2dsphere` index to find the closest online driver.\\n- Handle race conditions during assignment.\\n- Implement a fallback if no driver is nearby.",
        "branch": "feat/geospatial-driver-assignment",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Implement an Escrow Dispute Resolution flow",
        "directory": "backend/src/controllers/disputeController.ts",
        "goal": "Allow Admins to lock and manually arbitrate disputed funds.",
        "requirements": "- Create API to lock disputed escrows.\\n- Build resolution endpoint (refund buyer or release to driver).\\n- Track dispute history in Audit Log.",
        "branch": "feat/escrow-dispute-resolution",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Build a Driver Earnings ledger endpoint",
        "directory": "backend/src/controllers/driverEarningsController.ts",
        "goal": "Track completed deliveries and aggregate released escrow amounts.",
        "requirements": "- Create GET /api/v1/drivers/:id/earnings.\\n- Aggregate earnings by day/week/month.\\n- Pull data from resolved Escrow documents.",
        "branch": "feat/driver-earnings-ledger",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Implement a Push Notification service architecture",
        "directory": "backend/src/services/notificationService.ts",
        "goal": "Notify users on delivery state transitions.",
        "requirements": "- Integrate a push notification provider (e.g., Firebase FCM, OneSignal).\\n- Trigger notifications on Pending -> In Progress -> Completed.\\n- Allow users to manage notification preferences.",
        "branch": "feat/push-notifications",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a bulk upload endpoint allowing batch-creation of deliveries via CSV",
        "directory": "backend/src/controllers/bulkDeliveryController.ts",
        "goal": "Streamline delivery creation for high-volume merchants.",
        "requirements": "- Create POST /api/v1/deliveries/bulk.\\n- Parse and validate CSV data.\\n- Batch insert into MongoDB and handle partial failures.",
        "branch": "feat/bulk-csv-upload",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Implement 'Proof of Delivery' requirements",
        "directory": "backend/src/controllers/proofOfDeliveryController.ts",
        "goal": "Require drivers to upload an image before Escrow release.",
        "requirements": "- Require image upload (to S3/IPFS) upon delivery completion.\\n- Store the image reference in the Delivery document.\\n- Block Escrow release if proof is missing.",
        "branch": "feat/proof-of-delivery",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a dynamic Delivery Fee calculation engine",
        "directory": "backend/src/services/pricingService.ts",
        "goal": "Calculate delivery fees based on real-time factors.",
        "requirements": "- Consider real-time distance, traffic estimates, and weather conditions.\\n- Create a pricing formula.\\n- Expose an endpoint to estimate fees before creation.",
        "branch": "feat/dynamic-fee-calculation",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Implement multi-currency support for escrow and delivery fees",
        "directory": "backend/src/services/currencyService.ts",
        "goal": "Support various tokens (USDC, XLM, native token).",
        "requirements": "- Update schemas to track asset types.\\n- Handle conversions or strictly manage specific asset pools.\\n- Validate supported assets during escrow creation.",
        "branch": "feat/multi-currency-support",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Create a 'Delivery Pooling' algorithm to group nearby pending deliveries",
        "directory": "backend/src/services/poolingService.ts",
        "goal": "Optimize routes by grouping nearby deliveries for a single driver.",
        "requirements": "- Cluster pending deliveries based on pickup and drop-off proximity.\\n- Assign the pooled deliveries to a single driver.\\n- Calculate the optimal route sequence.",
        "branch": "feat/delivery-pooling-algorithm",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a driver penalty and rating system",
        "directory": "backend/src/services/driverRatingService.ts",
        "goal": "Automatically update driver ratings based on performance.",
        "requirements": "- Track delayed deliveries and frequent cancellations.\\n- Adjust driver ratings dynamically.\\n- Apply penalties (e.g., temporary suspension) for extremely low scores.",
        "branch": "feat/driver-penalty-rating",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Implement an Admin Dashboard aggregation endpoint",
        "directory": "backend/src/controllers/dashboardController.ts",
        "goal": "Provide real-time system metrics.",
        "requirements": "- Aggregate active deliveries, online drivers, and total escrow volume.\\n- Return metrics in a single optimized payload.\\n- Cache results to prevent heavy DB load.",
        "branch": "feat/admin-dashboard-metrics",
        "labels": "backend,high"
    },
    {
        "title": "[Feature] Add a secure User/Driver Profile picture upload feature",
        "directory": "backend/src/controllers/profileController.ts",
        "goal": "Allow users and drivers to upload profile pictures.",
        "requirements": "- Handle image uploads securely.\\n- Automatically resize and compress images before storage (S3).\\n- Update user profiles with the image URL.",
        "branch": "feat/profile-picture-upload",
        "labels": "backend,high"
    },
    # High Complexity - Bugs & System Enhancements
    {
        "title": "[Bug] Fix race conditions in Socket.io reconnections causing duplicate location updates",
        "directory": "backend/src/sockets/locationHandler.ts",
        "goal": "Ensure location updates are processed idempotently.",
        "requirements": "- Identify the race condition on reconnect.\\n- Implement a mechanism (e.g., timestamp comparison or Redis tracking) to drop duplicate updates.\\n- Write tests reproducing the issue.",
        "branch": "fix/socket-duplicate-locations",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Bug] Handle Stellar transaction submission failures gracefully when sequence numbers mismatch",
        "directory": "backend/src/services/stellarService.ts",
        "goal": "Prevent transactions from failing due to concurrent submissions.",
        "requirements": "- Catch `tx_bad_seq` errors.\\n- Automatically fetch the latest sequence number and retry the transaction.\\n- Limit retry attempts.",
        "branch": "fix/stellar-bad-seq",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Enhancement] Implement Distributed Locking (Redis Redlock) for Escrow release",
        "directory": "backend/src/services/escrowService.ts",
        "goal": "Prevent concurrent requests from releasing the same Escrow twice.",
        "requirements": "- Integrate Redis and implement Redlock.\\n- Acquire lock before processing an Escrow release.\\n- Release lock after completion.",
        "branch": "feat/redis-redlock-escrow",
        "labels": "backend,high"
    },
    {
        "title": "[Bug] Prevent driver assignment if Soroban Escrow contract initialization fails",
        "directory": "backend/src/services/deliveryService.ts",
        "goal": "Ensure drivers are only assigned to fully initialized deliveries.",
        "requirements": "- Check escrow contract status before allowing assignment.\\n- Roll back or reject the assignment if the contract is pending or failed.\\n- Return clear error to the client.",
        "branch": "fix/driver-assignment-escrow-check",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Enhancement] Implement the Circuit Breaker pattern for Google Maps API and Stellar RPC calls",
        "directory": "backend/src/utils/circuitBreaker.ts",
        "goal": "Prevent cascading system failures when external APIs go down.",
        "requirements": "- Implement a Circuit Breaker wrapper (e.g., `opossum`).\\n- Apply it to Google Maps and Stellar RPC calls.\\n- Trigger fallback logic when the circuit is open.",
        "branch": "feat/circuit-breaker-apis",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Add Idempotency keys to Delivery Creation and Escrow Funding endpoints",
        "directory": "backend/src/middlewares/idempotency.ts",
        "goal": "Prevent duplicate charges and entity creations on network retries.",
        "requirements": "- Require `Idempotency-Key` header.\\n- Store request outcomes mapped to the key in Redis.\\n- Return the cached response for duplicate requests.",
        "branch": "feat/idempotency-keys",
        "labels": "backend,high"
    },
    {
        "title": "[Bug] Fix edge cases in the Haversine ETA fallback formula near the anti-meridian",
        "directory": "backend/src/services/routingService.ts",
        "goal": "Ensure accurate distance calculation globally.",
        "requirements": "- Fix distance calculation wrapping around the 180th meridian.\\n- Add unit tests for anti-meridian coordinates.\\n- Ensure the fix doesn't impact performance.",
        "branch": "fix/haversine-anti-meridian",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Enhancement] Implement WebSocket message delivery guarantees and an offline message queue",
        "directory": "backend/src/sockets/messageQueue.ts",
        "goal": "Ensure drivers do not lose critical messages when briefly offline.",
        "requirements": "- Require acknowledgements (ACK) from clients.\\n- Queue unacknowledged messages.\\n- Flush the queue when the driver reconnects.",
        "branch": "feat/websocket-message-guarantees",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Implement a Redis caching layer for the Delivery ETA calculations",
        "directory": "backend/src/services/routingService.ts",
        "goal": "Reduce external API costs for frequently checked routes.",
        "requirements": "- Cache ETA results using a geohash or rounded coordinates as the key.\\n- Set an appropriate TTL.\\n- Check the cache before calling external APIs.",
        "branch": "feat/redis-cache-eta",
        "labels": "backend,high"
    },
    {
        "title": "[Bug] Ensure Graceful Shutdown logic correctly drains active Socket.io connections and DB transactions",
        "directory": "backend/src/server.ts",
        "goal": "Prevent data corruption during server restarts or deployments.",
        "requirements": "- Listen for SIGTERM/SIGINT.\\n- Stop accepting new requests/connections.\\n- Wait for ongoing DB transactions and drain Socket.io connections before exiting.",
        "branch": "fix/graceful-shutdown-drain",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Enhancement] Add strict validation to prevent 'Completed' status if GPS coordinates do not match drop-off",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Prevent fraud by ensuring drivers are actually at the drop-off location.",
        "requirements": "- Calculate distance between driver's current GPS and drop-off location.\\n- Reject the 'Completed' status update if the distance exceeds an acceptable radius.",
        "branch": "feat/validate-dropoff-location",
        "labels": "backend,high"
    },
    {
        "title": "[Bug] Fix token expiration edge cases causing location updates to silently fail mid-delivery",
        "directory": "backend/src/sockets/locationHandler.ts",
        "goal": "Ensure drivers are notified when their token expires during an active WebSocket session.",
        "requirements": "- Periodically validate the JWT during the active socket session.\\n- Emit an 'auth_expired' event to prompt the client to refresh.\\n- Gracefully disconnect if not refreshed.",
        "branch": "fix/socket-token-expiration",
        "labels": "backend,bug,high"
    },
    {
        "title": "[Enhancement] Implement a Dead Letter Queue (DLQ) for failed Escrow release transactions",
        "directory": "backend/src/services/dlqService.ts",
        "goal": "Allow Admins to manually retry failed blockchain transactions.",
        "requirements": "- Catch unrecoverable transaction failures.\\n- Store the transaction payload in a DLQ collection.\\n- Provide an Admin endpoint to review and retry them.",
        "branch": "feat/escrow-dlq",
        "labels": "backend,high"
    },
    {
        "title": "[Enhancement] Standardize all timezone handling across the backend to strictly use UTC",
        "directory": "backend/src/utils/dateUtils.ts",
        "goal": "Prevent timezone-related bugs in timestamps and cron jobs.",
        "requirements": "- Enforce UTC usage in all Mongoose models.\\n- Ensure Date objects are instantiated in UTC.\\n- Refactor any local timezone dependencies.",
        "branch": "refactor/standardize-utc-timezone",
        "labels": "backend,high"
    }
]

print("\\n════════════════════════════════════════════════════")
print("  📋 GENERATING SWIFTCHAIN BACKEND ISSUES (PHASE 1 & 2 ROBUSTNESS)")
print("════════════════════════════════════════════════════")

for issue in ISSUES:
    create_issue(
        title=issue["title"],
        directory=issue["directory"],
        goal=issue["goal"],
        requirements=issue["requirements"],
        branch=issue["branch"],
        labels=issue["labels"]
    )

print("\\n\\n════════════════════════════════════════════════════")
print(f"  🎉  All {len(ISSUES)} Issues Creation Attempted!")
print(f"  📌  Repo  : https://github.com/{REPO}/issues")
print("  ✅  Review your issues and assign contributors.")
print("════════════════════════════════════════════════════")