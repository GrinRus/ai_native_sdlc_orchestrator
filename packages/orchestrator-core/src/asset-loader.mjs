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
 * @param {string} reference
 * @returns {{ contextBundleId: string, version: number }}
 */
function parseContextBundleReference(reference) {
  const match = /^context-bundle:\/\/([^@]+)@v(\d+)$/u.exec(reference);
  if (!match) {
    throw new Error(
      `Invalid context bundle reference '${reference}'. Expected 'context-bundle://<bundle_id>@v<version>'.`,
    );
  }
  return {
    contextBundleId: match[1],
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
 * @param {{ contextBundlesRoot: string }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
function buildContextBundleRegistry(options) {
  if (!fs.existsSync(options.contextBundlesRoot)) {
    throw new Error(`Context bundle registry root '${options.contextBundlesRoot}' does not exist.`);
  }

  const registry = new Map();
  const entries = fs
    .readdirSync(options.contextBundlesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of entries) {
    const source = path.join(options.contextBundlesRoot, fileName);
    const loaded = loadContractFile({
      filePath: source,
      family: "context-bundle",
    });
    if (!loaded.ok) {
      throw new Error(`Context bundle '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const contextBundleId = profile.context_bundle_id;
    const version = profile.version;
    if (typeof contextBundleId !== "string" || typeof version !== "number") {
      throw new Error(`Context bundle '${source}' is missing context_bundle_id/version.`);
    }

    const registryKey = `context-bundle://${contextBundleId}@v${version}`;
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
 *   contextBundlesRoot: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
  *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 *   wrapperRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 *   promptRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 *   contextBundleRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
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

  const defaultPromptBundles = asRecord(profile.default_prompt_bundles);
  const promptBundleOverrides = asRecord(options.promptBundleOverrides ?? {});
  const promptOverrideRef = promptBundleOverrides[options.stepClass];
  const defaultPromptRef = defaultPromptBundles[options.stepClass];
  const usePromptOverride = typeof promptOverrideRef === "string" && promptOverrideRef.length > 0;
  const useProjectDefault = typeof defaultPromptRef === "string" && defaultPromptRef.length > 0;
  const promptBundleRef =
    usePromptOverride ? promptOverrideRef : useProjectDefault ? defaultPromptRef : null;

  if (!promptBundleRef) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': missing prompt bundle source in step override and default_prompt_bundles.${options.stepClass}.`,
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

  const defaultContextBundles = asRecord(profile.default_context_bundles);
  const contextBundleOverrides = asRecord(options.contextBundleOverrides ?? {});
  const contextOverrideRefs = contextBundleOverrides[options.stepClass];
  const contextDefaultRefs = defaultContextBundles[options.stepClass];
  const normalizedContextOverrideRefs = Array.isArray(contextOverrideRefs)
    ? contextOverrideRefs.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const normalizedContextDefaultRefs = Array.isArray(contextDefaultRefs)
    ? contextDefaultRefs.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const useContextOverride = normalizedContextOverrideRefs.length > 0;
  const contextBundleRefs = useContextOverride ? normalizedContextOverrideRefs : normalizedContextDefaultRefs;

  if (contextBundleRefs.length === 0) {
    throw new Error(
      `Asset resolution failed for step '${options.stepClass}': missing context bundles in step override and default_context_bundles.${options.stepClass}.`,
    );
  }

  const contextBundleEntries = contextBundleRefs.map((contextBundleRef) => {
    const parsed = parseContextBundleReference(contextBundleRef);
    const normalizedRef = `context-bundle://${parsed.contextBundleId}@v${parsed.version}`;
    const entry = options.contextBundleRegistry.get(normalizedRef);
    if (!entry) {
      throw new Error(
        `Asset resolution failed for step '${options.stepClass}': context bundle '${contextBundleRef}' is not present in context bundle registry '${options.contextBundlesRoot}'.`,
      );
    }

    const contextDocRefs = Array.isArray(entry.profile.context_doc_refs)
      ? entry.profile.context_doc_refs.filter((item) => typeof item === "string")
      : [];
    const contextRuleRefs = Array.isArray(entry.profile.context_rule_refs)
      ? entry.profile.context_rule_refs.filter((item) => typeof item === "string")
      : [];
    const contextSkillRefs = Array.isArray(entry.profile.context_skill_refs)
      ? entry.profile.context_skill_refs.filter((item) => typeof item === "string")
      : [];
    return {
      context_bundle_ref: normalizedRef,
      profile_source: entry.source,
      profile: {
        context_bundle_id: entry.profile.context_bundle_id,
        version: entry.profile.version,
        context_doc_refs: contextDocRefs,
        context_rule_refs: contextRuleRefs,
        context_skill_refs: contextSkillRefs,
      },
      context_doc_refs: contextDocRefs,
      context_rule_refs: contextRuleRefs,
      context_skill_refs: contextSkillRefs,
    };
  });

  const expandedContextDocRefs = [...new Set(contextBundleEntries.flatMap((entry) => entry.context_doc_refs))];
  const expandedContextRuleRefs = [...new Set(contextBundleEntries.flatMap((entry) => entry.context_rule_refs))];
  const expandedContextSkillRefs = [...new Set(contextBundleEntries.flatMap((entry) => entry.context_skill_refs))];

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
      },
    },
    prompt_bundle: {
      prompt_bundle_ref: promptBundleRef,
      resolution_source: {
        kind: usePromptOverride ? "step-override" : "project-default",
        field: usePromptOverride
          ? `prompt_bundle_overrides.${options.stepClass}`
          : `default_prompt_bundles.${options.stepClass}`,
      },
      profile_source: promptEntry.source,
      profile: {
        prompt_bundle_id: promptEntry.profile.prompt_bundle_id,
        version: promptEntry.profile.version,
        step_class: promptEntry.profile.step_class,
        required_inputs: asRecord(promptEntry.profile.required_inputs),
      },
    },
    context_bundles: {
      bundle_refs: contextBundleEntries.map((entry) => entry.context_bundle_ref),
      resolution_source: {
        kind: useContextOverride ? "step-override" : "project-default",
        field: useContextOverride
          ? `context_bundle_overrides.${options.stepClass}`
          : `default_context_bundles.${options.stepClass}`,
      },
      bundles: contextBundleEntries,
      expanded_refs: {
        context_doc_refs: expandedContextDocRefs,
        context_rule_refs: expandedContextRuleRefs,
        context_skill_refs: expandedContextSkillRefs,
      },
    },
    provenance: {
      project_profile_path: options.projectProfilePath,
      route_profile_source: routeResolution.route_profile_source,
      wrapper_profile_source: wrapperEntry.source,
      prompt_bundle_source: promptEntry.source,
      context_bundle_sources: contextBundleEntries.map((entry) => entry.profile_source),
    },
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   wrappersRoot: string,
 *   promptsRoot: string,
 *   contextBundlesRoot?: string,
 *   stepClass: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
  *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 * }} options
 */
export function resolveAssetBundleForStep(options) {
  const wrapperRegistry = buildWrapperRegistry({ wrappersRoot: options.wrappersRoot });
  const promptRegistry = buildPromptRegistry({ promptsRoot: options.promptsRoot });
  const contextBundleRegistry = buildContextBundleRegistry({
    contextBundlesRoot: options.contextBundlesRoot ?? path.join(path.dirname(options.projectProfilePath), "context/bundles"),
  });

  return resolveAssetBundleForStepWithRegistry({
    ...options,
    contextBundlesRoot:
      options.contextBundlesRoot ?? path.join(path.dirname(options.projectProfilePath), "context/bundles"),
    wrapperRegistry,
    promptRegistry,
    contextBundleRegistry,
  });
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   routesRoot: string,
 *   wrappersRoot: string,
 *   promptsRoot: string,
 *   contextBundlesRoot?: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
  *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 * }} options
 */
export function resolveAssetBundleMatrix(options) {
  const wrapperRegistry = buildWrapperRegistry({ wrappersRoot: options.wrappersRoot });
  const promptRegistry = buildPromptRegistry({ promptsRoot: options.promptsRoot });
  const contextBundleRegistry = buildContextBundleRegistry({
    contextBundlesRoot: options.contextBundlesRoot ?? path.join(path.dirname(options.projectProfilePath), "context/bundles"),
  });
  const contextBundlesRoot =
    options.contextBundlesRoot ?? path.join(path.dirname(options.projectProfilePath), "context/bundles");

  return SUPPORTED_STEP_CLASSES.map((stepClass) =>
    resolveAssetBundleForStepWithRegistry({
      ...options,
      contextBundlesRoot,
      stepClass,
      wrapperRegistry,
      promptRegistry,
      contextBundleRegistry,
    }),
  );
}
