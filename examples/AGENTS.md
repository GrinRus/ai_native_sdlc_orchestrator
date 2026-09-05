# AGENTS.md

`examples` contains the canonical example profiles, routes, wrappers, prompts, policies, packets, suites, and proof fixtures.

## Rules
- Write module-facing docs, examples, and comments in English.
- Examples are illustrative but must remain internally consistent.
- When a contract changes, update the relevant examples immediately.
- Prefer realistic examples over toy placeholders.
- Default target-facing examples to `no-write`. A fixture may demonstrate
  `patch-only`, `local-branch`, or `fork-first-pr` when that boundary is explicit;
  running its write-capable path still requires the user's authorization.
- Runtime prompts, context, and skills are product assets; `.agents/skills/**`
  and `AGENTS.md` are contributor guidance. Follow the asset family's contract.
- Use the [validation matrix](../CONTRIBUTING.md#validation-by-change-type)
  for reference integrity, compatibility, and runtime-asset evidence.
