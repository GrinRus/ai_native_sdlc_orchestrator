# Product scope and personas

## Product scope
AOR covers the full SDLC control flow for software delivery:
- bootstrap and onboarding,
- intake and discovery,
- research and specification,
- planning and approval,
- execution, review, QA, and repair,
- delivery and release,
- incidents, learning, and recertification.

## Primary personas
- product sponsor
- analyst / researcher
- architect / tech lead
- engineering manager / planner
- delivery engineer
- reviewer / QA lead
- AI platform owner
- operator / SRE
- security / compliance owner
- repository / multirepo owner
- incident / improvement owner

## Scope in MVP
- one bounded project at a time;
- monolith or bounded multirepo topology;
- multiple runner backends through adapters;
- live E2E profiles on selected public repositories;
- explicit approvals and delivery artifacts.

## Out of scope for MVP
- autonomous organization-wide orchestration;
- hidden write-back to upstream public repositories;
- UI-dependent execution;
- self-improving prompts without certification and approval.
