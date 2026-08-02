import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PUBLIC_CONTRACT_FAMILIES = new Set(
  JSON.parse(fs.readFileSync(new URL("./public-kernel.snapshot.json", import.meta.url), "utf8"))
    .contract_families.map((entry) => entry.family),
);
const PUBLIC_VALIDATOR = fileURLToPath(
  new URL("../../../../packages/contracts/bin/validate-document.mjs", import.meta.url),
);
const PUBLIC_SESSION_BUDGET_VALIDATOR = fileURLToPath(
  new URL("../../../../packages/contracts/bin/validate-session-budget.mjs", import.meta.url),
);

export function isPublicContractFamily(family) {
  return PUBLIC_CONTRACT_FAMILIES.has(family);
}

export function validatePublicContractDocument({ family, document, source }) {
  const child = spawnSync(process.execPath, [PUBLIC_VALIDATOR], {
    input: JSON.stringify({ family, document, source }),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.status !== 0) {
    return {
      ok: false,
      family,
      source,
      issues: [{
        code: "public_contract_validator_failed",
        source,
        expected: "installed public contract validator",
        actual: child.error?.message ?? child.stderr.trim() ?? `exit ${child.status}`,
        message: "Public contract validation failed at the product/private subprocess boundary.",
      }],
    };
  }
  return JSON.parse(child.stdout);
}

export function validatePublicExternalRunnerSessionBudget(value, source, field) {
  const child = spawnSync(process.execPath, [PUBLIC_SESSION_BUDGET_VALIDATOR], {
    input: JSON.stringify({ value, source, field }),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (child.status !== 0) {
    return [{
      code: "public_contract_validator_failed",
      source,
      field,
      expected: "installed public session-budget validator",
      actual: child.error?.message ?? child.stderr.trim() ?? `exit ${child.status}`,
      message: "Public session-budget validation failed at the product/private subprocess boundary.",
    }];
  }
  const parsed = JSON.parse(child.stdout);
  return Array.isArray(parsed.issues) ? parsed.issues : [];
}
