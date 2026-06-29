import fs from "node:fs";
import path from "node:path";

import { collectYamlFiles } from "./example-paths.mjs";
import { loadContractFile } from "./loader.mjs";
import { isPlainObject } from "./utils.mjs";
import { asReferenceString, referenceIssue } from "./reference-registry.mjs";

/**
 * @param {{ workspaceRoot?: string, examplesRoot?: string, catalogRoot?: string }} [options]
 * @returns {import("./index.d.ts").ReferenceValidationResult}
 */
export function validateLiveE2eCatalogReferences(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const examplesRoot = path.resolve(workspaceRoot, options.examplesRoot ?? "examples");
  const catalogRoot = path.resolve(workspaceRoot, options.catalogRoot ?? "scripts/live-e2e/catalog");
  const adapterRoot = path.join(examplesRoot, "adapters");
  const providerRoot = path.join(catalogRoot, "providers");
  const mandatoryLiveProviderVariantIds = new Set(["openai-primary", "anthropic-primary"]);
  /** @type {import("./index.d.ts").ReferenceValidationIssue[]} */
  const issues = [];
  let checkedReferences = 0;
  let checkedCompatibility = 0;

  /** @type {Map<string, { source: string, liveBaseline: boolean, runtimeMode: string | null, runtimeCommand: string | null, permissionPolicyMode: string | null, permissionPolicyArgs: string[] }>} */
  const adapterProfilesById = new Map();
  const adapterIds = new Set();
  if (fs.existsSync(adapterRoot)) {
    for (const filePath of collectYamlFiles(adapterRoot).sort()) {
      const loaded = loadContractFile({ filePath, family: "adapter-capability-profile" });
      if (!loaded.ok || !isPlainObject(loaded.document)) {
        continue;
      }
      const adapterId = typeof loaded.document.adapter_id === "string" ? loaded.document.adapter_id : null;
      if (!adapterId) {
        continue;
      }
      const execution = isPlainObject(loaded.document.execution) ? loaded.document.execution : {};
      const externalRuntime = isPlainObject(execution.external_runtime) ? execution.external_runtime : {};
      const permissionPolicy = isPlainObject(externalRuntime.permission_policy) ? externalRuntime.permission_policy : {};
      const defaultPermissionMode =
        typeof permissionPolicy.default_mode === "string" && permissionPolicy.default_mode.trim().length > 0
          ? permissionPolicy.default_mode.trim()
          : null;
      const permissionModes = isPlainObject(permissionPolicy.modes) ? permissionPolicy.modes : {};
      const defaultPermissionProfile =
        defaultPermissionMode && isPlainObject(permissionModes[defaultPermissionMode])
          ? permissionModes[defaultPermissionMode]
          : {};
      adapterIds.add(adapterId);
      adapterProfilesById.set(adapterId, {
        source: loaded.source,
        liveBaseline: execution.live_baseline === true,
        runtimeMode: typeof execution.runtime_mode === "string" ? execution.runtime_mode : null,
        runtimeCommand: typeof externalRuntime.command === "string" && externalRuntime.command.trim().length > 0
          ? externalRuntime.command.trim()
          : null,
        permissionPolicyMode: defaultPermissionMode,
        permissionPolicyArgs: Array.isArray(defaultPermissionProfile.args)
          ? defaultPermissionProfile.args.filter((value) => typeof value === "string" && value.trim().length > 0)
          : [],
      });
    }
  }

  const seenProviderVariantIds = new Set();
  if (fs.existsSync(providerRoot)) {
    for (const filePath of collectYamlFiles(providerRoot).sort()) {
      const loaded = loadContractFile({ filePath, family: "live-e2e-provider-variant" });
      if (!loaded.ok || !isPlainObject(loaded.document)) {
        continue;
      }
      checkedReferences += 1;
      const source = loaded.source;
      const providerVariantId = typeof loaded.document.provider_variant_id === "string"
        ? loaded.document.provider_variant_id.trim()
        : null;
      if (providerVariantId) {
        seenProviderVariantIds.add(providerVariantId);
      }
      const adapterRef = asReferenceString(loaded.document.primary_adapter, {
        issues,
        source,
        field: "primary_adapter",
      });
      if (!adapterRef) {
        continue;
      }
      if (!adapterIds.has(adapterRef)) {
        issues.push(
          referenceIssue({
            code: "reference_target_missing",
            source,
            field: "primary_adapter",
            reference: adapterRef,
            expected: "existing adapter_id",
            actual: "missing target",
            message: `Provider variant primary_adapter '${adapterRef}' does not resolve to an adapter capability profile.`,
          }),
        );
        continue;
      }

      const coverageTier = typeof loaded.document.coverage_tier === "string" ? loaded.document.coverage_tier : "extended";
      const mandatoryLiveProvider = providerVariantId ? mandatoryLiveProviderVariantIds.has(providerVariantId) : false;
      if (coverageTier !== "required" && !mandatoryLiveProvider) {
        continue;
      }

      checkedCompatibility += 1;
      const adapterProfile = adapterProfilesById.get(adapterRef);
      const liveRunnable =
        adapterProfile?.liveBaseline === true &&
        adapterProfile.runtimeMode === "external-process" &&
        typeof adapterProfile.runtimeCommand === "string" &&
        typeof adapterProfile.permissionPolicyMode === "string" &&
        adapterProfile.permissionPolicyArgs.length > 0;
      if (liveRunnable) {
        continue;
      }
      issues.push(
        referenceIssue({
          code: "reference_target_incompatible",
          source,
          field: "primary_adapter",
          reference: adapterRef,
          expected: "adapter with execution.live_baseline=true, runtime_mode=external-process, external_runtime.command, and permission_policy default mode args",
          actual: adapterProfile
            ? `live_baseline=${String(adapterProfile.liveBaseline)}, runtime_mode=${adapterProfile.runtimeMode ?? "missing"}, command=${adapterProfile.runtimeCommand ?? "missing"}, permission_policy.default_mode=${adapterProfile.permissionPolicyMode ?? "missing"}, permission_policy.args=${adapterProfile.permissionPolicyArgs.length > 0 ? "present" : "missing"}`
            : "missing adapter profile",
          message: `Required live E2E provider variant references adapter '${adapterRef}' without a live-runnable external runtime permission policy.`,
        }),
      );
    }
  }

  for (const providerVariantId of mandatoryLiveProviderVariantIds) {
    if (seenProviderVariantIds.has(providerVariantId)) {
      continue;
    }
    issues.push(
      referenceIssue({
        code: "reference_target_missing",
        source: providerRoot,
        field: "provider_variant_id",
        reference: providerVariantId,
        expected: "mandatory live E2E provider variant catalog entry",
        actual: "missing provider variant",
        message: `Mandatory live E2E provider variant '${providerVariantId}' is missing from the provider catalog.`,
      }),
    );
  }

  return {
    ok: issues.length === 0,
    workspaceRoot,
    examplesRoot,
    checkedReferences,
    checkedCompatibility,
    issues,
  };
}
