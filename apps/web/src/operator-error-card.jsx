import React from "react";

export function ResourceErrorCard({ errors }) {
  if (Object.keys(errors).length === 0) return null;
  return (
    <div className="alert" role="status">
      <strong>Some live resources are unavailable.</strong>
      <span> Last-known data is retained; affected actions remain non-authoritative.</span>
      <ul>
        {Object.entries(errors).map(([resource, error]) => (
          <li key={resource}>
            <strong>{resource}</strong>: {error.title ?? error.message}
            {error.consequence ? ` — ${error.consequence}` : ""}
            {error.recoveryActions?.length ? (
              <span> Recovery: {error.recoveryActions.map((action) => action.label ?? action.action).join(", ")}.</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
