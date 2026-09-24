import fs from "node:fs";
import path from "node:path";

import {
  CliUsageError,
  confirmAndStartIntent,
  connectProjectSourceSync,
  createIntentSubmission,
  createLocalProjectRegistry,
  exportEvidence,
  findIntentSubmissionProject,
  materializeProjectConfig,
  prepareIntentSubmission,
  readIntentSubmission,
  selectIntentExecutionRoute,
  resolveOptionalBooleanFlag,
  resolveOptionalStringFlag,
  summarizeProjectContext,
} from "../command-runtime.mjs";

export const INTENT_COMMANDS = Object.freeze([
  "project connect",
  "project materialize-config",
  "task prepare",
  "task start",
  "evidence export",
]);

export const INTENT_COMMAND_GROUP = Object.freeze({ group_id: "intent-first", commands: INTENT_COMMANDS });

function registry(cwd) {
  return createLocalProjectRegistry({ cwd, projects: [], persistence: { mode: "persistent" } });
}

function strings(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function handleIntentCommand({ command, flags, cwd, outputState }) {
  if (!INTENT_COMMANDS.includes(command)) return false;
  const workspace = registry(cwd);
  if (command === "project connect") {
    const localPath = resolveOptionalStringFlag("path", flags.path);
    const gitUrl = resolveOptionalStringFlag("git", flags.git);
    if (Boolean(localPath) === Boolean(gitUrl)) throw new CliUsageError("Use exactly one of '--path <dir>' or '--git <url>'.");
    const connected = connectProjectSourceSync({
      registry: workspace,
      source: localPath ? { kind: "local", path: localPath } : { kind: "git", url: gitUrl },
      label: resolveOptionalStringFlag("label", flags.label),
    });
    outputState.project = summarizeProjectContext(connected.context);
    outputState.source = connected.source;
    outputState.source_summary = connected.source_summary;
    return true;
  }
  let projectId = resolveOptionalStringFlag("project-id", flags["project-id"]);
  if (command === "task start" && !projectId) {
    const submissionId = resolveOptionalStringFlag("submission-id", flags["submission-id"]);
    if (!submissionId) throw new CliUsageError("Missing required flag '--submission-id' for 'aor task start'.");
    projectId = findIntentSubmissionProject({ registry: workspace, submissionId });
  }
  if (!projectId) throw new CliUsageError(`Missing required flag '--project-id' for 'aor ${command}'.`);
  if (command === "project materialize-config") {
    outputState.materialization = materializeProjectConfig({ registry: workspace, projectId });
    return true;
  }
  if (command === "task prepare") {
    const attachments = strings(flags.file).map((file) => ({ name: path.basename(file), content: fs.readFileSync(path.resolve(cwd, file), "utf8") }));
    const result = createIntentSubmission({
      registry: workspace,
      projectId,
      requestText: resolveOptionalStringFlag("request", flags.request) ?? "",
      attachments,
      sourceSubmissionId: resolveOptionalStringFlag("source-submission-id", flags["source-submission-id"]) ?? null,
      sourceIds: strings(flags["source-id"]),
      autoPrepare: false,
      preflightPreparation: true,
      preparationRouteId: resolveOptionalStringFlag("preparation-route", flags["preparation-route"]) ?? undefined,
    });
    outputState.intentSubmission = result.submission;
    outputState.statusRef = `intent-submission://${result.submission.submission_id}`;
    try {
      const prepared = prepareIntentSubmission({ registry: workspace, projectId, submissionId: result.submission.submission_id });
      outputState.intentSubmission = prepared.submission;
      outputState.intentNormalization = prepared.report;
    } catch (error) {
      outputState.prepareBlocker = { code: error?.code ?? "intent_prepare.failed", message: error instanceof Error ? error.message : String(error) };
    }
    return true;
  }
  if (command === "task start") {
    const submissionId = resolveOptionalStringFlag("submission-id", flags["submission-id"]);
    if (!submissionId) throw new CliUsageError("Missing required flag '--submission-id' for 'aor task start'.");
    const current = readIntentSubmission({ registry: workspace, projectId, submissionId });
    const expectedRevisionValue = resolveOptionalStringFlag("expected-revision", flags["expected-revision"]);
    let expectedRevision = expectedRevisionValue === undefined ? undefined : Number(expectedRevisionValue);
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      throw new CliUsageError("Flag '--expected-revision' must be a non-negative integer.");
    }
    expectedRevision ??= current.normalization?.revision;
    const routeId = resolveOptionalStringFlag("route", flags.route);
    const useProjectDefault = resolveOptionalBooleanFlag("use-project-default", flags["use-project-default"]);
    if (routeId && useProjectDefault) {
      throw new CliUsageError("Choose either '--route <route_id>' or '--use-project-default true' for 'aor task start'.");
    }
    let expectedSelectionRevision = Number.isInteger(current.submission.runner_selection_revision)
      ? current.submission.runner_selection_revision
      : 0;
    let runnerSelection = current.submission.execution_route_override ?? null;
    if (routeId || useProjectDefault) {
      const selected = selectIntentExecutionRoute({
        registry: workspace,
        projectId,
        submissionId,
        routeId: useProjectDefault ? null : routeId,
        expectedRevision,
        expectedSelectionRevision,
      });
      expectedSelectionRevision = Number.isInteger(selected.submission.runner_selection_revision)
        ? selected.submission.runner_selection_revision
        : expectedSelectionRevision;
      runnerSelection = selected.submission.execution_route_override ?? null;
    }
    outputState.runnerSelection = runnerSelection;
    outputState.taskStart = confirmAndStartIntent({ registry: workspace, projectId, submissionId, expectedRevision, expectedSelectionRevision });
    return true;
  }
  const flowId = resolveOptionalStringFlag("flow-id", flags["flow-id"]);
  const refs = strings(flags["evidence-ref"]);
  if (!flowId || refs.length === 0) throw new CliUsageError("Evidence export requires '--flow-id' and at least one '--evidence-ref'.");
  outputState.evidence_export = exportEvidence({
    registry: workspace,
    projectId,
    flowId,
    exportId: resolveOptionalStringFlag("export-id", flags["export-id"]),
    evidenceRefs: refs,
  });
  return true;
}
