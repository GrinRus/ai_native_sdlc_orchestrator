export const CONSOLE_EXPERIENCES = Object.freeze(["legacy", "quiet-cockpit"]);
export const COMPILED_CONSOLE_EXPERIENCE = "quiet-cockpit";

function valid(value) { return CONSOLE_EXPERIENCES.includes(value) ? value : null; }

export function legacyConsoleRequested(search = "") {
  return valid(new URLSearchParams(search).get("console")) === "legacy";
}

export function retiredConsoleSearch(search = "") {
  const params = new URLSearchParams(search);
  params.set("console", COMPILED_CONSOLE_EXPERIENCE);
  return `?${params.toString()}`;
}

export function resolveConsoleExperience() {
  return COMPILED_CONSOLE_EXPERIENCE;
}
