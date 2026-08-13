# W70 installed Task Workspace closure

W70-S08 owns the deterministic, installed-console closure for the Task
Workspace. It is development acceptance evidence only: no Codex, Claude, or
Qwen process is started, and no provider qualification claim is made.

The source-of-truth closure matrix is
`apps/web/browser/fixtures/task-workspace-closure.json`. The browser proof in
`apps/web/browser/task-workspace-closure.spec.mjs` exercises the local fixture
control plane through real UI actions and checks durable readback for:

- text-only, uploaded Markdown, repository Markdown, stale sources, and an
  unavailable approved runner;
- attention, failure, review, partial completion, immutable completion, and
  follow-up creation;
- reload, reconnect/offline recovery, mobile layout, keyboard focus, and
  reduced-motion behavior.

The private proof contract keeps the following boundaries fail closed:

- provider execution and upstream writes are prohibited;
- runtime state, credentials, and private absolute paths are not commit
  artifacts;
- historical v2 browser evidence remains readable but cannot satisfy W70
  acceptance;
- Task remains a server-owned projection; the browser does not become a
  lifecycle or next-action owner.

This closes W70 development acceptance when the slice gate passes. It does not
close W66-S09, remove `audit-hold`, or set production `release_clearance=true`.
