# AGENTS.md

`examples/context` owns committed runtime context docs, rules, skills, bundles,
and static compiled-context samples.

## Rules

- Start at the [asset authoring workflow](../../docs/architecture/15-platform-assets-and-prompt-lifecycle.md#authoring-prompt-and-context-changes)
  for content, selection, version, compatibility, and evidence decisions.
- Bundle references and project defaults/overrides determine inclusion. Do not
  assume `applies_to` alone activates an asset or `source_refs` recursively loads
  every linked document.
- Keep contributor instructions in `AGENTS.md` and `.agents/skills/`; context
  workflows operate within the runtime's wrapper and policy permissions.
- Update affected bundle/profile refs when identities change. Treat
  `compiled/` files as committed samples; runtime compilation outputs belong in
  AOR Home (`AOR_HOME`, default `~/.aor`) according to
  `docs/architecture/15-runtime-root-layout.md`. Internal maintainer rehearsal
  outputs follow `scripts/AGENTS.md` separately.
