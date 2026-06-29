# Bootstrap rehearsal fixtures (W1-S08)

This fixture set captures a no-write bootstrap rehearsal for:
- AOR workspace target (`<AOR_WORKSPACE>`) — expected verify success.
- Public catalog target `sindresorhus/ky` (`<KY_TARGET_ROOT>`) — expected safe verify failure.

## Files
- `aor/project-init.json`
- `aor/project-analyze.json`
- `aor/project-validate.json`
- `aor/project-verify.json`
- `aor/runtime-tree.txt`
- `ky/project-init.json`
- `ky/project-analyze.json`
- `ky/project-validate.json`
- `ky/project-verify.json`
- `ky/runtime-tree.txt`

## Placeholder policy
Absolute local paths are normalized:
- `<AOR_WORKSPACE>` replaces the local repository root.
- `<KY_TARGET_ROOT>` replaces the temporary clone path.

## Safety notes
- All runs stay in no-write mode (`allow_direct_write=false` and no upstream push commands).
- Runtime artifacts are persisted under `.aor/` in each target and summarized via `runtime-tree.txt`.
