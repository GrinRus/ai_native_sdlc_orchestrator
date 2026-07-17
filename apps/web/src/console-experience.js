export const CONSOLE_EXPERIENCES = Object.freeze(["legacy", "quiet-cockpit"]);
export const COMPILED_CONSOLE_EXPERIENCE = "quiet-cockpit";

function valid(value) { return CONSOLE_EXPERIENCES.includes(value) ? value : null; }

export function resolveConsoleExperience({ search = "", configDefault = null, compiledDefault = COMPILED_CONSOLE_EXPERIENCE } = {}) {
  return valid(new URLSearchParams(search).get("console")) ?? valid(configDefault) ?? valid(compiledDefault) ?? "quiet-cockpit";
}

export function consoleExperienceSearch(search, experience) {
  const params = new URLSearchParams(search);
  params.set("console", valid(experience) ?? COMPILED_CONSOLE_EXPERIENCE);
  return `?${params.toString()}`;
}
