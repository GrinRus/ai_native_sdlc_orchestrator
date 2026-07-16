export const EMPTY_PROJECT_SNAPSHOT = Object.freeze({
  generation: 0,
  status: "loading",
  errors: Object.freeze({}),
});

export function reduceProjectSnapshot(state, action) {
  if (action.generation < state.generation) return state;
  if (action.type === "loading") {
    return { ...state, generation: action.generation, status: "loading", errors: {} };
  }
  if (action.type === "loaded") {
    return {
      ...state,
      ...action.data,
      generation: action.generation,
      status: action.status,
      errors: action.errors ?? {},
    };
  }
  if (action.type === "stale") {
    return { ...state, generation: action.generation, status: "stale", errors: action.errors ?? state.errors };
  }
  return state;
}

export function mergeProjectPreview(projects, projectId, statePreview) {
  if (!statePreview?.onboarding_summary || !projectId) return projects;
  return projects.map((project) => project.project_id === projectId
    ? {
        ...project,
        runtime_root: statePreview.runtime_root ?? project.runtime_root,
        onboarding_summary: statePreview.onboarding_summary,
      }
    : project);
}
