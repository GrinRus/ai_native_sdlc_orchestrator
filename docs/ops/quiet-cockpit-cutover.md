# Quiet Cockpit cutover and rollback

The installed local app defaults to Quiet Cockpit. During the W65 default-on rehearsal, `?console=legacy` remains a presentation-only rollback. Query selection takes precedence over app-config, which takes precedence over the compiled default.

## Stop conditions

Stop the cutover when an installed scenario produces an uncaught console error, unexpected external request, hidden authoritative blocker, stale cross-project state, action/side-effect mismatch, duplicate durable artifact, page overflow, or identity drift across the presentation switch.

## Rehearsal

1. Capture Project, Flow, run, action, and evidence identity in the default Quiet Cockpit.
2. open the same URL with `console=legacy` and verify the identities and canonical mutation payloads are unchanged.
3. return to `console=quiet-cockpit` and verify durable readback rather than browser-owned state.
4. retain browser trace and runtime evidence under ignored `.aor/quality/w65/` paths.

The rollback changes presentation only. It does not authorize a lifecycle mutation, change no-write policy, or create a second subscription. W65-S06 retires the in-package legacy renderer; after that gate, rollback means installing the previous package version.
