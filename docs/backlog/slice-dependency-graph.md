# Slice dependency graph

## Purpose
This document shows the hard-dependency structure for all defined implementation slices.

## Mermaid graph
```mermaid
flowchart TB
  W0S01[W0-S01 Workspace and package build baseline]
  W0S02[W0-S02 Contracts package and schema loader baseline]
  W0S03[W0-S03 Example and reference integrity checks]
  W0S04[W0-S04 Agent guidance and backlog workflow baseline]
  W0S05[W0-S05 Live E2E profile registry and no-write preflight]
  W0S06[W0-S06 Repository CI and acceptance gates]
  W1S01[W1-S01 Bootstrap CLI shell and command contracts]
  W1S02[W1-S02 Project init and profile loading runtime]
  W1S03[W1-S03 Project analysis engine and durable analysis report]
  W1S04[W1-S04 Deterministic project validate flow]
  W1S05[W1-S05 Project verify flow and bounded preflight execution]
  W1S06[W1-S06 Runtime store and artifact packet materialization]
  W1S07[W1-S07 Wave ticket and handoff packet foundation]
  W1S08[W1-S08 Bootstrap end-to-end rehearsal]
  W2S01[W2-S01 Route registry and step resolution kernel]
  W2S02[W2-S02 Wrapper, prompt-bundle, and asset loader runtime]
  W2S03[W2-S03 Step policy resolution, budgets, and guardrails]
  W2S04[W2-S04 Adapter SDK and mock adapter baseline]
  W2S05[W2-S05 Routed step execution engine and durable step results]
  W2S06[W2-S06 First routed execution rehearsal]
  W3S01[W3-S01 Validation kernel generalization and asset graph checks]
  W3S02[W3-S02 Dataset and evaluation suite registry]
  W3S03[W3-S03 Eval runner and scorer interface]
  W3S04[W3-S04 Harness capture and replay runtime]
  W3S05[W3-S05 Certification and promotion decision baseline]
  W3S06[W3-S06 Quality rehearsal on selected public targets]
  W4S01[W4-S01 Isolated worktree and workspace execution foundation]
  W4S02[W4-S02 Delivery planning and write-back mode policy]
  W4S03[W4-S03 Patch and local branch delivery driver]
  W4S04[W4-S04 Fork-first GitHub PR delivery driver]
  W4S05[W4-S05 Delivery manifest and release packet materialization]
  W4S06[W4-S06 Delivery rehearsal and recovery-safe operations]
  W5S01[W5-S01 Control plane API read surface]
  W5S02[W5-S02 Live run event stream]
  W5S03[W5-S03 CLI operator commands beyond bootstrap]
  W5S04[W5-S04 Detachable web UI baseline]
  W5S05[W5-S05 Standard live E2E orchestration runner]
  W5S06[W5-S06 Scorecards, incident capture, and learning-loop handoff]
  W0S01 --> W0S02
  W0S02 --> W0S03
  W0S02 --> W0S05
  W0S03 --> W0S05
  W0S01 --> W0S06
  W0S03 --> W0S06
  W0S04 --> W0S06
  W0S05 --> W0S06
  W0S01 --> W1S01
  W0S02 --> W1S01
  W1S01 --> W1S02
  W1S02 --> W1S03
  W1S02 --> W1S04
  W0S03 --> W1S04
  W1S03 --> W1S05
  W1S04 --> W1S05
  W0S05 --> W1S05
  W1S02 --> W1S06
  W1S04 --> W1S07
  W1S06 --> W1S07
  W1S03 --> W1S08
  W1S04 --> W1S08
  W1S05 --> W1S08
  W1S07 --> W1S08
  W1S08 --> W2S01
  W2S01 --> W2S02
  W2S01 --> W2S03
  W2S01 --> W2S04
  W2S02 --> W2S05
  W2S03 --> W2S05
  W2S04 --> W2S05
  W1S06 --> W2S05
  W2S05 --> W2S06
  W1S07 --> W2S06
  W0S05 --> W2S06
  W2S05 --> W3S01
  W1S04 --> W3S01
  W3S01 --> W3S02
  W3S02 --> W3S03
  W2S04 --> W3S03
  W2S05 --> W3S03
  W3S02 --> W3S04
  W2S05 --> W3S04
  W3S03 --> W3S05
  W3S04 --> W3S05
  W3S05 --> W3S06
  W0S05 --> W3S06
  W2S05 --> W4S01
  W1S05 --> W4S01
  W4S01 --> W4S02
  W1S07 --> W4S02
  W3S05 --> W4S02
  W4S02 --> W4S03
  W4S02 --> W4S04
  W2S04 --> W4S04
  W4S03 --> W4S05
  W4S04 --> W4S05
  W3S05 --> W4S05
  W4S05 --> W4S06
  W0S05 --> W4S06
  W4S05 --> W5S01
  W2S05 --> W5S01
  W5S01 --> W5S02
  W2S05 --> W5S02
  W5S01 --> W5S03
  W5S02 --> W5S03
  W5S01 --> W5S04
  W5S02 --> W5S04
  W5S03 --> W5S05
  W4S06 --> W5S05
  W3S06 --> W5S05
  W5S05 --> W5S06
  W3S05 --> W5S06
```

## W0 hard dependencies
| Slice ID | Depends on |
|---|---|
| W0-S01 | none |
| W0-S02 | W0-S01 |
| W0-S03 | W0-S02 |
| W0-S04 | none |
| W0-S05 | W0-S02, W0-S03 |
| W0-S06 | W0-S01, W0-S03, W0-S04, W0-S05 |

## W1 hard dependencies
| Slice ID | Depends on |
|---|---|
| W1-S01 | W0-S01, W0-S02 |
| W1-S02 | W1-S01 |
| W1-S03 | W1-S02 |
| W1-S04 | W1-S02, W0-S03 |
| W1-S05 | W1-S03, W1-S04, W0-S05 |
| W1-S06 | W1-S02 |
| W1-S07 | W1-S04, W1-S06 |
| W1-S08 | W1-S03, W1-S04, W1-S05, W1-S07 |

## W2 hard dependencies
| Slice ID | Depends on |
|---|---|
| W2-S01 | W1-S08 |
| W2-S02 | W2-S01 |
| W2-S03 | W2-S01 |
| W2-S04 | W2-S01 |
| W2-S05 | W2-S02, W2-S03, W2-S04, W1-S06 |
| W2-S06 | W2-S05, W1-S07, W0-S05 |

## W3 hard dependencies
| Slice ID | Depends on |
|---|---|
| W3-S01 | W2-S05, W1-S04 |
| W3-S02 | W3-S01 |
| W3-S03 | W3-S02, W2-S04, W2-S05 |
| W3-S04 | W3-S02, W2-S05 |
| W3-S05 | W3-S03, W3-S04 |
| W3-S06 | W3-S05, W0-S05 |

## W4 hard dependencies
| Slice ID | Depends on |
|---|---|
| W4-S01 | W2-S05, W1-S05 |
| W4-S02 | W4-S01, W1-S07, W3-S05 |
| W4-S03 | W4-S02 |
| W4-S04 | W4-S02, W2-S04 |
| W4-S05 | W4-S03, W4-S04, W3-S05 |
| W4-S06 | W4-S05, W0-S05 |

## W5 hard dependencies
| Slice ID | Depends on |
|---|---|
| W5-S01 | W4-S05, W2-S05 |
| W5-S02 | W5-S01, W2-S05 |
| W5-S03 | W5-S01, W5-S02 |
| W5-S04 | W5-S01, W5-S02 |
| W5-S05 | W5-S03, W4-S06, W3-S06 |
| W5-S06 | W5-S05, W3-S05 |

## Topological order
1. W0-S01
2. W0-S04
3. W0-S02
4. W0-S03
5. W1-S01
6. W0-S05
7. W1-S02
8. W0-S06
9. W1-S03
10. W1-S04
11. W1-S06
12. W1-S05
13. W1-S07
14. W1-S08
15. W2-S01
16. W2-S02
17. W2-S03
18. W2-S04
19. W2-S05
20. W2-S06
21. W3-S01
22. W4-S01
23. W3-S02
24. W3-S03
25. W3-S04
26. W3-S05
27. W3-S06
28. W4-S02
29. W4-S03
30. W4-S04
31. W4-S05
32. W4-S06
33. W5-S01
34. W5-S02
35. W5-S03
36. W5-S04
37. W5-S05
38. W5-S06

## Planning rule
If a slice becomes too large during implementation, split it by introducing a new slice between existing hard dependencies rather than hiding extra work inside local tasks. Update the owning wave document, the master backlog, the epic map, and this graph together.
