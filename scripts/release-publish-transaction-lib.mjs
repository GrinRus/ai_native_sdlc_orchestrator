export const ALPHA_PUBLISH_OPERATIONS = Object.freeze([
  "create-tag",
  "create-release",
  "publish-npm",
  "set-alpha-dist-tag",
  "delete-release-branch",
]);

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

export function classifyAlphaPublishState({ expected, observed }) {
  const conflicts = [];
  const tagExists = observed.tag?.exists === true;
  const releaseExists = observed.release?.exists === true;
  const npmExists = observed.npm?.version_exists === true;
  const alphaVersion = observed.npm?.alpha_version ?? null;

  if (tagExists && observed.tag.target_sha !== expected.commit_sha) {
    conflicts.push(`git tag ${expected.tag} targets '${observed.tag.target_sha}', expected '${expected.commit_sha}'`);
  }
  if (releaseExists) {
    if (observed.release.tag !== expected.tag) {
      conflicts.push(`GitHub Release tag is '${observed.release.tag}', expected '${expected.tag}'`);
    }
    if (observed.release.target_sha !== expected.commit_sha) {
      conflicts.push(`GitHub Release targets '${observed.release.target_sha}', expected '${expected.commit_sha}'`);
    }
    if (observed.release.prerelease !== true) {
      conflicts.push("GitHub Release must remain a prerelease");
    }
    if (observed.release.title !== expected.release_title) {
      conflicts.push(`GitHub Release title is '${observed.release.title}', expected '${expected.release_title}'`);
    }
    if (observed.release.notes !== expected.release_notes) {
      conflicts.push("GitHub Release notes do not match the expected alpha publication metadata");
    }
  }
  if (npmExists && present(alphaVersion) && alphaVersion !== expected.version) {
    conflicts.push(`npm alpha dist-tag points to '${alphaVersion}', expected '${expected.version}' for an existing version`);
  }

  const surfaces = {
    tag: tagExists,
    release: releaseExists,
    npm: npmExists,
    alpha: alphaVersion === expected.version,
  };
  const count = Object.values(surfaces).filter(Boolean).length;
  let status = "partial";
  if (conflicts.length > 0) status = "conflict";
  else if (count === 0) status = "absent";
  else if (Object.values(surfaces).every(Boolean)) status = "complete";
  else if (npmExists && !tagExists && !releaseExists) status = "npm-only";
  else if (tagExists && !releaseExists && !npmExists) status = "tag-only";
  else if (releaseExists && !tagExists && !npmExists) status = "release-only";

  return {
    status,
    compatible: conflicts.length === 0,
    conflicts,
    surfaces,
    expected,
    observed,
  };
}

export function planAlphaPublishReconciliation(classification) {
  if (!classification.compatible) {
    return {
      status: "conflict",
      operations: [],
      delete_branch_allowed: false,
      conflicts: classification.conflicts,
    };
  }
  if (classification.status === "complete") {
    return {
      status: "complete",
      operations: ["delete-release-branch"],
      delete_branch_allowed: true,
      conflicts: [],
    };
  }

  const operations = [];
  if (!classification.surfaces.tag) operations.push("create-tag");
  if (!classification.surfaces.release) operations.push("create-release");
  if (!classification.surfaces.npm) operations.push("publish-npm");
  if (classification.surfaces.npm && !classification.surfaces.alpha) {
    operations.push("set-alpha-dist-tag");
  }
  return {
    status: "reconcile",
    operations,
    delete_branch_allowed: false,
    conflicts: [],
  };
}

export async function reconcileAlphaPublication({ expected, inspect, execute, onTransition = () => {} }) {
  const transitions = [];
  for (let index = 0; index < ALPHA_PUBLISH_OPERATIONS.length + 2; index += 1) {
    const observed = await inspect();
    const classification = classifyAlphaPublishState({ expected, observed });
    const plan = planAlphaPublishReconciliation(classification);
    const transition = { observed, classification, plan };
    transitions.push(transition);
    await onTransition(transition);

    if (plan.status === "conflict") {
      const error = new Error(`Alpha publication conflict: ${plan.conflicts.join("; ")}`);
      error.code = "alpha-publication-conflict";
      error.transitions = transitions;
      throw error;
    }
    if (classification.status === "complete") {
      await execute("delete-release-branch");
      return { status: "complete", transitions, branch_deleted: true };
    }

    const operation = plan.operations[0];
    if (!operation) {
      const error = new Error(`Alpha publication cannot progress from '${classification.status}'.`);
      error.code = "alpha-publication-stalled";
      error.transitions = transitions;
      throw error;
    }
    await execute(operation);
  }
  const error = new Error("Alpha publication reconciliation exceeded its bounded transition budget.");
  error.code = "alpha-publication-budget-exhausted";
  error.transitions = transitions;
  throw error;
}
