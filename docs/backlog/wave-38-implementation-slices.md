# W38 - Qwen stream progress adapter closure

Translate the W35/W37 Qwen finding into an adapter-level progress fix. Qwen
Code buffered `--output-format json` until process completion, so AOR reported
`silent-running` even when Qwen was actively calling the model and tools. W38
uses Qwen's official stream-json headless output as the public progress source.

## Wave objective

Qwen candidate live E2E should not look silent when stream events show provider
activity. Operator UI, reports, and raw evidence must expose sanitized progress
through AOR public read models while keeping private `~/.qwen/**` logs as
manual debug evidence only.

## Wave exit criteria

- Qwen candidate adapter uses `--output-format stream-json` and
  `--include-partial-messages`.
- `provider_step_status` exposes optional progress fields without leaking raw
  prompts, file contents, command args, env, tokens, or secrets.
- Adapter raw evidence includes bounded, sanitized `provider_progress_events[]`.
- True `silent-running` is reserved for provider steps with no stdout, stderr,
  artifact update, or stream progress inside the silent window.
- Regression tests cover Qwen stream progress, malformed JSONL, redaction, and
  interrupted provider progress preservation.

---

## W38-S01 — Qwen stream progress adapter closure
- **Epic:** EPIC-6 Operator control plane, EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Make Qwen candidate provider progress observable through official stream-json output before final runner completion.
- **Primary modules:** `docs/contracts/**`, `examples/adapters/**`, `packages/adapter-sdk/**`, `packages/orchestrator-core/**`, `apps/web/**`, `scripts/live-e2e/**`, tests
- **Hard dependencies:** W35-S05, W37-S01
- **Primary user story surfaces:** OPS-01, OPS-06, OPS-07, OPS-11.

### Local tasks
1. Update contract docs and OpenAPI so `provider_step_status` can carry sanitized stream progress fields.
2. Update Qwen adapter profile and runbooks from buffered JSON output to official stream-json progress output.
3. Parse external runner stdout JSONL incrementally in the supervisor and update heartbeat on Qwen progress events.
4. Persist bounded sanitized `provider_progress_events[]` in adapter raw evidence and response output.
5. Update control-plane normalization and web cockpit copy to render Qwen activity instead of false silence.
6. Add regression tests for stream progress, malformed JSONL, redaction, interrupted progress, and buffered-json silence.
7. Run targeted tests, `pnpm live-e2e:test`, `pnpm web:build`, and `pnpm slice:gate`.

### Acceptance criteria
1. Qwen stream JSONL lines update `last_progress_at`, `last_progress_kind`, `last_progress_label`, and `progress_event_count`.
2. Provider heartbeat does not downgrade to `silent-running` while recent progress exists.
3. Malformed JSONL does not crash adapter execution and keeps bounded raw evidence for diagnosis.
4. Public status and UI do not expose raw prompt text, file contents, full command args, env values, tokens, or secrets.
5. Interrupted Qwen-style runs preserve non-empty progress evidence and remain classified as provider execution blockers.
6. `~/.qwen/**` is documented as debug-only and is not required for runtime progress.

### Done evidence
- updated contracts/OpenAPI and adapter profile
- updated runbook/dependency notes
- adapter supervisor stream progress tests
- provider-step-status normalization tests
- web rendering test for provider progress
- bounded local Qwen 0.17.0 diagnostic observed stream-json progress: first
  event after ~1.55s, 32 JSONL events, final result observed
- slice gate output

### Out of scope
- Promoting Qwen from extended candidate to required provider coverage.
- Reading private Qwen runtime logs as a product dependency.
- Publishing a new npm release.
