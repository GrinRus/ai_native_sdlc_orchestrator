export const VERIFICATION_TRANSACTION_STAGES = Object.freeze([
  "resolve-inputs", "execute-command-groups", "compare-baseline", "aggregate-evidence", "persist-report",
]);
export const DELIVERY_PLAN_STAGES = Object.freeze([
  "resolve-scope", "classify-changed-paths", "authorize-exact-diff", "apply-safety-gates", "assemble-plan",
]);
export const DELIVERY_TRANSACTION_STAGES = Object.freeze([
  "validate-preconditions", "execute-delivery-mode", "commit-evidence", "cleanup", "rollback-or-retain-recovery",
]);

export function runTransactionCoordinator(service, options) {
  return service(options);
}
