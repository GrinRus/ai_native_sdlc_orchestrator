# State transaction contract

Shared mutable AOR state under AOR Home is persisted through a lock-scoped
transaction owner. A transaction has four ordered phases:

1. acquire the state lock (the lock must cover read, domain validation, and
   persistence);
2. read the current JSON strictly; a malformed document is quarantined and
   raises `state-corrupt` with the original `state_file` and optional
   `recovery_ref`;
3. apply one domain transition, optionally fencing against an expected integer
   revision; and
4. write a complete document to a unique temporary file and atomically rename
   it into place. Temporary files are removed when persistence fails.

The primitive never converts corruption, a failed read, or a failed write into
an empty object. A revision conflict raises `state-revision-conflict` and the
caller must re-read before retrying. Repeated requests use a stable domain
idempotency key and return the already persisted result instead of invoking a
provider again.

The primitive is runner-agnostic. Domain owners remain responsible for which
fields they may change; provider heartbeat writers may update only
`provider_step_status`, while operator controls remain owned by run-control.

The adoption ratchet is `scripts/state-transaction-ratchet.mjs`. Any remaining
direct write that targets a shared mutable state reference must be listed in
`scripts/state-transaction-direct-write-exceptions.json` with a named owner,
reason, and expiry date. Immutable evidence/artifact creation is not a mutable
state exception; a future migration may still move it to the primitive for
uniform atomicity.

The contract is intentionally private to the local AOR Home persistence
boundary and does not add a public packet family or hosted-storage requirement.
