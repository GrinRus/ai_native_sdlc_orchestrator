# Package and module map

## Apps
- `apps/api` — control-plane API, queries, approvals, and live streams
- `apps/cli` — operator CLI and bootstrap surface
- `apps/web` — detachable operator console

## Packages
- `packages/contracts` — schemas, parsers, and validation helpers
- `packages/orchestrator-core` — workflow decisions, packet lifecycle logic, delivery-plan policy gating, bounded patch/local-branch delivery drivers, and fork-first PR intent planning
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
