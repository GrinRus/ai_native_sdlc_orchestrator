# AGENTS.md

Web is the optional packaged Task Workspace for the headless AOR control plane.

## Owns

- Tasks Home, project selection, and New task / Prepare task / Start task;
- task activity, attention, changes, checks, evidence, and Ask AOR interaction;
- rendered components, presentation state, accessibility, and browser behavior.

## Rules

- UI is detachable and must not own critical orchestration logic.
- Read models and streams come from the shared control-plane/API contracts.
- Preserve the read-only Prepare boundary and explicit Start authorization.
- Detaching the browser must not cancel runtime work; lifecycle ownership stays
  in the headless control plane.
- Use the [validation matrix](../../CONTRIBUTING.md#validation-by-change-type):
  rendered UI changes require browser acceptance and inspection of affected
  responsive and keyboard/focus states, beyond a successful build.
