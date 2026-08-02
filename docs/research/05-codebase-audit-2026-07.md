# AOR codebase baseline audit — July 2026

## Executive summary

This report records a full baseline review of AOR at commit
`db9951718083804bab1e1e4028a8a713bd2ec574` (`0.1.0-alpha.15`). The review
covered the shipped CLI, API, web bundle, shared packages, repository scripts,
private live-E2E harness, tests, contracts, examples, CI, release packaging, and
the documentation that defines expected behavior. Audit evidence collection did
not change source code, contracts, public types, examples, or backlog items.
Remediation planning was performed afterward and is tracked in W57-W59.

The baseline is not ready for production or for unattended write-capable runs.
No `S0 Critical` issue was found, but the audit identified **55 consolidated
findings: 21 S1 High, 30 S2 Medium, and 4 S3 Low**. Fifty-four are confirmed by
code trace plus a targeted probe or a second independent signal; one web race is
probable. Hypotheses are excluded from the remediation backlog.

The highest-risk conclusions are:

1. The default `no-write` live path positively asks a provider to edit the
   primary checkout and accepts the edit as success.
2. Permission and delivery scope controls are bypassable; delivery can commit or
   push unrelated local files, and evidence gates accept arbitrary strings.
3. Project/runtime identifiers, symlinks, and allowed-path handling allow path
   escape, scope loss, filename collision, and SSE framing injection.
4. Harness scoring and strict-delivery checks can certify missing or step-only
   evidence, so current promotion evidence is not trustworthy.
5. Several HTTP/SSE guarantees are not implemented: read routes mutate clean
   projects, local app transport permits unauthenticated cross-origin mutation,
   run start blocks the event loop, and detached processes cannot deliver live
   events to one another.
6. The root test gate omits 12 of 55 tracked test files. Web and production
   readiness checks frequently inspect source markers or metadata instead of the
   behavior they claim to certify.

`pnpm production:ready`, release verification, package dry-run, and package smoke
all passed independently in the disposable audit copy. Integrated `pnpm check`
runs were not stable under audit load: Node 25 failed one two-second adapter
timeout test, and Node 22 later failed one selected core test. The adapter test
passed immediately in isolation; the complete 22-file core batch then passed
194/194 on Node 22. These are retained as gate-stability observations rather than
product defect claims. The more important conclusion is that even a green rerun
would not exercise several confirmed failure paths.

## Scope, rules, and method

The audit followed a baseline-plus-risk approach informed by the
[OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html)
and the [NIST Secure Software Development Framework](https://csrc.nist.gov/projects/ssdf).
Automated results were triage inputs, not verdicts. In particular, whole-file and
export candidates were checked against package exports, CLI dispatch, Vite entry
points, test discovery, dynamic file loaders, and the private live-E2E profile
system, consistent with [Knip's documented model and limitations](https://knip.dev/explanations/how-knip-works).

The review used these evidence standards:

- a bug required a safe reproduction, failing probe, or an unambiguous
  expected/actual state trace;
- dead code required at least two independent signals;
- refactoring findings required multiple signals such as complexity, size,
  duplication, cycle, churn, and a concrete defect concentration;
- security findings used source-to-sink traces and isolated temporary projects;
- `S1` findings received a second review or independent reproduction;
- no credentialed provider execution, paid call, external upstream write, or
  destructive security proof was performed.

Complexity thresholds were used only for triage, following the intent of
[ESLint's complexity rule](https://eslint.org/docs/latest/rules/complexity).
Coverage used the [Node 22 test runner](https://nodejs.org/download/release/v22.17.0/docs/api/test.html),
but coverage percentage was not treated as proof of assertion quality. Dependency
review included read-only [`pnpm audit`](https://pnpm.io/10.x/cli/audit), outdated,
license, and package-content checks.

## Baseline and reproducibility

| Item | Recorded value |
|---|---|
| Commit | `db9951718083804bab1e1e4028a8a713bd2ec574` |
| Commit date | `2026-07-09T23:15:24+04:00` |
| Worktree | Clean, detached HEAD before the report was created |
| Host | macOS 26.5.1, Darwin 25.5.0, arm64 |
| Supported local runtime | Node `v22.22.3`; CI declares Node 22 / 22.14.0 |
| Incidental host runtime | Node `v25.9.0` |
| Package manager | pnpm `10.12.4` |
| Static index | ast-index `3.20.0`: 227 indexed files, 3,507 symbols, 40,585 references |
| Tracked code-like files | 228 `*.mjs/*.js/*.jsx/*.ts/*.tsx`, 139,442 physical lines |
| Tests | 55 tracked `*.test.mjs` files |
| Audit copy | `/tmp/aor-code-audit-db995171.7cN4ZO` |
| Ignored evidence root | `.aor/audits/codebase-review/db9951718083804bab1e1e4028a8a713bd2ec574/` |

Tool versions were pinned for the disposable run: ESLint `10.6.0`, Knip
`6.25.0`, jscpd `5.0.12`, madge `8.0.0`, and TypeScript `7.0.2`. The disposable
copy was created from `git archive`, dependency installation used the frozen
lockfile, and the copy was initialized as a local Git repository only because
some repository tests require Git metadata. No analyzer used `--fix`.

### Gate and analyzer results

| Check | Result | Interpretation |
|---|---|---|
| `pnpm install --frozen-lockfile` | Pass | Disposable copy installed successfully. |
| Node 22 syntax check over tracked JS/ESM | Pass | No parse failures. |
| `pnpm check` on Node 22 | Fail: 1/194 in the selected core phase | Immediate rerun of the same 22-file core batch passed 194/194; the integrated build phase was not reached. |
| `pnpm check` on Node 25 | Fail: 1/57 adapter timeout assertion | The failing test passed immediately alone; treated as a stability observation. |
| Twelve tests omitted by `scripts/test.mjs` | 51/51 pass when invoked directly | Confirms discovery drift, not failing omitted tests at this commit. |
| Targeted Node 22 core coverage | 17/17 pass; 68.60% lines, 55.31% branches, 71.03% functions | Permission, run-level Harness, and review tests with transitive core sources; diagnostic only, not a release threshold. |
| `pnpm production:ready --json` | Pass | The check is predominantly evidence/metadata presence validation. |
| `pnpm release:verify` | Pass | Release metadata accepted in the disposable repository. |
| `pnpm release:pack` | Pass | 297 files in package dry-run. |
| `pnpm release:smoke` | Pass | Installed tarball and ran no-write onboarding plus app smoke. |
| `npm pack --dry-run --json` | Pass | 620,775 bytes packed; 3,024,991 bytes unpacked; 297 entries. |
| Knip | No confirmed whole-file/dependency finding | Custom entry points and filesystem loaders were manually checked. |
| madge circular scan | One ESM cycle | See AUD-048. |
| jscpd, 30-line minimum | 61 clones, 7,176 duplicate lines / 98,348 analyzed lines (7.30%) | See AUD-050. |
| Diagnostic ESLint | 5 errors, 729 warnings in 98/225 files | 256 unused vars, 248 long functions, 164 complexity, 57 depth, 5 duplicate keys, 4 excessive parameter lists. |
| `pnpm audit --prod --json` | Clean | No production-dependency advisory reported. |
| `pnpm audit --json` | 1 high, 1 moderate in Vite 8.0.14 | Development/build surface; see AUD-047. |
| License inventory | MIT, Apache-2.0, MPL-2.0, ISC, BSD-3-Clause | No immediate blocker identified; this is not legal advice. |

The repository's `tsconfig.base.json` declares `strict: true`, but no root script
invokes TypeScript and JavaScript is not opted into `checkJs`. An exploratory
`allowJs/checkJs` run produced a large amount of environment and inference noise,
so its raw count is not treated as a defect count; the missing configured gate is
reported separately.

## Module risk map

| Subsystem | Risk | Why |
|---|---|---|
| Delivery, permissions, and workspace isolation | Critical concentration | Default no-write violation, deny bypass, unrelated-file staging, fake evidence, fork/upstream confusion, and Git isolation corruption. |
| Contracts and filesystem foundation | High | Path traversal, symlink escape, fail-open scopes, weak identifiers, non-transactional initialization, and unresolved asset references. |
| Harness, evaluation, and certification | High | Synthetic scoring, ignored run-level requirement, weak replay compatibility, and mission-profile cross-contamination. |
| HTTP, SSE, and observability | High | Unauthenticated/cross-origin mutation, blocking control plane, process-local live events, event races, and unbounded stream resources. |
| Web console | High | Read-triggered initialization, stale/error state handling, missing live transport, inaccessible drawer, and source-string tests. |
| CLI and in-process API | Medium-high | Unknown flags accepted, follow mode is not live, export drift, redaction gap, and list-limit drift. |
| Private live-E2E harness | Medium-high | Very high complexity and a duplicated private contract kernel; deterministic private tests pass, but no credentialed live profile was run. |
| CI, release, and package | Medium | Actions are pinned and least-privilege, but gates miss tests and behavior; Vite advisories remain; package smoke does not execute the SPA. |

## Finding registry

Only `Confirmed` and `Probable` entries below belong in remediation planning.
Severity describes impact; priority describes recommended sequencing.
The finding title and detailed trace state the primary affected outcome; the
likelihood column estimates exposure on supported paths rather than exploit
probability in an unknown deployment.

| ID | Severity / priority | Confidence | Category | Subsystem | Finding | Likelihood | Effort |
|---|---|---|---|---|---|---|---|
| AUD-001 | S1 / P0 | Confirmed | Contract/security | Execution | Default no-write live runs request and accept source edits | High | L/XL |
| AUD-002 | S1 / P0 | Confirmed | Security | Permissions | Trusted-run command denylist is syntax-bypassable | Medium | M/L |
| AUD-003 | S1 / P0 | Confirmed | Security/scope | Delivery | Delivery stages unrelated tracked and untracked files | High | M/L |
| AUD-004 | S1 / P0 | Confirmed | Evidence integrity | Delivery | Handoff and promotion gates accept arbitrary strings | High | L |
| AUD-005 | S1 / P0 | Confirmed | Security | Delivery | Fork-first accepts an origin-equivalent remote | Medium | M |
| AUD-006 | S1 / P0 | Confirmed | Reliability | Control plane | Synchronous run start blocks SSE and run control | High | XL |
| AUD-007 | S1 / P0 | Confirmed | Data integrity | Isolation | Copied workspaces can share source Git index and HEAD | Medium | L |
| AUD-008 | S1 / P0 | Confirmed | Security | Permissions | Lexical containment allows symlink escape | Medium | M/L |
| AUD-009 | S1 / P0 | Confirmed | Quality gate | Harness | Strict delivery ignores the run-level evidence requirement | Medium | M |
| AUD-010 | S1 / P1 | Confirmed | Evidence lineage | Harness | Mission strictness is selected by project-wide mtime | High | L |
| AUD-011 | S1 / P1 | Confirmed | Concurrency | Execution | Concurrent same-step runs overwrite immutable evidence | Medium | L |
| AUD-012 | S1 / P1 | Confirmed | Quality gate | Evaluation | Scoring and pairwise judge gates are synthetic | Certain | L/XL |
| AUD-013 | S1 / P0 | Confirmed | Security | Filesystem | `project_id` permits runtime-root traversal | Medium | M |
| AUD-014 | S1 / P0 | Confirmed | Security | Filesystem | Symlinked default `.aor` follows an external directory | Medium | M |
| AUD-015 | S1 / P0 | Confirmed | Security/contract | Scope | Allowed-path and rename handling fails open | High | M/L |
| AUD-016 | S1 / P1 | Confirmed | Security/data integrity | Identifiers | Weak IDs cause state collisions and SSE field injection | Medium | M |
| AUD-017 | S1 / P1 | Confirmed | Concurrency | Observability | Concurrent event writers allocate duplicate sequence IDs | Medium | M |
| AUD-018 | S1 / P1 | Confirmed | Architecture/contract | Context | Context/skill assets are neither fully checked nor delivered | High | L |
| AUD-019 | S1 / P0 | Confirmed | Contract/reliability | Read model | GET routes and initial SPA load mutate clean projects | Certain | M |
| AUD-020 | S1 / P0 | Confirmed | Security | HTTP | Local transport permits unauthenticated cross-origin mutation | Medium | M |
| AUD-021 | S2 / P1 | Confirmed | Architecture/reliability | SSE | Live event notification is process-local | High | L/XL |
| AUD-022 | S1 / P0 | Confirmed | Tests/quality gate | Quality gates | Root test discovery omits files and is load-sensitive | Certain | M |
| AUD-023 | S2 / P1 | Confirmed | Concurrency | Run control | Concurrent commands silently lose transitions | Medium | M/L |
| AUD-024 | S2 / P1 | Confirmed | Adapter safety | Adapter SDK | Qwen JSONL normalization erases denial semantics | Medium | M |
| AUD-025 | S2 / P1 | Confirmed | Contract/dead config | Routing | Fallback, retry, and repair route references are dropped | High | L |
| AUD-026 | S2 / P1 | Confirmed | Bug/policy | Policies | `retry.on[]` and `repair.on[]` do not constrain actions | Medium | M |
| AUD-027 | S2 / P1 | Confirmed | Certification | Harness | Replay compatibility ignores content and version fingerprints | Medium | M |
| AUD-028 | S2 / P1 | Confirmed | Data integrity | Assets | Duplicate asset identities resolve last-file-wins | Medium | M |
| AUD-029 | S2 / P1 | Confirmed | Atomicity | Initialization | Initialization writes before validation and is non-transactional | Medium | L |
| AUD-030 | S2 / P1 | Confirmed | Portability | Git worktrees | Linked Git worktrees are detected as non-Git projects | Medium | S |
| AUD-031 | S2 / P2 | Confirmed | Portability | Module loading | Module paths with spaces retain `%20` URL encoding | Low | XS/S |
| AUD-032 | S2 / P1 | Confirmed | CLI compatibility | CLI | `run status --follow` exits after replay | Certain | M |
| AUD-033 | S2 / P1 | Confirmed | Performance | SSE | Replay accepts zero as all and has no effective bound | Medium | S/M |
| AUD-034 | S2 / P1 | Confirmed | Reliability/performance | SSE | Active streams block shutdown and leak resources | Medium | M |
| AUD-035 | S2 / P1 | Confirmed | API compatibility | API | Documented in-process exports are incomplete and ambiguous | High | M |
| AUD-036 | S2 / P1 | Confirmed | Bug/performance | API | Operator-request list ignores `limit` | High | S/M |
| AUD-037 | S2 / P1 | Confirmed | Contract/quality gate | OpenAPI | Schema and readiness checks disagree with runtime | High | M/L |
| AUD-038 | S2 / P1 | Confirmed | Operator safety | CLI/API | Unknown command flags are silently accepted | High | M |
| AUD-039 | S2 / P1 | Confirmed | Architecture | Web | Console does not implement configured detached/live transport | High | M/L |
| AUD-040 | S2 / P1 | Probable | Race/data isolation | Web | Stale project refresh can overwrite a new selection | Medium | M |
| AUD-041 | S2 / P1 | Confirmed | Reliability/UX | Web | Endpoint failures are rendered as empty connected state | High | M |
| AUD-042 | S2 / P1 | Confirmed | Functional bug | Web | Multi-item interaction queues expose only the first item | Medium | S/M |
| AUD-043 | S2 / P1 | Confirmed | Accessibility | Web | Add Project drawer is not an accessible modal | Certain | M |
| AUD-044 | S2 / P1 | Confirmed | Quality gate | Web tests | Web gates scan strings instead of exercising behavior | High | L |
| AUD-045 | S2 / P1 | Confirmed | Security | CLI | `aor app --json` bypasses configured redaction | Medium | XS/S |
| AUD-046 | S2 / P1 | Confirmed | Security/reliability | HTTP | Mutation bodies are buffered without a size limit | Medium | S |
| AUD-047 | S2 / P1 | Confirmed | Supply-chain security | Build | Vite 8.0.14 has two Windows advisories | Low/conditional | XS |
| AUD-048 | S2 / P2 | Confirmed | Dependency cycle | Architecture | Control-plane and app-launcher modules form an ESM cycle | High | M/L |
| AUD-049 | S2 / P1 | Confirmed | Refactoring | Cross-cutting | Critical flows exceed size and complexity thresholds | High | XL |
| AUD-050 | S2 / P2 | Confirmed | Duplication | Contracts/live-E2E | Public and private contract/runtime kernels drift by copy | High | L/XL |
| AUD-051 | S2 / P2 | Confirmed | Static analysis | Quality gates | Strict TypeScript and diagnostic lint configuration is inert | High | M/L |
| AUD-052 | S3 / P2 | Confirmed | Dead output | Initialization | Materialized `context/` output is not used by registry roots | Low | S |
| AUD-053 | S3 / P2 | Confirmed | Dead code | Cross-cutting | Dead symbols, imports, and overwritten object fields remain | Certain | S/M |
| AUD-054 | S3 / P2 | Confirmed | Compatibility | Web | UI displays a stale hard-coded version | Certain | XS |
| AUD-055 | S3 / P3 | Confirmed | Performance | Scripts | Reference-integrity gate parses examples twice | Certain | XS/S |

## S1 findings — release and trust blockers

### AUD-001 — Default no-write live runs request and accept source edits

**Evidence:** `packages/orchestrator-core/src/delivery-plan.mjs:166-177,251-289`,
`packages/orchestrator-core/src/step-adapter-invocation.mjs:91-128`,
`packages/orchestrator-core/src/step-execution-engine.mjs:1061-1065,1570-1573`, and
`packages/adapter-sdk/src/index.mjs:1859-1881,2887-2895`.

**Expected:** `README.md:120-122` and `docs/contracts/delivery-plan.md:20-24`
allow runtime evidence under `.aor` but forbid target-source edits in `no-write`.
**Actual:** a no-write plan is `ready` with `writeback_allowed=true`, normal run
start uses the primary checkout, and the provider packet unconditionally sets
`expected_meaningful_change.required=true`, `no_op_forbidden=true`, and
`direct_edits_allowed=true`. A fake local adapter wrote `SOURCE_EDITED.txt`; the
route returned success and retained the edit. Independent reproduction confirmed
the same state trace.

**Impact:** the safest default mode violates its defining invariant. **CWE:**
CWE-284/CWE-693; no independent CVSS score was assigned to this architecture
defect. **Recommendation:** separate execution permission from delivery
write-back; compile a read-only provider contract; execute in a real disposable
workspace; fail on any target diff. **Acceptance:** a malicious adapter write is
blocked and the primary SHA, index, status, and content remain unchanged.

### AUD-002 — Trusted-run command denylist is syntax-bypassable

**Evidence:** `packages/orchestrator-core/src/runtime-permission-policy.mjs:6-21,159-177,270-282,425-434`
and `packages/orchestrator-core/src/step-execution-engine.mjs:1694-1709,1915-1927`.
The classifier denies `git push origin HEAD` but auto-approves `git -C . push
origin HEAD`, `node -e "fetch(...)"`, and a Python network wrapper in
`trusted-run`; the classified command may then be retried with `full-bypass`.

**Expected:** `docs/contracts/adapter-capability-profile.md:102-108` states that
network/upstream hard denies are not bypassable. **Impact:** command spelling or
an interpreter wrapper defeats the main mutation boundary. **CWE:** CWE-184 and
CWE-693. **Recommendation:** replace regex mediation with structural capability
enforcement plus OS/network sandboxing; deny unparsed interpreters by default.
**Acceptance:** aliases, `git -C`, wrappers, interpreters, and option permutations
cannot perform an upstream or network mutation.

### AUD-003 — Delivery stages unrelated tracked and untracked files

**Evidence:** `packages/orchestrator-core/src/delivery-mode-runners.mjs:277-320,333-368,601-643`,
`packages/orchestrator-core/src/delivery-driver.mjs:99-105,464-495`, and
`packages/orchestrator-core/src/shared/mission-scope.mjs:242-258`.
Local-branch and fork-first run `git add -A`; patch-only collects every tracked
diff; validation checks that expected paths are present but never rejects extras,
and some validation occurs after side effects. Independent temporary-repository
probes committed and locally pushed an intended file plus an unrelated tracked
edit and an untracked `private` file.

**Impact:** dirty worktrees can leak unrelated or secret data into a commit/fork.
**CWE:** CWE-200/CWE-862. **Recommendation:** snapshot the baseline, calculate the
exact admissible diff, reject extras before mutation, and stage only approved
paths. **Acceptance:** unrelated additions, edits, deletions, renames, and
symlinks block every delivery mode before commit or push.

### AUD-004 — Handoff and promotion gates accept arbitrary strings

**Evidence:** `packages/orchestrator-core/src/delivery-plan.mjs:172-177,214-226,251-291`,
`packages/orchestrator-core/src/step-execution-engine.mjs:1282-1302`, and
`packages/orchestrator-core/src/operator-cli/command-handlers/delivery.mjs:322-390`.
Non-empty caller strings are converted into present/pass evidence without loading
an artifact. Two guaranteed-nonexistent handoff/promotion paths produced a ready,
writeback-enabled local-branch plan with no blockers.

**Impact:** typos or a malicious caller unlock write-capable execution. **CWE:**
CWE-345. **Recommendation:** resolve every reference and validate family,
contract, project/run ownership, approval status, freshness, and lock state.
**Acceptance:** nonexistent, wrong-family, wrong-run, stale, held, or malformed
evidence blocks before any provider or Git operation. Public behavior changes
from permissive strings to resolvable evidence and needs an explicit compatibility
note.

### AUD-005 — Fork-first accepts an origin-equivalent remote

**Evidence:** `packages/orchestrator-core/src/delivery-mode-runners.mjs:423-451,523-526,639-643`
and `packages/orchestrator-core/src/operator-cli/command-handlers/delivery.mjs:460-475`.
The supplied fork URL is pushed without proving that it differs from origin,
while evidence still claims `direct_upstream_write_allowed=false`. A local bare
remote probe confirmed an origin-equivalent target is accepted and pushed.

**Impact:** credentials can turn a purported fork-first flow into direct upstream
write. **CWE:** CWE-284/CWE-345. **Recommendation:** canonicalize both remotes and
verify repository owner, parent/fork relationship, and inequality before Git
mutation. **Acceptance:** origin-equivalent, mismatched, or local URLs fail before
staging or commit.

### AUD-006 — Synchronous run start blocks SSE and run control

**Evidence:** `packages/orchestrator-core/src/control-plane/http/http-mutation-handlers.mjs:168-199`,
`packages/orchestrator-core/src/control-plane/lifecycle-command.mjs:338-384`,
`packages/orchestrator-core/src/operator-cli/index.mjs:24-60`, and
`packages/adapter-sdk/src/index.mjs:811-832`. HTTP start executes the full CLI
path and synchronous external runner in the server process. A timer scheduled
during a 400 ms fake provider ran only after execution returned.

**Expected:** the realtime architecture requires concurrent stream, heartbeat,
pause, cancel, and answer operations. **Impact:** a live run makes its own control
plane unresponsive. **Recommendation:** persist a job, return `202 + run_id`, and
run providers asynchronously in a worker with IPC. **Acceptance:** during a
five-second fake provider, SSE heartbeat and state GET remain responsive and a
same-server cancel terminates the process group promptly.

### AUD-007 — Copied workspaces can share source Git index and HEAD

**Evidence:** `packages/orchestrator-core/src/workspace-isolation.mjs:118-137,157-187`.
Both advertised isolation modes use filesystem copy, including `.git`. For a
linked worktree the copied `.git` file still points to the source worktree admin
directory. In a temporary repository, `git add` inside the copy changed source
status and a commit moved the source branch HEAD while leaving its file dirty.

**Impact:** verification/execution can corrupt the source index and branch.
**Recommendation:** use `git worktree add --detach` or a real independent clone,
never copy `.git`, and verify independent gitdirs. **Acceptance:** source HEAD,
index, status, and content are invariant across execution and cleanup.

### AUD-008 — Lexical containment allows symlink escape

**Evidence:** `packages/orchestrator-core/src/runtime-permission-policy.mjs:105-119,409-423`
and coarse retry at
`packages/orchestrator-core/src/step-execution-engine.mjs:836-864,1915-1927`.
Containment is
computed with `path.resolve/path.relative` but without canonicalizing existing
ancestors. An in-root link to an outside directory was auto-approved and eligible
for full-bypass retry.

**Impact:** an apparently in-scope file request can modify an external path.
**CWE:** CWE-59/CWE-367. **Recommendation:** resolve ancestors, reject escaping
links/junctions, use no-follow operations where possible, and remove broad retry.
**Acceptance:** file and command requests through escaping links are denied,
including link-swap race probes.

### AUD-009 — Strict delivery ignores the run-level evidence requirement

**Evidence:** `packages/orchestrator-core/src/operator-cli/command-runtime.mjs:419-445,476-537`
and caller setup at
`packages/orchestrator-core/src/operator-cli/command-handlers/delivery.mjs:217-269`.
`requireRunLevel` is passed but never read. A strict step-only report without a
controller/run decision and a soft no-write report with no step decisions both
returned pass when run-level evidence was requested.

**Impact:** incomplete or cross-contaminated evidence can authorize strict
delivery. **Recommendation:** make delivery mode authoritative and require a
closed run controller, transitions, routed decisions, meaningful paths, and a
run-level pass. **Acceptance:** a delivery-mode × mission-profile × report-level
truth table fails closed for every incomplete case.

### AUD-010 — Mission strictness is selected by project-wide mtime

**Evidence:** `packages/orchestrator-core/src/runtime-harness-report.mjs:191-199,264-285,1119-1124`.
The resolver picks the newest intake artifact in the project and accepts no
run/flow identifier. A newer soft no-write intake for run B caused an older
code-changing run A to resolve B's mission profile.

**Impact:** concurrent flows can downgrade one another's strictness. **Recommendation:**
persist the exact intake/mission ref in run state and follow run-scoped lineage,
never filesystem mtime. **Acceptance:** interleaved flows retain independent
mission profiles regardless of write order.

### AUD-011 — Concurrent same-step runs overwrite immutable evidence

**Evidence:** `packages/orchestrator-core/src/step-execution-engine.mjs:706-752,1072-1085`
and `packages/orchestrator-core/src/step-result-writer.mjs:13-26`. Attempt
allocation scans then increments without reservation, and deterministic filenames
are overwritten. Ten parallel identical dry executions all selected attempt 1;
only one step result remained.

**Impact:** multiple providers may spend, edit, or fail while nine evidence chains
disappear. **Recommendation:** transactional per-run attempt reservation,
idempotency keys, and exclusive immutable writes. **Acceptance:** concurrent same
keys produce one execution plus idempotent responses/conflicts, or unique attempts,
never overwrite.

### AUD-012 — Scoring and pairwise judge gates are synthetic

**Evidence:** `packages/harness/src/scorer-interface.mjs:25-31,65-104`,
`packages/orchestrator-core/src/eval-runner.mjs:137-172`, and
`packages/orchestrator-core/src/certification-decision.mjs:885-896,1030-1062`.
The deterministic scorer only checks that ref strings are non-empty. The named
pairwise judge does not read subject, input, or expected content and always
produces a score in the passing `0.7..1` range. Critical cases using
`missing://subject`, `missing://input`, and `missing://expected` passed with a
pass rate of 1.

**Impact:** invalid assets can be certified and promoted using synthetic evidence.
**Recommendation:** resolve immutable case artifacts, execute real deterministic
assertions, isolate the judge interface, and content-address subject/cases.
**Acceptance:** missing or contradictory cases fail closed, controlled mutations
change verdicts, and promotion rejects placeholder scoring.

### AUD-013 — `project_id` permits runtime-root traversal

**Evidence:** `packages/contracts/src/families.mjs:89-137`,
`packages/contracts/src/loader.mjs:147-179,304-388`,
`packages/orchestrator-core/src/project-init.mjs:743-767,809-823`, and
`packages/orchestrator-core/src/artifact-store.mjs:300-303`. A valid profile was
changed to `project_id: ../../escaped`; contract validation still returned
`ok: true`, and runtime layout joined the value beneath `projectsRoot` without a
containment check.

**Impact:** profile-controlled writes can escape the intended runtime root.
**CWE:** CWE-22. **Recommendation:** define a canonical identifier grammar in the
contract and re-check canonical containment at every filesystem sink. **Acceptance:**
absolute, traversal, separator, dot-segment, Unicode-confusable, and Windows-drive
variants fail before any write.

### AUD-014 — Symlinked default `.aor` follows an external directory

**Evidence:** `packages/orchestrator-core/src/project-init.mjs:627-729,743-823`.
Initialization creates and writes beneath the configured runtime path without
`lstat`/canonical ancestor validation; an existing `.aor` symlink redirects
runtime artifacts outside the target.

**Impact:** ordinary initialization crosses its filesystem trust boundary.
**CWE:** CWE-59. **Recommendation:** reject symlink/junction runtime roots by
default, canonicalize existing ancestors, and persist the canonical root.
**Acceptance:** a symlinked root or ancestor fails before the first artifact and
the external directory remains unchanged.

### AUD-015 — Allowed-path and rename handling fails open

**Evidence:** `packages/orchestrator-core/src/shared/mission-scope.mjs:77-106,206-223`,
`packages/orchestrator-core/src/review-run.mjs:734-752,1050-1062`, and
`packages/contracts/src/loader.mjs:536-548`.

Three independent probes expose the same root problem:

- porcelain rename parsing keeps only the destination, so moving
  `outside.txt -> source/inside.txt` hides an out-of-scope deletion;
- wildcard matching treats patterns as prefixes: `source/*.ts` accepted
  `source/private/secret.txt`;
- malformed non-string `allowed_paths` entries are filtered to an empty list,
  and empty means unrestricted.

**Impact:** review and delivery may authorize changes outside mission scope.
**CWE:** CWE-22/CWE-184. **Recommendation:** validate every scope entry in the
contract; use a tested path-glob library with explicit semantics; parse Git
status `-z` and retain both rename endpoints; make missing/malformed scope fail
closed. **Acceptance:** a property-test matrix covers separators, globstars,
renames, deletions, links, Unicode, and malformed values.

### AUD-016 — Weak IDs cause state collisions and SSE field injection

**Evidence:** filename normalization in `packages/orchestrator-core/src/run-control.mjs:30-31,89-113`,
raw event IDs in `packages/observability/src/live-run-events.mjs:55-61`, SSE
encoding in `packages/orchestrator-core/src/control-plane/http/http-sse.mjs:12-21`,
and string-only validation in `packages/contracts/src/families.mjs:1194-1203`.
`foo/bar` and `foo bar` resolve to the same run-state filename. A run ID containing
CR/LF produced additional `retry:` and `event:` fields in the SSE frame.

**Impact:** runs overwrite one another and an identifier can alter stream framing.
**CWE:** CWE-93/CWE-116. **Recommendation:** establish one collision-resistant,
single-line identifier grammar and reject rather than lossy-normalize at ingress.
**Acceptance:** collision/property tests across all filesystem and protocol sinks;
CR/LF returns HTTP 400 and the SSE encoder emits one ID/event field.

### AUD-017 — Concurrent event writers allocate duplicate sequence IDs

**Evidence:** `packages/observability/src/live-run-events.mjs:68-110,126-137,219-234`.
Each writer rereads and sorts the complete JSONL log, calculates `last + 1`, then
appends without interprocess serialization. Parallel-process probes produced all
records but only 18 unique IDs out of 24/40 writes; SSE suppresses duplicate or
lower sequence numbers.

**Impact:** durable records exist but subscribers silently miss events; repeated
full-file parsing is also quadratic over a long run. **Recommendation:** use a
single writer or locked sequence reservation, an immutable UUID/offset cursor,
and bounded tail recovery. **Acceptance:** 1,000 concurrent appends produce unique
ordered IDs and complete replay with bounded append latency.

### AUD-018 — Context/skill assets are neither fully checked nor delivered

**Evidence:** `packages/contracts/src/reference-registry.mjs:157-355`,
`packages/contracts/src/example-reference-validation.mjs:38-329,504-550`,
`packages/orchestrator-core/src/asset-loader.mjs:293-330`,
`packages/orchestrator-core/src/context-compiler.mjs:283-312,384-500`, and
`packages/adapter-sdk/src/index.mjs:1765-2003`.
Reference integrity misses some skill overrides and context-rule refs. At runtime,
the compiler carries IDs/URIs but not normalized content or content hashes into
the instruction set/provider packet. A public-repo safety rule appeared in refs
but its instruction text did not reach the provider.

**Impact:** evidence says safety context is present when the runner never sees it;
same-version content changes do not invalidate certification. **Recommendation:**
resolve and family-validate every ref, compile bounded normalized content, and
include source hashes in fingerprints. **Acceptance:** missing/wrong-family refs
block; changing rule content changes the fingerprint; provider input contains the
effective rule text or an immutable readable attachment.

### AUD-019 — GET routes and initial SPA load mutate clean projects

**Evidence:** `apps/web/src/spa.jsx:6469-6472,6493-6502`,
`packages/orchestrator-core/src/control-plane/http/http-read-handlers.mjs:143-144`,
`packages/orchestrator-core/src/control-plane/read-run-projections.mjs:495-500`,
and
`packages/orchestrator-core/src/control-plane/read-artifact-readers.mjs:695-717,728-734,757-763`.
`GET /state` is non-mutating, but `GET /packets` and `/runs` call initialization.
A first browser load requested `/state` then `/runs` and created the profile,
state, onboarding report, bootstrap packet, and body without a click.

**Expected:** `docs/contracts/control-plane-api.md:695` makes reads read-only;
`README.md:218-220` makes initialization explicit. **Impact:** merely observing a
repository changes it and can produce a false first-run state. **Recommendation:**
introduce a non-materializing read context and return explicit uninitialized/empty
models. **Acceptance:** `/`, app config, and every GET route leave a clean target
byte-for-byte unchanged. Response compatibility needs an explicit
`initialized=false` representation.

### AUD-020 — Local transport permits unauthenticated cross-origin mutation

**Evidence:** `packages/orchestrator-core/src/operator-cli/app-launcher.mjs:85-91,343-376`,
`packages/orchestrator-core/src/control-plane/http/http-transport.mjs:52-103,132-141,284-315`,
`packages/orchestrator-core/src/control-plane/http/http-auth.mjs:40-45,118-123`,
and `packages/orchestrator-core/src/control-plane/http/http-utils.mjs:83-110`.
`aor app --host 0.0.0.0` leaves auth disabled; Host and Origin are not validated;
the JSON parser accepts `text/plain`, enabling a CORS-safelisted browser write;
and `/app-config.json` bypasses hardened auth, reflects Host, and exposes absolute
paths. Isolated probes received HTTP 200 and created state for an unauthenticated
LAN request and a foreign-Origin text/plain POST; a spoofed Host was reflected in
app config while normal API returned 401.

**Impact:** a local/LAN or DNS-rebinding/CSRF attacker can invoke filesystem
mutations. **CWE:** CWE-306/CWE-346/CWE-352. **Recommendation:** refuse non-loopback
binding without hardened auth, validate Host/Origin, require JSON media type, add
same-origin CSRF protection, and authenticate config. **Acceptance:** unsafe
launch fails; foreign Origin/text returns 403/415 without artifacts; spoofed Host
returns 400.

### AUD-022 — Root test discovery omits files and is load-sensitive

**Evidence:** the explicit list in `scripts/test.mjs:1178-1184,1233-1257` does not
include:

- `apps/web/test/operator-request-spa.test.mjs`;
- `packages/orchestrator-core/test/control-plane-interaction-answer.test.mjs`;
- `packages/orchestrator-core/test/flow-projections.test.mjs`,
  `packages/orchestrator-core/test/intake-create-cli.test.mjs`,
  `packages/orchestrator-core/test/live-e2e-read-model.test.mjs`, and
  `packages/orchestrator-core/test/multirepo-coordination.test.mjs`;
- `packages/orchestrator-core/test/operator-request.test.mjs`,
  `packages/orchestrator-core/test/review-run.test.mjs`,
  `packages/orchestrator-core/test/runtime-harness-controller.test.mjs`, and
  `packages/orchestrator-core/test/runtime-permission-policy.test.mjs`;
- `packages/orchestrator-core/test/skill-registry.test.mjs` and
  `packages/orchestrator-core/test/stack-discovery.test.mjs`.

All 12 passed when directly invoked (51 tests), but future regressions in them are
invisible to `pnpm test`, `pnpm check`, CI, and `release:gate`.
`scripts/production-readiness.mjs:434-483` only scans one omitted Harness test's
source and then claims evidence is present.

In addition, integrated runs failed different timing-sensitive tests under audit
load: Node 25 failed the two-second route-timeout adapter assertion (56/57), and
Node 22 failed one test in the 194-test selected core phase. The adapter test
passed immediately alone and the complete core phase passed 194/194 on immediate
rerun. This does not establish a product bug, but it does establish that the gate
can report a false release failure under ordinary concurrent load.

**Impact:** the release gate's test claim is materially incomplete. **Recommendation:**
discover all tracked test files with explicit, documented exclusions; fail when a
new test is undiscovered; keep private boundary tests separately labeled but
included. **Acceptance:** manifest-vs-discovery test reports 55/55 at this commit,
and intentionally excluded tests require a reason and expiry.

## S2 findings — next repair slices

### AUD-021 — Live event notification is process-local

**Evidence:** `packages/observability/src/live-run-events.mjs:17-28,136-137,203-234`
and the same-process-only test at `apps/api/test/http-transport.test.mjs:495-567`.
Notification uses a module-local `EventEmitter`; a detached server in process A
did not receive an event appended by process B, although history GET saw the
durable record. A second reviewer reduced the initial S1 classification because
durable history/reconnect retains the event; live delivery, not evidence, is lost.

**Impact:** the canonical CLI/runtime process cannot update a detached API/web
live view while a run is active. **Recommendation:** tail the durable journal
across processes or use a broker with cursor/order/deduplication. **Acceptance:**
a separate writer process delivers an ordered live event and reconnect by event ID
remains correct.

### AUD-023 — Concurrent run-control commands silently lose transitions

`packages/orchestrator-core/src/run-control.mjs:89-112,396-423,457-511`
performs read/sequence/write without a lock or compare-and-swap. Start plus 16
simultaneous steer commands ended at sequence 8 with only eight audit files; nine
operator transitions disappeared. Use a per-run transaction/lock or an append-only
state machine with unique command IDs. Acceptance: 100 concurrent commands are
serialized or return explicit conflicts and no audit entry is overwritten.

### AUD-024 — Qwen JSONL normalization erases denial semantics

`packages/adapter-sdk/src/index.mjs:987-1025,1121-1153,1332-1414,3161-3164,3307-3384`
replaces Qwen stream records with presentation metadata before structured failure
classification. A successful two-event stream whose final record contained an
outside-path `permission_denials` array returned public `success`, although raw
evidence retained the denial. Extract semantic signals before redaction and test
denials, interaction requests, packet echo, and blocked final reports across all
provider formats. Acceptance: each structured denial produces a blocked response
with a stable failure kind while public output remains redacted.

### AUD-025 — Fallback, retry, and repair route references are dropped

`packages/provider-routing/src/route-resolution.mjs:169-199` reconstructs the
resolved route without source `fallback`, `retry_policy_ref`, or
`repair_policy_ref`; `packages/adapter-sdk/src/index.mjs:2322-2430` therefore sees
only the primary. Every example declares these fields, but a probe showed none in
the resolved route and retry selected the same route. Preserve and validate an
ordered candidate/policy graph and record each transition. Acceptance: an allowed
transient failure selects a compatible fallback, while a disallowed or incapable
fallback fails closed.

### AUD-026 — `retry.on[]` and `repair.on[]` do not constrain actions

`packages/orchestrator-core/src/runtime-harness-report.mjs:580-620` records that a
failure class is not listed, but
`packages/orchestrator-core/src/step-execution-engine.mjs:818-830,1887-1927`
checks only remaining attempts and still schedules the action. A policy limited to
`tests-failed` scheduled repair for `security-boundary`. Make `on[]` membership an
executable precondition and define the otherwise escalation. Acceptance: a matrix
over failure class, action, and budget proves unlisted failures never retry/repair.

### AUD-027 — Replay compatibility ignores content and version fingerprints

`packages/harness/src/capture-format.mjs:80-112` compares six IDs/refs; replay at
`packages/orchestrator-core/src/harness-capture-replay.mjs:123-170` trusts that
result. Compiled-context fingerprint, route/policy/adapter versions, compiler
revision, and source hashes are absent. Same-reference changed assets therefore
replay as compatible. Define a content-addressed compatibility manifest.
Acceptance: changing content or an effective version with stable IDs returns
`incompatible` and blocks certification.

### AUD-028 — Duplicate asset identities resolve last-file-wins

`packages/orchestrator-core/src/asset-loader.mjs:71-182` and
`packages/contracts/src/reference-registry.mjs:205-335` index assets without a
duplicate conflict. Directory order silently chooses one document. Reject duplicate
canonical IDs unless byte-identical and explicitly layered; include source path and
digest in conflicts. Acceptance: two differing assets with one identity fail
deterministically on every OS/filesystem ordering.

### AUD-029 — Initialization writes before validation and is non-transactional

`packages/orchestrator-core/src/project-init.mjs:627-729,1102-1234` and
`packages/orchestrator-core/src/artifact-store.mjs:300-349` copy examples/context
and write state before all
validation and packet creation finish. Invalid profiles and injected write failures
left partial runtime layouts. Stage the complete initialized tree under a sibling
temporary directory, validate it, fsync as appropriate, then atomically publish or
roll back. Acceptance: a failure injected at every write boundary leaves either the
previous valid runtime or no runtime, never a mixed state.

### AUD-030 — Linked Git worktrees are detected as non-Git projects

`packages/orchestrator-core/src/project-init.mjs:248-260` checks whether `.git` is
a directory. In a linked worktree it is a file, so generated profiles default to
`main` instead of the actual branch. Resolve Git metadata through `git rev-parse`
or parse the gitdir file. Acceptance: normal repositories, linked worktrees,
detached HEADs, and bare-invalid targets produce explicit correct branch state.

### AUD-031 — Module paths with spaces retain `%20` URL encoding

`packages/orchestrator-core/src/project-init.mjs:236-242` derives an install path
from `import.meta.url.pathname`; spaces remain `%20`. Use `fileURLToPath()`.
Acceptance: package installation and onboarding pass from paths containing spaces,
Unicode, and platform-native separators.

### AUD-032 — `run status --follow` exits after replay

`packages/orchestrator-core/src/operator-cli/command-handlers/run-control.mjs:451-541`
copies `replay_events` and prints once; it never subscribes to the stream. A follow
process exited before a later append. Implement an async streaming stdout path with
cursor reconnect and signal cleanup, or rename the option. Acceptance: start follow,
append from another process, observe the event, and terminate cleanly with SIGINT.
This is a CLI compatibility correction.

### AUD-033 — SSE replay accepts zero as all and has no effective bound

`packages/observability/src/live-run-events.mjs:162-201`,
`packages/orchestrator-core/src/control-plane/http/http-utils.mjs:22-27,118-123`,
and `packages/orchestrator-core/src/control-plane/http/http-stream-handlers.mjs:17-28`
read the whole log and apply `slice(-max)`.
Because `slice(-0) === slice(0)`, `maxReplay=0` returned all events; positive input
is uncapped. Define zero as none, enforce a server cap, and tail only the required
window. Acceptance: zero returns no replay, over-cap input is rejected/capped, and
large logs are not fully retained.

### AUD-034 — Active streams block shutdown and leak resources

`packages/orchestrator-core/src/control-plane/http/http-stream-handlers.mjs:55-68`,
`packages/orchestrator-core/src/control-plane/http/http-transport.mjs:234-247`,
`packages/observability/src/live-run-events.mjs:17-28`, and
`packages/orchestrator-core/src/control-plane/http/http-sse.mjs:12-21`
do not track/close active responses, never remove emitter entries, and ignore
`response.write()` backpressure. `transport.close()` remained pending until the
client aborted. Track sockets/responses/subscriptions, clean on every close/error,
bound slow clients, and evict idle emitters. Acceptance: shutdown completes within
a bound with active clients and listener/memory counts return to baseline.

### AUD-035 — Documented in-process exports are incomplete and ambiguous

`apps/api/src/index.mjs:1-27` omits documented operator request, flow trace/evidence,
artifact summary, and operator mutation/status operations. The core barrel
`packages/orchestrator-core/src/control-plane/index.mjs:1-7` star-exports two
different `listOperatorRequests` implementations
(`packages/orchestrator-core/src/control-plane/read-artifact-readers.mjs:909-951`
and `packages/orchestrator-core/src/operator-request.mjs:321-342`),
so ESM omits the ambiguous symbol. Establish
one canonical service and explicit exports/aliases. Acceptance: every documented
operation imports from `apps/api`; a module-surface contract test detects drift.

### AUD-036 — Operator-request list ignores `limit`

`packages/orchestrator-core/src/control-plane/http/http-read-handlers.mjs:134-136`
passes the parameter, but
`packages/orchestrator-core/src/control-plane/read-artifact-readers.mjs:927-951`
ignores it and OpenAPI omits it. Seven requests
with `?limit=2` returned all seven, contrary to
`docs/contracts/control-plane-api.md:633-637`. Apply a validated default/max before
parsing/output. Acceptance: default is at most 200, explicit five returns at most
five, and values above 1,000 are rejected or capped consistently.

### AUD-037 — OpenAPI and readiness checks disagree with runtime

Examples include object-only `JsonObject` schemas for array endpoints
(`docs/contracts/control-plane-api.openapi.json:119-140,1319-1322`), missing SSE
and list query parameters (`:570-587,831-847`), a global bearer requirement that
does not model local mode (`:19-23`), and auth metadata at the wrong nesting level
(`:1373-1392`). `scripts/production-readiness.mjs:486-573` validates names/markers,
not captured payloads, so it remains green. Model real success/error/nullable
shapes and validate route fixtures against OpenAPI. Acceptance: every captured
route response validates and a generated client exposes all supported parameters.

### AUD-038 — Unknown command flags are silently accepted

The generic parser at
`packages/orchestrator-core/src/operator-cli/command-handler.mjs:105-158` and
lifecycle normalization at
`packages/orchestrator-core/src/control-plane/lifecycle-command.mjs:228-309`
validate required
and server-owned flags but not unexpected ones, despite an explicit catalog.
`aor doctor --totally-unknown yes --json` exited 0. Generate allowed/repeatable
sets from command definitions and validate once before dispatch. Acceptance: a
typo exits 1 / HTTP 400 with a suggestion while valid repeated flags remain
compatible.

### AUD-039 — Console does not implement configured detached/live transport

`apps/web/src/spa.jsx:6229-6233,6616-6625` uses relative HTTP and an eight-request
poll every five seconds only while one provider state is active. It contains no
`EventSource` and does not consume `config.control_plane`, `api_base_url`, or the
UI lifecycle endpoints required by `docs/contracts/control-plane-api.md:683-689`.
Create one typed/configured client with SSE cursor/reconnect, detach/unsubscribe,
auth policy, and polling fallback. Acceptance: a separate-process event updates
the UI, project switches close old streams, and explicit detach is invoked.

### AUD-040 — Stale project refresh can overwrite a new selection

`apps/web/src/spa.jsx:6447-6568,6659-6668` applies most project state, packets,
runs, and request setters without the selection-version guard used by only flow
selection/workbench. A slow A refresh can therefore commit after fast B. This is
`Probable`: the asynchronous state trace is unambiguous, but a deterministic
browser delay harness was not added during the audit. Use AbortController or a
generation-keyed atomic snapshot. Acceptance: delayed A followed by B never
renders any A identifier after B becomes current.

### AUD-041 — Endpoint failures render as empty connected state

`apps/web/src/spa.jsx:6432-6444,6531-6540` turns graph/trace and seven list/report
failures into null/empty values; `:7217` labels connection as connected whenever
config exists. A 500/offline response is indistinguishable from no evidence.
Track per-resource loading/error/stale state, retain last-known snapshots, and
disable dependent mutations. Acceptance: injected endpoint failures show named
partial/offline errors and never appear as an authoritative empty result.

### AUD-042 — Multi-item interaction queues expose only the first item

`apps/web/src/spa.jsx:4749-4771,5072-5077` fixes both interaction and decision
workspaces to `[0]`; displayed rows do not select another item. Later pending
questions/decisions cannot be answered. Add an accessible selected ID and
per-item draft state. Acceptance: with two entries an operator selects and submits
each with the correct run/request reference.

### AUD-043 — Add Project drawer is not an accessible modal

`apps/web/src/spa.jsx:5922-5994` renders the drawer as a complementary region. In
Chrome's accessibility tree it was not a dialog; focus stayed on the background
opener, Escape did not close it, and the next Tab reached a background Flow
selector. Introduce a shared labelled dialog primitive with initial focus,
contained Tab/Shift+Tab, inert background, Escape, and focus restoration.
Acceptance: keyboard-only browser tests cover the complete cycle; custom radio/tab
widgets also receive APG/native keyboard semantics.

### AUD-044 — Web gates scan strings instead of exercising behavior

`apps/web/test/operator-console.test.mjs:24-80+`,
`apps/web/test/operator-request-spa.test.mjs:10-80+`, and
`packages/orchestrator-core/src/operator-cli/app-launcher.mjs:255-294` inspect
source/bundle markers. Targeted
web/API tests passed despite automatic initialization, missing live transport,
first-item-only queues, and the non-modal drawer. Keep marker checks only for
packaging; add component and real-browser tests for clean first load, error/race
states, SSE, keyboard, responsive layout, and console failures. Acceptance: tests
first fail on every known behavior above, then protect the remediation.

### AUD-045 — `aor app --json` bypasses configured redaction

`packages/orchestrator-core/src/operator-cli/app-launcher.mjs:56-63,382-445` uses
a custom JSON formatter rather than shared redaction at
`packages/orchestrator-core/src/operator-cli/cli-output.mjs:522-539`. With
`AOR_REDACTION_SECRETS=TOPSECRET`, app smoke output emitted the marker inside
`project_ref` and `runtime_root`, contrary to
`docs/ops/self-hosted-secrets-and-redaction.md:20-28`. Route app output through the
shared formatter. Acceptance: configured secrets never occur in full or compact
app JSON, errors, or logs.

### AUD-046 — Mutation bodies are buffered without a size limit

`packages/orchestrator-core/src/control-plane/http/http-utils.mjs:83-110` retains
all request chunks and concatenates them with no byte cap, deadline, or media-type
check. This is also what enables the text/plain CSRF path in AUD-020. Add a bounded
incremental reader, supported content-type validation, timeout, and `413` response.
Acceptance: an over-limit payload returns 413 before handler invocation and does
not materially grow retained memory. **CWE:** CWE-400.

### AUD-047 — Vite 8.0.14 has two Windows advisories

Read-only audit reported:

- high [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) /
  CVE-2026-53571, `server.fs.deny` bypass through Windows alternate paths,
  CWE-22/CWE-200;
- moderate [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) /
  CVE-2026-53632, UNC-triggered NTLMv2 disclosure, CWE-73/CWE-522.

Both affect the installed `8.0.14` and are fixed in `>=8.0.16`. The audit feed
reported no numeric CVSS vector, so upstream severity is retained. Vite is a
development/build dependency and exploitability is Windows/network-configuration
dependent; it is not in the production dependency audit. Upgrade and add a
documented dependency-audit policy. Acceptance: frozen install resolves at least
8.0.16 and both advisories disappear.

### AUD-048 — Control-plane and app-launcher modules form an ESM cycle

Madge and import trace confirmed:

`http-transport -> http-mutation-handlers -> lifecycle-command -> operator-cli/index -> app-launcher -> http-transport`.

The edges are at
`packages/orchestrator-core/src/control-plane/http/http-transport.mjs:14`,
`packages/orchestrator-core/src/control-plane/http/http-mutation-handlers.mjs:9`,
`packages/orchestrator-core/src/control-plane/lifecycle-command.mjs:5`,
`packages/orchestrator-core/src/operator-cli/index.mjs:2`, and
`packages/orchestrator-core/src/operator-cli/app-launcher.mjs:7`.
This couples transport to CLI startup and contributes to AUD-006. Extract a
transport-neutral lifecycle application service; CLI and HTTP should be adapters
that do not import one another. Acceptance: madge reports no cycle and module
initialization order does not affect exports.

### AUD-049 — Critical flows exceed size and complexity thresholds

This is not a metric-only finding. Multiple concrete defects above cluster in the
same oversized units, and diagnostic analysis recorded:

- `executeFullJourneyFlow`, `scripts/live-e2e/lib/flows.mjs:5108`: complexity 404,
  about 2,552 function lines; file 7,710 lines;
- `FlowCockpit`, `apps/web/src/spa.jsx:3801`: 215; `App` at `:6190`: 144 and
  about 1,218 lines; file 7,409 lines;
- `executeRoutedStep`, `packages/orchestrator-core/src/step-execution-engine.mjs:1019`:
  147 and about 748 lines;
- `handleOperationsCommand`,
  `packages/orchestrator-core/src/operator-cli/command-handlers/operations.mjs:99`:
  144 and about 772 lines;
- `writeProofRunnerArtifacts`, `scripts/live-e2e/run-profile.mjs:3613`: 139;
- `materializeReviewReport`, `packages/orchestrator-core/src/review-run.mjs:764`:
  126 and about 555 lines;
- `packages/adapter-sdk/src/index.mjs`: 3,387 lines and an `execute` method at
  complexity 78.

Refactor by behavior boundary: immutable artifact store, attempt allocator,
permission mediator, provider supervisor/parser, route state machine, web API
client/snapshot reducer, feature views, and private live-E2E stage executors.
Acceptance: preserve behavior with characterization tests, remove the cycle, and
set ratcheting per-module complexity/size budgets rather than one bulk rewrite.

### AUD-050 — Public and private contract/runtime kernels drift by copy

jscpd found 61 clones and 7,176 duplicated lines (7.30% of analyzed production
sources). The largest coherent family is the public contract loader, families,
reference registry, and example validator copied into
`scripts/live-e2e/lib/contracts/**` (individual blocks of roughly 440-720 lines).
Mission-scope and external-runtime/provider parsing also have long public/private
copies. The black-box boundary is legitimate, but unmanaged copy makes parity
unverifiable. Generate the private contract kernel from a pinned source artifact,
or extract a pure versioned kernel consumed on both sides while keeping runner
orchestration independent. Acceptance: parity tests compare content hashes and
behavior fixtures; divergence requires an explicit compatibility version.

### AUD-051 — Strict TypeScript and diagnostic lint configuration is inert

`tsconfig.base.json` declares strict NodeNext options, but no root script invokes
TypeScript, no JS `checkJs` project exists, and `scripts/lint.mjs` is a repository
integrity scanner rather than code lint. Diagnostic ESLint found 5 duplicate-key
errors and 729 warnings across 98 files. Introduce a scoped code-quality config,
initial baselines, and a ratchet so current debt does not block all work at once.
Acceptance: CI discovers syntax/type/lint issues in changed production modules,
new duplicate keys/unused imports fail, and the baseline count can only decrease.

## S3 findings and dead-code result

### AUD-052 — Materialized `context/` output is not used by registry roots

`packages/orchestrator-core/src/project-init.mjs:17-29,713-729` copies context to a
target `context/` tree in materialized mode, while registry resolution continues
to use bundled `examples/context`. The copied output is dead runtime material
unless a downstream external consumer is documented. Either make it an explicit
registry root with provenance or stop materializing it. Acceptance: every copied
asset has a traced consumer, or the unused output disappears with migration notes.

### AUD-053 — Dead symbols, imports, and overwritten object fields remain

No whole source file was confirmed dead. Knip found no actionable whole-file or
dependency result after entrypoint review. Two independent static checks did
confirm narrower dead code:

- `loadArtifactPacket` at
  `packages/orchestrator-core/src/artifact-store.mjs:568-570` has
  zero indexed/text callers and is not exposed by the package export map;
- `ROUTE_STEP_VALUES` at `packages/contracts/src/families.mjs:2-13`,
  `asStringArray` at `packages/orchestrator-core/src/compiler-revision.mjs:24-28`,
  and `uniqueStrings` at
  `packages/orchestrator-core/src/shared/mission-scope.mjs:42-48` have no use;
- five CLI command-handler modules import 42-51 unused names apiece from the
  command-runtime barrel, obscuring their actual dependencies;
- `scripts/live-e2e/lib/step-controller.mjs:753-774` defines `mode`,
  `flow_range_policy`, `included_steps`, `operator_context`, and `retry_counters`
  twice in one object; the first values are immediately overwritten.

Remove internal dead symbols and imports after a package/deep-import compatibility
check. Acceptance: diagnostic `no-unused-vars/no-dupe-keys` is clean in touched
modules and public removal is covered by an export-surface test.

### AUD-054 — UI displays a stale hard-coded version

`apps/web/src/spa.jsx:7183-7189` displays `v0.4.2`; the package is
`0.1.0-alpha.15`, and app config already supplies the version. Render
`config.version` with a fallback. Acceptance: the installed browser UI matches the
package manifest in release smoke.

### AUD-055 — Reference-integrity gate parses examples twice

`scripts/reference-integrity.mjs:9-20` loads example documents and then calls a
validator that reloads them at `packages/contracts/src/example-reference-validation.mjs:22-24`.
Pass the parsed registry/documents into validation. Acceptance: one parse per file,
identical diagnostics, and a small fixture benchmark prevents regression.

## Recommended remediation sequence

These risk groupings informed the committed W57-W59 remediation backlog; they
are conceptual cuts rather than backlog slice IDs. Exact ownership,
dependencies, priorities, effort estimates, tasks, acceptance criteria, and
out-of-scope boundaries live in the three wave documents. Each implementation
slice begins contract-first and retains compatibility notes for public behavior.

### R0 — Freeze unsafe mutation surfaces

**Includes:** AUD-001 through AUD-005, AUD-007, AUD-008, AUD-013 through
AUD-016, and AUD-020.

Temporarily keep live no-write execution and write-capable delivery behind an
explicit experimental opt-in. Define canonical identifier/path/scope contracts,
fail closed on unresolved evidence, and require authenticated loopback-safe
transport. This slice is a prerequisite for any unattended or credentialed run.

**Exit criteria:** no-write cannot change source; delivery cannot stage an extra
path; fake refs cannot unlock it; traversal/symlink/rename/glob matrices pass;
non-loopback and cross-origin unauthenticated mutations are impossible.

### R1 — Build transactional execution and evidence foundations

**Includes:** AUD-006, AUD-011, AUD-017, AUD-023, AUD-029, and the persistence
part of AUD-034.

Introduce a durable async job boundary and one transactional artifact/event store
with immutable IDs, atomic publish, per-run concurrency control, and idempotency.
Do this before independently patching every blind `writeFileSync`, otherwise the
same races will recur in several modules.

**Exit criteria:** concurrent attempt, command, init, and event stress suites lose
no record; HTTP remains responsive during a provider; crash injection produces a
previous-or-new complete state.

### R2 — Make quality evidence real and run-scoped

**Includes:** AUD-004, AUD-009, AUD-010, AUD-012, AUD-018, AUD-025 through
AUD-028.

Resolve immutable assets and evidence refs, compile content-addressed context,
bind mission strictness to run lineage, implement policy/fallback state machines,
replace placeholder scoring, and strengthen replay compatibility.

**Exit criteria:** missing or cross-run evidence fails closed; changed effective
content changes fingerprints; controlled case mutations change eval outcomes;
strict delivery requires a closed run-level pass.

### R3 — Separate and harden the control plane

**Includes:** AUD-006, AUD-021, AUD-032 through AUD-038, AUD-046, and AUD-048.

Extract a transport-neutral lifecycle service, implement asynchronous jobs and
cross-process journal tailing, bound SSE/body resources, validate CLI/HTTP inputs,
and drive OpenAPI from captured contract fixtures.

**Exit criteria:** no module cycle; live cross-process follow works; shutdown is
bounded; unknown inputs fail clearly; runtime fixtures validate against OpenAPI.

### R4 — Rebuild the web runtime boundary and behavior tests

**Includes:** AUD-019 and AUD-039 through AUD-045, plus AUD-054.

Start with a typed/configured control-plane client and atomic project snapshot
state, then split feature views and introduce an accessible dialog primitive.
Add real browser tests before restructuring the 7,409-line SPA.

**Exit criteria:** clean first load is non-mutating; SSE/reconnect and external
events work; error/race/multi-item states are explicit; keyboard modal tests pass;
displayed package version and redaction are correct.

### R5 — Make the quality gate honest and ratchet maintainability

**Includes:** AUD-022, AUD-044, AUD-047, and AUD-049 through AUD-055.

Discover every test, upgrade Vite, add scoped lint/type/coverage checks, establish
complexity and duplication ratchets, and decide whether the private live-E2E
contract kernel is generated or shared. Refactor incrementally behind
characterization tests.

**Exit criteria:** 55/55 current tests are discovered; UI behavior replaces marker
claims; advisories are cleared; changed modules cannot add lint/type debt; private
contract parity is mechanically checked.

### Quick wins that do not replace the slices

- upgrade Vite to `>=8.0.16` and re-run frozen install/audit/package smoke;
- route app JSON through shared redaction and render `config.version`;
- enforce JSON media type and a bounded HTTP body reader;
- reject unknown CLI/HTTP lifecycle flags;
- repair `limit` and `maxReplay=0` semantics with contract tests;
- add the 12 missing test files to discovery immediately, then replace the static
  list with manifest/discovery enforcement;
- remove verified internal dead symbols, unused imports, and duplicate keys;
- use `fileURLToPath()` and Git-aware worktree detection.

## Compatibility and migration notes

The audit did not change public behavior. The following remediations will require
explicit compatibility handling:

| Surface | Expected compatibility impact |
|---|---|
| Identifiers and scope patterns | Previously accepted IDs, globs, or malformed arrays may be rejected. Provide validation diagnostics and, if runtime state exists, a collision-detecting migration/read-only recovery tool. |
| Evidence refs | Callers must provide resolvable, run-owned contract artifacts rather than arbitrary strings. Return machine-readable blocker reasons. |
| No-write/delivery plans | `writeback_allowed` semantics should split from execution permission; old stored plans need versioned interpretation. |
| Read models | Uninitialized GET responses need an explicit stable shape instead of implicit initialization. |
| HTTP auth/config | Non-loopback local-trusted launch should fail; hardened config may require authentication and a configured public base URL. |
| CLI flags/follow | Unknown flags start failing; true follow becomes a long-running command with signal behavior. |
| OpenAPI/module exports | Corrected schemas and explicit exports may affect generated clients and unsupported deep imports. |
| Private live-E2E contracts | Generated/shared kernel changes require a pinned compatibility version so black-box independence remains testable. |

## Subsystem coverage matrix

| Area | Status | Evidence and limitations |
|---|---|---|
| Root manifests, package/bin/config entrypoints | Reviewed | Package exports, CLI bin, Vite entry, npm dry-run, release install smoke. |
| `packages/contracts` and examples | Reviewed | Loader/reference trace, mutation probes, all current contract tests, public/private parity scan. |
| Filesystem initialization and `.aor` persistence | Reviewed | Traversal, symlink, partial-write, ID collision, Git worktree, and path-space probes. |
| Execution, routing, policies, adapters | Reviewed | Dataflow, fake local adapters, permission classification, concurrency probes; no credentialed provider call. |
| Harness, eval, certification | Reviewed | Missing-ref scoring probe, run-level truth probes, mtime lineage, replay comparison. |
| Delivery and release runtime | Reviewed | Isolated local Git/bare-remote probes; no real upstream write or GitHub API call. |
| Observability and run control | Reviewed | Interprocess event races, SSE replay/live/shutdown, concurrent command probes. |
| CLI | Reviewed | Command catalog, parser, handler surfaces, output/redaction, package smoke. |
| In-process API, HTTP, OpenAPI | Reviewed | Module exports, route probes, auth/Host/Origin/body, lifecycle trace, schema comparison. |
| Web console | Partially reviewed | Real packaged SPA on desktop and 390×844 mobile, network/console/a11y keyboard probes. No full screen-reader/browser matrix. |
| Tests and root quality gates | Reviewed | All 55 files enumerated; selected and omitted suites run; source-marker assertions inspected. |
| `scripts/live-e2e` | Partially reviewed | 159 private tests pass, static/complexity/duplication and black-box boundary reviewed. Credentialed profiles and paid targets excluded. |
| CI, release, supply chain, licenses | Reviewed | Pinned actions/permissions, release scripts, pack/smoke, audit/outdated/license inventory. GitHub-hosted jobs were not rerun remotely. |
| Performance | Partially reviewed | Algorithmic full-log reads and focused timing/concurrency probes. No long-duration production workload profile. |
| Windows/other OS portability | Partially reviewed | Static review and Windows advisories; no Windows process-tree or filesystem run. |

## Open hypotheses and coverage gaps

The following items are not in the remediation backlog until reproduced or a
product decision is made:

1. On Windows, adapter timeout cleanup appears to kill only the direct child;
   child/grandchild process-tree behavior needs a Windows probe.
2. A newline-free Qwen stream may grow `stdoutLineBuffer` beyond the nominal
   output bound; a controlled memory test is needed.
3. Prefix-only output truncation may discard a final provider report without a
   truncation marker.
4. `deliver prepare --quality-gate-mode observe` proceeds with not-pass Harness
   evidence; current tests encode it, so intended product semantics must be
   clarified before classifying it as a defect.
5. Raw provider evidence is not written with an explicit `0600` mode; relevance
   depends on the supported host/umask and multi-user threat model.
6. `packages/orchestrator-core/src/control-plane/index.mjs` has no internal
   importer and is not in the package export map, but published deep-import usage
   was not measured; it remains a dead-code hypothesis.
7. Request drawer and custom tab/radio widgets likely share the confirmed Add
   Project keyboard defects, but only the Add Project flow received the complete
   browser reproduction.
8. Formal mutation tooling was not installed. Instead, the audit used targeted
   manual mutations of IDs, refs, scope values, policy failure classes, case refs,
   write failures, and concurrency schedules. A future mutation baseline should
   focus on delivery, permission, Harness, and read-only invariants.

No credentialed provider profile, paid external call, real upstream push,
destructive proof, exhaustive screen-reader suite, Windows runtime, or large-scale
performance benchmark was run. These are explicit coverage gaps, not implicit
passes.

## Positive controls

The audit also confirmed useful foundations that should be preserved:

- CI and release workflows use explicit permissions, concurrency, frozen installs,
  and full-SHA-pinned GitHub actions;
- the production dependency audit was clean at this commit;
- package dry-run and isolated install smoke succeeded, with CLI and web bundle
  present;
- all tracked ESM parsed on Node 22; all selected groups passed on targeted rerun,
  although the integrated gate showed the stability limitation described above;
- no whole source file or unused dependency met the confirmation threshold;
- desktop/mobile smoke showed no horizontal overflow, visible active controls met
  the 44 px target in the sampled views, and the browser console was clean;
- the private live-E2E deterministic suite passed all 159 tests.

These controls do not offset the findings; they identify stable scaffolding on
which the repair slices can build.

## Evidence location and command index

Ignored evidence is stored under:

`.aor/audits/codebase-review/db9951718083804bab1e1e4028a8a713bd2ec574/`

It includes the diagnostic ESLint JSON, jscpd report, independent high-severity
probe output, a machine-readable finding ledger, and the evidence/command index.
Representative reproducible commands are:

```sh
env PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm check
pnpm production:ready --json
pnpm release:verify
pnpm release:pack
pnpm release:smoke
pnpm audit --json
pnpm audit --prod --json
npm pack --dry-run --json
npx --yes knip@6.25.0 --reporter json
npx --yes madge@8.0.0 --extensions mjs,js,jsx --circular apps packages scripts
npx --yes jscpd@5.0.12 --min-lines 30 --reporters json apps packages scripts
```

Exact disposable-copy paths, exclusions, targeted test commands, versions, and
outcomes are recorded in the ignored evidence index. Runtime state and raw probes
must remain outside Git; this report is the only intended tracked audit artifact.
