# Quiet Cockpit cutover and rollback

The installed local app has one renderer: Quiet Cockpit. A retired `?console=legacy` link is recognized, shows a bounded migration notice, preserves presentation context, and is normalized to `console=quiet-cockpit`. It does not activate a second renderer.

## Stop conditions

Stop the cutover when an installed scenario produces an uncaught console error, unexpected external request, hidden authoritative blocker, stale cross-project state, action/side-effect mismatch, duplicate durable artifact, page overflow, or identity drift across the presentation switch.

## Rehearsal

1. Capture Project, Flow, run, action, and evidence identity in the default Quiet Cockpit.
2. open the same URL with `console=legacy` and verify it normalizes to Quiet while Project/Flow identity remains unchanged.
3. verify durable readback rather than browser-owned state.
4. retain browser trace and runtime evidence under ignored `.aor/quality/w65/` paths.

Post-retirement rollback means installing the previous package version. URL normalization does not authorize a lifecycle mutation, change no-write policy, or create a second subscription.
