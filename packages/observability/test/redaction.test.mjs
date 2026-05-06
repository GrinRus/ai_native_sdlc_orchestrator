import assert from "node:assert/strict";
import test from "node:test";

import { parseRedactionSecretList, redactSensitiveValue } from "../src/index.mjs";

test("redaction masks configured secret values in nested observability payloads", () => {
  const redacted = redactSensitiveValue(
    {
      summary: "operator entered prod-secret-token during triage",
      nested: {
        detail: "prefix-prod-secret-token-suffix",
      },
      events: [{ message: "prod-secret-token" }],
    },
    {
      secretValues: ["prod-secret-token"],
    },
  );

  assert.equal(JSON.stringify(redacted).includes("prod-secret-token"), false);
  assert.equal(JSON.stringify(redacted).includes("[REDACTED]"), true);
});

test("redaction masks sensitive string fields without erasing non-string policy booleans", () => {
  const redacted = redactSensitiveValue({
    token: "direct-token",
    authorization: "Bearer direct-token",
    security_policy: {
      redact_secrets: true,
    },
  });

  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.deepEqual(redacted.security_policy, { redact_secrets: true });
});

test("redaction secret list accepts json arrays and comma-separated values", () => {
  assert.deepEqual(parseRedactionSecretList('["alpha-token","beta-token"]'), ["alpha-token", "beta-token"]);
  assert.deepEqual(parseRedactionSecretList("alpha-token,beta-token"), ["alpha-token", "beta-token"]);
});
