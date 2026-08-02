#!/usr/bin/env node

import fs from "node:fs";

import { validateExternalRunnerSessionBudget } from "../src/session-budget-validation.mjs";

try {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const issues = validateExternalRunnerSessionBudget(input.value, input.source, input.field);
  process.stdout.write(`${JSON.stringify({ issues })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
