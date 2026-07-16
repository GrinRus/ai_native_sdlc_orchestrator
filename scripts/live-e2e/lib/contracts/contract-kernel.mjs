import {
  CONTRACT_FAMILY_INDEX as PUBLIC_CONTRACT_FAMILY_INDEX,
  EXAMPLE_FAMILY_RESOLUTION_RULES as PUBLIC_EXAMPLE_FAMILY_RESOLUTION_RULES,
} from "../../../../packages/contracts/src/families.mjs";
import {
  PRIVATE_CONTRACT_FAMILY_INDEX,
  PRIVATE_EXAMPLE_FAMILY_RESOLUTION_RULES,
} from "./families.mjs";

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
