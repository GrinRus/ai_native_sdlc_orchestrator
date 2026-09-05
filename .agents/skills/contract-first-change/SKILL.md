---
name: contract-first-change
description: Review or change AOR contracts, validators, and consumers; route prompt, runtime skill, or context-only edits through the asset-authoring workflow.
---

For a contract review, inspect the chain below and report drift or missing
evidence. Apply changes only within the requested change scope.

1. Find the public contract in `docs/contracts/00-index.md`. Private live-E2E
   contracts belong under `scripts/live-e2e/docs/contracts/` and
   `scripts/live-e2e/lib/contracts/`; do not turn rehearsal-only fields into
   public runtime requirements.
2. Trace the documented fields to `packages/contracts/src/families.mjs`, the
   owning validator reached through `packages/contracts/src/loader.mjs`, and
   public declarations under `packages/contracts/src/`. For API changes, also
   inspect the owning control-plane contract and transport. A prose change alone
   does not change accepted runtime input.
3. Define required/optional fields, defaults, invalid-input behavior, and the
   treatment of existing packets or profiles. Update the owning docs, validators,
   relevant declarations, examples, and consuming code together. When references
   change, inspect `packages/contracts/src/reference-registry.mjs` and
   `packages/contracts/src/example-reference-validation.mjs`.
4. Verify valid and invalid cases with the relevant tests under
   `packages/contracts/test/`, then run `pnpm test:references` for the example
   graph. Include focused consumer tests when behavior or compatibility changes;
   use [the validation matrix](../../../CONTRIBUTING.md#validation-by-change-type)
   to select the remaining checks.
5. When `packages/contracts/src/` changes, run
   `node scripts/contract-kernel-parity.mjs`. Regenerate the public metadata
   snapshot with `node scripts/contract-kernel-parity.mjs --write` only after
   reviewing the intentional source change, and review the generated diff.
   The private rehearsal kernel consumes this snapshot; do not maintain a second
   handwritten public schema there.

If only prompt or runtime context content changes and its contract shape stays
the same, use the authoring path in
`docs/architecture/15-platform-assets-and-prompt-lifecycle.md`; do not introduce
schema changes just to revise instructions.
