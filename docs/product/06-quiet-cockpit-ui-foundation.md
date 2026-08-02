# Quiet Cockpit semantic UI foundation

## Status

This document is the W63-S02 implementation contract for Quiet Cockpit. W65
made this foundation the single packaged renderer without changing lifecycle ownership.

## Source of truth

- `apps/web/src/ui/tokens.css` owns consumed semantic color, typography, spacing, radius, elevation, motion, control-size, focus, and data-density values.
- `apps/web/src/ui/components.jsx` owns reusable component anatomy.
- `apps/web/src/ui/semantics.js` owns explicit tone and state vocabulary. Free-form runtime status strings must not choose visual severity.

Raw color values are permitted in the token declaration file. Migrated component CSS consumes semantic variables only. The first implementation is light-only and respects reduced-motion preference.

## Component contract

| Family | Required anatomy | Variants and states | Accessibility and responsive rules |
|---|---|---|---|
| Button / IconButton | Label or accessible name, optional icon, pending state | Primary/secondary; compact/default/touch; hover, active, focus, disabled, loading | 40px desktop, 44px touch; visible focus; icon-only controls require a label |
| Field | Label, control, optional helper and error | Default, focus, disabled, invalid | Helper/error IDs feed `aria-describedby`; invalid controls expose `aria-invalid` |
| Dialog / Drawer | Labelled modal, content, actions | Closed/open | Initial focus, Tab containment, Escape, inert background, focus restoration |
| StatusBadge / Count | Text plus explicit semantic tone | Neutral, information, success, warning, danger | Color-independent text; neutral counts never imply warning |
| Alert | Message and optional recovery | Information, success, warning, danger | Danger uses alert semantics; other updates use status semantics |
| Card / Section / EmptyState | Heading where applicable and body | Normal, loading, empty, error through consuming surface | Avoid decorative nested cards; preserve heading order |
| Disclosure / Tabs | Native summary or labelled tablist | Open/closed; selected/disabled/focus | Keyboard-operable with persistent labels and touch targets |
| ProgressPath | Ordered named stages | Complete, active, waiting, blocked, unavailable | State is text/shape-backed and not color-only |
| Responsive actions/table | Labelled controls or column headers | Loading, empty, ready, error | Wrap or use labelled local overflow; never create page-level overflow |

## Operational typography and density

Page title, section heading, body, label, status, metric, and code roles use distinct tokens. Repeated operational data uses tabular figures. Ordinary headings are not encoded with all-uppercase text or artificial extreme weight. Compact density is limited to repeated data; onboarding and recovery surfaces remain relaxed.

## Verification

`apps/web/test/ui-foundation.test.mjs` verifies token completeness, explicit tone handling, component states, keyboard markers, touch sizing, and reduced-motion coverage. Installed SPA freshness and browser validation remain part of each W63 slice gate.

## Baseline inventory and ratchet

The pre-S02 legacy stylesheet contains 373 raw color occurrences and 27 distinct variable consumers. It is retained as the W34 compatibility renderer rather than bulk-rewritten. Two previously consumed but undeclared legacy aliases, `--color-text-muted` and `--color-text-soft`, are now explicitly declared.

The W63 foundation starts with zero raw colors outside `tokens.css`, zero undefined consumed `--aor-*` tokens, and one explicit tone vocabulary. Later W63 slices migrate only the surfaces they touch and must not increase the legacy raw-value count, create an undefined token, infer tone from runtime text, or increase the committed `spa.jsx`/`spa.css` ceilings.
