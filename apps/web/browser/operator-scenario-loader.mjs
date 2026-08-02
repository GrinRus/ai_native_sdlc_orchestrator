import fs from "node:fs";

const ACTION_CATEGORIES = new Set(["mutation", "workbench", "evidence", "copy", "refresh", "unavailable"]);
const REQUIRED_FIELDS = ["id", "title", "entry_state", "authoritative_evidence", "primary_action", "blockers", "expected_recovery", "success_signal", "coverage"];

export function validateOperatorScenarioCatalog(catalog) {
  const errors = [];
  if (catalog?.schema_version !== 1) errors.push("catalog schema_version must be 1");
  if (catalog?.external_network !== false) errors.push("catalog must disable external network");
  if (catalog?.upstream_writes !== false) errors.push("catalog must disable upstream writes");
  const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
  const ids = new Set();
  for (const scenario of scenarios) {
    for (const field of REQUIRED_FIELDS) if (scenario?.[field] === undefined) errors.push(`${scenario?.id ?? "unknown"}: missing ${field}`);
    if (ids.has(scenario.id)) errors.push(`${scenario.id}: duplicate id`);
    ids.add(scenario.id);
    const action = scenario.primary_action ?? {};
    if (!ACTION_CATEGORIES.has(action.category)) errors.push(`${scenario.id}: unknown action category`);
    if (!String(action.label ?? "").trim()) errors.push(`${scenario.id}: action label is required`);
    if (action.category === "copy" && !/^Copy\b/u.test(action.label)) errors.push(`${scenario.id}: copy action must begin with Copy`);
    if (action.category === "workbench" && !/^(Open|Review|Inspect)\b/u.test(action.label)) errors.push(`${scenario.id}: workbench action must name its navigation effect`);
    if (action.category === "refresh" && !/^(Refresh|Check|Resolve)\b/u.test(action.label)) errors.push(`${scenario.id}: refresh action must name its read effect`);
    if (action.category === "unavailable" && scenario.blockers.length === 0) errors.push(`${scenario.id}: unavailable action requires a blocker`);
    if (action.category !== "unavailable" && !action.operation) errors.push(`${scenario.id}: available action requires an operation`);
    if (!Array.isArray(scenario.authoritative_evidence) || scenario.authoritative_evidence.length === 0) errors.push(`${scenario.id}: authoritative evidence is required`);
    if (!Array.isArray(scenario.coverage?.viewports) || scenario.coverage.viewports.length === 0) errors.push(`${scenario.id}: viewport coverage is required`);
    if (typeof scenario.coverage?.keyboard !== "boolean") errors.push(`${scenario.id}: keyboard coverage must be explicit`);
  }
  return { ok: errors.length === 0, errors, scenarios };
}

export function loadOperatorScenarioCatalog(url = new URL("./fixtures/operator-scenarios.json", import.meta.url)) {
  const catalog = JSON.parse(fs.readFileSync(url, "utf8"));
  const validation = validateOperatorScenarioCatalog(catalog);
  if (!validation.ok) throw new Error(`Invalid operator scenario catalog:\n${validation.errors.join("\n")}`);
  return catalog;
}

export function validateOperatorAcceptanceFixtures(manifest, catalog) {
  const errors = [];
  if (manifest?.schema_version !== 1) errors.push("acceptance fixture schema_version must be 1");
  if (manifest?.catalog_id !== catalog?.catalog_id) errors.push("acceptance fixture catalog_id must match the scenario catalog");
  if (manifest?.package_mode !== "installed-tarball") errors.push("acceptance fixtures must use the installed tarball");
  if (manifest?.transport !== "loopback-same-origin") errors.push("acceptance fixtures must use loopback same-origin transport");
  const scenarioIds = new Set((catalog?.scenarios ?? []).map((scenario) => scenario.id));
  const fixtureIds = new Set();
  for (const fixture of manifest?.fixtures ?? []) {
    if (!scenarioIds.has(fixture.scenario_id)) errors.push(`${fixture.scenario_id}: fixture has no catalog scenario`);
    if (fixtureIds.has(fixture.scenario_id)) errors.push(`${fixture.scenario_id}: duplicate acceptance fixture`);
    fixtureIds.add(fixture.scenario_id);
    for (const field of ["expected_surfaces", "side_effects", "durable_readback"]) {
      if (!Array.isArray(fixture[field])) errors.push(`${fixture.scenario_id}: ${field} must be an array`);
    }
    if (!fixture.seed_profile) errors.push(`${fixture.scenario_id}: seed_profile is required`);
  }
  for (const scenarioId of scenarioIds) if (!fixtureIds.has(scenarioId)) errors.push(`${scenarioId}: acceptance fixture is missing`);
  if ((manifest?.viewports ?? []).length !== 7) errors.push("acceptance fixtures must declare the seven blocking viewports");
  for (const mode of ["keyboard-only", "reduced-motion", "zoom-200"]) {
    if (!manifest?.environment_modes?.includes(mode)) errors.push(`acceptance fixtures are missing ${mode}`);
  }
  return { ok: errors.length === 0, errors };
}

export function loadOperatorAcceptanceFixtures(url = new URL("./fixtures/operator-acceptance-fixtures.json", import.meta.url)) {
  const catalog = loadOperatorScenarioCatalog();
  const manifest = JSON.parse(fs.readFileSync(url, "utf8"));
  const validation = validateOperatorAcceptanceFixtures(manifest, catalog);
  if (!validation.ok) throw new Error(`Invalid operator acceptance fixtures:\n${validation.errors.join("\n")}`);
  return manifest;
}

export async function applyOperatorScenarioFixture(page, scenario) {
  await page.evaluate((fixture) => {
    window.__AOR_OPERATOR_SCENARIO__ = structuredClone(fixture);
  }, scenario);
  return page.evaluate(() => window.__AOR_OPERATOR_SCENARIO__);
}
