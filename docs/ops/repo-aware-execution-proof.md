# Repo-aware execution proof

Use this runbook to exercise the retained W62 component fixtures without
credentials, provider network calls, or upstream writes. It does not reproduce
the current installed multirepo lifecycle; W71 owns that integration proof.

## Proof boundary

The runner covers two curated models:

- a monorepo with independently scoped components;
- a bounded two-repository graph with an explicit contract dependency.

For both, the command exercises the production execution-DAG and stale-boundary
functions. It records task/unit coverage, declared parallel/conflicting scopes,
and transitive invalidation in deterministic component fixtures.

The report explicitly uses `evidence_kind=deterministic-component-fixture`,
`browser_assessment.status=not-run`, and `quality_assessment.status=fixture-only`.
It does not create a delivery manifest, execute public integration, or claim
browser parity. The linked core tests provide supporting component evidence;
W71-S10 and W71-S14 own installed provision-to-integration and delivery closure.

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
