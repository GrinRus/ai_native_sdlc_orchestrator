/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRefPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @param {string | null} root
 * @returns {string | null}
 */
function normalizeSourceRoot(root) {
  if (!root) return null;
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/u, "");
  return normalized.length > 0 ? normalized : ".";
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<{
 *   repo_id: string,
 *   name: string,
 *   role: string,
 *   default_branch: string,
 *   source_kind: string,
 *   source_root: string | null,
 *   remote_url: string | null,
 *   default_ref: string | null,
 *   build_commands: string[],
 *   test_commands: string[],
 *   lint_commands: string[],
 * }>}
 */
export function normalizeProfileRepos(profile) {
  const seen = new Set();
  const repos = Array.isArray(profile.repos) ? profile.repos : [];

  return repos
    .map((entry, index) => {
      const repo = asRecord(entry);
      const source = asRecord(repo.source);
      const repoId = asString(repo.repo_id) ?? `repo-${index + 1}`;
      const sourceKind = asString(source.kind) ?? "unknown";
      const sourceRoot = normalizeSourceRoot(asString(source.root));

      return {
        repo_id: repoId,
        name: asString(repo.name) ?? repoId,
        role: asString(repo.role) ?? "unspecified",
        default_branch: asString(repo.default_branch) ?? asString(source.default_ref) ?? "main",
        source_kind: sourceKind,
        source_root: sourceRoot,
        remote_url: asString(source.remote_url),
        default_ref: asString(source.default_ref),
        build_commands: asStringArray(repo.build_commands),
        test_commands: asStringArray(repo.test_commands),
        lint_commands: asStringArray(repo.lint_commands),
      };
    })
    .filter((repo) => {
      if (seen.has(repo.repo_id)) return false;
      seen.add(repo.repo_id);
      return true;
    });
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<{ from_repo_id: string, to_repo_id: string, relationship: string, validation_refs: string[] }>}
 */
export function normalizeRepoGraph(profile) {
  const edges = Array.isArray(profile.repo_graph) ? profile.repo_graph : [];

  return edges
    .map((entry) => {
      const edge = asRecord(entry);
      const fromRepoId = asString(edge.from_repo_id) ?? asString(edge.from) ?? asString(edge.source_repo_id);
      const toRepoId = asString(edge.to_repo_id) ?? asString(edge.to) ?? asString(edge.target_repo_id);
      if (!fromRepoId || !toRepoId) return null;

      return {
        from_repo_id: fromRepoId,
        to_repo_id: toRepoId,
        relationship: asString(edge.relationship) ?? asString(edge.kind) ?? "dependency",
        validation_refs: uniqueStrings(
          asStringArray(edge.validation_refs).length > 0
            ? asStringArray(edge.validation_refs)
            : [`validation://repo-graph/${normalizeRefPart(fromRepoId)}-to-${normalizeRefPart(toRepoId)}`],
        ),
      };
    })
    .filter((edge) => edge !== null);
}

/**
 * @param {{ profile: Record<string, unknown> }} options
 * @returns {{
 *   topology: string,
 *   repo_count: number,
 *   repos: ReturnType<typeof normalizeProfileRepos>,
 *   repo_ids: string[],
 *   repo_graph: ReturnType<typeof normalizeRepoGraph>,
 *   impacted_repo_scope: Array<{ repo_id: string, role: string, source_kind: string, source_root: string | null, default_branch: string }>,
 *   per_repo_validation_evidence: Array<{ repo_id: string, validation_refs: string[], command_refs: string[] }>,
 *   integration_validation_refs: string[],
 *   coordination_required: boolean,
 * }}
 */
export function resolveProjectRepoScope(options) {
  const profile = options.profile;
  const projectId = normalizeRefPart(asString(profile.project_id) ?? "project");
  const topology = asString(profile.repo_topology) ?? "unknown";
  const repos = normalizeProfileRepos(profile);
  const repoGraph = normalizeRepoGraph(profile);
  const repoIds = repos.map((repo) => repo.repo_id);
  const integrationValidationRefs = uniqueStrings(
    repoGraph.flatMap((edge) => edge.validation_refs).length > 0
      ? repoGraph.flatMap((edge) => edge.validation_refs)
      : repos.length > 1
        ? [`validation://repo-graph/${projectId}/declared-scope`]
        : [],
  );

  return {
    topology,
    repo_count: repos.length,
    repos,
    repo_ids: repoIds,
    repo_graph: repoGraph,
    impacted_repo_scope: repos.map((repo) => ({
      repo_id: repo.repo_id,
      role: repo.role,
      source_kind: repo.source_kind,
      source_root: repo.source_root,
      default_branch: repo.default_branch,
    })),
    per_repo_validation_evidence: repos.map((repo) => {
      const repoRefPart = normalizeRefPart(repo.repo_id);
      return {
        repo_id: repo.repo_id,
        validation_refs: [
          `validation://repos/${projectId}/${repoRefPart}/profile-entry`,
          `validation://repos/${projectId}/${repoRefPart}/scope`,
        ],
        command_refs: [
          ...repo.lint_commands.map((_, index) => `validation://repos/${projectId}/${repoRefPart}/lint/${index + 1}`),
          ...repo.test_commands.map((_, index) => `validation://repos/${projectId}/${repoRefPart}/test/${index + 1}`),
          ...repo.build_commands.map((_, index) => `validation://repos/${projectId}/${repoRefPart}/build/${index + 1}`),
        ],
      };
    }),
    integration_validation_refs: integrationValidationRefs,
    coordination_required: repos.length > 1,
  };
}

/**
 * @param {string[]} changedPaths
 * @param {Array<{ repo_id: string, source_root?: string | null }>} repos
 * @returns {Map<string, string[]>}
 */
export function classifyChangedPathsByRepo(changedPaths, repos) {
  const normalizedPaths = uniqueStrings(changedPaths.map((entry) => entry.replace(/\\/g, "/")));
  const changesByRepo = new Map(repos.map((repo) => [repo.repo_id, /** @type {string[]} */ ([])]));
  const repoRoots = repos
    .map((repo, index) => ({
      repo_id: repo.repo_id,
      index,
      root: normalizeSourceRoot(asString(repo.source_root)) ?? ".",
    }))
    .sort((left, right) => right.root.length - left.root.length);
  const matchedPaths = new Set();

  for (const repo of repoRoots.filter((entry) => entry.root !== ".")) {
    const matched = normalizedPaths.filter((entry) => entry === repo.root || entry.startsWith(`${repo.root}/`));
    if (matched.length === 0) continue;
    const current = changesByRepo.get(repo.repo_id) ?? [];
    changesByRepo.set(repo.repo_id, uniqueStrings([...current, ...matched]));
    for (const entry of matched) {
      matchedPaths.add(entry);
    }
  }

  const unmatched = normalizedPaths.filter((entry) => !matchedPaths.has(entry));
  const rootRepos = repoRoots.filter((entry) => entry.root === ".");
  const fallbackRepo = rootRepos[0] ?? [...repoRoots].sort((left, right) => left.index - right.index)[0] ?? null;
  if (fallbackRepo && unmatched.length > 0) {
    const current = changesByRepo.get(fallbackRepo.repo_id) ?? [];
    changesByRepo.set(fallbackRepo.repo_id, uniqueStrings([...current, ...unmatched]));
  }

  return changesByRepo;
}
