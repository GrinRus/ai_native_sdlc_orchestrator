---
name: story-traceability
description: Assess whether an AOR change closes a supported role-based user outcome and identify the contracts, executable flow, and acceptance evidence that prove it.
---

1. Find the role and story in `docs/product/00-supported-user-stories.md` and
   state the intended user outcome. Preserve the documented implementation status;
   a planned story is not evidence of an executable flow.
2. Trace the outcome through its packet/contract, public CLI/API/web action,
   policy decision, and durable result. Use the owning wave's acceptance criteria
   when a slice is involved; read `docs/architecture/12-orchestrator-operating-model.md`
   when lifecycle ownership is unclear.
3. Identify the test, runnable command, or captured evidence that demonstrates
   closure, including the relevant failure or recovery path. Distinguish current
   implementation, deterministic test coverage, and live acceptance evidence;
   do not infer one from another.
4. Report missing links with the exact owning files and the smallest correction.
   Reviews and planning requests remain read-only. If the request also includes
   changes, update the relevant source docs, flow, or backlog within that scope
   and verify using [the validation matrix](../../../CONTRIBUTING.md#validation-by-change-type).
