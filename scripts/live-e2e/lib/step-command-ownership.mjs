const STEP_COMMAND_LABELS = Object.freeze({
  discovery: ["discovery-run", "project-analyze"],
  spec: ["spec-build", "project-validate"],
  planning: ["plan-create", "wave-create", "handoff-prepare"],
  handoff: ["handoff-approve"],
  execution: ["run-start", "project-verify-routed-live"],
  review: ["review-run", "harness-certify", "eval-run"],
  qa: ["eval-run", "project-verify-post-run-primary", "project-verify-post-run-diagnostic"],
  delivery: ["deliver-prepare", "delivery-harness-certify"],
  release: ["release-prepare"],
  learning: [
    "learning-handoff",
    "audit-runs",
    "guided-next-after-learning",
    "follow-up-mission-create",
    "guided-next-after-follow-up",
    "flow-targeted-request-create",
  ],
});

const RESUME_COMMAND_STEP = Object.freeze({
  "project-validate-approved-handoff": "handoff",
  "run-status": "execution",
  "guided-next-after-review": "review",
  "review-decide-request-repair": "review",
  "review-decide-approve": "review",
  "guided-next-after-delivery": "delivery",
});

const COMMAND_LABEL_STEP = Object.freeze(Object.fromEntries([
  ...Object.entries(STEP_COMMAND_LABELS).flatMap(([step, labels]) => labels.map((label) => [label, step])),
  ...Object.entries(RESUME_COMMAND_STEP),
]));

export function getLiveE2eCommandLabelPriority(step) {
  return [...(STEP_COMMAND_LABELS[step] ?? [])];
}

export function resolveResumeOnlyCommandStep(label) {
  if (/^repair-close-[1-9][0-9]*$/u.test(label)) return "review";
  return RESUME_COMMAND_STEP[label] ?? "";
}

export function resolveLiveE2eCommandStep(label) {
  return resolveResumeOnlyCommandStep(label) || COMMAND_LABEL_STEP[label] || "";
}
