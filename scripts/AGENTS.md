# AGENTS.md

This directory owns maintainer tooling: repository-integrity checks, builds,
test discovery, backlog helpers, release tooling, and executable runtime proofs.

## Rules

- Prefer Node.js standard library and existing repository dependencies.
- Keep deterministic checks fast, reproducible, and readable. Declare network,
  browser, provider, and credential requirements for executable proofs.
- Fail with actionable messages that point to the owning file or doc.
- Test implemented behavior and distinguish fixtures from live evidence.
- Keep internal proof code out of the public runtime and npm package surface.

## Validation and evidence

- Use the [validation matrix](../CONTRIBUTING.md#validation-by-change-type);
  `pnpm check` is the commit-ready gate, with browser/readiness/release checks
  selected by scope.
- Product runtime state uses AOR Home. Keep caches and internal proof outputs
  in their documented ignored paths; never commit generated private evidence.
- Follow `scripts/live-e2e/AGENTS.md` for its black-box runner and target
  preparation boundaries. Provider calls and external writes require the
  user's authorization; carry previously granted authorization forward.
