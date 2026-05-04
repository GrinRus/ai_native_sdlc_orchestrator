import { loadExampleContracts } from "./example-loader.mjs";
import { isPlainObject } from "./utils.mjs";
import {
  asReferenceString,
  asStringArray,
  buildReferenceRegistry,
  extractRouteAdapterRefs,
  isContextBundleRef,
  isDatasetRef,
  isExternalReference,
  isPlaceholderAdapterReference,
  isPromptBundleRef,
  isVersionedRef,
  referenceIssue,
  validateReferenceTarget,
} from "./reference-registry.mjs";

/**
 * @param {{ workspaceRoot?: string, examplesRoot?: string }} [options]
 * @returns {import("./index.d.ts").ReferenceValidationResult}
 */
export function validateExampleReferences(options = {}) {
  const loaded = loadExampleContracts(options);
  const registry = buildReferenceRegistry(loaded.results, loaded.workspaceRoot);
  /** @type {import("./index.d.ts").ReferenceValidationIssue[]} */
  const issues = [];
  let checkedReferences = 0;
  let checkedCompatibility = 0;

  for (const result of loaded.results) {
    if (!result.ok || !result.family || !isPlainObject(result.document)) {
      continue;
    }

    const document = result.document;
    const source = result.source;

    if (result.family === "project-profile") {
      const allowedAdapters = new Set(
        Array.isArray(document.allowed_adapters)
          ? document.allowed_adapters.filter((value) => typeof value === "string")
          : [],
      );
      const defaultRouteProfiles = document.default_route_profiles;
      if (isPlainObject(defaultRouteProfiles)) {
        for (const [key, rawValue] of Object.entries(defaultRouteProfiles)) {
          checkedReferences += 1;
          const field = `default_route_profiles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing route_id",
            expectedFamily: "provider-route-profile",
            expectedSet: registry.routeIds,
            registry,
          });

          const routeProfile = registry.routeProfilesById.get(reference);
          if (!routeProfile) continue;

          checkedCompatibility += 1;
          if (routeProfile.step && routeProfile.step !== key) {
            issues.push(
              referenceIssue({
                code: "reference_target_incompatible",
                source,
                field,
                reference,
                expected: `route step '${key}'`,
                actual: routeProfile.step,
                message: `Route '${reference}' has step '${routeProfile.step}', which does not match profile slot '${key}'.`,
              }),
            );
          }

          if (allowedAdapters.size === 0) continue;
          for (const adapterRef of routeProfile.adapters) {
            checkedCompatibility += 1;
            if (allowedAdapters.has(adapterRef.adapterId)) continue;
            issues.push(
              referenceIssue({
                code: "reference_target_incompatible",
                source,
                field,
                reference,
                expected: "route adapters included in allowed_adapters",
                actual: `${adapterRef.adapterId} is not allowed`,
                message: `Route '${reference}' uses adapter '${adapterRef.adapterId}', which is not listed in allowed_adapters.`,
              }),
            );
          }
        }
      }

      const defaultWrapperProfiles = document.default_wrapper_profiles;
      if (isPlainObject(defaultWrapperProfiles)) {
        for (const [key, rawValue] of Object.entries(defaultWrapperProfiles)) {
          checkedReferences += 1;
          const field = `default_wrapper_profiles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "wrapper_id@vN",
                actual: reference,
                message: `Field '${field}' must use wrapper_id@vN format.`,
              }),
            );
            continue;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing wrapper_id@vN",
            expectedFamily: "wrapper-profile",
            expectedSet: registry.wrapperRefs,
            registry,
          });

          const wrapperProfile = registry.wrapperProfilesByRef.get(reference);
          if (!wrapperProfile || !wrapperProfile.stepClass) continue;
          checkedCompatibility += 1;
          if (wrapperProfile.stepClass === key) continue;
          issues.push(
            referenceIssue({
              code: "reference_target_incompatible",
              source,
              field,
              reference,
              expected: `wrapper step_class '${key}'`,
              actual: wrapperProfile.stepClass,
              message: `Wrapper '${reference}' has step_class '${wrapperProfile.stepClass}', which does not match profile slot '${key}'.`,
            }),
          );
        }
      }

      const defaultPromptBundles = document.default_prompt_bundles;
      if (isPlainObject(defaultPromptBundles)) {
        for (const [key, rawValue] of Object.entries(defaultPromptBundles)) {
          checkedReferences += 1;
          const field = `default_prompt_bundles.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          if (!isPromptBundleRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "prompt-bundle://prompt_bundle_id@vN",
                actual: reference,
                message: `Field '${field}' must use prompt-bundle://prompt_bundle_id@vN format.`,
              }),
            );
            continue;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing prompt-bundle://prompt_bundle_id@vN",
            expectedFamily: "prompt-bundle",
            expectedSet: registry.promptBundleRefs,
            registry,
          });

          const promptBundle = registry.promptBundlesByRef.get(reference);
          if (!promptBundle?.stepClass || !isPlainObject(defaultRouteProfiles)) continue;
          const routeRefValue = defaultRouteProfiles[key];
          if (typeof routeRefValue !== "string") continue;
          const routeProfile = registry.routeProfilesById.get(routeRefValue);
          if (!routeProfile?.routeClass) continue;
          checkedCompatibility += 1;
          if (promptBundle.stepClass === routeProfile.routeClass) continue;
          issues.push(
            referenceIssue({
              code: "reference_target_incompatible",
              source,
              field,
              reference,
              expected: `prompt bundle step_class '${routeProfile.routeClass}'`,
              actual: promptBundle.stepClass,
              message: `Step '${key}' maps to route class '${routeProfile.routeClass}', which is incompatible with prompt bundle '${reference}' step_class '${promptBundle.stepClass}'.`,
            }),
          );
        }
      }

      const defaultContextBundles = document.default_context_bundles;
      if (isPlainObject(defaultContextBundles)) {
        for (const [key, rawValue] of Object.entries(defaultContextBundles)) {
          const references = asStringArray(rawValue, {
            issues,
            source,
            field: `default_context_bundles.${key}`,
          });
          references.forEach((reference, index) => {
            checkedReferences += 1;
            const field = `default_context_bundles.${key}[${index}]`;
            if (isExternalReference(reference)) return;
            if (!isContextBundleRef(reference)) {
              issues.push(
                referenceIssue({
                  code: "reference_format_invalid",
                  source,
                  field,
                  reference,
                  expected: "context-bundle://context_bundle_id@vN",
                  actual: reference,
                  message: `Field '${field}' must use context-bundle://context_bundle_id@vN format.`,
                }),
              );
              return;
            }
            validateReferenceTarget({
              issues,
              source,
              field,
              reference,
              expected: "existing context-bundle://context_bundle_id@vN",
              expectedFamily: "context-bundle",
              expectedSet: registry.contextBundleRefs,
              registry,
            });

            const contextBundle = registry.contextBundlesByRef.get(reference);
            if (!contextBundle || contextBundle.steps.size === 0) return;
            checkedCompatibility += 1;
            if (contextBundle.steps.has(key)) return;
            const actual = [...contextBundle.steps].sort().join(", ");
            issues.push(
              referenceIssue({
                code: "reference_target_incompatible",
                source,
                field,
                reference,
                expected: `context bundle includes step '${key}'`,
                actual: actual.length > 0 ? actual : "no applies_to.steps",
                message: `Context bundle '${reference}' is selected for step '${key}' but does not include it in applies_to.steps.`,
              }),
            );
          });
        }
      }

      const defaultStepPolicies = document.default_step_policies;
      if (isPlainObject(defaultStepPolicies)) {
        for (const [key, rawValue] of Object.entries(defaultStepPolicies)) {
          checkedReferences += 1;
          const field = `default_step_policies.${key}`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) continue;
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing policy_id",
            expectedFamily: "step-policy-profile",
            expectedSet: registry.policyIds,
            registry,
          });

          const policyProfile = registry.policyProfilesById.get(reference);
          if (!policyProfile || !policyProfile.stepClass) continue;
          checkedCompatibility += 1;
          if (policyProfile.stepClass === key) continue;
          issues.push(
            referenceIssue({
              code: "reference_target_incompatible",
              source,
              field,
              reference,
              expected: `policy step_class '${key}'`,
              actual: policyProfile.stepClass,
              message: `Policy '${reference}' has step_class '${policyProfile.stepClass}', which does not match profile slot '${key}'.`,
            }),
          );
        }
      }

      const defaultReleaseSuiteRef = document.eval_policy?.default_release_suite_ref;
      if (defaultReleaseSuiteRef !== undefined) {
        checkedReferences += 1;
        const field = "eval_policy.default_release_suite_ref";
        const reference = asReferenceString(defaultReleaseSuiteRef, { issues, source, field });
        if (reference && !isExternalReference(reference)) {
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: "default_release_suite_ref must use suite_id@vN format.",
              }),
            );
          } else {
            validateReferenceTarget({
              issues,
              source,
              field,
              reference,
              expected: "existing suite_id@vN",
              expectedFamily: "evaluation-suite",
              expectedSet: registry.suiteRefs,
              registry,
            });
          }
        }
      }

    }

    if (result.family === "provider-route-profile") {
      checkedReferences += 1;
      const primaryAdapterField = "primary.adapter";
      const primaryAdapterValue = isPlainObject(document.primary) ? document.primary.adapter : undefined;
      const primaryAdapterRef = asReferenceString(primaryAdapterValue, {
        issues,
        source,
        field: primaryAdapterField,
      });
      if (
        primaryAdapterRef &&
        !isExternalReference(primaryAdapterRef) &&
        !isPlaceholderAdapterReference(primaryAdapterRef)
      ) {
        validateReferenceTarget({
          issues,
          source,
          field: primaryAdapterField,
          reference: primaryAdapterRef,
          expected: "existing adapter_id",
          expectedFamily: "adapter-capability-profile",
          expectedSet: registry.adapterIds,
          registry,
        });
      }

      const fallback = document.fallback;
      if (Array.isArray(fallback)) {
        fallback.forEach((candidate, index) => {
          checkedReferences += 1;
          const fallbackAdapterField = `fallback[${index}].adapter`;
          const fallbackAdapterValue = isPlainObject(candidate) ? candidate.adapter : candidate;
          const fallbackAdapterRef = asReferenceString(fallbackAdapterValue, {
            issues,
            source,
            field: fallbackAdapterField,
          });
          if (
            !fallbackAdapterRef ||
            isExternalReference(fallbackAdapterRef) ||
            isPlaceholderAdapterReference(fallbackAdapterRef)
          ) {
            return;
          }
          validateReferenceTarget({
            issues,
            source,
            field: fallbackAdapterField,
            reference: fallbackAdapterRef,
            expected: "existing adapter_id",
            expectedFamily: "adapter-capability-profile",
            expectedSet: registry.adapterIds,
            registry,
          });
        });
      }

      const requiredAdapterCapabilities = asStringArray(document.required_adapter_capabilities, {
        issues,
        source,
        field: "required_adapter_capabilities",
      });
      if (requiredAdapterCapabilities.length > 0) {
        const routeAdapterRefs = extractRouteAdapterRefs(document);
        for (const adapterRef of routeAdapterRefs) {
          const adapterProfile = registry.adapterProfilesById.get(adapterRef.adapterId);
          if (!adapterProfile) continue;
          checkedCompatibility += 1;
          const missingCapabilities = requiredAdapterCapabilities.filter(
            (capability) => !adapterProfile.capabilities.has(capability),
          );
          if (missingCapabilities.length === 0) continue;
          issues.push(
            referenceIssue({
              code: "reference_target_incompatible",
              source,
              field: adapterRef.field,
              reference: adapterRef.adapterId,
              expected: `adapter with capabilities: ${requiredAdapterCapabilities.join(", ")}`,
              actual: `missing capabilities: ${missingCapabilities.join(", ")}`,
              message: `Adapter '${adapterRef.adapterId}' does not satisfy required route capabilities.`,
            }),
          );
        }
      }
    }

    if (result.family === "evaluation-suite") {
      checkedReferences += 1;
      const field = "dataset_ref";
      const reference = asReferenceString(document.dataset_ref, { issues, source, field });
      if (reference && !isExternalReference(reference)) {
        if (!isDatasetRef(reference)) {
          issues.push(
            referenceIssue({
              code: "reference_format_invalid",
              source,
              field,
              reference,
              expected: "dataset://dataset_id@version",
              actual: reference,
              message: "dataset_ref must use dataset://dataset_id@version format.",
            }),
          );
        } else {
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing dataset://dataset_id@version",
            expectedFamily: "dataset",
            expectedSet: registry.datasetRefs,
            registry,
          });

          const suiteSubjectType = typeof document.subject_type === "string" ? document.subject_type : null;
          const dataset = registry.datasetsByRef.get(reference);
          if (suiteSubjectType && dataset?.subjectType) {
            checkedCompatibility += 1;
            if (dataset.subjectType !== suiteSubjectType) {
              issues.push(
                referenceIssue({
                  code: "reference_target_incompatible",
                  source,
                  field,
                  reference,
                  expected: `dataset subject_type '${suiteSubjectType}'`,
                  actual: dataset.subjectType,
                  message: `Suite subject_type '${suiteSubjectType}' is incompatible with dataset '${reference}' subject_type '${dataset.subjectType}'.`,
                }),
              );
            }
          }
        }
      }
    }

    if (result.family === "step-policy-profile") {
      const suiteRef = document.quality_gate?.suite_ref;
      if (suiteRef !== undefined) {
        checkedReferences += 1;
        const field = "quality_gate.suite_ref";
        const reference = asReferenceString(suiteRef, { issues, source, field });
        if (reference && !isExternalReference(reference)) {
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: "quality_gate.suite_ref must use suite_id@vN format.",
              }),
            );
          } else {
            validateReferenceTarget({
              issues,
              source,
              field,
              reference,
              expected: "existing suite_id@vN",
              expectedFamily: "evaluation-suite",
              expectedSet: registry.suiteRefs,
              registry,
            });
          }
        }
      }
    }

    if (result.family === "prompt-bundle") {
      const defaultSuiteRefs = document.certification_hints?.default_suite_refs;
      if (Array.isArray(defaultSuiteRefs)) {
        defaultSuiteRefs.forEach((rawValue, index) => {
          checkedReferences += 1;
          const field = `certification_hints.default_suite_refs[${index}]`;
          const reference = asReferenceString(rawValue, { issues, source, field });
          if (!reference || isExternalReference(reference)) return;
          if (!isVersionedRef(reference)) {
            issues.push(
              referenceIssue({
                code: "reference_format_invalid",
                source,
                field,
                reference,
                expected: "suite_id@vN",
                actual: reference,
                message: `${field} must use suite_id@vN format.`,
              }),
            );
            return;
          }
          validateReferenceTarget({
            issues,
            source,
            field,
            reference,
            expected: "existing suite_id@vN",
            expectedFamily: "evaluation-suite",
            expectedSet: registry.suiteRefs,
            registry,
          });
        });
      }
    }

  }

  return {
    ok: issues.length === 0,
    workspaceRoot: loaded.workspaceRoot,
    examplesRoot: loaded.examplesRoot,
    checkedReferences,
    checkedCompatibility,
    issues,
  };
}
