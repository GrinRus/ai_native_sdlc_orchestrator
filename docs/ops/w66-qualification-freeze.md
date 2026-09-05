# W66 qualification freeze

Freeze provider qualification inputs only after W71-S14 has integrated the UI
handoff, passed the installed real-control-plane journeys, and regenerated
adversarial proof for the final integrated commit. The current entry conditions
are defined in `docs/backlog/wave-71-implementation-slices.md` and
`docs/backlog/wave-66-implementation-slices.md`.

W66-S25 remains historical prerequisite evidence. Neither its old proof nor
restored provider quota bypasses W71-S14. Freezing inputs makes no provider call
and does not grant release clearance.

Once that entry gate is satisfied, pin the exact `ky` target commit and create
the qualification manifest:

```bash
node ./scripts/w66-adversarial-proof.mjs \
  --source-commit <40-character-final-integrated-commit> \
  --output .aor/w66/adversarial-proof.json
pnpm w66:freeze -- \
  --target-commit <40-character-ky-commit> \
  --proof-file .aor/w66/adversarial-proof.json
```

The command writes `.aor/w66/qualification-manifest.json` exclusively. It
fails on a dirty AOR tree, a non-full target commit, a missing or changed
profile, any cell other than the four W66 cells, or any premature cell result.
The manifest records SHA-256 digests for:

- OpenAI medium and large profiles;
- Anthropic medium and large profiles.

Supply `--proof-file` to bind the passing final-commit adversarial proof digest
to the frozen AOR commit. W71-S14 also owns the accepted package, UI handoff,
profile, and artifact identities; these commands alone do not close that slice.
All earlier qualification evidence remains diagnostic-only for W66-S09.

S09 must validate the manifest again before the installed baseline and before
each sequential cell. Any source commit, target commit, or profile digest
change invalidates the entire matrix. The run remains `audit-hold` until all
four versioned qualification-cell reports and their final all-pass assessments
close on that unchanged commit pair.

Before freezing, run:

```bash
pnpm quality:ratchet
pnpm check
pnpm test:web:browser
pnpm release:pack
pnpm release:smoke
```

These commands are deterministic/package gates. They must not be replaced by a
provider run, an upstream write, or a manually asserted pass.
