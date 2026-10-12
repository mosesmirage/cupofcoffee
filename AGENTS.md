# CupOfCoffee project guidance

## Product and scope

CupOfCoffee helps independent developers explore locally appropriate prices for paid mobile apps with one-time purchases. The initial markets are the United States (USD), Türkiye (TRY), the United Kingdom (GBP), and Germany (EUR). Keep the MVP small enough for a one-day hackathon.

## Project conventions

- Use TypeScript, Next.js App Router, Tailwind CSS, and Recharts as described in the project plan.
- Keep pricing and revenue calculations in small, pure functions with explicit inputs and outputs. Keep UI components focused on presentation and interaction.
- Prefer simple local configuration and typed data structures. Do not add a database or service layer without a documented MVP need.
- Name units and currencies explicitly; do not pass ambiguous numeric values where currency, rate direction, or percentage basis matters.
- Keep user-facing explanations concise and show the assumptions behind recommendations and scenarios.

## Specification authority

- `specs/pricing-intelligence/design.md` is the canonical source for pricing formulas, strategy factors, rounding rules, and revenue simulation assumptions. Do not change these decisions without explicit user approval.
- If implementation requirements conflict with the specifications, stop and explain the conflict instead of silently choosing a different approach.
- Follow `specs/pricing-intelligence/tasks.md` in order. Do not skip ahead or introduce unapproved features.
- Complete the relevant verification steps before marking a task complete. Report completed tasks, verification results, and remaining work clearly.

## Architecture boundaries

- The deterministic pricing engine is the source of all prices shown by the product. It must run without network access or an AI API key.
- Keep the optional AI Pricing Advisor separate from pricing calculation. AI may explain supplied inputs and deterministic results, but must not create, override, or silently alter a recommendation.
- Keep market data and its provenance separate from calculation logic. Do not embed undocumented market facts or coefficients in UI components.
- Keep revenue simulation separate from price recommendation; its outputs are scenarios, not forecasts.

## Determinism and data provenance

- The same explicit inputs and methodology version must produce the same output.
- Every externally sourced value must record its source, observation date, unit/currency, and relevant comparison basis.
- Every demo or placeholder value must be marked `illustrative` in data and visibly labeled as an assumption in the interface. Never present it as verified market data.
- Never describe seed data as current or verified unless its source and observation date have been checked. If reliable data is unavailable, preserve illustrative status rather than guessing; never silently substitute illustrative data for missing verified data. Keep status visible wherever data affects a recommendation or comparison.
- Do not invent empirical coefficients, market statistics, competitor sales, or current prices. Keep strategy factors and any optional coffee guardrail configurable and identify them as product assumptions.
- Currency conversion, purchasing-power adjustment, strategy adjustment, coffee context, and local price-point rounding must remain distinct and inspectable steps.
- Coffee is contextual. Changing coffee data must not change a recommendation while the optional coffee guardrail is disabled.

## Verification

- Add unit tests for pricing and revenue calculations.
- Run relevant tests after changing pricing or revenue simulation logic. Never claim tests pass unless they have actually been executed successfully. Report failed tests, skipped checks, and unresolved issues explicitly.
- Cover calculation order, provenance/illustrative flags, rounding, strategy ordering (including after rounding), coffee independence with the guardrail off, and simulation edge cases.
- Use deterministic synthetic inputs for unit tests where appropriate.
- Do not rely on visual checks alone for deterministic logic. Keep test cases tied to documented formulas.

## Hackathon execution

- Prioritize a working end-to-end MVP over additional features. Avoid unnecessary dependencies, abstractions, and infrastructure.
- Keep implementation tasks small enough to verify independently and preserve a working application at major checkpoints.
- Defer subscriptions, databases, live market APIs, and App Store Connect integration unless explicitly approved.
