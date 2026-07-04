# Rule: AI usage & secrets

Binding. Derived from TDD §2.5 and PRD §6.

## Model & generation
- Generation is **provider-swappable** via the `GenerationProvider` adapter (`src/generation/generation-provider.interface.ts`) — never call a model SDK/API directly from `GenerationService` or the controller.
- **Claude `claude-opus-4-8` via `@anthropic-ai/sdk` is the default provider** (`AnthropicGenerationProvider`) and the only one with native citations. Don't change the default or hardcode a different model ID without a stated reason — swapping the *configured* provider via `GENERATION_PROVIDER` is fine; silently changing what ships out of the box is not.
- **Citations are a capability, never a fabrication.** Enable native citations (`citations: {enabled: true}` on `document` content blocks) on providers that support them. A provider without native support reports `supportsCitations: false` and returns `citations: []` — it must never prompt-engineer a citation format as a substitute; that's the same brittleness the original Claude-only decision (D4) rejected, and worse on a smaller model.
- **Abstain on empty retrieval.** If no chunk clears the score floor, return "not in the corpus" — never free-generate an answer. This lives in `GenerationService`, above the provider, so it holds regardless of which provider is configured. Grounding is the whole product.
- Consult the `claude-api` capability (one level up) for current SDK shapes rather than guessing — the API surface drifts.

## Secrets
- **Env only.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `DATABASE_URL`, etc. come from the environment.
- Never commit a key, never log one, never embed one in a prompt or a test fixture. `.env` is git-ignored; `.env.example` documents the keys with placeholder values.
