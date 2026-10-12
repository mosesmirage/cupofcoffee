# Pricing Intelligence — Requirements

## Purpose and scope

Help independent app developers compare transparent, locally adjusted one-time purchase prices. The MVP covers paid mobile apps in the United States (USD), Türkiye (TRY), the United Kingdom (GBP), and Germany (EUR). Subscription pricing and advanced integrations are out of scope.

Recommendations are deterministic decision support, not predictions of willingness to pay or optimal revenue. The dashboard must work without an AI API key.

## User stories

1. As an indie developer, I can enter a reference app price and currency and compare localized recommendations across the four initial markets.
2. As a developer, I can switch among Accessible, Balanced, and Premium strategies and understand how each changes the result.
3. As a developer, I can inspect conversion, purchasing-power adjustment, strategy adjustment, coffee comparison, and price-point rounding separately.
4. As a developer, I can distinguish sourced values from illustrative demo values, including their provenance and dates.
5. As a developer, I can simulate revenue using my audience and conversion assumptions and see the assumptions and limitations.
6. As a developer, I can get an explanation of the result when AI is unavailable; optional AI can explain, but cannot change, calculated prices.

## Functional requirements

- **FR1 — Markets and currency:** Support US/USD, Türkiye/TRY, UK/GBP, and Germany/EUR in the recommendation view.
- **FR2 — One-time app price:** Accept a positive reference price and its currency. Do not model subscriptions in this MVP.
- **FR3 — Deterministic pricing:** Compute recommendations from explicit market data, strategy configuration, and a documented methodology. Identical inputs and methodology version produce identical results.
- **FR4 — Distinct steps:** Show the converted anchor, purchasing-power adjustment and factor, strategy-adjusted anchor and factor, local price point selected, and final price. Keep coffee comparison informational unless a user explicitly enables its optional guardrail. `design.md` must document the purchasing-power index or adjustment method, base country, comparison direction, units and normalization, exact formula, and fallback when reliable index data is unavailable. Do not assume suitable index data exists or invent empirical coefficients.
- **FR5 — Strategies:** Provide Accessible, Balanced, and Premium. Their configurable factors must be ordered Accessible ≤ Balanced ≤ Premium. Label factors as assumptions, not empirical coefficients.
- **FR6 — Coffee context:** Show local coffee benchmark provenance and the recommended price expressed as a coffee equivalent. With the guardrail disabled, changing coffee price cannot change the recommended app price.
- **FR7 — Local price points:** Select from explicit market-specific price points using a documented, deterministic monotonic rounding rule. Label unsourced demo points illustrative.
- **FR8 — Data status:** Display data status and source/date for sourced inputs; visibly label illustrative exchange rates, purchasing-power factors, coffee prices, and price points as demo assumptions.
- **FR9 — Revenue scenarios:** Let users configure audience size and conversion-rate assumptions for each market, plus any fee assumption. Shared audience and conversion assumptions across markets are acceptable for the MVP only when explicitly labeled as simplifying scenario assumptions. Make clear which assumptions apply to each market. Present every calculated revenue result as a hypothetical scenario, not a forecast.
- **FR10 — Advisor fallback and data integrity:** Provide a deterministic explanation without AI. The advisor may use only supplied calculation results and documented inputs; it must not invent exchange rates, coffee prices, purchasing-power indices, conversion rates, competitor data, or market statistics. It must distinguish verified data from illustrative assumptions and must never override or silently modify deterministic pricing results.
- **FR11 — Responsive dashboard:** Make the comparison and assumptions usable on desktop and narrow screens.

## Acceptance criteria

- All four initial markets can be selected and show a local currency recommendation for each of the three strategies when complete inputs are available.
- For each result, the UI shows the conversion rate/status, purchasing-power factor/status, strategy factor, pre-round value, selected price point, coffee equivalent/status, and final amount.
- No unsupported market statistic or unsourced value is described as verified. Any illustrative input is labeled in both the data model and user-facing interface.
- The design documents the purchasing-power method, comparison base and direction, units/normalization, exact formula, and transparent fallback for missing reliable data. Unit tests verify adjustment direction, repeatability for identical inputs, and transparent handling of missing or illustrative data.
- Turning the coffee guardrail off makes the recommendation invariant to coffee benchmark changes; the coffee equivalent may still change.
- Strategy prices are non-decreasing Accessible → Balanced → Premium after rounding, including ties. Invalid factor ordering is rejected or surfaced, not silently normalized.
- Revenue results update when audience, conversion, price, or configured fee changes and expose the assumptions applying to each market. Shared assumptions, if used, are labeled as simplifying assumptions; all calculated results are identified as hypothetical scenarios, not forecasts.
- Pricing and revenue logic has unit tests for ordinary cases and edge cases; tests pass.
- The advisor uses only supplied results and documented inputs, labels verified versus illustrative data, makes no unsupported factual claims, and does not alter engine results. Deterministic explanations remain available with no AI API key.
