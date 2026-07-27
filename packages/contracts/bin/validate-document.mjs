#!/usr/bin/env node
import fs from "node:fs";

import { validateContractDocument } from "../src/loader.mjs";

try {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const result = validateContractDocument({
    family: request.family,
    document: request.document,
    source: request.source,
  });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
