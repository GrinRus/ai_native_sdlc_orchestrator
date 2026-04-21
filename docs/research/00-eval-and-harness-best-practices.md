# Eval and harness best practices

## Why this matters for AOR
AOR does not just run coding sessions. It has to decide whether a route, wrapper, prompt bundle, adapter, or full run is trustworthy enough to use. That makes eval and harness part of the product core, not a side tool.

## Best practices we are adopting

### 1. Separate deterministic validation from evaluation
Run objective checks first: schema validity, allowed scope, required evidence, build, lint, and tests. Use judge-based or rubric-based evaluation only after deterministic checks pass.

### 2. Use task-specific suites
AOR should not rely on one generic benchmark. It needs suites for:
- run regression,
- release readiness,
- wrapper certification,
- adapter certification,
- incident backfill,
- live E2E rehearsal.

### 3. Treat datasets and suites as first-class assets
Each dataset and suite needs:
- explicit subject type,
- provenance,
- split or tag metadata,
- flake policy,
- versioned references,
- promotion and quarantine rules.

### 4. Log everything needed to reproduce a decision
The system should keep transcripts, tool traces, command outputs, diffs, validation reports, evaluation results, and route/wrapper/adapter metadata. Without that evidence, certification and incident review become guesswork.

### 5. Compare candidates against baselines
For platform changes, absolute scores are not enough. AOR should support candidate-versus-stable comparison for wrappers, routes, adapters, and full flows.

### 6. Keep online and offline quality loops separate
Offline certification is where a candidate becomes eligible. Online monitoring is where production behavior is observed. The two loops should inform each other without being collapsed into one noisy signal.

### 7. Support replay and failure-mode injection
Harness should be able to replay previous runs, compare traces, and inject failures so the orchestrator can be tested for resilience rather than only happy-path success.

### 8. Calibrate humans into the loop
Flaky cases, ambiguous judge results, and policy disagreements need a human path. AOR should support review queues and explicit sign-off records rather than pretending those cases are fully automatic.

## Implications for the AOR architecture
- Eval must be a standard step class, not an afterthought.
- Harness must reuse the same route, wrapper, and policy concepts as normal execution.
- Promotion decisions must be durable artifacts.
- Incident reports must be able to backfill new regression cases.
- Live E2E runs on public repositories should be part of certification, not a separate ritual.

## Why `ai_driven_dev` still matters as a reference
`GrinRus/ai_driven_dev` is useful because it shows a practical artifact-driven delivery slice built around idea → research → plan → review-spec → tasklist → implement → review → qa. AOR extends that mindset into the rest of the SDLC and makes eval, harness, and platform-asset certification first-class.

## Why the Habr article matters
The Habr article is valuable because it argues that the working context for an AI developer must live outside the model and that harness is more than a big prompt: it is the runtime environment, rules, tests, validation, review, and recovery loop around execution.

## External references
- [OpenAI: evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Anthropic: demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [OpenAI: sandboxes for agents](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [OpenAI: Codex skills](https://developers.openai.com/codex/skills)
- [Habr article](https://habr.com/ru/articles/1012654/)
- [GrinRus/ai_driven_dev](https://github.com/GrinRus/ai_driven_dev)
