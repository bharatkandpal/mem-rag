# Rule: AI usage & secrets

Binding. Derived from TDD §2.5 and PRD §6.

## Model & generation
- Generation uses **Claude `claude-opus-4-8`** via `@anthropic-ai/sdk`. Don't downgrade the model or hardcode a different ID without a stated reason.
- Enable **native citations** (`citations: {enabled: true}` on `document` content blocks). Cited answers are a core requirement, not a nice-to-have.
- **Abstain on empty retrieval.** If no chunk clears the score floor, return "not in the corpus" — never free-generate an answer. Grounding is the whole product.
- Consult the `claude-api` capability (one level up) for current SDK shapes rather than guessing — the API surface drifts.

## Secrets
- **Env only.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `DATABASE_URL`, etc. come from the environment.
- Never commit a key, never log one, never embed one in a prompt or a test fixture. `.env` is git-ignored; `.env.example` documents the keys with placeholder values.
