export const EMPTY_PROJECT_SETUP = Object.freeze({
  sourceKind: "local",
  projectRef: "",
  gitUrl: "",
  label: "",
});

export function parseSetupRows(value, fields) {
  return String(value ?? "").split(/\r?\n/u).map((row) => row.trim()).filter(Boolean).map((row) => {
    const values = row.split(":").map((part) => part.trim());
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
  });
}
