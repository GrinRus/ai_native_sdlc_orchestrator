export const CONSOLE_EXPERIENCES = Object.freeze(["legacy", "quiet-cockpit"]);

export function resolveConsoleExperience(search = "") {
  const requested = new URLSearchParams(search).get("console");
  return requested === "quiet-cockpit" ? "quiet-cockpit" : "legacy";
}
