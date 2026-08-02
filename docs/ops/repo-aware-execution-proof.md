# Repo-aware execution proof

Use this runbook to reproduce the bounded W62 closure without credentials,
provider network calls, or upstream writes.

## Proof boundary

The runner covers two curated models:

- a monorepo with independently scoped components;
- a bounded two-repository graph with an explicit contract dependency.

For both, it validates exact task-to-unit coverage, deterministic workspace and
parent-run lineage, at least one safe parallel pair, conflict serialization,
failed-attempt retry identity, transitive stale invalidation, bounded repair,
passing integration ownership, and aggregate/per-repository delivery truth.
Runtime-heavy behavior is owned by the focused suites referenced in
`docs/research/14-w62-repo-aware-execution-closure.json`; the proof command uses
the same production DAG, stale-boundary, and browser projection functions.

## Reproduce

```bash
pnpm w62:proof
pnpm test:web:browser
pnpm check
pnpm release:pack
pnpm release:smoke
pnpm production:ready --json
```

The generated report belongs in `node_modules/.cache/aor` and must not be
committed. A pass is not authorization for provider credentials, automatic
conflict resolution, unbounded repair, GitHub/npm publication, or upstream
delivery.
