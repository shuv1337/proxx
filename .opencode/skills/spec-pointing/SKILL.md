---
name: spec-pointing
description: "Rules for story pointing, priority, epic creation, and complexity limits when authoring or reviewing specs in proxx."
trigger: "spec, story points, epic, breakdown, priority, SP, complexity"
---

# Spec Pointing & Epic Management

Use this skill when creating, reviewing, or breaking down specs.

## Core Rules

### Complexity Ceiling
**Any spec >5 SP MUST be broken into sub-specs ≤5 SP under an epic.** No exceptions.

### Story Point Scale
| SP | Meaning | Example |
|----|---------|---------|
| 1 | Trivial — single file, mechanical change | Rename a type, fix a test assertion |
| 2 | Small — few files, clear scope | Extract a function + add tests |
| 3 | Medium — cross-cutting but bounded | Create a new module, refactor a module's API |
| 5 | Large — multiple modules, significant risk | Refactor a hot path, add a new subsystem |

Anything that feels like 8+ SP must be decomposed before implementation begins.

### Priority Tiers
| Tier | Meaning | When to use |
|------|---------|-------------|
| **P0** | Blocking / correctness bug | Blocks other work, causes data loss or routing failures, is a live bug |
| **P1** | High architectural debt | Significant tech debt, near-term value, unblocks future work |
| **P2** | Important but not urgent | Improvements that matter but can wait a sprint |
| **P3** | Visionary / future | Platform integrations, long-term architecture |

### Estimation Heuristics
- If you can't describe the change in one sentence, it's ≥3 SP.
- If it touches the hot path (provider fallback, routing), add 2 SP for testing risk.
- If it requires live upstream validation, note it in the spec and defer to a dedicated session.
- If it modifies a function >200 lines, it's at least 3 SP even if the change is small.

## Epic Structure

When a spec exceeds 5 SP, create an epic:

```
specs/drafts/epics/<epic-name>-epic.md          ← epic overview
specs/drafts/epics/<epic-name>--<sub1>.md       ← sub-spec 1
specs/drafts/epics/<epic-name>--<sub2>.md       ← sub-spec 2
```

### Epic File Template
```markdown
# Epic: <Name>

**Status:** Draft
**Epic SP:** <total> (broken into N sub-specs ≤5 SP each)
**Priority:** P0|P1|P2|P3
**Parent file:** `specs/.../original-spec.md`

## Problem
<1-2 paragraphs>

## Sub-specs

| # | Sub-spec | SP | Status | File |
|---|----------|----|--------|------|
| 1 | <name> | N | ⬜ Not started | `epics/epic--sub.md` |

## Execution order
<dependency chain>

## Definition of done
- <measurable criteria>
```

### Sub-spec File Template
```markdown
# Sub-spec: <Name>

**Epic:** `epic-name-epic.md`
**SP:** N
**Priority:** P0|P1
**Status:** Draft|Done
**Depends on:** `other-sub-spec.md`

## Scope
<what changes>

## Verification
<how to validate>
```

## Status Values
- `Draft` — not started
- `In progress` — actively being worked
- `Done` — build passes, tests pass, validated
- `Deferred` — explicitly postponed with reason

## Dependency Ordering
1. P0 correctness bugs first (even if small)
2. Foundation/infrastructure before features
3. Sub-specs within an epic in dependency order
4. Hot-path changes last (highest risk)

## Validation Before Marking Done
1. `pnpm build` passes (zero errors)
2. Relevant unit tests pass
3. Full proxy test suite passes (162/162)
4. If touching the hot path: live request validation (pick a cheap model like `glm-4.7-flash`)

## Session Learnings

These patterns were validated during the 2026-04-02 audit session:

- **Dead code kills agents.** `model-selection-policies.ts` and `provider-route-policies.ts` were never imported but existed for months. Always grep for imports before editing.
- **Dual entry = drift.** `runMigrations()` hardcoded SQL while `ALL_MIGRATIONS` was the canonical list. Single source of truth prevents this.
- **Test the fix, not just the code.** The `routing-outcome-handler.ts` extraction passed build + unit tests but failed 1 proxy test because it changed behavior (403 vs 502). Integration tests catch what unit tests miss.
- **Cheap model validation.** Use `glm-4.7-flash` or `glm-4.5-air` for live validation — fast, cheap, available through ollama-cloud or zai.
- **Epic decomposition works.** The fallback-extraction epic (8 SP) was broken into 4 sub-specs (2+2+3+3). Each was independently testable and commitable.
