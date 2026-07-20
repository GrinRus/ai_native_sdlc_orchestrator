import fs from "node:fs";

import {
  PRIVATE_CONTRACT_FAMILY_INDEX,
  PRIVATE_EXAMPLE_FAMILY_RESOLUTION_RULES,
} from "./families.mjs";

const snapshot = JSON.parse(fs.readFileSync(new URL("./public-kernel.snapshot.json", import.meta.url), "utf8"));
if (snapshot.schema_version !== 2 || !Array.isArray(snapshot.contract_families)) {
  throw new Error("Private live-E2E contract kernel requires a versioned public metadata snapshot.");
}
const PUBLIC_CONTRACT_FAMILY_INDEX = Object.freeze(snapshot.contract_families);
const PUBLIC_EXAMPLE_FAMILY_RESOLUTION_RULES = Object.freeze(
  snapshot.example_family_resolution_rules.map((entry) => ({
    regex: new RegExp(entry.regex_source, entry.regex_flags),
    family: entry.family,
  })),
);

const publicFamilyIds = new Set(PUBLIC_CONTRACT_FAMILY_INDEX.map((entry) => entry.family));
export const CONTRACT_FAMILY_INDEX = Object.freeze([
  ...PUBLIC_CONTRACT_FAMILY_INDEX,
  ...PRIVATE_CONTRACT_FAMILY_INDEX.filter((entry) => !publicFamilyIds.has(entry.family)),
]);

const publicResolutionPatterns = new Set(
  PUBLIC_EXAMPLE_FAMILY_RESOLUTION_RULES.map((entry) => `${entry.regex.source}:${entry.regex.flags}`),
);
export const EXAMPLE_FAMILY_RESOLUTION_RULES = Object.freeze([
  ...PUBLIC_EXAMPLE_FAMILY_RESOLUTION_RULES,
  ...PRIVATE_EXAMPLE_FAMILY_RESOLUTION_RULES.filter(
    (entry) => !publicResolutionPatterns.has(`${entry.regex.source}:${entry.regex.flags}`),
  ),
]);
