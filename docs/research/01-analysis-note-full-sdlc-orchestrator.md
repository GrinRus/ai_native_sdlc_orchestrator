# Analysis note: full-SDLC orchestrator

## Framing
The design question is not "how do we wrap one coding agent?" The design question is "what control plane is required to close the full SDLC in a safe, inspectable, and replayable way?"

## Main conclusion
AOR should be built as an **AI-native SDLC control plane** with five equal layers:
1. knowledge orchestration;
2. execution orchestration;
3. quality orchestration;
4. delivery orchestration;
5. learning orchestration.

## Why delivery-only automation is not enough
A delivery-focused system is useful, but it leaves open problems around:
- project bootstrap and repeatable onboarding;
- discovery and specification quality;
- route, wrapper, and prompt evolution;
- certification and promotion;
- incident-to-regression learning;
- multirepo impact analysis;
- detached operator surfaces and long-running workflows.

## What AOR must add on top of delivery-first systems
- a bootstrap flow: `init → analyze → validate → verify`;
- a durable packet chain from discovery to release;
- a runner-agnostic adapter model;
- validation, eval, and harness as built-in step classes;
- a delivery manifest as a first-class object;
- promotion and freeze logic for platform assets;
- a live E2E target catalog using real public repositories.

## Why a control-plane architecture fits
A control plane gives AOR the right boundaries:
- it owns decisions and durable state;
- it lets runners stay replaceable;
- it supports approvals and pause/resume behavior;
- it keeps platform quality loops attached to execution;
- it makes incident learning operational rather than aspirational.

## Design consequence
The orchestrator stack should resolve execution in a consistent order:

`project profile → route → wrapper → prompt bundle → step policy → adapter/provider/model execution`

That stack keeps execution explainable and makes asset evolution testable.
