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
  W6S01[W6-S01 Backlog and slice-cycle extensibility for W6+]
  W6S02[W6-S02 Intake/discovery/spec/wave command pack]
  W6S03[W6-S03 Run-control command pack with policy and audit guardrails]
  W6S04[W6-S04 UI attach/detach lifecycle command pack]
  W6S05[W6-S05 Delivery/release prepare command pack]
  W6S06[W6-S06 Incident and audit command pack]
  W7S01[W7-S01 Governance quality guardrails and evidence parity]
  W7S02[W7-S02 AI platform promotion/freeze maturity pack]
  W7S03[W7-S03 Incident recertification and controlled re-enable flow]
  W7S04[W7-S04 Finance evidence and audit durability expansion]
  W7S05[W7-S05 MVP+ governance and learning-loop integration closure]
  W8S01[W8-S01 Sponsor and planner strategic visibility expansion]
  W8S02[W8-S02 Later discovery and architecture maturity pack]
  W8S03[W8-S03 Later delivery and security route-governance maturity]
  W8S04[W8-S04 Later operator event and policy visibility expansion]
  W8S05[W8-S05 Later QA and AI platform baseline comparison maturity]
  W8S06[W8-S06 Later incident and platform recertification maturity]
  W8S07[W8-S07 Later multi-repo, bootstrap, and delivery rerun maturity]
  W8S08[W8-S08 Runtime context compiler and adapter-context injection]
  W8S09[W8-S09 Context asset lifecycle and quality-gated update flow]
  W9S01[W9-S01 Run-scoped routed evidence durability bugfix]
  W9S02[W9-S02 Current-state documentation drift repair]
  W9S03[W9-S03 Control-plane API contract/runtime alignment]
  W9S04[W9-S04 Machine-checkable control-plane API contract coverage]
  W9S05[W9-S05 Public harness replay command surface]
  W9S06[W9-S06 Asset promote/freeze command surface completion]
  W9S07[W9-S07 Detached HTTP control-plane transport baseline]
  W9S08[W9-S08 First real provider adapter and live execution foundation]
  W10S01[W10-S01 External live adapter execution baseline]
  W10S02[W10-S02 Networked fork-first delivery execution]
  W10S03[W10-S03 Detached transport mutation command baseline]
  W10S04[W10-S04 Detached transport authn/authz hardening baseline]
  W10S05[W10-S05 Externally verified live E2E target-catalog proof]
  W11S01[W11-S01 Source-of-truth reality repair]
  W11S02[W11-S02 Target workspace materialization for live E2E]
  W11S03[W11-S03 Profile-driven preflight and routed live execution]
  W11S04[W11-S04 Target-anchored delivery and release evidence]
  W11S05[W11-S05 Fresh external proof bundle for catalog targets]

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
  W5S06 --> W6S01
  W6S01 --> W6S02
  W6S01 --> W6S03
  W5S03 --> W6S03
  W6S03 --> W6S04
  W5S04 --> W6S04
  W6S03 --> W6S05
  W4S05 --> W6S05
  W6S03 --> W6S06
  W5S06 --> W6S06
  W6S03 --> W7S01
  W3S04 --> W7S01
  W7S01 --> W7S02
  W3S05 --> W7S02
  W7S02 --> W7S03
  W6S06 --> W7S03
  W6S06 --> W7S04
  W7S02 --> W7S05
  W7S03 --> W7S05
  W7S04 --> W7S05
  W7S05 --> W8S01
  W6S02 --> W8S02
  W7S05 --> W8S02
  W6S03 --> W8S03
  W7S05 --> W8S03
  W8S08 --> W8S03
  W6S03 --> W8S04
  W7S05 --> W8S04
  W8S08 --> W8S04
  W7S01 --> W8S05
  W7S02 --> W8S05
  W7S03 --> W8S06
  W7S04 --> W8S06
  W7S05 --> W8S06
  W6S05 --> W8S07
  W6S02 --> W8S07
  W8S04 --> W8S07
  W8S06 --> W8S07
  W6S03 --> W8S08
  W7S05 --> W8S08
  W8S08 --> W8S09
  W7S02 --> W8S09
  W8S05 --> W8S09
  W8S08 --> W9S01
  W8S04 --> W9S03
  W9S03 --> W9S04
  W3S04 --> W9S05
  W8S05 --> W9S05
  W7S02 --> W9S06
  W8S09 --> W9S06
  W9S03 --> W9S07
  W9S04 --> W9S07
  W9S01 --> W9S08
  W8S03 --> W9S08
  W8S08 --> W9S08
  W9S08 --> W10S01
  W4S04 --> W10S02
  W6S05 --> W10S02
  W9S07 --> W10S03
  W6S03 --> W10S03
  W6S04 --> W10S03
  W10S03 --> W10S04
  W11S01 --> W11S02
  W11S02 --> W11S03
  W11S03 --> W11S04
  W11S04 --> W11S05
  W10S01 --> W10S05
  W10S02 --> W10S05
  W11S05 --> W10S05
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

## W6 hard dependencies
| Slice ID | Depends on |
|---|---|
| W6-S01 | W5-S06 |
| W6-S02 | W6-S01 |
| W6-S03 | W6-S01, W5-S03 |
| W6-S04 | W6-S03, W5-S04 |
| W6-S05 | W6-S03, W4-S05 |
| W6-S06 | W6-S03, W5-S06 |

## W7 hard dependencies
| Slice ID | Depends on |
|---|---|
| W7-S01 | W6-S03, W3-S04 |
| W7-S02 | W7-S01, W3-S05 |
| W7-S03 | W7-S02, W6-S06 |
| W7-S04 | W6-S06 |
| W7-S05 | W7-S02, W7-S03, W7-S04 |

## W8 hard dependencies
| Slice ID | Depends on |
|---|---|
| W8-S01 | W7-S05 |
| W8-S02 | W6-S02, W7-S05 |
| W8-S03 | W6-S03, W7-S05, W8-S08 |
| W8-S04 | W6-S03, W7-S05, W8-S08 |
| W8-S05 | W7-S01, W7-S02 |
| W8-S06 | W7-S03, W7-S04, W7-S05 |
| W8-S07 | W6-S05, W6-S02, W8-S04, W8-S06 |
| W8-S08 | W6-S03, W7-S05 |
| W8-S09 | W8-S08, W7-S02, W8-S05 |

## W9 hard dependencies
| Slice ID | Depends on |
|---|---|
| W9-S01 | W8-S08 |
| W9-S02 | none |
| W9-S03 | W8-S04 |
| W9-S04 | W9-S03 |
| W9-S05 | W3-S04, W8-S05 |
| W9-S06 | W7-S02, W8-S09 |
| W9-S07 | W9-S03, W9-S04 |
| W9-S08 | W9-S01, W8-S03, W8-S08 |

## W10 hard dependencies
| Slice ID | Depends on |
|---|---|
| W10-S01 | W9-S08 |
| W10-S02 | W4-S04, W6-S05 |
| W10-S03 | W9-S07, W6-S03, W6-S04 |
| W10-S04 | W10-S03 |
| W10-S05 | W10-S01, W10-S02, W11-S05 |

## W11 hard dependencies
| Slice ID | Depends on |
|---|---|
| W11-S01 | none |
| W11-S02 | W11-S01 |
| W11-S03 | W11-S02 |
| W11-S04 | W11-S03 |
| W11-S05 | W11-S04 |

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
39. W6-S01
40. W6-S02
41. W6-S03
42. W6-S04
43. W6-S05
44. W6-S06
45. W7-S01
46. W7-S02
47. W7-S04
48. W7-S03
49. W8-S05
50. W7-S05
51. W8-S01
52. W8-S02
53. W8-S08
54. W8-S03
55. W8-S04
56. W8-S06
57. W8-S09
58. W8-S07
59. W9-S01
60. W9-S02
61. W9-S03
62. W9-S05
63. W9-S06
64. W9-S04
65. W9-S07
66. W9-S08
67. W10-S01
68. W10-S02
69. W10-S03
70. W10-S04
71. W11-S01
72. W11-S02
73. W11-S03
74. W11-S04
75. W11-S05
76. W10-S05

## Planning rule
If a slice becomes too large during implementation, split it by introducing a new slice between existing hard dependencies rather than hiding extra work inside local tasks. Update the owning wave document, the master backlog, the epic map, and this graph together.
