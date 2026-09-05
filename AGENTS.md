# AGENTS.md

AOR is an AI-native orchestrator for the full SDLC: bootstrap, discovery,
specification, planning, execution, review, QA, delivery, release, and learning.

## Operating contract

- Derive a compact task contract from the request and repository evidence:
  intended outcome, in-scope files or surfaces, hard constraints, acceptance
  criteria, and verification. Make reasonable, reversible assumptions when they
  do not change observable behavior or safety.
- Requests to answer, explain, review, diagnose, or plan are read-only. Inspect
  the relevant sources and report evidence; do not edit files unless the request
  also asks for a change.
- Requests to change, build, or fix authorize bounded local edits and relevant
  non-destructive validation. Continue without asking for routine in-scope
  actions.
- Ask before destructive actions, upstream or external writes, publishing or
  releases, paid calls, credential or secret changes, new production
  dependencies, or a material expansion of scope.
- If a material ambiguity affects contracts, safety, or user-visible behavior,
  stop and ask. Otherwise proceed and call out the assumption in the handoff.

## Load context progressively

- Always follow the nearest `AGENTS.md` for the files being inspected or edited;
  more local guidance wins.
- Use `README.md` for the repository map and current status, and
  `CONTRIBUTING.md` for contributor and PR expectations.
- Read `docs/architecture/12-orchestrator-operating-model.md` when the change
  affects lifecycle ownership, runtime boundaries, or end-to-end behavior.
- Start at `docs/contracts/00-index.md` when packets, reports, profiles,
  manifests, schemas, routes, wrappers, policies, or APIs may change.
- Read `docs/backlog/backlog-operating-model.md`, `docs/backlog/mvp-roadmap.md`,
  and the owning wave document for planning or implementation-slice work.
- Search for the owning source of truth before editing. Do not preload every
  linked document when a narrower source answers the task.

## Current repository state

- This repository is docs-first with implemented CLI, API, web, and runtime
  baselines, but it is not yet a production-ready orchestrator runtime.
- Product runtime outputs belong in AOR Home (`~/.aor` or `AOR_HOME`) and must
  not be committed. Maintainer rehearsal outputs may use ignored repo-local
  `.aor/`; target repositories receive only explicitly materialized portable
  config or evidence exports.
- English is the default language for docs, contracts, examples, comments, and
  commit-ready artifacts unless an external source requires another language.

## Change workflow

1. Classify the work as product, architecture, contract, example, ops, backlog,
   implementation, or community/CI.
2. For implementation work, identify the owning backlog slice and use its wave
   document as the local plan. A tightly scoped bug or maintenance fix may stay
   outside a feature slice when it does not create a new product outcome; make
   that boundary explicit.
3. Identify the minimum set of source-of-truth docs, contracts, examples, tests,
   and code that must remain aligned.
4. Update source-of-truth docs and contracts before, or together with, code that
   depends on them.
5. Implement the smallest complete change that satisfies the task contract.
   Preserve unrelated user changes and avoid opportunistic refactors.
6. Validate in increasing scope: deterministic contract or static checks first,
   focused tests second, then the relevant repository gate.
7. Review the final diff for scope, contract drift, missing evidence, generated
   state, secrets, and accidental provider coupling before handing off.

Use the slice helpers when a slice is involved:

- `pnpm slice:status`
- `pnpm slice:plan -- <slice-id>`
- `pnpm slice:gate`

For a commit-ready repository change, run `pnpm check`. Run
`pnpm production:ready` only when production-readiness or release evidence is in
scope. Use `pnpm install --frozen-lockfile` when dependencies need installation.
If a relevant check is intentionally pending, state the exact reason.

## Parallel work

- Use parallel work only for independent investigations or disjoint file
  ownership that materially reduces elapsed time.
- Give each workstream a bounded objective, allowed scope, expected evidence,
  and output contract. Do not assign overlapping writes.
- Keep one integration owner responsible for reconciling results, reviewing the
  combined diff, and running final validation. Parallel success is not task
  completion until integration gates pass.

## Non-negotiable project rules

- Packet-first: packets, reports, profiles, manifests, and scorecards are
  first-class artifacts.
- Contract-first: define or update the contract before implementation details
  depend on it.
- Runner-agnostic core: do not leak provider-specific behavior into orchestrator
  core.
- Validation before evaluation: deterministic checks come before judge-based
  checks.
- Harness by default: quality-sensitive flows must explain replay, evaluation,
  and certification.
- Headless-first runtime: `apps/web` is optional and detachable.
- Bounded execution: scope, commands, budgets, and write-back mode must stay
  explicit.
- Public-repo safety first: no upstream writes by default in installed-user or
  delivery rehearsals.
- Keep contributor guidance model-agnostic. Model selection, reasoning effort,
  caching, and provider-specific capabilities belong in their owning profiles,
  configuration, or prompt assets and require representative evaluation.

## Where changes belong

- Product scope and user stories: `docs/product/**`
- Research notes and external references: `docs/research/**`
- Architecture and flows: `docs/architecture/**`
- Contracts and schemas: `docs/contracts/**`
- Roadmap, epics, slices, and local-task planning: `docs/backlog/**`
- Runbooks: `docs/ops/**`
- Internal maintainer rehearsal and repository-integrity tooling: `scripts/**`
- Project examples: `examples/**`
- API, CLI, and web surfaces: `apps/**`
- Shared runtime modules: `packages/**`
- CI, issue templates, and community files: `.github/**`

## Code review rules

- Prioritize correctness, contract and source-of-truth drift, security and data
  safety, runner-agnostic boundaries, failure handling, and missing verification.
- Tie every finding to an exact file and evidence. Explain the observable impact
  and the smallest safe correction.
- Do not report formatting or lint preferences already enforced by repository
  checks unless they expose a real defect.
- If no actionable findings remain, say so and identify any residual validation
  gap.

## Done means

- The requested outcome and acceptance criteria are satisfied.
- Relevant docs, contracts, examples, command surfaces, and code agree.
- The owning wave, epic, or slice still describes the change accurately when
  backlog work is involved.
- Focused verification and the applicable repository gate passed, or the
  pending check and reason are documented.
- The final diff contains no unrelated changes, runtime state, secrets, or ad
  hoc notes.
- The handoff summarizes the outcome, changed files, validation evidence,
  assumptions, and remaining risks without requiring the reader to reconstruct
  the work from logs.

## Skills

Use the root skills when their workflow matches the task:

- `repo-navigation` for ownership and cross-file impact.
- `contract-first-change` for packet, report, profile, route, wrapper, policy,
  or API changes.
- `backlog-workflow` for choosing, splitting, or validating a slice.
- `story-traceability` for user-story coverage.
- `npm-cli-alpha-release` for alpha release preparation or publication.
