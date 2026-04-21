import path from "node:path";

import { loadExampleContracts } from "../../contracts/src/index.mjs";

const SUPPORTED_SUBJECT_TYPES = new Set(["run", "wrapper", "route", "adapter"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{
 *   workspaceRoot: string,
 *   examplesRoot: string,
 *   source: string,
 *   code: string,
 *   message: string,
 *   suiteRef?: string | null,
 *   datasetRef?: string | null,
 *   expected?: string | null,
 *   actual?: string | null,
 * }} options
 * @returns {{
 *   code: string,
 *   source: string,
 *   suite_ref: string | null,
 *   dataset_ref: string | null,
 *   expected: string | null,
 *   actual: string | null,
 *   message: string,
 * }}
 */
function registryIssue(options) {
  return {
    code: options.code,
    source: path.relative(options.workspaceRoot, options.source) || options.source,
    suite_ref: options.suiteRef ?? null,
    dataset_ref: options.datasetRef ?? null,
    expected: options.expected ?? null,
    actual: options.actual ?? null,
    message: options.message,
  };
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function toDatasetRef(document) {
  const datasetId = document.dataset_id;
  const version = document.version;
  if (typeof datasetId !== "string" || typeof version !== "string") {
    return null;
  }
  return `dataset://${datasetId}@${version}`;
}

/**
 * @param {Record<string, unknown>} document
 * @returns {string | null}
 */
function toSuiteRef(document) {
  const suiteId = document.suite_id;
  const version = document.version;
  if (typeof suiteId !== "string" || typeof version !== "number") {
    return null;
  }
  return `${suiteId}@v${version}`;
}

/**
 * @param {{
 *   workspaceRoot?: string,
 *   examplesRoot?: string,
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   workspaceRoot: string,
 *   examplesRoot: string,
 *   datasets: Array<{ dataset_ref: string, dataset_id: string, version: string, subject_type: string | null, source: string }>,
 *   suites: Array<{ suite_ref: string, suite_id: string, version: number, subject_type: string | null, dataset_ref: string | null, source: string }>,
 *   issues: Array<{
 *     code: string,
 *     source: string,
 *     suite_ref: string | null,
 *     dataset_ref: string | null,
 *     expected: string | null,
 *     actual: string | null,
 *     message: string,
 *   }>,
 * }}
 */
export function loadEvaluationRegistry(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const examplesRoot = path.resolve(workspaceRoot, options.examplesRoot ?? "examples");
  const loaded = loadExampleContracts({ workspaceRoot, examplesRoot: options.examplesRoot });

  /** @type {Array<{ dataset_ref: string, dataset_id: string, version: string, subject_type: string | null, source: string }>} */
  const datasets = [];
  /** @type {Array<{ suite_ref: string, suite_id: string, version: number, subject_type: string | null, dataset_ref: string | null, source: string }>} */
  const suites = [];
  /** @type {Array<{ code: string, source: string, suite_ref: string | null, dataset_ref: string | null, expected: string | null, actual: string | null, message: string }>} */
  const issues = [];

  /** @type {Map<string, { dataset_ref: string, dataset_id: string, version: string, subject_type: string | null, source: string }>} */
  const datasetsByRef = new Map();
  /** @type {Map<string, { suite_ref: string, suite_id: string, version: number, subject_type: string | null, dataset_ref: string | null, source: string }>} */
  const suitesByRef = new Map();

  for (const result of loaded.results) {
    if (!result.ok || !result.family || !isPlainObject(result.document)) {
      continue;
    }

    const source = path.relative(workspaceRoot, result.source) || result.source;
    const document = result.document;

    if (result.family === "dataset") {
      const datasetRef = toDatasetRef(document);
      if (!datasetRef) {
        continue;
      }

      const datasetEntry = {
        dataset_ref: datasetRef,
        dataset_id: /** @type {string} */ (document.dataset_id),
        version: /** @type {string} */ (document.version),
        subject_type: typeof document.subject_type === "string" ? document.subject_type : null,
        source,
      };

      if (datasetsByRef.has(datasetRef)) {
        issues.push(
          registryIssue({
            workspaceRoot,
            examplesRoot,
            source: result.source,
            code: "dataset_duplicate_ref",
            datasetRef,
            expected: "unique dataset ref",
            actual: "duplicate ref",
            message: `Dataset ref '${datasetRef}' is defined more than once.`,
          }),
        );
        continue;
      }

      datasetsByRef.set(datasetRef, datasetEntry);
      datasets.push(datasetEntry);
      continue;
    }

    if (result.family === "evaluation-suite") {
      const suiteRef = toSuiteRef(document);
      if (!suiteRef) {
        continue;
      }

      const suiteEntry = {
        suite_ref: suiteRef,
        suite_id: /** @type {string} */ (document.suite_id),
        version: /** @type {number} */ (document.version),
        subject_type: typeof document.subject_type === "string" ? document.subject_type : null,
        dataset_ref: typeof document.dataset_ref === "string" ? document.dataset_ref : null,
        source,
      };

      if (suitesByRef.has(suiteRef)) {
        issues.push(
          registryIssue({
            workspaceRoot,
            examplesRoot,
            source: result.source,
            code: "suite_duplicate_ref",
            suiteRef,
            expected: "unique suite ref",
            actual: "duplicate ref",
            message: `Suite ref '${suiteRef}' is defined more than once.`,
          }),
        );
        continue;
      }

      suitesByRef.set(suiteRef, suiteEntry);
      suites.push(suiteEntry);
    }
  }

  for (const suite of suites) {
    if (!suite.dataset_ref) {
      issues.push(
        registryIssue({
          workspaceRoot,
          examplesRoot,
          source: path.resolve(workspaceRoot, suite.source),
          code: "suite_dataset_ref_missing",
          suiteRef: suite.suite_ref,
          expected: "dataset://dataset_id@version",
          actual: "null",
          message: `Suite '${suite.suite_ref}' does not declare a dataset_ref.`,
        }),
      );
      continue;
    }

    const dataset = datasetsByRef.get(suite.dataset_ref);
    if (!dataset) {
      issues.push(
        registryIssue({
          workspaceRoot,
          examplesRoot,
          source: path.resolve(workspaceRoot, suite.source),
          code: "suite_dataset_ref_missing_target",
          suiteRef: suite.suite_ref,
          datasetRef: suite.dataset_ref,
          expected: "existing dataset ref",
          actual: "missing dataset",
          message: `Suite '${suite.suite_ref}' references missing dataset '${suite.dataset_ref}'.`,
        }),
      );
      continue;
    }

    if (suite.subject_type && !SUPPORTED_SUBJECT_TYPES.has(suite.subject_type)) {
      issues.push(
        registryIssue({
          workspaceRoot,
          examplesRoot,
          source: path.resolve(workspaceRoot, suite.source),
          code: "suite_subject_type_unknown",
          suiteRef: suite.suite_ref,
          datasetRef: suite.dataset_ref,
          expected: [...SUPPORTED_SUBJECT_TYPES].join("|"),
          actual: suite.subject_type,
          message: `Suite '${suite.suite_ref}' has unsupported subject_type '${suite.subject_type}'.`,
        }),
      );
    }

    if (dataset.subject_type && !SUPPORTED_SUBJECT_TYPES.has(dataset.subject_type)) {
      issues.push(
        registryIssue({
          workspaceRoot,
          examplesRoot,
          source: path.resolve(workspaceRoot, dataset.source),
          code: "dataset_subject_type_unknown",
          suiteRef: suite.suite_ref,
          datasetRef: suite.dataset_ref,
          expected: [...SUPPORTED_SUBJECT_TYPES].join("|"),
          actual: dataset.subject_type,
          message: `Dataset '${suite.dataset_ref}' has unsupported subject_type '${dataset.subject_type}'.`,
        }),
      );
    }

    if (suite.subject_type && dataset.subject_type && suite.subject_type !== dataset.subject_type) {
      issues.push(
        registryIssue({
          workspaceRoot,
          examplesRoot,
          source: path.resolve(workspaceRoot, suite.source),
          code: "suite_dataset_subject_type_mismatch",
          suiteRef: suite.suite_ref,
          datasetRef: suite.dataset_ref,
          expected: suite.subject_type,
          actual: dataset.subject_type,
          message: `Suite '${suite.suite_ref}' subject_type '${suite.subject_type}' does not match dataset '${suite.dataset_ref}' subject_type '${dataset.subject_type}'.`,
        }),
      );
    }
  }

  datasets.sort((left, right) => left.dataset_ref.localeCompare(right.dataset_ref));
  suites.sort((left, right) => left.suite_ref.localeCompare(right.suite_ref));

  return {
    ok: issues.length === 0,
    workspaceRoot,
    examplesRoot,
    datasets,
    suites,
    issues,
  };
}

/**
 * @param {{
 *   suites: Array<{ suite_ref: string, suite_id: string, version: number, subject_type: string | null, dataset_ref: string | null, source: string }>,
 *   datasets: Array<{ dataset_ref: string, dataset_id: string, version: string, subject_type: string | null, source: string }>,
 * }} registry
 * @param {string} suiteRef
 * @returns {{ suite: { suite_ref: string, suite_id: string, version: number, subject_type: string | null, dataset_ref: string | null, source: string }, dataset: { dataset_ref: string, dataset_id: string, version: string, subject_type: string | null, source: string } | null }}
 */
export function resolveSuiteWithDataset(registry, suiteRef) {
  const suite = registry.suites.find((candidate) => candidate.suite_ref === suiteRef);
  if (!suite) {
    throw new Error(`Suite '${suiteRef}' was not found in evaluation registry.`);
  }

  if (!suite.dataset_ref) {
    return {
      suite,
      dataset: null,
    };
  }

  const dataset = registry.datasets.find((candidate) => candidate.dataset_ref === suite.dataset_ref) ?? null;
  return {
    suite,
    dataset,
  };
}
