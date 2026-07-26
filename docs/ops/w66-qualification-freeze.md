# W66 qualification freeze

W66-S08 closes deterministic remediation while preserving `audit-hold`. It
does not call a provider and cannot grant release clearance.

After the implementation is merged to one clean commit, pin the exact `ky`
target commit and create the runtime-owned manifest:

```bash
pnpm w66:freeze -- --target-commit <40-character-ky-commit>
```

The command writes `.aor/w66/qualification-manifest.json` exclusively. It
fails on a dirty AOR tree, a non-full target commit, a missing or changed
profile, any cell other than the four W66 cells, or any premature cell result.
The manifest records SHA-256 digests for:

- OpenAI medium and large profiles;
- Anthropic medium and large profiles.

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
