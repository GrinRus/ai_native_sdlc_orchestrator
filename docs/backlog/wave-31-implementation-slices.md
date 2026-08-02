# W31 - installed-user local app launch and onboarding UI

Make the npm-installed AOR first run understandable without requiring users to
read internal CLI/API/web docs first.

## Wave objective

Turn `aor app` into a real local app launcher for installed users while keeping
the runtime headless-first, packet-first, and control-plane-owned.

## Wave exit criteria

- W31 is represented across the roadmap, master backlog, epic map, dependency
  graph, and owning wave doc.
- `aor app` starts a foreground loopback server, opens the packaged SPA by
  default, supports `--project-ref`, `--runtime-root`, `--host`, `--port`,
  `--open`, `--json`, and `--smoke`, and exits cleanly in smoke mode.
- The CLI launcher uses shared control-plane HTTP/SSE transport under
  `packages/orchestrator-core`; `apps/api` remains a thin re-export surface.
- The React/Vite SPA guides the seven installed-user stages, includes a Mission
  form and safe walkthrough template, shows next action, blockers, evidence
  refs, and runtime root, and calls runtime-owned lifecycle mutations.
- README, product stories, architecture docs, contracts, ops runbooks, ADRs,
  packaging checks, and release smoke docs describe the first-run UI path.

---

## W31-S01 — Installed-user local app launch and onboarding UI
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** An installed user can run `aor onboard .`, launch `aor app`, complete first Mission intake from the local UI, and see the refreshed next-action report without reading internal docs.
- **Primary modules:** `apps/web/**`, `apps/cli/**`, `apps/api/**`, `packages/orchestrator-core/**`, `docs/product/**`, `docs/architecture/**`, `docs/contracts/**`, `docs/ops/**`, `docs/backlog/**`, `scripts/**`, `package.json`
- **Hard dependencies:** W30-S06
- **Primary user story surfaces:** PBO-09, OPS-01, OPS-06.

### Local tasks
1. Change `aor app` from read-only guidance to a foreground local app launcher.
2. Add launcher flags and smoke mode for installed-package CI/release checks.
3. Move HTTP/SSE transport ownership into shared runtime and keep `apps/api` as re-export wrappers.
4. Build the packaged React/Vite SPA with seven stages, Mission form, safe template, right rail, and activity/evidence panels.
5. Wire Mission submit through lifecycle-command mutation and automatic `next` refresh.
6. Update README, user stories, architecture, contracts, ADRs, ops runbooks, release docs, and backlog source-of-truth docs.
7. Add CLI/API/web/packaging/release smoke coverage.

### Acceptance criteria
1. `aor app --help` documents launcher flags and smoke mode.
2. `aor app --smoke --open false --json` verifies SPA, app config, and control-plane state routes, then exits.
3. The SPA serves same-origin from `/`, `/app-config.json`, and `/api/projects/:projectId/**`.
4. Mission form submission writes existing intake evidence with `delivery-mode=no-write` by default and refreshes `next-action-report`.
5. Headless CLI/API flows remain valid without launching the UI.
6. `npm pack --dry-run` includes `apps/web/dist` and shared app launcher/runtime files and excludes runtime state.

### Done evidence
- `packages/orchestrator-core/src/operator-cli/app-launcher.mjs`
- `packages/orchestrator-core/src/control-plane/http/**`
- `apps/web/src/spa.jsx`
- `apps/web/src/spa.css`
- `apps/web/dist`
- CLI/API/web tests for app launch, app routes, and SPA controls
- release pack and release smoke checks
- updated README, user stories, architecture, contract, ADR, ops, and backlog docs

### Out of scope
- Making the web UI mandatory.
- Hosted SaaS, Docker/GHCR, SSO, or managed multi-tenant operation.
- UI-owned orchestration or UI-only packet schema fields.
- Certifying additional external runners.
