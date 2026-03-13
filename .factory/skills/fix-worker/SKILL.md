---
name: fix-worker
description: Implements targeted bug fixes and improvements in the proxx codebase (backend TypeScript and frontend React/CSS)
---

# Fix Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for targeted bug fixes and improvements that touch backend TypeScript code (Fastify/Node.js), frontend React components, or CSS styling. Each feature is a self-contained fix with clear scope.

## Work Procedure

### 1. Understand the Fix

Read the feature description, preconditions, and expectedBehavior carefully. Then read the specific source files mentioned to understand the current (broken) behavior.

### 2. Write Tests First (Red)

Before making any code changes:
- Identify or create the appropriate test file in `src/tests/`
- Write test cases that verify the expected (fixed) behavior
- For backend fixes: use Node.js built-in `node:test` and `assert`
- Run `pnpm test` to confirm the tests fail (red phase)
- If the fix is CSS-only or purely visual, document what manual verification you'll do instead

### 3. Implement the Fix (Green)

Make the minimum code changes needed to fix the bug:
- Follow existing code patterns and style in the file being edited
- Do not refactor unrelated code
- Do not add new dependencies
- For CSS changes: match the existing naming conventions and specificity patterns

### 4. Verify the Fix

Run ALL of these in order:
1. `pnpm typecheck` — must pass with zero errors
2. `pnpm test` — must pass, including your new tests
3. For frontend/visual fixes: start the web dev server (`pnpm web:dev`) and use agent-browser to visually verify the fix at relevant viewport sizes
4. For backend/API fixes: use curl to verify endpoint behavior
5. Check for regressions: verify that adjacent functionality still works

### 5. Manual Verification (Required)

For every feature, you MUST do at least one manual verification:
- **CSS/layout fixes**: Use agent-browser to screenshot the dashboard at 1920px width, verify the fix visually
- **Backend fixes**: Use curl to hit the relevant endpoint and verify the response
- **Token usage fix**: Verify the code path by tracing through the logic, since live traffic may not be available

### 6. Commit

Commit all changes with a descriptive message. Include only files related to this fix.

## Example Handoff

```json
{
  "salientSummary": "Fixed donut chart legend swatches by adding background-color to .dashboard-donut-segment-N CSS classes. Verified with agent-browser at 1920px — all 6 swatches now show correct colors matching their SVG arc segments. SVG donut rendering unaffected (fill remains none). pnpm typecheck and pnpm test both pass.",
  "whatWasImplemented": "Added background-color property to each .dashboard-donut-segment-0 through .dashboard-donut-segment-5 CSS class in web/src/styles.css, using the same hex values already defined for stroke. This makes the HTML span legend swatches visible while preserving SVG circle rendering.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "pnpm test", "exitCode": 0, "observation": "All 47 tests passed" }
    ],
    "interactiveChecks": [
      { "action": "Opened dashboard at http://127.0.0.1:5174 with agent-browser at 1920x1080", "observed": "All 6 donut legend swatches visible with correct colors: cyan (#56d8ff), green (#82f0b8), amber (#ffcc7d), coral (#ff907c), blue (#82a8ff), purple (#c79bff)" },
      { "action": "Inspected SVG donut chart rendering", "observed": "Donut arcs render correctly with colored strokes, fill:none preserved" }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The bug is more complex than described and requires architectural changes
- The fix would break other functionality that can't be resolved within scope
- Required test infrastructure doesn't exist (e.g., can't run the test suite)
- The source file structure has changed significantly from what's described in the feature
