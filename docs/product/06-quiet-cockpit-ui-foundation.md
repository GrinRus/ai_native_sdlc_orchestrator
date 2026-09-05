# Task Workspace semantic UI foundation

## Status

This document describes the shared tokens and components consumed by the Task
Workspace. W63 introduced the foundation; current behavior and visual
acceptance belong to `08-task-workspace-console-design.md`.

## Source of truth

- `apps/web/src/ui/tokens.css` owns consumed semantic color, typography, spacing,
  radius, elevation, motion, control-size, focus, and data-density values.
- `apps/web/src/ui/components.jsx` owns Button, EmptyState, the Icon re-export,
  and the `useRovingTabs` keyboard hook.
- `apps/web/src/ui/icon.jsx` owns the shared outline icon system.
- `apps/web/src/dialog.jsx` owns modal focus, dismissal, and focus restoration.

The current theme is light-only and respects reduced-motion preference. Task
styles consume semantic tokens and must not communicate status through color
alone.

## Active component contract

| Component | Required anatomy | States and accessibility |
|---|---|---|
| Button | Label or accessible name, optional icon, pending state | Primary/secondary; compact/default/touch; hover, focus, disabled, and busy states; icon-only buttons retain accessible names |
| EmptyState | Optional heading and explanatory content | Explain the missing state and the next available action through the consuming surface |
| Icon | Shared outline SVG geometry | Decorative icons are hidden from assistive technology; meaningful controls retain their own accessible names |
| Dialog | Labelled modal, content, close action | Initial focus, Tab containment, Escape dismissal, and opener focus restoration; supports the narrow-layout inspector |
| `useRovingTabs` | Enabled tab list, selection, and selection callback | One tab stop; Arrow keys, Home, and End skip disabled tabs and move focus |

## Typography and layout

Page title, section heading, body, label, status, metric, and code roles use
distinct tokens. Repeated operational data uses tabular figures. Compact density
is limited to repeated data; preparation and recovery surfaces remain relaxed.
Responsive controls and tables must wrap or use labelled local overflow without
creating page-level overflow.

## Verification and maintenance

`apps/web/test/ui-foundation.test.mjs` covers the shared foundation;
`apps/web/test/dialog.test.mjs` covers the modal contract. Installed SPA freshness
and Task Workspace browser validation remain part of the relevant web gate.
Remove unused exports and styles with their callers. The repository quality
ratchet owns enforceable source limits; historical renderer counts and rollout
ceilings do not define the current component contract.
