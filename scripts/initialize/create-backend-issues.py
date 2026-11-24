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
    # Epic 1: Project Setup & Architecture
    {
        "title": "Backend: Initialize Node.js/Express project with TypeScript configuration",
        "directory": "backend/",
        "goal": "Set up the base Node.js and Express application using TypeScript.",
        "requirements": "- Initialize package.json.\\n- Configure tsconfig.json.\\n- Create base app.ts and server.ts.",
        "branch": "feat/init-express-ts",
        "labels": "backend,low"
    },
    {
        "title": "Backend: Configure ESLint, Prettier, and Husky for code quality",
        "directory": "backend/",
        "goal": "Ensure consistent code formatting and pre-commit checks.",
        "requirements": "- Install ESLint and Prettier.\\n- Configure Husky pre-commit hooks for linting.\\n- Add linting scripts to package.json.",
        "branch": "feat/eslint-prettier-husky",
        "labels": "backend,medium"
    },
    {
        "title": "Backend: Set up MongoDB connection using Mongoose with connection pooling",
        "directory": "backend/src/config/database.ts",
        "goal": "Establish a robust connection to MongoDB.",
        "requirements": "- Integrate mongoose.\\n- Configure connection pooling parameters.\\n- Handle database connection events and errors.",
        "branch": "feat/mongodb-setup",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement environment variables validation using dotenv and Zod",
        "directory": "backend/src/config/env.ts",
        "goal": "Ensure all required environment variables are present and valid at startup.",
        "requirements": "- Load .env via dotenv.\\n- Validate variables using Zod schemas.\\n- Fail fast if config is invalid.",
        "branch": "feat/env-validation",
        "labels": "backend,medium"
    },
    {
        "title": "Backend: Set up global error handling middleware and custom Express error classes",
        "directory": "backend/src/middlewares/errorHandler.ts",
        "goal": "Centralize error management for the Express application.",
        "requirements": "- Create custom AppError classes.\\n- Implement a global error handling middleware.\\n- Format error responses properly for production and dev environments.",
        "branch": "feat/global-error-handling",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement request and application logging using Winston or Pino",
        "directory": "backend/src/config/logger.ts",
        "goal": "Provide structured logging for requests and application events.",
        "requirements": "- Set up Winston or Pino.\\n- Create a request logging middleware.\\n- Output logs in JSON format for production.",
        "branch": "feat/application-logging",
        "labels": "backend,low"
    },
    {
        "title": "Backend: Configure CORS and Helmet.js for secure HTTP headers",
        "directory": "backend/src/app.ts",
        "goal": "Enhance backend security by setting appropriate HTTP headers and CORS policies.",
        "requirements": "- Integrate helmet.js.\\n- Configure CORS options to accept requests only from allowed frontend origins.\\n- Apply to all API routes.",
        "branch": "feat/cors-helmet-security",
        "labels": "backend,security,medium"
    },
    # Epic 2: Authentication & Identity
    {
        "title": "Backend: Design User Mongoose Schema",
        "directory": "backend/src/models/User.ts",
        "goal": "Create the data model for system users.",
        "requirements": "- Include email, password_hash, role, and wallet_address fields.\\n- Add timestamps and validation.\\n- Ensure email is unique.",
        "branch": "feat/user-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement User Registration API endpoint",
        "directory": "backend/src/controllers/authController.ts",
        "goal": "Allow users to register and hash passwords securely.",
        "requirements": "- Create POST /api/v1/auth/register.\\n- Use bcrypt to hash passwords.\\n- Return appropriate user data (exclude hash).",
        "branch": "feat/auth-register",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement User Login API endpoint and JWT generation",
        "directory": "backend/src/controllers/authController.ts",
        "goal": "Authenticate users and issue JWTs.",
        "requirements": "- Create POST /api/v1/auth/login.\\n- Verify credentials.\\n- Generate and return JWT token.",
        "branch": "feat/auth-login",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Create JWT verification middleware for protected API routes",
        "directory": "backend/src/middlewares/authMiddleware.ts",
        "goal": "Protect endpoints using JWT authentication.",
        "requirements": "- Extract token from Authorization header.\\n- Verify token signature.\\n- Attach user payload to request object.",
        "branch": "feat/jwt-middleware",
        "labels": "backend,security,high"
    },
    {
        "title": "Backend: Implement API to link/update a Stellar wallet address for a user",
        "directory": "backend/src/controllers/userController.ts",
        "goal": "Allow users to connect their Stellar wallet to their profile.",
        "requirements": "- Create PUT /api/v1/users/wallet.\\n- Validate Stellar public key format.\\n- Update user profile with wallet address.",
        "branch": "feat/link-stellar-wallet",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Admin API endpoint to suspend/ban a malicious user or driver",
        "directory": "backend/src/controllers/adminController.ts",
        "goal": "Provide administrative controls over user accounts.",
        "requirements": "- Create PUT /api/v1/admin/users/:id/suspend.\\n- Ensure route is protected by Admin role.\\n- Update user status to suspended.",
        "branch": "feat/admin-suspend-user",
        "labels": "backend,api,high"
    },
    # Epic 3: Core Delivery Management
    {
        "title": "Backend: Design Delivery Mongoose Schema",
        "directory": "backend/src/models/Delivery.ts",
        "goal": "Model the core delivery entity.",
        "requirements": "- Include sender, recipient, status, metadata, and contract_id fields.\\n- Reference User schema where appropriate.\\n- Add timestamps.",
        "branch": "feat/delivery-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement Create Delivery API to store off-chain metadata",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Save initial delivery details before on-chain creation.",
        "requirements": "- Create POST /api/v1/deliveries.\\n- Store delivery metadata.\\n- Return created document with ID.",
        "branch": "feat/create-delivery",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Fetch Deliveries API",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Retrieve a list of deliveries with advanced querying.",
        "requirements": "- Create GET /api/v1/deliveries.\\n- Support pagination (limit, page).\\n- Support status filtering and date sorting.",
        "branch": "feat/fetch-deliveries",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Fetch Single Delivery API by ID",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Retrieve details of a specific delivery.",
        "requirements": "- Create GET /api/v1/deliveries/:id.\\n- Fetch associated sender/recipient data.\\n- Return 404 if not found.",
        "branch": "feat/fetch-single-delivery",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Driver Assignment API",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Link a driver to a pending delivery.",
        "requirements": "- Create PUT /api/v1/deliveries/:id/assign.\\n- Update delivery document with driver ID.\\n- Validate driver existence and status.",
        "branch": "feat/assign-driver",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Delivery Status Update API",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Update the lifecycle status of a delivery.",
        "requirements": "- Create PUT /api/v1/deliveries/:id/status.\\n- Validate status transitions (e.g., Pending -> Active -> InTransit).\\n- Enforce authorization.",
        "branch": "feat/update-delivery-status",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Create QR Code generation endpoint for delivery handoff verification",
        "directory": "backend/src/controllers/deliveryController.ts",
        "goal": "Generate QR codes for secure physical handoffs.",
        "requirements": "- Create GET /api/v1/deliveries/:id/qrcode.\\n- Generate QR encoding delivery ID and a secure verification token.\\n- Return image or base64 string.",
        "branch": "feat/generate-handoff-qrcode",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement soft delete logic and archived status for Deliveries",
        "directory": "backend/src/models/Delivery.ts",
        "goal": "Allow safe deletion and archiving without losing historical data.",
        "requirements": "- Add isDeleted flag to Delivery schema.\\n- Update queries to filter out soft-deleted documents.\\n- Add archive endpoint.",
        "branch": "feat/soft-delete-delivery",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement delivery route distance and ETA calculation endpoint",
        "directory": "backend/src/services/routingService.ts",
        "goal": "Provide estimated time of arrival for deliveries.",
        "requirements": "- Create GET /api/v1/deliveries/:id/eta.\\n- Use a routing service/API to calculate distance based on coordinates.\\n- Return estimated time.",
        "branch": "feat/delivery-eta-calc",
        "labels": "backend,api,high"
    },
    # Epic 4: Real-time Tracking & WebSockets
    {
        "title": "Backend: Set up Socket.io server and integrate with Express HTTP server",
        "directory": "backend/src/server.ts",
        "goal": "Establish WebSocket infrastructure for real-time features.",
        "requirements": "- Initialize Socket.io attached to the HTTP server.\\n- Configure basic connection/disconnection event logging.\\n- Setup namespaces if needed.",
        "branch": "feat/socketio-setup",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Implement WebSocket authentication middleware using JWT",
        "directory": "backend/src/middlewares/socketAuth.ts",
        "goal": "Secure WebSocket connections.",
        "requirements": "- Intercept Socket.io connection handshakes.\\n- Extract and verify JWT.\\n- Reject unauthorized socket connections.",
        "branch": "feat/socket-jwt-auth",
        "labels": "backend,security,high"
    },
    {
        "title": "Backend: Implement WebSocket events for real-time driver location broadcasting",
        "directory": "backend/src/sockets/locationHandler.ts",
        "goal": "Enable live tracking of deliveries.",
        "requirements": "- Handle `driver_location_update` events from drivers.\\n- Broadcast updates to subscribed clients for specific delivery IDs.\\n- Ensure efficient room management.",
        "branch": "feat/socket-location-broadcast",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Implement WebSocket connection health checks and disconnect cleanup",
        "directory": "backend/src/sockets/connectionHandler.ts",
        "goal": "Maintain healthy WebSocket connections.",
        "requirements": "- Implement ping/pong mechanisms.\\n- Clean up orphaned rooms and state when a client disconnects unexpectedly.\\n- Log disconnections.",
        "branch": "feat/socket-health-checks",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Implement offline data sync/catch-up for drivers reconnecting to WebSockets",
        "directory": "backend/src/sockets/syncHandler.ts",
        "goal": "Ensure data consistency for drivers in low-connectivity areas.",
        "requirements": "- Allow drivers to send buffered location updates upon reconnection.\\n- Process batch updates efficiently.\\n- Acknowledge successful sync to client.",
        "branch": "feat/socket-offline-sync",
        "labels": "backend,high"
    },
    # Epic 5: Soroban Smart Contract Indexer
    {
        "title": "Backend: Install Stellar SDK and configure Soroban RPC client",
        "directory": "backend/src/config/stellar.ts",
        "goal": "Connect backend to the Stellar network.",
        "requirements": "- Setup stellar-sdk.\\n- Configure Soroban RPC URL and network passphrase.\\n- Implement basic connectivity check.",
        "branch": "feat/soroban-rpc-setup",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Design EventLog Mongoose Schema to track processed ledger sequences",
        "directory": "backend/src/models/EventLog.ts",
        "goal": "Prevent double-processing of blockchain events.",
        "requirements": "- Create schema to store last processed ledger sequence.\\n- Include fields for event type, transaction hash, and timestamp.",
        "branch": "feat/eventlog-schema",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Create Soroban Event Poller background service",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Continuously fetch new contract events.",
        "requirements": "- Implement a polling loop fetching events from the Soroban RPC.\\n- Use the EventLog to determine the starting ledger.\\n- Dispatch events to specific handlers.",
        "branch": "feat/soroban-event-poller",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement indexer handler for delivery_created smart contract event",
        "directory": "backend/src/indexer/deliveryHandlers.ts",
        "goal": "Sync on-chain delivery creation with off-chain DB.",
        "requirements": "- Parse the `delivery_created` XDR payload.\\n- Match with off-chain metadata.\\n- Update Delivery document status and `contract_id`.",
        "branch": "feat/indexer-delivery-created",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement indexer handler for delivery_status_updated on-chain event",
        "directory": "backend/src/indexer/deliveryHandlers.ts",
        "goal": "Reflect smart contract status changes in the backend.",
        "requirements": "- Parse the `delivery_status_updated` event.\\n- Update corresponding Delivery document.\\n- Trigger any related WebSocket notifications.",
        "branch": "feat/indexer-delivery-status",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement indexer catch-up mechanism for missed blockchain events",
        "directory": "backend/src/services/eventPoller.ts",
        "goal": "Ensure no events are missed during backend downtime.",
        "requirements": "- Compare current ledger with last processed ledger on startup.\\n- Implement paginated fetching to catch up on large gaps without timing out.",
        "branch": "feat/indexer-catch-up",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Write unit tests for the Soroban XDR event parser",
        "directory": "backend/src/utils/__tests__/xdrParser.test.ts",
        "goal": "Ensure reliable decoding of blockchain data.",
        "requirements": "- Create test cases with mock XDR payloads for deliveries and escrows.\\n- Verify output matches expected JSON objects.\\n- Handle malformed XDR gracefully.",
        "branch": "feat/test-xdr-parser",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Implement exponential backoff retry mechanism for Soroban RPC failures",
        "directory": "backend/src/utils/rpcClient.ts",
        "goal": "Make the indexer resilient to RPC rate limits and temporary outages.",
        "requirements": "- Wrap RPC calls in a retry logic.\\n- Implement exponential backoff.\\n- Log failure attempts appropriately.",
        "branch": "feat/rpc-retry-backoff",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Add alerting/monitoring for indexer lag to notify admins",
        "directory": "backend/src/services/monitorService.ts",
        "goal": "Proactively detect when the indexer falls behind the blockchain.",
        "requirements": "- Periodically compare processed ledger with network current ledger.\\n- If lag exceeds threshold, log a critical alert or trigger a webhook notification.",
        "branch": "feat/indexer-lag-alert",
        "labels": "backend,indexer,high"
    },
    # Epic 6: Escrow & Payments Integration
    {
        "title": "Backend: Design Escrow Mongoose Schema",
        "directory": "backend/src/models/Escrow.ts",
        "goal": "Track escrow amounts, assets, and lock status.",
        "requirements": "- Include amount, asset type, lock status, and delivery reference.\\n- Add timestamps and associated transaction hashes.",
        "branch": "feat/escrow-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement indexer handler for escrow_funded event",
        "directory": "backend/src/indexer/escrowHandlers.ts",
        "goal": "Sync escrow funding from the smart contract.",
        "requirements": "- Parse `escrow_funded` event.\\n- Create/Update Escrow document in MongoDB.\\n- Update related Delivery status to funded.",
        "branch": "feat/indexer-escrow-funded",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement indexer handler for escrow_released and escrow_refunded events",
        "directory": "backend/src/indexer/escrowHandlers.ts",
        "goal": "Sync final escrow resolutions.",
        "requirements": "- Parse release and refund events.\\n- Update Escrow document status accordingly.\\n- Store the settlement transaction hash.",
        "branch": "feat/indexer-escrow-resolved",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement API endpoint to fetch escrow status for a specific delivery",
        "directory": "backend/src/controllers/escrowController.ts",
        "goal": "Allow frontend to display escrow locking state.",
        "requirements": "- Create GET /api/v1/escrow/delivery/:id.\\n- Return the associated Escrow document data.",
        "branch": "feat/fetch-escrow-status",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement API endpoint to generate unsigned XDR transactions for escrow locking",
        "directory": "backend/src/controllers/transactionController.ts",
        "goal": "Assist the frontend in proposing smart contract calls.",
        "requirements": "- Create POST /api/v1/transactions/escrow-lock.\\n- Construct Soroban contract invocation XDR.\\n- Return base64 XDR for client wallet signing.",
        "branch": "feat/generate-escrow-xdr",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement backend cron job to monitor and flag expired escrow locks",
        "directory": "backend/src/jobs/escrowMonitor.ts",
        "goal": "Ensure escrows do not remain locked indefinitely.",
        "requirements": "- Setup a cron job to find Escrows locked beyond their TTL.\\n- Flag them in the DB.\\n- Expose flagged escrows to Admins for resolution.",
        "branch": "feat/escrow-expiry-cron",
        "labels": "backend,high"
    },
    # Epic 7: Dispute Management
    {
        "title": "Backend: Design Dispute Mongoose Schema",
        "directory": "backend/src/models/Dispute.ts",
        "goal": "Store dispute metadata and evidence.",
        "requirements": "- Include related delivery ID, reason, evidence URLs, status, and resolution details.",
        "branch": "feat/dispute-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement Open Dispute API allowing users to flag delivery issues",
        "directory": "backend/src/controllers/disputeController.ts",
        "goal": "Allow users to initiate disputes off-chain before on-chain execution.",
        "requirements": "- Create POST /api/v1/disputes.\\n- Validate delivery is in an active state.\\n- Store dispute metadata.",
        "branch": "feat/open-dispute-api",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement evidence upload API integration",
        "directory": "backend/src/controllers/uploadController.ts",
        "goal": "Handle media evidence for disputes.",
        "requirements": "- Integrate AWS S3 or Local storage.\\n- Create POST /api/v1/uploads/evidence.\\n- Return secure URL to be linked to the dispute.",
        "branch": "feat/evidence-upload",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement indexer handler for dispute_opened and dispute_resolved on-chain events",
        "directory": "backend/src/indexer/disputeHandlers.ts",
        "goal": "Sync smart contract dispute resolutions.",
        "requirements": "- Parse on-chain dispute events.\\n- Update local Dispute document statuses.\\n- Trigger notifications if necessary.",
        "branch": "feat/indexer-disputes",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement Admin API endpoint to fetch all active disputes for dashboard",
        "directory": "backend/src/controllers/adminController.ts",
        "goal": "Provide administrators a view of pending issues.",
        "requirements": "- Create GET /api/v1/admin/disputes.\\n- Support pagination and filtering by status.\\n- Ensure admin role protection.",
        "branch": "feat/admin-fetch-disputes",
        "labels": "backend,api,high"
    },
    # Epic 8: Fleet Management
    {
        "title": "Backend: Design Fleet Mongoose Schema",
        "directory": "backend/src/models/Fleet.ts",
        "goal": "Model enterprise fleets.",
        "requirements": "- Include treasury address, owner ID, and members array.\\n- Add business metadata.",
        "branch": "feat/fleet-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement Create Fleet API for enterprise users",
        "directory": "backend/src/controllers/fleetController.ts",
        "goal": "Allow creation of enterprise fleets.",
        "requirements": "- Create POST /api/v1/fleets.\\n- Validate enterprise user role.\\n- Store fleet data.",
        "branch": "feat/create-fleet",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Fleet Driver Invitation API",
        "directory": "backend/src/controllers/fleetController.ts",
        "goal": "Allow fleets to invite drivers.",
        "requirements": "- Create POST /api/v1/fleets/:id/invite.\\n- Send invitation to driver (email or in-app notification).\\n- Track invitation status.",
        "branch": "feat/fleet-invite",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Implement Fleet Metrics API returning aggregated delivery and revenue statistics",
        "directory": "backend/src/controllers/fleetController.ts",
        "goal": "Provide analytics for fleet managers.",
        "requirements": "- Create GET /api/v1/fleets/:id/metrics.\\n- Aggregate delivery counts and escrow values.\\n- Return formatted statistics.",
        "branch": "feat/fleet-metrics",
        "labels": "backend,api,high"
    },
    # Epic 9: Identity & Reputation System
    {
        "title": "Backend: Design Driver Profile & Reputation Mongoose Schema",
        "directory": "backend/src/models/DriverProfile.ts",
        "goal": "Model driver-specific attributes and scores.",
        "requirements": "- Include linked User ID, reputation points, tier, and vehicle details.",
        "branch": "feat/driver-profile-schema",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Implement indexer handler for reputation_increased and reputation_slashed events",
        "directory": "backend/src/indexer/reputationHandlers.ts",
        "goal": "Sync on-chain reputation changes.",
        "requirements": "- Parse reputation events from smart contract.\\n- Update DriverProfile reputation points and tier accordingly.",
        "branch": "feat/indexer-reputation",
        "labels": "backend,indexer,high"
    },
    {
        "title": "Backend: Implement Fetch Driver Leaderboard API for frontend gamification",
        "directory": "backend/src/controllers/driverController.ts",
        "goal": "Provide top drivers list.",
        "requirements": "- Create GET /api/v1/drivers/leaderboard.\\n- Query drivers sorted by reputation points.\\n- Implement caching or efficient indexing.",
        "branch": "feat/driver-leaderboard",
        "labels": "backend,api,high"
    },
    # Epic 10: Security, Performance & Documentation
    {
        "title": "Backend: Implement rate limiting middleware (express-rate-limit) for public APIs",
        "directory": "backend/src/middlewares/rateLimiter.ts",
        "goal": "Protect against brute-force and DDoS.",
        "requirements": "- Configure express-rate-limit.\\n- Apply strict limits to Auth routes and moderate limits to general API.",
        "branch": "feat/rate-limiting",
        "labels": "backend,security,high"
    },
    {
        "title": "Backend: Add request validation middleware (Zod) to all POST/PUT endpoints",
        "directory": "backend/src/middlewares/validateRequest.ts",
        "goal": "Ensure payload integrity before processing.",
        "requirements": "- Create generic validation middleware using Zod.\\n- Apply to all state-mutating endpoints.",
        "branch": "feat/zod-validation",
        "labels": "backend,api,high"
    },
    {
        "title": "Backend: Write API Integration Tests for Auth and Delivery flows",
        "directory": "backend/src/tests/integration/",
        "goal": "Automate testing of critical business logic.",
        "requirements": "- Use Jest and Supertest.\\n- Mock DB connections where appropriate.\\n- Cover successful flows and error conditions.",
        "branch": "feat/integration-tests",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Generate Swagger/OpenAPI documentation for all REST endpoints",
        "directory": "backend/src/docs/swagger.ts",
        "goal": "Provide developer-friendly API specs.",
        "requirements": "- Define Swagger definitions for all API routes.\\n- Expose UI at /api-docs.",
        "branch": "feat/swagger-docs",
        "labels": "backend,high"
    },
    {
        "title": "Backend: Create database indexes (MongoDB) for high-frequency queries to optimize performance",
        "directory": "backend/src/models/",
        "goal": "Improve read performance for the API and indexer.",
        "requirements": "- Analyze query patterns.\\n- Add compound and single-field indexes to Mongoose schemas (e.g., Delivery status, User wallet).",
        "branch": "feat/db-indexes",
        "labels": "backend,database,high"
    },
    {
        "title": "Backend: Write load tests using Artillery or k6 for WebSocket and API endpoints",
        "directory": "backend/load-tests/",
        "goal": "Ensure backend can handle Phase 2 traffic expectations.",
        "requirements": "- Create load testing scripts.\\n- Simulate multiple concurrent WebSocket connections and API calls.",
        "branch": "feat/load-testing",
        "labels": "backend,high"
    }
]

print("\\n════════════════════════════════════════════════════")
print("  📋 GENERATING SWIFTCHAIN BACKEND ISSUES")
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