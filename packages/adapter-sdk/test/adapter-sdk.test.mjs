import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAdapterRegistry,
  createAdapterRequestEnvelope,
  createAdapterResponseEnvelope,
  createMockAdapter,
  resolveAdapterForRoute,
  resolveAdapterMatrix,
} from "../src/index.mjs";
import { resolveRouteForStep, resolveRouteMatrix } from "../../provider-routing/src/route-resolution.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s04-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("buildAdapterRegistry loads adapter capability profiles through shared contracts path", () => {
  withTempRepo((repoRoot) => {
    const registry = buildAdapterRegistry({
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(registry.size >= 3, true);
    assert.equal(registry.has("codex-cli"), true);
    assert.equal(registry.has("mock-runner"), true);
  });
});

test("resolveAdapterForRoute passes when required capabilities are declared by selected adapter", () => {
  withTempRepo((repoRoot) => {
    const routeResolution = resolveRouteForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      stepClass: "implement",
    });

    const resolved = resolveAdapterForRoute({
      routeResolution,
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(resolved.adapter.adapter_id, "codex-cli");
    assert.equal(resolved.adapter.resolution_source.kind, "route-primary");
    assert.equal(resolved.capability_check.status, "pass");
    assert.deepEqual(resolved.capability_check.missing, []);
  });
});

test("resolveAdapterForRoute fails early when route requires missing adapter capability", () => {
  withTempRepo((repoRoot) => {
    const adapterPath = path.join(repoRoot, "examples/adapters/codex-cli.yaml");
    const content = fs.readFileSync(adapterPath, "utf8");
    fs.writeFileSync(adapterPath, content.replace("live_logs: true", "live_logs: false"), "utf8");

    const routeResolution = resolveRouteForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      stepClass: "implement",
    });

    assert.throws(
      () =>
        resolveAdapterForRoute({
          routeResolution,
          adaptersRoot: path.join(repoRoot, "examples/adapters"),
        }),
      /missing capabilities \[live_logs\]/i,
    );
  });
});

test("resolveAdapterMatrix validates capability negotiation for every resolved step route", () => {
  withTempRepo((repoRoot) => {
    const routeResolutionMatrix = resolveRouteMatrix({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
    });

    const matrix = resolveAdapterMatrix({
      routeResolutionMatrix,
      adaptersRoot: path.join(repoRoot, "examples/adapters"),
    });

    assert.equal(matrix.length, 10);
    const discovery = matrix.find((entry) => entry.step_class === "discovery");
    assert.ok(discovery);
    assert.equal(discovery.adapter.adapter_id, "none");
    const implement = matrix.find((entry) => entry.step_class === "implement");
    assert.ok(implement);
    assert.equal(implement.adapter.adapter_id, "codex-cli");
    assert.equal(implement.capability_check.status, "pass");
  });
});

test("adapter request and response envelopes enforce stable required fields", () => {
  const request = createAdapterRequestEnvelope({
    request_id: "req-1",
    run_id: "run-1",
    step_id: "step-1",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    input_packet_refs: ["packet://handoff"],
    dry_run: true,
    context: {
      compiled_context_ref: "compiled-context://compiled-context.aor-core.implement.runner-default",
      packet_refs: ["packet://handoff"],
    },
  });

  assert.equal(request.request_id, "req-1");
  assert.equal(request.dry_run, true);
  assert.deepEqual(request.input_packet_refs, ["packet://handoff"]);
  assert.equal(request.context.compiled_context_ref, "compiled-context://compiled-context.aor-core.implement.runner-default");

  const response = createAdapterResponseEnvelope({
    request_id: "req-1",
    adapter_id: "mock-runner",
    status: "success",
    summary: "ok",
    evidence_refs: ["evidence://mock-adapter/req-1"],
  });

  assert.equal(response.status, "success");
  assert.deepEqual(response.evidence_refs, ["evidence://mock-adapter/req-1"]);

  assert.throws(
    () =>
      createAdapterResponseEnvelope({
        request_id: "req-1",
        adapter_id: "mock-runner",
        status: "unknown",
        summary: "not-allowed",
      }),
    /must be one of: success, failed, blocked/i,
  );
});

test("mock adapter executes deterministic dry-run outputs for rehearsal coverage", () => {
  const mockAdapter = createMockAdapter();
  const request = {
    request_id: "req-mock-1",
    run_id: "run-mock-1",
    step_id: "step-mock-1",
    step_class: "implement",
    route: { resolved_route_id: "route.implement.default" },
    asset_bundle: { wrapper_ref: "wrapper.runner.default@v3" },
    policy_bundle: { policy_id: "policy.step.runner.default" },
    dry_run: true,
  };

  const first = mockAdapter.execute(request);
  const second = mockAdapter.execute(request);

  assert.deepEqual(first, second);
  assert.equal(first.status, "success");
  assert.equal(first.output.mode, "dry-run");
  assert.ok(first.evidence_refs[0].startsWith("evidence://mock-adapter/"));
});
