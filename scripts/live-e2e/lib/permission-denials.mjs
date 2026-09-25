function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

export function hasNonEmptyPermissionDenials(value) {
  if (Array.isArray(value)) return value.some(hasNonEmptyPermissionDenials);
  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) return false;
  if (Array.isArray(record.permission_denials) && record.permission_denials.length > 0) return true;
  return entries.some(([, entry]) => hasNonEmptyPermissionDenials(entry));
}
