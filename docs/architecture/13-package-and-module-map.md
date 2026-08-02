# Package and module map

## Distribution package

The root package publishes the npm CLI alpha as `@grinrus/aor` with bin command
`aor`. It packages the CLI entrypoint plus the private internal runtime modules
needed by that CLI and the built local web console assets under
`apps/web/dist`. The root package is the only public package channel in the
current alpha.

## Apps
All apps listed here are package-managed workspace entries, not just folders.

- `apps/api` — thin module export surface that re-exports the shared HTTP/SSE control-plane transport and read/control services
- `apps/cli` — thin operator CLI entrypoint and bootstrap surface over shared operator services
- `apps/web` — optional React/Vite operator console source; the npm package serves the built `dist` assets through `aor app`, and app smoke validates the real SPA/config/project-index/state route path plus first-run wizard, project switcher, flow selector, and `New Flow` bundle markers without a public static snapshot module export

## Packages
All packages listed here are package-managed workspace entries with private manifests.

- `packages/contracts` — schemas, parsers, and validation helpers
- `packages/orchestrator-core` — workflow decisions, packet lifecycle logic, run-level Runtime Harness control, shared control-plane read/control services, shared HTTP/SSE transport, local app launcher, operator-request runtime services, shared operator CLI lifecycle service, delivery-plan policy gating, bounded patch/local-branch delivery drivers, fork-first PR intent planning, and delivery-manifest/release-packet materialization
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

The W31 local app launcher follows the same boundary: `apps/cli/bin/aor.mjs`
delegates `aor app` to `packages/orchestrator-core/src/operator-cli/app-launcher.mjs`,
which starts the shared transport from
`packages/orchestrator-core/src/control-plane/http/**` and serves
`apps/web/dist`. `apps/api/src/http-*.mjs` files remain compatibility
re-exports and must not become the CLI launcher's implementation dependency.

W32 operator requests follow the same ownership rule. Request creation,
sanitized reads, request execution, proposal/patch evidence, and next-action
refresh live under `packages/orchestrator-core/src/operator-request.mjs` plus
shared CLI/control-plane handlers. `apps/web` sends control-plane mutations and
renders evidence refs; it does not compile prompts, route runners, or mutate
target files directly.

Boundary rules:
- `apps/api/src/**` must not import or reference `apps/cli/**` implementation files.
- `apps/cli/src/**` must not import or reference `apps/api/**` implementation files.
- app-level files may re-export shared package services to preserve existing public module paths.
- `scripts/lint.mjs` enforces the no app-to-app source edge rule.
