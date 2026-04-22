import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";
import {
  SUPPORTED_STEP_CLASSES,
  resolveRouteForStep,
} from "../../provider-routing/src/route-resolution.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {string} reference
 * @returns {{ wrapperId: string, version: number }}
 */
function parseWrapperReference(reference) {
  const match = /^([^@]+)@v(\d+)$/u.exec(reference);
  if (!match) {
    throw new Error(`Invalid wrapper reference '${reference}'. Expected '<wrapper_id>@v<version>'.`);
  }
  return {
    wrapperId: match[1],
    version: Number(match[2]),
  };
}

/**
 * @param {string} reference
 * @returns {{ promptBundleId: string, version: number }}
 */
function parsePromptBundleReference(reference) {
  const match = /^prompt-bundle:\/\/([^@]+)@v(\d+)$/u.exec(reference);
  if (!match) {
    throw new Error(
      `Invalid prompt bundle reference '${reference}'. Expected 'prompt-bundle://<bundle_id>@v<version>'.`,
    );
  }
  return {
    promptBundleId: match[1],
    version: Number(match[2]),
  };
}

/**
 * @param {{ wrappersRoot: string }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
function buildWrapperRegistry(options) {
  if (!fs.existsSync(options.wrappersRoot)) {
    throw new Error(`Wrapper registry root '${options.wrappersRoot}' does not exist.`);
  }

  const registry = new Map();
  const entries = fs
    .readdirSync(options.wrappersRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of entries) {
    const source = path.join(options.wrappersRoot, fileName);
    const loaded = loadContractFile({
      filePath: source,
      family: "wrapper-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Wrapper profile '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const wrapperId = profile.wrapper_id;
    const version = profile.version;
    if (typeof wrapperId !== "string" || typeof version !== "number") {
      throw new Error(`Wrapper profile '${source}' is missing wrapper_id/version.`);
    }

    const registryKey = `${wrapperId}@v${version}`;
    registry.set(registryKey, { profile, source });
  }

  return registry;
}

/**
 * @param {{ promptsRoot: string }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
function buildPromptRegistry(options) {
  if (!fs.existsSync(options.promptsRoot)) {
    throw new Error(`Prompt registry root '${options.promptsRoot}' does not exist.`);
  }

  const registry = new Map();
  const entries = fs
    .readdirSync(options.promptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of entries) {
    const source = path.join(options.promptsRoot, fileName);
    const loaded = loadContractFile({
      filePath: source,
      family: "prompt-bundle",
    });
    if (!loaded.ok) {
      throw new Error(`Prompt bundle '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const promptBundleId = profile.prompt_bundle_id;
    const version = profile.version;
    if (typeof promptBundleId !== "string" || typeof version !== "number") {
      throw new Error(`Prompt bundle '${source}' is missing prompt_bundle_id/version.`);
    }

    const registryKey = `prompt-bundle://${promptBundleId}@v${version}`;
    registry.set(registryKey, { profile, source });
  }

  return registry;
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   wrappersRoot: string,
 *   promptsRoot: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 *   wrapperRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 *   promptRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 * }} options
 */
function resolveAssetBundleForStepWithRegistry(options) {
  const routeResolution = resolveRouteForStep({
    projectProfilePath: options.projectProfilePath,
    routesRoot: options.routesRoot,
    stepClass: options.stepClass,
    stepOverrides: options.routeOverrides,
  });

  const loadedProfile = loadContractFile({
    filePath: options.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${options.projectProfilePath}' failed contract validation.`);
  }
  const profile = asRecord(loadedProfile.document);

  const defaultWrappers = asRecord(profile.default_wrapper_profiles);
  const wrapperRouteClass = routeResolution.route_profile.route_class;
  const defaultWrapperRef = defaultWrappers[wrapperRouteClass];
  const wrapperOverrides = asRecord(options.wrapperOverrides ?? {});
  const wrapperOverrideRef = wrapperOverrides[options.stepClass];
  const wrapperRef =
    typeof wrapperOverrideRef === "string" && wrapperOverrideRef.length > 0
      ? wrapperOverrideRef
      : typeof defaultWrapperRef === "string" && defaultWrapperRef.length > 0
        ? defaultWrapperRef
        : null;

  if (!wrapperRef) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': missing wrapper source in step override and default_wrapper_profiles.${String(
        wrapperRouteClass,
      )}.`,
    );
  }

  const wrapperParsed = parseWrapperReference(wrapperRef);
  const wrapperEntry = options.wrapperRegistry.get(`${wrapperParsed.wrapperId}@v${wrapperParsed.version}`);
  if (!wrapperEntry) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': wrapper '${wrapperRef}' is not present in wrapper registry '${options.wrappersRoot}'.`,
    );
  }

  const promptBundleOverrides = asRecord(options.promptBundleOverrides ?? {});
  const promptOverrideRef = promptBundleOverrides[options.stepClass];
  const wrapperPromptRef = wrapperEntry.profile.prompt_bundle_ref;
  const promptBundleRef =
    typeof promptOverrideRef === "string" && promptOverrideRef.length > 0
      ? promptOverrideRef
      : typeof wrapperPromptRef === "string" && wrapperPromptRef.length > 0
        ? wrapperPromptRef
        : null;

  if (!promptBundleRef) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': wrapper '${wrapperRef}' has no prompt_bundle_ref and no step-level prompt override was provided.`,
    );
  }

  const promptParsed = parsePromptBundleReference(promptBundleRef);
  const promptEntry = options.promptRegistry.get(
    `prompt-bundle://${promptParsed.promptBundleId}@v${promptParsed.version}`,
  );
  if (!promptEntry) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': prompt bundle '${promptBundleRef}' is not present in prompt registry '${options.promptsRoot}'.`,
    );
  }

  return {
    step_class: options.stepClass,
    route: {
      ...routeResolution,
    },
    wrapper: {
      wrapper_ref: wrapperRef,
      resolution_source: {
        kind:
          typeof wrapperOverrideRef === "string" && wrapperOverrideRef.length > 0
            ? "step-override"
            : "project-default",
        field:
          typeof wrapperOverrideRef === "string" && wrapperOverrideRef.length > 0
            ? `wrapper_overrides.${options.stepClass}`
            : `default_wrapper_profiles.${String(wrapperRouteClass)}`,
      },
      profile_source: wrapperEntry.source,
      profile: {
        wrapper_id: wrapperEntry.profile.wrapper_id,
        version: wrapperEntry.profile.version,
        step_class: wrapperEntry.profile.step_class,
        prompt_bundle_ref: wrapperEntry.profile.prompt_bundle_ref,
      },
    },
    prompt_bundle: {
      prompt_bundle_ref: promptBundleRef,
      resolution_source: {
        kind:
          typeof promptOverrideRef === "string" && promptOverrideRef.length > 0
            ? "step-override"
            : "wrapper-default",
        field:
          typeof promptOverrideRef === "string" && promptOverrideRef.length > 0
            ? `prompt_bundle_overrides.${options.stepClass}`
            : "wrapper.prompt_bundle_ref",
      },
      profile_source: promptEntry.source,
      profile: {
        prompt_bundle_id: promptEntry.profile.prompt_bundle_id,
        version: promptEntry.profile.version,
        step_class: promptEntry.profile.step_class,
      },
    },
    provenance: {
      project_profile_path: options.projectProfilePath,
      route_profile_source: routeResolution.route_profile_source,
      wrapper_profile_source: wrapperEntry.source,
      prompt_bundle_source: promptEntry.source,
    },
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   wrappersRoot: string,
 *   promptsRoot: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAssetBundleForStep(options) {
  const wrapperRegistry = buildWrapperRegistry({ wrappersRoot: options.wrappersRoot });
  const promptRegistry = buildPromptRegistry({ promptsRoot: options.promptsRoot });

  return resolveAssetBundleForStepWithRegistry({
    ...options,
    wrapperRegistry,
    promptRegistry,
  });
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   wrappersRoot: string,
 *   promptsRoot: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 * }} options
 */
export function resolveAssetBundleMatrix(options) {
  const wrapperRegistry = buildWrapperRegistry({ wrappersRoot: options.wrappersRoot });
  const promptRegistry = buildPromptRegistry({ promptsRoot: options.promptsRoot });

  return SUPPORTED_STEP_CLASSES.map((stepClass) =>
    resolveAssetBundleForStepWithRegistry({
      ...options,
      stepClass,
      wrapperRegistry,
      promptRegistry,
    }),
  );
}
