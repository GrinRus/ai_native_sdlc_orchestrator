export const EMPTY_PROJECT_SETUP = Object.freeze({
  projectRef: "",
  label: "",
  runtimeRoot: "",
  projectProfile: "",
  topology: "single-repo",
  repositories: "",
  components: "",
  dependencies: "",
});

export function parseSetupRows(value, fields) {
  return String(value ?? "").split(/\r?\n/u).map((row) => row.trim()).filter(Boolean).map((row) => {
    const values = row.split(":").map((part) => part.trim());
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
  });
}
