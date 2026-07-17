# W65 legacy renderer retirement

W65-S06 removes renderer selection from the packaged SPA. Quiet Cockpit is the only reachable renderer and the server emits `console_experience=quiet-cockpit` even when an older launcher supplies the deprecated `legacy` value.

The `console=legacy` URL input remains recognized for compatibility. The SPA shows a migration notice, preserves the Project/Flow and presentation parameters, and replaces the selector with `console=quiet-cockpit`. It does not fall back silently or perform a mutation.

The installed fixture asserts that no legacy switch or conditional renderer branch remains in source or the distribution. Historical W34 screenshots and W63 before-state reports remain immutable evidence. Operational rollback after this slice is package-version rollback.
