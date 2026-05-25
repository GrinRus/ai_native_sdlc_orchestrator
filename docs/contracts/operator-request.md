# Operator Request

Durable runtime-owned request created by an operator surface when the user asks AOR to analyze, explain, revise, repair, validate, plan, implement, or review bounded project artifacts during an AOR flow stage.

An operator request is not a direct chat transcript. The request is stored as a contract artifact, validated against project scope and policy, compiled into the selected runtime step context as `packet://operator-request@...`, routed through the normal runtime path, and linked to proposal, patch, step-result, compiled-context, next-action, and audit evidence.

## Required Fields

- `request_id`: stable request identifier.
- `project_id`: owning AOR project id.
- `version`: contract version, currently `1`.
- `source_surface`: source surface such as `cli`, `api`, or `web`.
- `target_stage`: AOR flow stage the request belongs to.
- `intent_type`: one of `analyze`, `explain`, `revise-document`, `create-document`, `repair`, `validate`, `plan`, `implement`, `review`.
- `request_text`: durable raw operator request text. Read/live surfaces must prefer `request_summary`.
- `request_summary`: sanitized short summary for UI/API lists.
- `target_refs[]`: evidence, packet, compiled-context, or project-relative document refs.
- `allowed_paths[]`: bounded write/proposal scope. Non-`no-write` delivery requires explicit paths.
- `delivery_mode`: existing AOR delivery mode; default UI/CLI behavior is `no-write`.
- `status`: `created`, `running`, `completed`, `failed`, or `blocked`.
- `created_at`: ISO timestamp.
- `result_refs[]`: durable runtime output refs such as proposal/patch/step-result refs.
- `evidence_refs[]`: audit and context evidence refs.

`updated_at` is optional but SHOULD be present after the first mutation.

## Runtime Semantics

`delivery_mode=no-write` is the default and produces analysis/proposal evidence only. `patch-only` may produce patch evidence, but v1 must not silently mutate target project files; direct mutation remains gated by existing delivery modes, policy checks, and future explicit writeback flows.

The context compiler receives the request as an input packet reference. Runtime prompt selection stays based on the requested target step class, with the additional `operator-intervention` context bundle/rule describing how to treat the request as a bounded intervention.

## Read Surface Safety

Raw `request_text` can contain sensitive local context. API/UI list responses must expose sanitized summaries and refs rather than echoing raw request text by default.
