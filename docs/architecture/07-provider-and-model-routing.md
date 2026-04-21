# Provider and model routing

## Purpose
Routing chooses how a step is executed without hard-coding provider behavior into orchestrator core.

## Inputs to route resolution
- step type and risk tier
- required adapter capabilities
- budget and timeout constraints
- project allowlists
- promotion channel and frozen state
- fallback policy
- current workflow mode such as execution, eval, or harness

## Route outputs
- adapter
- provider
- model alias or concrete model
- wrapper profile reference
- retry and repair profile references
- constraints such as timeout, cost, and scope expansion rules

## Routing rules
- prefer stable routes by default;
- allow explicit candidate routing for certification or controlled rehearsals;
- do not select routes whose required capabilities are missing;
- never bypass project allowlists;
- respect frozen or demoted assets.
