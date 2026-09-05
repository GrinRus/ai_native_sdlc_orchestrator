# Bootstrap rehearsal fixtures (W1-S08)

This directory preserves the historical no-write bootstrap rehearsal for the
public catalog target `sindresorhus/ky` (`<KY_TARGET_ROOT>`), including its safe
verification failure. These pre-W67 samples use repo-local runtime paths and
are historical evidence, not the current storage or qualification contract.

## Retained command evidence

- `ky/project-init.json`
- `ky/project-analyze.json`
- `ky/project-validate.json`
- `ky/project-verify.json`
- `ky/runtime-tree.txt`

The remaining `ky/` files contain the corresponding analysis, validation,
verification summary, and step results. The former AOR-workspace sample set is
not present; it is not claimed as retained evidence.

## Placeholder policy

`<KY_TARGET_ROOT>` replaces the historical temporary clone path. Preserve these
sanitized identities when reading the archived evidence.

## Current reproduction

Use `scripts/live-e2e/docs/runbooks/live-e2e-no-write-preflight.md` for current
preflight. Public commands now isolate runtime state through `AOR_HOME`; do not
recreate historical repo-local `.aor/` trees from this fixture listing.
