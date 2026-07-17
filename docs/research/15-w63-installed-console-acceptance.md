# W63 Installed Quiet Cockpit Acceptance

Date: 2026-07-17

Slice: `W63-S07`

Scope: opt-in `?console=quiet-cockpit`; the legacy renderer remains the installed default.

## Result

The blocking installed-console matrix passed against a tarball installed into a disposable prefix. The app was launched from a neutral directory with a disposable `AOR_HOME`, literal loopback transport, no provider credentials, and no upstream remote.

- 12 catalog scenarios have one-to-one companion fixtures with expected surfaces, side effects, durable readback, and safety assertions.
- 13 Playwright cases passed against the installed package.
- Shell coverage includes 320, 390×844, 768×1024, 1024×768, 1180, 1181, and 1440×900 viewports, keyboard focus, reduced motion, and 200% zoom/reflow.
- External browser requests are blocked. The neutral launcher stays empty. Target changes are confined to `.aor/`, tracked source and Git remotes remain unchanged.
- Reload/reconnect, partial reads, multi-item selection, independent drafts, project/flow isolation, dialogs, plan details, and durable Mission readback remain executable.

No unresolved P1 accessibility or product-safety finding remains in this acceptance scope. Full canonical lifecycle parity and `OPS-12` closure remain explicitly owned by `W63-S08`; this report does not use visual evidence as lifecycle proof.

## Reproduction

```sh
pnpm test:web:browser
pnpm quality:ratchet
pnpm slice:gate -- W63-S07
```

Raw traces, screenshots, videos, DOM/error context, and the Playwright JSON report are written only under ignored `.aor/quality/w63/s07/`.

## Residual limitations

- Chromium is the only blocking browser engine.
- Hosted UI, multi-user authentication, Windows certification, credentialed providers, paid calls, target-source writes, and real upstream delivery are not claimed.
- The Quiet Cockpit remains opt-in until the W65 cutover decision.
