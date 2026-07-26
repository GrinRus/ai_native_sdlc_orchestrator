import { describeActualType, isPlainObject, issue } from "./utils.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateExplicitCatalogTaskPlan({ mission, parentField, source }) {
  const taskPlan = isPlainObject(mission.task_plan) ? mission.task_plan : null;
  const localTasks = taskPlan && Array.isArray(taskPlan.local_tasks) ? taskPlan.local_tasks : [];
  const issues = [];
  if (localTasks.length < 3) {
    issues.push(issue({
      code: "required_field_missing",
      source,
      field: `${parentField}.task_plan.local_tasks`,
      expected: "at least three mission-specific structured tasks",
      actual: String(localTasks.length),
      message: `Field '${parentField}.task_plan.local_tasks' requires an explicit medium+ decomposition; compact fallback is small-only.`,
    }));
  }
  localTasks.forEach((task, index) => {
    const taskField = `${parentField}.task_plan.local_tasks[${index}]`;
    if (!isPlainObject(task)) {
      issues.push(issue({
        code: "field_type_mismatch",
        source,
        field: taskField,
        expected: "object",
        actual: describeActualType(task),
        message: `Field '${taskField}' must be an object.`,
      }));
      return;
    }
    for (const field of ["task_id", "title", "objective"]) {
      if (!isNonEmptyString(task[field])) {
        issues.push(issue({
          code: "required_field_missing",
          source,
          field: `${taskField}.${field}`,
          expected: "non-empty string",
          actual: describeActualType(task[field]),
          message: `Field '${taskField}.${field}' must be a non-empty string.`,
        }));
      }
    }
  });
  return issues;
}

export function explicitCatalogTaskPlanMissionIds(document) {
  const policy = isPlainObject(document.qualification_policy) ? document.qualification_policy : {};
  return new Set(
    Array.isArray(policy.explicit_task_plan_mission_ids)
      ? policy.explicit_task_plan_mission_ids.filter(isNonEmptyString)
      : [],
  );
}
