function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function problem({ code, source, field, expected, actual, message }) {
  return { code, source, field, expected, actual, message };
}

function positiveIntegerIssue(value, source, field, minimum = 1) {
  if (Number.isInteger(value) && value >= minimum) return null;
  return problem({
    code: value === undefined ? "required_field_missing" : "field_type_mismatch",
    source,
    field,
    expected: minimum === 0 ? "non-negative integer" : "positive integer",
    actual: value === undefined ? "missing" : actualType(value),
    message: `Field '${field}' must be ${minimum === 0 ? "a non-negative" : "a positive"} integer.`,
  });
}

export function validateExternalRuntimeSessionBudget(value, source, field) {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      problem({
        code: "field_type_mismatch",
        source,
        field,
        expected: "object",
        actual: actualType(value),
        message: `Field '${field}' must be an object.`,
      }),
    ];
  }

  const issues = [];
  for (const key of [
    "schema_version",
    "warn_after_assistant_turns",
    "max_assistant_turns",
    "max_tool_calls",
    "termination_grace_ms",
  ]) {
    const issue = positiveIntegerIssue(value[key], source, `${field}.${key}`);
    if (issue) issues.push(issue);
  }
  if (Number.isInteger(value.schema_version) && value.schema_version !== 1) {
    issues.push(
      problem({
        code: "enum_value_invalid",
        source,
        field: `${field}.schema_version`,
        expected: "1",
        actual: String(value.schema_version),
        message: `Field '${field}.schema_version' must be 1.`,
      }),
    );
  }
  if (
    Number.isInteger(value.warn_after_assistant_turns) &&
    Number.isInteger(value.max_assistant_turns) &&
    value.warn_after_assistant_turns >= value.max_assistant_turns
  ) {
    issues.push(
      problem({
        code: "field_value_invalid",
        source,
        field: `${field}.warn_after_assistant_turns`,
        expected: "integer lower than max_assistant_turns",
        actual: String(value.warn_after_assistant_turns),
        message: `Field '${field}.warn_after_assistant_turns' must be lower than max_assistant_turns.`,
      }),
    );
  }
  return issues;
}

export function validateExternalRunnerSessionBudget(value, source, field) {
  if (!isRecord(value)) {
    return [
      problem({
        code: "field_type_mismatch",
        source,
        field,
        expected: "object",
        actual: actualType(value),
        message: `Field '${field}' must be an object.`,
      }),
    ];
  }

  const issues = [];
  if (value.schema_version !== 1) {
    issues.push(
      problem({
        code: "enum_value_invalid",
        source,
        field: `${field}.schema_version`,
        expected: "1",
        actual: String(value.schema_version),
        message: `Field '${field}.schema_version' must be 1.`,
      }),
    );
  }
  if (!["pass", "warn", "exceeded", "not_configured"].includes(value.status)) {
    issues.push(
      problem({
        code: "enum_value_invalid",
        source,
        field: `${field}.status`,
        expected: "pass|warn|exceeded|not_configured",
        actual: String(value.status),
        message: `Field '${field}.status' must use the supported session-budget vocabulary.`,
      }),
    );
  }

  for (const [section, fields, minimum] of [
    [
      "configured",
      ["warn_after_assistant_turns", "max_assistant_turns", "max_tool_calls", "termination_grace_ms"],
      1,
    ],
    ["observed", ["assistant_turns", "tool_calls", "progress_events"], 0],
  ]) {
    const record = value[section];
    if (!isRecord(record)) {
      issues.push(
        problem({
          code: record === undefined ? "required_field_missing" : "field_type_mismatch",
          source,
          field: `${field}.${section}`,
          expected: "object",
          actual: record === undefined ? "missing" : actualType(record),
          message: `Field '${field}.${section}' is required and must be an object.`,
        }),
      );
      continue;
    }
    for (const key of fields) {
      const issue = positiveIntegerIssue(record[key], source, `${field}.${section}.${key}`, minimum);
      if (issue) issues.push(issue);
    }
  }

  const configured = isRecord(value.configured) ? value.configured : {};
  if (
    Number.isInteger(configured.warn_after_assistant_turns) &&
    Number.isInteger(configured.max_assistant_turns) &&
    configured.warn_after_assistant_turns >= configured.max_assistant_turns
  ) {
    issues.push(
      problem({
        code: "field_value_invalid",
        source,
        field: `${field}.configured.warn_after_assistant_turns`,
        expected: "integer lower than max_assistant_turns",
        actual: String(configured.warn_after_assistant_turns),
        message: `Field '${field}.configured.warn_after_assistant_turns' must be lower than max_assistant_turns.`,
      }),
    );
  }

  if (
    value.exhausted_dimension !== null &&
    value.exhausted_dimension !== undefined &&
    !["assistant_turns", "tool_calls"].includes(value.exhausted_dimension)
  ) {
    issues.push(
      problem({
        code: "enum_value_invalid",
        source,
        field: `${field}.exhausted_dimension`,
        expected: "assistant_turns|tool_calls|null",
        actual: String(value.exhausted_dimension),
        message: `Field '${field}.exhausted_dimension' must name a supported hard bound.`,
      }),
    );
  }

  if (value.termination !== undefined) {
    if (!isRecord(value.termination)) {
      issues.push(
        problem({
          code: "field_type_mismatch",
          source,
          field: `${field}.termination`,
          expected: "object",
          actual: actualType(value.termination),
          message: `Field '${field}.termination' must be an object.`,
        }),
      );
    } else {
      if (typeof value.termination.requested !== "boolean") {
        issues.push(
          problem({
            code:
              value.termination.requested === undefined ? "required_field_missing" : "field_type_mismatch",
            source,
            field: `${field}.termination.requested`,
            expected: "boolean",
            actual:
              value.termination.requested === undefined
                ? "missing"
                : actualType(value.termination.requested),
            message: `Field '${field}.termination.requested' must be a boolean.`,
          }),
        );
      }
      for (const key of ["graceful_signal", "forced_signal"]) {
        const signal = value.termination[key];
        if (signal !== undefined && signal !== null && typeof signal !== "string") {
          issues.push(
            problem({
              code: "field_type_mismatch",
              source,
              field: `${field}.termination.${key}`,
              expected: "string|null",
              actual: actualType(signal),
              message: `Field '${field}.termination.${key}' must be a string or null.`,
            }),
          );
        }
      }
    }
  }
  return issues;
}
