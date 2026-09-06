# Command Desk Task Workspace refinement

## Outcome

The installed AOR web console gives an operator a calm, scannable Command Desk
for the server-owned Task lifecycle: Project → Task → Prepare → Start → Work →
Review → Complete. The redesign improves visual hierarchy and recovery without
changing lifecycle ownership, mutation routes, or the patch-only/no-upstream-write
boundary defined by the W70 Task Workspace contract.

## Information architecture

- **Tasks** is the default queue and remains the first landing surface.
- **Attention** is a filtered recovery queue for tasks that need an operator.
- **Evidence** opens the selected task's review or immutable completion proof.
- **Project** opens the existing explicit project connection dialog.
- Runs, source previews, review, and completion evidence stay inside the Task
  context; the redesign does not introduce a second runtime state store.

## Visual contract

- A dark, compact navigation rail anchors the workspace; the content canvas is
  light and reserved for readable operational data.
- The Tasks queue exposes ID, task, status, updated time, and runner at a glance.
- Attention, active, ready, and completed groups retain the existing server
  projection and use semantic warning/success/neutral tones.
- The selected row and right-hand detail panel make the next server-published
  action obvious. On narrow screens the detail panel becomes an accessible
  drawer or inline detail region without horizontal overflow.
- Existing `Glyph`, `Button`, `Dialog`, roving-tab, focus, and semantic token
  primitives remain the only interaction foundations.

## Acceptance

1. A clean installed project opens the redesigned Tasks Home with no legacy
   surface override and no repository-local runtime writes.
2. Existing server-owned actions still drive create/prepare, start, pause/stop,
   attention recovery, review decisions, follow-up, and completion.
3. All eight W70 screens preserve their current accessible names and state
   coverage (loading, empty, stale, error, permission, offline, and complete).
4. Desktop, tablet, mobile, keyboard navigation, 200% zoom, and reduced-motion
   checks show no clipped controls, horizontal overflow, or lost focus.
5. Focused unit tests, the web build, and the installed browser closure pass;
   visual evidence is captured from the live `apps/web` project.
