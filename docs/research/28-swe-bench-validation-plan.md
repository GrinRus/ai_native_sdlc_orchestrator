# SWE-bench tasks for W72 validation

Status: research and proposed evaluation plan, 2026-10-06. No task environment,
gold/base test run, provider attempt, result, or benchmark score is certified.
Implementation owner: W72-S21; combined evaluation owner: W72-S15.

## Recommendation and primary-source facts

Start with a small curated SWE-bench Verified development set. The official
[Verified dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified)
contains 500 human-filtered repository issues; the
[project repository](https://github.com/SWE-bench/SWE-bench) describes patch
generation and Docker-based checking. The
[evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/)
documents prediction records, instance selection, individual reports, and
failure classes. These are useful independent implementation checks.

The [Multilingual dataset](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual)
is a later option for non-Python targets. Qualify the initial verifier and
one repository first, then broaden targets. W72 does not need a full leaderboard
run or a new product dependency on a benchmark package.

The official harness accepts patch predictions and distinguishes resolved,
unresolved, and infrastructure/error outcomes. It also caches by run/instance
identity: a changed patch needs a fresh evaluation run ID. The current official
README exposes a v5 CLI and still documents the older module entry point.
Pin and inspect the exact harness revision/CLI before implementing commands;
do not copy mutable main commands as a release contract. Local ARM execution
needs environment qualification before it can support results. These facts are
documented in the [official repository](https://github.com/SWE-bench/SWE-bench).

## Initial metadata-reviewed candidates

The dataset revision inspected was
`c104f840cc67f8b6eec6f759ebc8b2693d585d4a`.
IDs, repository baselines, issue summaries, and test-group counts were read from
the public dataset metadata. The importer must verify them against the pinned
revision before freezing an executable selection. Counts below describe
declared test groups, not observed results or difficulty estimates.

| Instance | Repository | Behavior to investigate | FAIL_TO_PASS / PASS_TO_PASS |
| --- | --- | --- | --- |
| `astropy__astropy-12907` | astropy/astropy | Nested model composition and separability. | 2 / 13 |
| `astropy__astropy-13033` | astropy/astropy | Required-column error reporting. | 1 / 20 |
| `django__django-14373` | django/django | Padding of formatted years. | 1 / 19 |
| `django__django-17087` | django/django | Nested class methods used as field defaults. | 1 / 53 |
| `scikit-learn__scikit-learn-10844` | scikit-learn/scikit-learn | Numerical warning in clustering scoring. | 1 / 16 |
| `scikit-learn__scikit-learn-10908` | scikit-learn/scikit-learn | Feature-name access with a supplied vocabulary. | 1 / 47 |
| `sympy__sympy-15809` | sympy/sympy | Empty-input extrema behavior. | 2 / 10 |
| `sympy__sympy-15875` | sympy/sympy | Uncertainty and correctness of zero predicates. | 1 / 80 |

This is a candidate list for a bounded development suite, not a representative
random sample or evidence that any task is cheap. Prefer the Django formatting
case as an initial feasibility candidate; that is a hypothesis pending base/gold
and resource preflight. Replace unusable candidates before prediction collection
with recorded reasons. Freeze inclusion/exclusion and denominators before
comparison; later infrastructure failures remain visible.

## What AOR can test with these tasks

Map public issue intent and the exact base checkout into immutable source input.
Author observable acceptance expectations from issue behavior before execution.
Keep the official patch-verification result alongside AOR's criterion proof:
code correctness, runtime authority, and operator comprehension are separate
evaluation dimensions.

| Evaluation group | Observable question | Owner |
| --- | --- | --- |
| Unmodified repository tasks | Does the submitted patch resolve required tests while retaining regressions? | S21 verifier; S15 paired evaluation |
| Criterion correspondence | Does each claimed accepted behavior have current relevant proof? | S05, S06, S15 |
| AOR-specific interventions | Do contradictory answers, lost negative requirements, stale workers, exhausted budgets, and scoped blockers produce the required state? | S03, S04, S12, S19, S20, S15 |
| Human decisions | Can operators explain bounds, catch seeded errors, and locate proof? | S17 formative; S15 comparative pilot |

Add intervention variants under separate AOR case IDs with explicit modifications
and independently authored expected outcomes. A variant that changes an issue or
adds requirements is not an official SWE-bench instance result. Retain native
fixtures for no-write investigations, delivery, parallel conflicts, and
multirepo integration: the selected single-repository bugfix cases do not cover
those outcomes. This coverage assessment is an AOR-specific conclusion.

## Proposed verifier boundary

1. Freeze dataset revision, selected instance IDs/base commits, upstream harness
   revision, test-group identity, image identity/platform, and resource limits.
   Record provenance and applicable dataset/repository licensing before copying
   material; keep the initial repository docs to references and metadata.
2. Expose only issue input and source at the base commit to the coding runner.
   Keep gold patches, evaluator test patches/results, future Git objects, and
   evaluation secrets outside its accessible workspace and compiled context.
   Worker/verifier use separate mount/access boundaries. Probes must show the
   coding worker cannot read evaluator files, inspect verifier containers through
   a shared Docker control socket, or retrieve future solutions through allowed
   network/Git paths. Separate directories alone do not establish isolation.
   Controller/verifier owns environment preparation and network policy.
3. Qualify each case with independent base and gold runs: required failing tests
   must fail on the base, regression tests must pass there, and the gold result
   must satisfy the expected groups. Distinguish infrastructure problems from
   product failures. Preserve immutable logs and environment identity.
4. After execution, pass only the exact candidate patch to a fresh isolated
   verifier. Use a new run identity per patch/input attempt. Preserve test output,
   report, patch digest, and result classification; never trust runner-authored
   report JSON as verifier authority.
5. Publish observations through the owning criterion producer and keep the
   benchmark verdict separate. A missing/failed/stale mandatory observation
   blocks AOR acceptance even when other tests are green.

Maintainer evaluation tooling belongs under `scripts/` according to its owning
guidance; profile contracts may stay private. Runtime evidence belongs in an
isolated AOR Home. Do not vendor the full dataset or gold solutions into runtime
prompt assets, ship the benchmark harness inside the npm CLI, or add a production
Python/Docker dependency as part of this planning change.

## Comparison protocol and honest claims

Compare a direct coding-runner baseline with the same runner/model/configuration
under AOR, using fixed sources, images, patch-only mode, maximum concurrency one,
and comparable enforceable resource limits. Record unavailable cost telemetry;
time/attempt limits do not establish equal monetary spend. Freeze repeat policy,
selection, budgets, seed/intervention behavior, and aggregation before runs.

Measure resolved/unresolved/infrastructure outcomes, false acceptance, stale
proof adoption, prohibited effects, criterion coverage, and observed resources.
Report actual denominators and uncertainty rather than a leaderboard claim for
eight curated cases. Public tasks can already be known to models; the development
set establishes executable regression coverage, not uncontaminated generalization.
Keep a later independently selected holdout separate from tuning cases.

S21 first delivers catalog/provenance, task mapping, verifier boundaries,
base/gold qualification, and deterministic integration proof. S15 owns actual
paired attempts and human observations under separately authorized prerequisites.
Paid/provider calls, cloud evaluation, publication, and participant messaging
are not authorized by this research task and have not been performed.
