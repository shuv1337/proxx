---
name: feature-worker
description: Implements new features in the proxx codebase — backend TypeScript (Fastify/Node.js) and frontend React
---

# Feature Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for new feature implementation that adds functionality to the proxx OpenAI proxy. This includes new provider integrations, new API endpoints, new UI components, and supporting infrastructure (credential loading, auth flows, etc.).

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Read `AGENTS.md` for mission boundaries and conventions. If the feature involves Factory.ai, read `.factory/library/factory-api.md` for API reference.

Read the specific source files that will be modified. Understand existing patterns by examining similar code (e.g., how other providers are registered, how existing strategies work).

### 2. Investigate Reference Code

For Factory.ai features, read the reference implementation at `/tmp/factory-openai-proxy/src/` to understand:
- How Factory.ai's API is called
- What headers are required
- How request/response translation works
- Known quirks and workarounds

### 3. Write Tests First (Red)

Before making any implementation changes:
- Create or extend test files in `src/tests/` using Node.js `node:test` and `assert`
- Write test cases covering each `expectedBehavior` item
- For HTTP intercept tests, use test doubles or mock functions
- Run `pnpm test` to confirm tests fail (red phase)
- If the feature is purely visual, document the manual verification plan

### 4. Implement the Feature (Green)

Build the minimum code to make all tests pass:
- Follow existing code patterns and style
- Match naming conventions (kebab-case files, camelCase functions)
- Do not add new npm dependencies without checking if an existing one covers the need
- Keep Factory-specific code isolated in dedicated files (e.g., `factory-compat.ts`, `factory-auth.ts`)
- Do not modify existing provider strategies — create new Factory-specific ones

### 5. Verify the Feature

Run ALL of these in order:
1. `pnpm typecheck` — must pass with zero errors
2. `pnpm test` — must pass, including your new tests
3. Manual verification:
   - **Backend/API features**: Start the backend (`pnpm dev` or use services.yaml), use curl to verify endpoints
   - **Frontend features**: Use agent-browser to verify UI changes at http://127.0.0.1:5174
   - **Config features**: Verify with unit tests and env var manipulation
4. Check for regressions: run the full test suite, verify adjacent functionality

### 6. Commit

Commit all changes with a descriptive message prefixed with `feat:`. Include only files related to this feature.

## Example Handoff

```json
{
  "salientSummary": "Implemented FactoryProviderStrategy with tri-endpoint routing for Factory.ai. Claude models route to /api/llm/a/v1/messages, GPT to /api/llm/o/v1/responses, common to /api/llm/o/v1/chat/completions. All Factory-specific headers included (x-api-provider, stainless SDK, x-factory-client, x-api-key placeholder). Added 12 tests covering endpoint routing, header generation, and model-to-type mapping. pnpm typecheck and pnpm test both pass (59 tests).",
  "whatWasImplemented": "Created src/lib/factory-compat.ts with FactoryProviderStrategy class extending TransformedJsonProviderStrategy. Implements getUpstreamUrl() for tri-endpoint routing based on model type, applyRequestHeaders() for Factory-specific headers, and getModelType() for claude/gpt/common classification. System prompt inlining for fk- keys handled in transformRequest().",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "pnpm test", "exitCode": 0, "observation": "59 tests passed including 12 new factory tests" },
      { "command": "curl -X POST http://127.0.0.1:8789/v1/chat/completions -H 'Authorization: Bearer ...' -H 'Content-Type: application/json' -d '{\"model\":\"factory/claude-opus-4-5\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}'", "exitCode": 0, "observation": "Request routed to Factory.ai, response received successfully" }
    ],
    "interactiveChecks": [
      { "action": "Verified GET /v1/models includes Factory models", "observed": "Model list contains claude-opus-4-5, gpt-5, gemini-3-pro-preview from Factory catalog" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/tests/factory.test.ts",
        "cases": [
          { "name": "routes claude-opus-4-5 to Anthropic Messages endpoint", "verifies": "VAL-ROUTE-001" },
          { "name": "routes gpt-5 to OpenAI Responses endpoint", "verifies": "VAL-ROUTE-002" },
          { "name": "includes x-api-provider header", "verifies": "VAL-HEADER-002" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature requires modifying existing provider strategies (which is off-limits)
- A dependency on an unimplemented API endpoint or data model is discovered
- Factory.ai API behavior differs from the reference implementation in ways that affect architecture
- The test suite has pre-existing failures unrelated to this feature
- Requirements are ambiguous or contradictory
