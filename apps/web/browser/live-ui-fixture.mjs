import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.AOR_LIVE_UI_PORT || 4173);
const projectId = "project-live";

const runner = {
  schema_version: 1,
  source: "project-default",
  route_id: "route.implement.simulation",
  readiness: "ready",
  requested_model: "gpt-5",
  effective_model: "gpt-5",
  requested_reasoning_effort: "high",
  effective_reasoning_effort: "high",
  unavailable_reason: null,
  recovery_action: "Review the approved route.",
};

const taskBase = {
  project_id: projectId,
  work_type: "code-change",
  intent_submission_ref: "evidence://intent/live-ui",
  mission_id: "mission.live-ui",
  flow_id: "flow.live-ui",
  lineage: { intent_submission_ref: "evidence://intent/live-ui", mission_id: "mission.live-ui", flow_id: "flow.live-ui" },
  source_items: [{ schema_version: 1, source_id: "source.live-ui", kind: "repository-markdown", immutable: true, stale: false, digest: "a".repeat(64), preview: { project_relative_path: "docs/auth-timeouts.md", pinned_base_revision: "live-ui-base", sanitized_markdown: "# Authentication timeouts" } }],
  attention_items: [],
  review: { verification_status: "pass", delivery_status: "pending", changed_paths: ["docs/auth-timeouts.md", "src/auth/timeout.ts"], evidence_refs: ["evidence://review/live-ui.patch"] },
  completion: { status: "complete", verification_status: "pass", delivery_status: "pass", evidence_refs: ["evidence://completion/live-ui"], follow_up_eligible: true },
  lifecycle_path: { owner: "runtime", steps: [{ id: "prepare", state: "complete" }, { id: "execute", state: "current" }, { id: "review", state: "upcoming" }, { id: "complete", state: "upcoming" }] },
  current_step: "execute",
  current_step_label: "Execute",
  attention_count: 0,
  blocker_count: 0,
  evidence_refs: ["evidence://review/live-ui.patch"],
  primary_action: { action_id: "task.start", operator_control: "Start", reason: "Ready", available: true },
  runner_selection: runner,
  run_ids: ["run.live-ui"],
  revision: 3,
  updated_at: "2026-08-21T10:00:00.000Z",
  completed_read_only: false,
  read_only: true,
};

const tasks = [
  { ...taskBase, task_id: "task.live-ui.active", display_title: "Implement deterministic timeout checks", status: "active", status_detail: "execute" },
  { ...taskBase, task_id: "task.live-ui.attention", display_title: "Approve revised timeout plan", status: "attention", status_detail: "Needs approval", attention_count: 1, blocker_count: 1, current_step: "attention", current_step_label: "Attention" },
  { ...taskBase, task_id: "task.live-ui.prepared", display_title: "Add session expiry docs", status: "prepared", status_detail: "Ready", current_step: "prepare", current_step_label: "Prepare" },
  { ...taskBase, task_id: "task.live-ui.draft", display_title: "Draft authentication task", status: "draft", status_detail: "Draft", current_step: "prepare", current_step_label: "Prepare" },
  { ...taskBase, task_id: "task.live-ui.completed", display_title: "Update auth timeout docs", status: "completed", status_detail: "Completed", current_step: "complete", current_step_label: "Complete", completed_read_only: true },
];

const review = {
  schema_version: 1,
  task_id: "task.live-ui.active",
  project_id: projectId,
  availability: "available",
  files: [
    { path: "docs/auth-timeouts.md", kind: "markdown", additions: 2, deletions: 1, diff_available: true, truncated: false },
    { path: "src/auth/timeout.ts", kind: "text", additions: 4, deletions: 2, diff_available: true, truncated: false },
  ],
  selected_path: "docs/auth-timeouts.md",
  selected_file: {
    path: "docs/auth-timeouts.md",
    kind: "markdown",
    additions: 2,
    deletions: 1,
    diff_available: true,
    truncated: false,
    hunks: [{ old_start: 6, old_lines: 3, new_start: 6, new_lines: 4, rows: [
      { kind: "context", old_line: 6, new_line: 6, text: "Authentication sessions expire after a period of inactivity." },
      { kind: "deletion", old_line: 7, new_line: null, text: "The idle timeout is 10 minutes." },
      { kind: "addition", old_line: null, new_line: 7, text: "The idle timeout is 15 minutes." },
      { kind: "addition", old_line: null, new_line: 8, text: "A warning appears at 13 minutes." },
    ] }],
    rendered: { before: "Authentication sessions expire after a period of inactivity.\nThe idle timeout is 10 minutes.", after: "Authentication sessions expire after a period of inactivity.\nThe idle timeout is 15 minutes.\nA warning appears at 13 minutes.", sanitized: true, partial: true },
    source_ref: "evidence://review/live-ui.patch",
  },
  evidence_refs: ["evidence://review/live-ui.patch"],
  freshness: { status: "current", updated_at: "2026-08-21T10:00:00.000Z" },
  read_only: true,
};

const reviewFiles = {
  [review.selected_file.path]: review.selected_file,
  "src/auth/timeout.ts": {
    path: "src/auth/timeout.ts",
    kind: "text",
    additions: 4,
    deletions: 2,
    diff_available: true,
    truncated: false,
    hunks: [{ old_start: 18, old_lines: 5, new_start: 18, new_lines: 7, rows: [
      { kind: "context", old_line: 18, new_line: 18, text: "export const DEFAULT_IDLE_TIMEOUT_MS = 600_000;" },
      { kind: "deletion", old_line: 19, new_line: null, text: "export const WARNING_BEFORE_EXPIRY_MS = 30_000;" },
      { kind: "addition", old_line: null, new_line: 19, text: "export const DEFAULT_IDLE_TIMEOUT_MS = 900_000;" },
      { kind: "addition", old_line: null, new_line: 20, text: "export const WARNING_BEFORE_EXPIRY_MS = 120_000;" },
      { kind: "context", old_line: 20, new_line: 21, text: "export function isExpired(lastActivityAt, now) {" },
    ] }],
    rendered: { before: "const idleTimeout = 600_000;\nconst warning = 30_000;", after: "const idleTimeout = 900_000;\nconst warning = 120_000;", sanitized: true, partial: true },
    source_ref: "evidence://review/live-ui.patch",
  },
};

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

function routeApi(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/app-config.json") return json(response, 200, { version: "live-ui-fixture", project_id: projectId, default_project_id: projectId, projects: [{ project_id: projectId, label: "Project Atlas", display_name: "Project Atlas", project_root: "/tmp/aor-live-ui", onboarding_summary: { initialized: true, state_exists: true } }] });
  if (url.pathname === "/api/projects") return json(response, 200, { default_project_id: projectId, projects: [{ project_id: projectId, label: "Project Atlas", display_name: "Project Atlas", project_root: "/tmp/aor-live-ui", onboarding_summary: { initialized: true, state_exists: true } }] });
  const prefix = `/api/projects/${projectId}`;
  if (!url.pathname.startsWith(prefix)) return false;
  const suffix = url.pathname.slice(prefix.length);
  if (suffix === "/state") return json(response, 200, { project_id: projectId, initialized: true, state: "ready", onboarding_summary: { initialized: true, state_exists: true }, read_only: true });
  if (suffix === "/tasks") return json(response, 200, { project_id: projectId, selected_task_id: tasks[0].task_id, tasks, read_only: true });
  if (suffix.startsWith("/tasks/") && suffix.endsWith("/review")) {
    const selectedPath = url.searchParams.get("path") || review.selected_path;
    return json(response, 200, { ...review, task_id: suffix.split("/")[2], selected_path: selectedPath, selected_file: reviewFiles[selectedPath] || review.selected_file });
  }
  if (suffix.startsWith("/tasks/") && suffix.endsWith("/actions") && request.method === "POST") return json(response, 202, { action: "accepted", readback: { durable: true, task_id: suffix.split("/")[2], evidence_refs: ["evidence://action/live-ui"] } });
  if (suffix === "/flows") return json(response, 200, { flows: [], selected_flow_id: null });
  if (suffix === "/flows/selected") return json(response, 404, { code: "flow.not_found", detail: "No selected flow." });
  if (suffix === "/next-action-report") return json(response, 404, { code: "next_action.not_found", detail: "No next action." });
  if (suffix === "/intent-submissions") return json(response, 200, { submissions: [] });
  if (suffix === "/runs") return json(response, 200, []);
  if (suffix === "/packets") return json(response, 200, { packets: [] });
  if (suffix === "/step-results") return json(response, 200, { items: [] });
  if (suffix === "/delivery-manifests") return json(response, 200, { items: [] });
  if (suffix === "/operator-requests") return json(response, 200, { requests: [] });
  if (suffix === "/topology") return json(response, 200, { project_id: projectId, components: [], read_only: true });
  if (suffix === "/execution-profile") return json(response, 200, { project_id: projectId, readiness: "ready", route_id: runner.route_id, read_only: true });
  return json(response, 404, { code: "not_found", detail: "Fixture route not found." });
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/") || request.url === "/app-config.json") return routeApi(request, response);
  const urlPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//u, "");
  const candidate = path.resolve(root, relative);
  const filePath = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, "index.html");
  const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`live UI fixture: http://127.0.0.1:${port}/?surface=tasks&project=${projectId}\n`);
});
