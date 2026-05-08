# Package and module map

## Apps
All apps listed here are package-managed workspace entries, not just folders.

- `apps/api` — thin detached HTTP/SSE transport and module export surface for connected read/follow and bounded lifecycle/control mutations
- `apps/cli` — thin operator CLI entrypoint and bootstrap surface over shared operator services
- `apps/web` — detachable operator console

## Packages
All packages listed here are package-managed workspace entries with private manifests.

- `packages/contracts` — schemas, parsers, and validation helpers
- `packages/orchestrator-core` — workflow decisions, packet lifecycle logic, run-level Runtime Harness control, shared control-plane read/control services, shared operator CLI lifecycle service, delivery-plan policy gating, bounded patch/local-branch delivery drivers, fork-first PR intent planning, and delivery-manifest/release-packet materialization
- `packages/provider-routing` — route resolution and promotion-aware routing
- `packages/adapter-sdk` — runner abstraction, request/response envelopes, capability negotiation, and deterministic mock adapter
- `packages/harness` — capture format, replay compatibility checks, certification, and compare-to-baseline flows
- `packages/observability` — live events, evidence links, and telemetry

## Expected internal module themes
As the repo grows, the following internal concerns should stay visible:
- packet materialization
- approval management
- workspace management
- checkout and source preparation
- delivery transaction handling
- dataset and suite registry
- promotion and freeze logic
- incident backfill workflows

## CLI/API service boundary (W23-S03)

`apps/cli` and `apps/api` are app transports. Shared lifecycle and read/control behavior lives under `packages/orchestrator-core/src/operator-cli/**` and `packages/orchestrator-core/src/control-plane/**`.

Boundary rules:
- `apps/api/src/**` must not import or reference `apps/cli/**` implementation files.
- `apps/cli/src/**` must not import or reference `apps/api/**` implementation files.
- app-level files may re-export shared package services to preserve existing public module paths.
- `scripts/lint.mjs` enforces the no app-to-app source edge rule.
