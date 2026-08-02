import path from "node:path";

import { EXTERNAL_REFERENCE_PREFIXES } from "./families.mjs";
import { describeActualType, isPlainObject } from "./utils.mjs";

/**
 * @param {unknown} value
 * @param {{ issues: import("./index.d.ts").ReferenceValidationIssue[], source: string, field: string }} options
 * @returns {string | null}
 */
export function asReferenceString(value, { issues, source, field }) {
  if (typeof value === "string") {
    return value;
  }

  issues.push(
    referenceIssue({
      code: "reference_format_invalid",
      source,
      field,
      reference: null,
      expected: "string reference",
      actual: describeActualType(value),
      message: `Field '${field}' must be a string reference.`,
    }),
  );
  return null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isExternalReference(value) {
  return EXTERNAL_REFERENCE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isVersionedRef(value) {
  return /^[A-Za-z0-9._-]+@v\d+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isPromptBundleRef(value) {
  return /^prompt-bundle:\/\/[A-Za-z0-9._-]+@v\d+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isContextBundleRef(value) {
  return /^context-bundle:\/\/[A-Za-z0-9._-]+@v\d+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isDatasetRef(value) {
  return /^dataset:\/\/[A-Za-z0-9._-]+@[^@\s]+$/.test(value);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isPlaceholderAdapterReference(value) {
  return value === "none";
}

/**
 * @param {unknown} value
 * @param {{ issues: import("./index.d.ts").ReferenceValidationIssue[], source: string, field: string }} options
 * @returns {string[]}
 */
export function asStringArray(value, { issues, source, field }) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    issues.push(
      referenceIssue({
        code: "reference_format_invalid",
        source,
        field,
        expected: "array of strings",
        actual: describeActualType(value),
        message: `Field '${field}' must be an array of string values.`,
      }),
    );
    return [];
  }

  /** @type {string[]} */
  const values = [];
  value.forEach((entry, index) => {
    if (typeof entry === "string") {
      values.push(entry);
      return;
    }
    issues.push(
      referenceIssue({
        code: "reference_format_invalid",
        source,
        field: `${field}[${index}]`,
        expected: "string",
        actual: describeActualType(entry),
        message: `Field '${field}[${index}]' must be a string.`,
      }),
    );
  });
  return values;
}

/**
 * @param {Record<string, unknown>} routeProfile
 * @returns {Array<{ field: string, adapterId: string }>}
 */
export function extractRouteAdapterRefs(routeProfile) {
  /** @type {Array<{ field: string, adapterId: string }>} */
  const references = [];

  const primary = routeProfile.primary;
  if (
    isPlainObject(primary) &&
    typeof primary.adapter === "string" &&
    !isPlaceholderAdapterReference(primary.adapter)
  ) {
    references.push({ field: "primary.adapter", adapterId: primary.adapter });
  }

  const fallback = routeProfile.fallback;
  if (Array.isArray(fallback)) {
    fallback.forEach((candidate, index) => {
      if (
        !isPlainObject(candidate) ||
        typeof candidate.adapter !== "string" ||
        isPlaceholderAdapterReference(candidate.adapter)
      ) {
        return;
      }
      references.push({ field: `fallback[${index}].adapter`, adapterId: candidate.adapter });
    });
  }

  return references;
}

/**
 * @param {import("./index.d.ts").LoadedContractFile[]} results
 * @param {string} workspaceRoot
 * @returns {{
 *   routeIds: Set<string>,
 *   wrapperRefs: Set<string>,
 *   policyIds: Set<string>,
 *   suiteRefs: Set<string>,
 *   datasetRefs: Set<string>,
 *   contextBundleRefs: Set<string>,
 *   promptBundleRefs: Set<string>,
 *   adapterIds: Set<string>,
 *   routeProfilesById: Map<string, { source: string, step: string | null, routeClass: string | null, adapters: Array<{ field: string, adapterId: string }> }>,
 *   wrapperProfilesByRef: Map<string, { source: string, stepClass: string | null }>,
 *   policyProfilesById: Map<string, { source: string, stepClass: string | null }>,
 *   contextBundlesByRef: Map<string, { source: string, steps: Set<string> }>,
 *   promptBundlesByRef: Map<string, { source: string, stepClass: string | null }>,
 *   datasetsByRef: Map<string, { source: string, subjectType: string | null }>,
 *   adapterProfilesById: Map<string, { source: string, capabilities: Set<string> }>,
 *   knownReferenceFamilies: Map<string, Set<import("./index.d.ts").ContractFamily>>,
 * }}
 */
export function buildReferenceRegistry(results, workspaceRoot) {
  const routeIds = new Set();
  const wrapperRefs = new Set();
  const policyIds = new Set();
  const suiteRefs = new Set();
  const datasetRefs = new Set();
  const contextBundleRefs = new Set();
  const promptBundleRefs = new Set();
  const adapterIds = new Set();
  /** @type {Map<string, { source: string, step: string | null, routeClass: string | null, adapters: Array<{ field: string, adapterId: string }> }>} */
  const routeProfilesById = new Map();
  /** @type {Map<string, { source: string, stepClass: string | null }>} */
  const wrapperProfilesByRef = new Map();
  /** @type {Map<string, { source: string, stepClass: string | null }>} */
  const policyProfilesById = new Map();
  /** @type {Map<string, { source: string, steps: Set<string> }>} */
  const contextBundlesByRef = new Map();
  /** @type {Map<string, { source: string, stepClass: string | null }>} */
  const promptBundlesByRef = new Map();
  /** @type {Map<string, { source: string, subjectType: string | null }>} */
  const datasetsByRef = new Map();
  /** @type {Map<string, { source: string, capabilities: Set<string> }>} */
  const adapterProfilesById = new Map();
  /** @type {Map<string, Set<import("./index.d.ts").ContractFamily>>} */
  const knownReferenceFamilies = new Map();

  for (const result of results) {
    if (!result.ok || !result.family || !isPlainObject(result.document)) {
      continue;
    }

    const document = result.document;
    switch (result.family) {
      case "provider-route-profile": {
        const routeId = document.route_id;
        if (typeof routeId === "string") {
          routeIds.add(routeId);
          registerKnownReference(knownReferenceFamilies, routeId, "provider-route-profile");
          routeProfilesById.set(routeId, {
            source: result.source,
            step: typeof document.step === "string" ? document.step : null,
            routeClass: typeof document.route_class === "string" ? document.route_class : null,
            adapters: extractRouteAdapterRefs(document),
          });
        }
        break;
      }
      case "wrapper-profile": {
        const wrapperId = document.wrapper_id;
        const version = document.version;
        if (typeof wrapperId === "string" && typeof version === "number") {
          const wrapperRef = `${wrapperId}@v${version}`;
          wrapperRefs.add(wrapperRef);
          registerKnownReference(knownReferenceFamilies, wrapperRef, "wrapper-profile");
          wrapperProfilesByRef.set(wrapperRef, {
            source: result.source,
            stepClass: typeof document.step_class === "string" ? document.step_class : null,
          });
        }
        break;
      }
      case "step-policy-profile": {
        const policyId = document.policy_id;
        if (typeof policyId === "string") {
          policyIds.add(policyId);
          registerKnownReference(knownReferenceFamilies, policyId, "step-policy-profile");
          policyProfilesById.set(policyId, {
            source: result.source,
            stepClass: typeof document.step_class === "string" ? document.step_class : null,
          });
        }
        break;
      }
      case "evaluation-suite": {
        const suiteId = document.suite_id;
        const version = document.version;
        if (typeof suiteId === "string" && typeof version === "number") {
          const suiteRef = `${suiteId}@v${version}`;
          suiteRefs.add(suiteRef);
          registerKnownReference(knownReferenceFamilies, suiteRef, "evaluation-suite");
        }
        break;
      }
      case "dataset": {
        const datasetId = document.dataset_id;
        const version = document.version;
        if (typeof datasetId === "string" && typeof version === "string") {
          const datasetRef = `dataset://${datasetId}@${version}`;
          datasetRefs.add(datasetRef);
          registerKnownReference(knownReferenceFamilies, datasetRef, "dataset");
          datasetsByRef.set(datasetRef, {
            source: result.source,
            subjectType: typeof document.subject_type === "string" ? document.subject_type : null,
          });
        }
        break;
      }
      case "context-bundle": {
        const bundleId = document.context_bundle_id;
        const version = document.version;
        if (typeof bundleId === "string" && typeof version === "number") {
          const bundleRef = `context-bundle://${bundleId}@v${version}`;
          contextBundleRefs.add(bundleRef);
          registerKnownReference(knownReferenceFamilies, bundleRef, "context-bundle");
          const steps = isPlainObject(document.applies_to)
            ? new Set(
                Array.isArray(document.applies_to.steps)
                  ? document.applies_to.steps.filter((step) => typeof step === "string")
                  : [],
              )
            : new Set();
          contextBundlesByRef.set(bundleRef, {
            source: result.source,
            steps,
          });
        }
        break;
      }
      case "prompt-bundle": {
        const bundleId = document.prompt_bundle_id;
        const version = document.version;
        if (typeof bundleId === "string" && typeof version === "number") {
          const bundleRef = `prompt-bundle://${bundleId}@v${version}`;
          promptBundleRefs.add(bundleRef);
          registerKnownReference(knownReferenceFamilies, bundleRef, "prompt-bundle");
          promptBundlesByRef.set(bundleRef, {
            source: result.source,
            stepClass: typeof document.step_class === "string" ? document.step_class : null,
          });
        }
        break;
      }
      case "adapter-capability-profile": {
        const adapterId = document.adapter_id;
        if (typeof adapterId === "string") {
          adapterIds.add(adapterId);
          registerKnownReference(knownReferenceFamilies, adapterId, "adapter-capability-profile");
          const capabilities = new Set(
            Object.entries(isPlainObject(document.capabilities) ? document.capabilities : {})
              .filter(([, value]) => value === true)
              .map(([capability]) => capability),
          );
          adapterProfilesById.set(adapterId, {
            source: result.source,
            capabilities,
          });
        }
        break;
      }
      case "project-profile": {
        const relativePath = normalizePath(path.relative(workspaceRoot, result.source));
        registerKnownReference(knownReferenceFamilies, relativePath, "project-profile");
        break;
      }
      default:
        break;
    }
  }

  return {
    routeIds,
    wrapperRefs,
    policyIds,
    suiteRefs,
    datasetRefs,
    contextBundleRefs,
    promptBundleRefs,
    adapterIds,
    routeProfilesById,
    wrapperProfilesByRef,
    policyProfilesById,
    contextBundlesByRef,
    promptBundlesByRef,
    datasetsByRef,
    adapterProfilesById,
    knownReferenceFamilies,
  };
}

/**
 * @param {{
 *   issues: import("./index.d.ts").ReferenceValidationIssue[],
 *   source: string,
 *   field: string,
 *   reference: string,
 *   expected: string,
 *   expectedFamily: import("./index.d.ts").ContractFamily,
 *   expectedSet: Set<string>,
 *   registry: { knownReferenceFamilies: Map<string, Set<import("./index.d.ts").ContractFamily>> }
 * }} params
 */
export function validateReferenceTarget({ issues, source, field, reference, expected, expectedFamily, expectedSet, registry }) {
  if (expectedSet.has(reference)) {
    return;
  }

  const knownFamilies = registry.knownReferenceFamilies.get(reference);
  if (knownFamilies && knownFamilies.size > 0 && !knownFamilies.has(expectedFamily)) {
    issues.push(
      referenceIssue({
        code: "reference_target_type_mismatch",
        source,
        field,
        reference,
        expected: expectedFamily,
        actual: [...knownFamilies].join("|"),
        message: `Reference '${reference}' resolves to a different family than expected.`,
      }),
    );
    return;
  }

  issues.push(
    referenceIssue({
      code: "reference_target_missing",
      source,
      field,
      reference,
      expected,
      actual: "missing target",
      message: `Reference '${reference}' does not resolve to ${expected}.`,
    }),
  );
}

/**
 * @param {Map<string, Set<import("./index.d.ts").ContractFamily>>} registry
 * @param {string} reference
 * @param {import("./index.d.ts").ContractFamily} family
 */
export function registerKnownReference(registry, reference, family) {
  const knownFamilies = registry.get(reference);
  if (knownFamilies) {
    knownFamilies.add(family);
    return;
  }
  registry.set(reference, new Set([family]));
}

/**
 * @param {{ code: import("./index.d.ts").ReferenceValidationIssueCode, source: string, field?: string | null, expected?: string | null, actual?: string | null, reference?: string | null, message: string }} params
 * @returns {import("./index.d.ts").ReferenceValidationIssue}
 */
export function referenceIssue({ code, source, field = null, expected = null, actual = null, reference = null, message }) {
  return {
    code,
    source,
    field,
    expected,
    actual,
    reference,
    message,
  };
}

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizePath(input) {
  return input.split(path.sep).join("/");
}
