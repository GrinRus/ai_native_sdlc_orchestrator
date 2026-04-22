import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";

const ROUTE_STEP_VALUES = Object.freeze([
  "discovery",
  "research",
  "spec",
  "planning",
  "implement",
  "review",
  "qa",
  "repair",
  "eval",
  "harness",
]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values)];
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isVersionedRef(value) {
  return /^[A-Za-z0-9._-]+@v\d+$/u.test(value);
}

/**
 * @param {{ skillsRoot: string }} options
 * @returns {Map<string, { profile: Record<string, unknown>, source: string }>}
 */
export function buildSkillRegistry(options) {
  if (!fs.existsSync(options.skillsRoot)) {
    throw new Error(`Skill registry root '${options.skillsRoot}' does not exist.`);
  }

  const entries = fs
    .readdirSync(options.skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const registry = new Map();
  for (const fileName of entries) {
    const source = path.join(options.skillsRoot, fileName);
    const loaded = loadContractFile({
      filePath: source,
      family: "skill-profile",
    });
    if (!loaded.ok) {
      throw new Error(`Skill profile '${source}' failed contract validation.`);
    }

    const profile = asRecord(loaded.document);
    const skillId = profile.skill_id;
    const version = profile.version;
    const stepClass = profile.step_class;

    if (typeof skillId !== "string" || skillId.trim().length === 0) {
      throw new Error(`Skill profile '${source}' is missing skill_id.`);
    }
    if (typeof version !== "number" || Number.isFinite(version) === false) {
      throw new Error(`Skill profile '${source}' is missing version.`);
    }
    if (typeof stepClass !== "string" || stepClass.trim().length === 0) {
      throw new Error(`Skill profile '${source}' is missing step_class.`);
    }

    const skillRef = `${skillId}@v${version}`;
    if (registry.has(skillRef)) {
      throw new Error(`Skill ref '${skillRef}' is declared more than once in skill registry.`);
    }

    registry.set(skillRef, { profile, source });
  }

  return registry;
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   stepClass: string,
 *   routeClass: string,
 *   skillsRoot: string,
 *   skillRegistry: Map<string, { profile: Record<string, unknown>, source: string }>,
 *   skillOverrides?: Record<string, string[]>,
 * }} options
 */
function resolveSkillsForStepWithRegistry(options) {
  const loadedProfile = loadContractFile({
    filePath: options.projectProfilePath,
    family: "project-profile",
  });
  if (!loadedProfile.ok) {
    throw new Error(`Project profile '${options.projectProfilePath}' failed contract validation.`);
  }

  const profile = asRecord(loadedProfile.document);
  const defaultSkillProfiles = asRecord(profile.default_skill_profiles);
  const profileSkillOverrides = asRecord(profile.skill_overrides);
  const runtimeSkillOverrides = asRecord(options.skillOverrides ?? {});

  for (const key of Object.keys(runtimeSkillOverrides)) {
    if (!ROUTE_STEP_VALUES.includes(key)) {
      throw new Error(
        `Unknown skill override '${key}'. Expected one of: ${ROUTE_STEP_VALUES.join(", ")}.`,
      );
    }
  }

  const runtimeOverrideRefs = asStringArray(runtimeSkillOverrides[options.stepClass]);
  const profileOverrideRefs = asStringArray(profileSkillOverrides[options.stepClass]);
  const projectDefaultRefs = asStringArray(defaultSkillProfiles[options.routeClass]);

  let resolvedSkillRefs = projectDefaultRefs;
  let resolutionSource = {
    kind: "project-default",
    field: `default_skill_profiles.${options.routeClass}`,
  };

  if (profileOverrideRefs.length > 0) {
    resolvedSkillRefs = profileOverrideRefs;
    resolutionSource = {
      kind: "step-override",
      field: `skill_overrides.${options.stepClass}`,
    };
  }

  if (runtimeOverrideRefs.length > 0) {
    resolvedSkillRefs = runtimeOverrideRefs;
    resolutionSource = {
      kind: "step-override",
      field: `runtime_skill_overrides.${options.stepClass}`,
    };
  }

  const uniqueSkillRefs = uniqueStrings(resolvedSkillRefs);
  const resolvedSkills = [];
  /** @type {string[]} */
  const profileSources = [];

  for (const skillRef of uniqueSkillRefs) {
    if (!isVersionedRef(skillRef)) {
      throw new Error(
        `Skill resolution failed for step '${options.stepClass}': skill ref '${skillRef}' from ${resolutionSource.field} must use skill_id@vN format.`,
      );
    }

    const registryEntry = options.skillRegistry.get(skillRef);
    if (!registryEntry) {
      throw new Error(
        `Skill resolution failed for step '${options.stepClass}': skill '${skillRef}' from ${resolutionSource.field} is not present in skill registry '${options.skillsRoot}'.`,
      );
    }

    const skillStepClass = registryEntry.profile.step_class;
    if (skillStepClass !== options.routeClass) {
      throw new Error(
        `Skill resolution conflict for step '${options.stepClass}': skill '${skillRef}' from ${resolutionSource.field} has step_class '${String(skillStepClass)}', expected '${options.routeClass}'.`,
      );
    }

    resolvedSkills.push({
      skill_ref: skillRef,
      profile_source: registryEntry.source,
      profile: {
        skill_id: registryEntry.profile.skill_id,
        version: registryEntry.profile.version,
        step_class: registryEntry.profile.step_class,
        summary: registryEntry.profile.summary,
        activation_hints: asStringArray(registryEntry.profile.activation_hints),
        workflow: Array.isArray(registryEntry.profile.workflow)
          ? registryEntry.profile.workflow.map((entry) => asRecord(entry))
          : [],
        required_inputs: asRecord(registryEntry.profile.required_inputs),
        expected_outputs: asStringArray(registryEntry.profile.expected_outputs),
      },
    });
    profileSources.push(registryEntry.source);
  }

  return {
    step_class: options.stepClass,
    route_class: options.routeClass,
    skill_refs: uniqueSkillRefs,
    resolution_source: uniqueSkillRefs.length > 0 ? resolutionSource : { kind: "none", field: null },
    skills: resolvedSkills,
    provenance: {
      project_profile_path: options.projectProfilePath,
      skill_profile_sources: uniqueStrings(profileSources),
    },
  };
}

/**
 * @param {{
 *   projectProfilePath: string,
 *   stepClass: string,
 *   routeClass: string,
 *   skillsRoot: string,
 *   skillOverrides?: Record<string, string[]>,
 * }} options
 */
export function resolveSkillsForStep(options) {
  const skillRegistry = buildSkillRegistry({
    skillsRoot: options.skillsRoot,
  });

  return resolveSkillsForStepWithRegistry({
    ...options,
    skillRegistry,
  });
}
