import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRepo } from "../../../scripts/test/helpers/temp-repo.mjs";
import { createLocalProjectRegistry } from "../src/control-plane/local-project-registry.mjs";
import {
  IntentServiceError,
  answerIntentQuestions,
  confirmIntent,
  confirmAndStartIntent,
  createIntentSubmission,
  prepareIntentSubmission,
  readIntentSubmission,
  listIntentSubmissions,
  reviseIntentSubmission,
} from "../src/intent-service.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("intent submission stores bounded text inputs under central AOR Home", async () => {
  await withTempRepo({ prefix: "aor-intent-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intent-home-"));
    try {
      const registry = createLocalProjectRegistry({
        cwd: projectRoot,
        projects: [{ projectRef: projectRoot }],
        persistence: { mode: "persistent", root: aorHome },
      });
      const projectId = registry.defaultProjectId;
      const created = createIntentSubmission({
        registry,
        projectId,
        requestText: "Add bounded timeout handling.",
        attachments: [{ name: "requirements.md", content: "# Acceptance\nTimeouts are reported consistently.\n" }],
        autoPrepare: false,
      });
      assert.equal(fs.existsSync(path.join(projectRoot, ".aor")), false);
      assert.equal(created.submission.attachments.length, 1);
      assert.ok(created.submission_file.startsWith(fs.realpathSync.native(aorHome)));
      const attachment = created.submission.attachments[0];
      assert.equal(attachment.original_name, "requirements.md");
      assert.equal(attachment.sha256.length, 64);
      assert.equal(attachment.storage_ref.includes("requirements.md"), false);
      const storedAttachment = path.join(path.dirname(created.submission_file), path.basename(attachment.storage_ref));
      assert.equal(fs.statSync(storedAttachment).mode & 0o777, 0o600);
      assert.equal(path.isAbsolute(created.submission.repository_snapshot[0].resolved_identity), false);

      const revised = reviseIntentSubmission({
        registry,
        projectId,
        submissionId: created.submission.submission_id,
        normalization: {
          title: "Add timeout handling",
          outcome: "Timeouts are handled consistently.",
          constraints: ["Do not write upstream."],
          acceptance: ["Timeout tests pass."],
          scope: ["src/**", "test/**"],
          work_type: "code-change",
          assumptions: [],
          open_questions: [],
          confidence: 0.9,
        },
      });
      assert.equal(revised.report.status, "prepared");
      assert.equal(revised.report.delivery_mode, "patch-only");
      assert.equal(revised.report.previous_revision_ref, null);
      assert.equal(readIntentSubmission({ registry, projectId, submissionId: created.submission.submission_id }).normalization.title, "Add timeout handling");

      const secondRevision = reviseIntentSubmission({
        registry,
        projectId,
        submissionId: created.submission.submission_id,
        normalization: { ...revised.report, title: "Add bounded timeout handling" },
      });
      assert.equal(secondRevision.report.revision, 2);
      assert.equal(secondRevision.report.previous_revision_ref, revised.submission.normalization_refs[0]);
    } finally {
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});

test("intent attachment validation covers empty input, traversal names, UTF-8 replacement, total size, and restart recovery", async () => {
  await withTempRepo({ prefix: "aor-intent-boundaries-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intent-boundaries-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const projectId = registry.defaultProjectId;
      assert.throws(() => createIntentSubmission({ registry, projectId, autoPrepare: false }), (error) => error.code === "intent_submission.empty");
      assert.throws(() => createIntentSubmission({ registry, projectId, attachments: [{ name: "bad.txt", content: "bad\uFFFDtext" }], autoPrepare: false }), (error) => error.code === "intent_attachment.invalid_utf8");
      assert.throws(() => createIntentSubmission({ registry, projectId, attachments: Array.from({ length: 6 }, (_, index) => ({ name: `${index}.txt`, content: "x".repeat(900 * 1024) })), autoPrepare: false }), (error) => error.code === "intent_attachment.total_too_large");
      const created = createIntentSubmission({ registry, projectId, attachments: [{ name: "../nested\\requirements.md", content: "safe" }], autoPrepare: false });
      assert.equal(created.submission.attachments[0].original_name, "requirements.md");
      assert.equal(created.submission.attachments[0].storage_ref.includes(".."), false);

      const restarted = createLocalProjectRegistry({ cwd: projectRoot, projects: [], persistence: { mode: "persistent", root: aorHome } });
      const recovered = readIntentSubmission({ registry: restarted, projectId, submissionId: created.submission.submission_id });
      assert.equal(recovered.submission.request_text, "");
      assert.equal(recovered.submission.attachments[0].sha256, created.submission.attachments[0].sha256);
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("normalization blockers remain retryable and confirmation is idempotent", async () => {
  await withTempRepo({ prefix: "aor-intent-lifecycle-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intent-lifecycle-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const projectId = registry.defaultProjectId;
      const missingProvider = createIntentSubmission({ registry, projectId, requestText: "Explain this repository.", autoPrepare: false });
      assert.throws(() => prepareIntentSubmission({ registry, projectId, submissionId: missingProvider.submission.submission_id }), (error) => error.code === "intent_provider.not_ready");
      assert.equal(readIntentSubmission({ registry, projectId, submissionId: missingProvider.submission.submission_id }).submission.status, "blocked");

      const malformed = createIntentSubmission({ registry, projectId, requestText: "Review the API.", autoPrepare: false });
      const rejected = reviseIntentSubmission({ registry, projectId, submissionId: malformed.submission.submission_id, normalization: {
        title: "x".repeat(201), outcome: "Review it.", constraints: [], acceptance: [], scope: [], work_type: "unknown", assumptions: [], open_questions: [], confidence: 2,
      } });
      assert.equal(rejected.report.status, "invalid");
      assert.equal(rejected.submission.status, "blocked");
      assert.match(rejected.report.validation.findings.join(" "), /title exceeds|acceptance requires|unsupported|between 0 and 1/u);

      const created = createIntentSubmission({ registry, projectId, requestText: "Change documentation.", autoPrepare: false });
      const needsInput = reviseIntentSubmission({ registry, projectId, submissionId: created.submission.submission_id, normalization: {
        title: "Change documentation", outcome: "Clarify setup.", constraints: [], acceptance: ["The setup is clear."], scope: ["README.md"], work_type: "document-change", assumptions: [], open_questions: ["Which audience?"], confidence: 0.6,
      } });
      assert.equal(needsInput.report.status, "needs-input");
      assert.equal(needsInput.submission.status, "blocked");
      assert.throws(() => confirmAndStartIntent({ registry, projectId, submissionId: created.submission.submission_id }), (error) => error.code === "intent_submission.not_prepared");

      assert.throws(
        () => answerIntentQuestions({ registry, projectId, submissionId: created.submission.submission_id, answers: {} }),
        (error) => error.code === "intent_submission.answers_incomplete",
      );
      assert.deepEqual(
        readIntentSubmission({ registry, projectId, submissionId: created.submission.submission_id }).normalization.open_questions,
        ["Which audience?"],
      );

      const prepared = answerIntentQuestions({
        registry,
        projectId,
        submissionId: created.submission.submission_id,
        answers: { "Which audience?": "Installed AOR operators" },
      });
      assert.equal(prepared.report.delivery_mode, "patch-only");
      assert.deepEqual(prepared.report.open_questions, []);
      assert.match(prepared.report.assumptions.at(-1), /Installed AOR operators/u);
      assert.deepEqual(prepared.report.provider, needsInput.report.provider);
      const confirmed = confirmIntent({ registry, projectId, submissionId: created.submission.submission_id });
      assert.equal(confirmed.discovery, null);
      assert.equal(confirmed.normalization_revision, 2);
      assert.match(confirmed.flow_id, /^flow\./u);
      assert.equal(confirmed.next_action.action_id, "discovery-run");
      assert.match(confirmed.next_action_report_ref, /^evidence:\/\/projects\//u);
      assert.equal(fs.existsSync(path.join(projectRoot, ".aor")), false);
      const resumable = listIntentSubmissions({ registry, projectId });
      assert.equal(resumable.read_only, true);
      assert.equal(resumable.submissions[0].submission.submission_id, created.submission.submission_id);
      const first = confirmAndStartIntent({ registry, projectId, submissionId: created.submission.submission_id });
      const second = confirmAndStartIntent({ registry, projectId, submissionId: created.submission.submission_id });
      assert.equal(second.mission.command_output?.mission_id ?? second.mission.command, first.mission.command_output?.mission_id ?? first.mission.command);
      assert.equal(readIntentSubmission({ registry, projectId, submissionId: created.submission.submission_id }).submission.status, "confirmed");
    } finally { fs.rmSync(aorHome, { recursive: true, force: true }); }
  });
});

test("confirm rejects a stale prepared revision before creating a Mission", async () => {
  await withTempRepo({ prefix: "aor-intent-stale-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intent-stale-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      const projectId = registry.defaultProjectId;
      const created = createIntentSubmission({ registry, projectId, requestText: "Review the timeout boundary.", autoPrepare: false });
      const first = reviseIntentSubmission({
        registry,
        projectId,
        submissionId: created.submission.submission_id,
        normalization: {
          title: "Review timeout boundary",
          outcome: "Document the timeout behavior.",
          constraints: [], acceptance: ["The timeout behavior is explicit."], scope: ["src/**"],
          work_type: "review", assumptions: [], open_questions: [], confidence: 0.8,
        },
      });
      const second = reviseIntentSubmission({
        registry,
        projectId,
        submissionId: created.submission.submission_id,
        normalization: { ...first.report, title: "Review authorization timeout boundary" },
      });
      assert.equal(second.report.revision, 2);
      assert.throws(
        () => confirmIntent({ registry, projectId, submissionId: created.submission.submission_id, expectedRevision: 1 }),
        (error) => error instanceof IntentServiceError
          && error.code === "intent_submission.stale_revision"
          && error.statusCode === 409
          && error.details.current_revision === 2
          && error.details.recovery_actions?.[0]?.payload?.current_revision === 2,
      );
      assert.equal(readIntentSubmission({ registry, projectId, submissionId: created.submission.submission_id }).submission.confirmation, undefined);
      const confirmed = confirmIntent({ registry, projectId, submissionId: created.submission.submission_id, expectedRevision: 2 });
      assert.equal(confirmed.normalization_revision, 2);
    } finally {
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});

test("intent submission rejects unsupported and oversized attachments", async () => {
  await withTempRepo({ prefix: "aor-intent-invalid-", workspaceRoot }, (projectRoot) => {
    const aorHome = fs.mkdtempSync(path.join(os.tmpdir(), "aor-intent-invalid-home-"));
    try {
      const registry = createLocalProjectRegistry({ cwd: projectRoot, projects: [{ projectRef: projectRoot }], persistence: { mode: "persistent", root: aorHome } });
      assert.throws(
        () => createIntentSubmission({ registry, projectId: registry.defaultProjectId, attachments: [{ name: "screen.png", content: "x" }], autoPrepare: false }),
        (error) => error instanceof IntentServiceError && error.code === "intent_attachment.unsupported",
      );
      assert.throws(
        () => createIntentSubmission({
          registry,
          projectId: registry.defaultProjectId,
          attachments: Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, content: "x" })),
          autoPrepare: false,
        }),
        (error) => error instanceof IntentServiceError && error.code === "intent_attachment.count_exceeded",
      );
      assert.throws(
        () => createIntentSubmission({ registry, projectId: registry.defaultProjectId, attachments: [{ name: "large.txt", content: "x".repeat(1024 * 1024 + 1) }], autoPrepare: false }),
        (error) => error instanceof IntentServiceError && error.code === "intent_attachment.too_large",
      );
    } finally {
      fs.rmSync(aorHome, { recursive: true, force: true });
    }
  });
});
