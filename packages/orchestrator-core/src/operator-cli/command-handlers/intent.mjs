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
      autoPrepare: false,
    });
    outputState.intent_submission = result.submission;
    outputState.status_ref = `intent-submission://${result.submission.submission_id}`;
    try {
      const prepared = prepareIntentSubmission({ registry: workspace, projectId, submissionId: result.submission.submission_id });
      outputState.intent_submission = prepared.submission;
      outputState.intent_normalization = prepared.report;
    } catch (error) {
      outputState.prepare_blocker = { code: error?.code ?? "intent_prepare.failed", message: error instanceof Error ? error.message : String(error) };
    }
    return true;
  }
  if (command === "task start") {
    const submissionId = resolveOptionalStringFlag("submission-id", flags["submission-id"]);
    if (!submissionId) throw new CliUsageError("Missing required flag '--submission-id' for 'aor task start'.");
    outputState.task_start = confirmAndStartIntent({ registry: workspace, projectId, submissionId });
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
