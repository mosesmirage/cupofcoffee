# Pricing Intelligence — Implementation Tasks

Ordered for a one-day hackathon. Keep the first complete path small and demonstrable; do not begin integrations before the local end-to-end flow works.

## 1. Scaffold the app shell

- Create the Next.js App Router, TypeScript, and Tailwind project structure and a single dashboard route.
- Add only required UI/chart/test dependencies.
- **Checkpoint:** app starts and renders a responsive placeholder dashboard.

## 2. Define typed market and assumption data

- Add the four market identities/currencies and typed provenance/configuration shapes.
- Populate demo values only if needed for an interactive screen; mark every such value `illustrative` and add a visible demo-data label. Do not invent values labeled sourced.
- Make purchasing-power factors configurable. Use index-derived factors only when reliable comparable data is available; otherwise use explicitly `illustrative` factors, visibly labeled in the UI.
- Add configurable strategy factors without asserting empirical calibration.
- **Checkpoint/tests:** validate required fields, positive finite values, provenance rules, illustrative purchasing-power factor status, and ordered strategy factors.

## 3. Implement deterministic pricing functions

- Implement currency conversion, purchasing-power adjustment, strategy adjustment, informational coffee comparison, and nearest-point rounding as distinct steps.
- Return intermediate values and provenance with the recommendation.
- Ensure nearest-point mapping is monotonic and strategy ordering remains non-decreasing after rounding.
- **Checkpoint/tests:** synthetic fixtures cover each step, tie-breaking, invalid inputs, monotonicity, and identical-input determinism.
- Test that changing coffee benchmark data changes the displayed coffee equivalent but never changes the recommended app price.

## 4. Implement revenue simulation

- Implement expected purchases, gross revenue, and optional net after a configured fee using the documented formulas.
- Support audience and conversion assumptions per market. Shared assumptions may be used for the MVP only when labeled as simplifying scenario assumptions and their applicable markets are explicit.
- Validate audience, conversion, fee, price, and currency inputs.
- **Checkpoint/tests:** zero audience/conversion, boundary rates, invalid values, and expected calculation cases.

## 5. Build the end-to-end dashboard

- Accept a reference one-time app price and show all four markets across Accessible, Balanced, and Premium.
- Show the calculation breakdown, coffee equivalent, provenance/demo labels, and strategy assumptions.
- Connect editable audience/conversion/fee assumptions to the revenue scenario view and chart. Clearly identify which assumptions apply to each market, label shared assumptions as simplifying assumptions, and present results as hypothetical scenarios rather than forecasts.
- **Checkpoint:** a user can change price or simulation assumptions and observe updated, labeled output without reloading.

## 6. Add explanation and finish the demo path

- Add deterministic explanations based on engine outputs. Keep any AI adapter optional and prevent it from changing prices.
- Add empty/error states for incomplete configuration and a visible statement that illustrative values are examples.
- **Checkpoint:** dashboard and explanation work with no AI key; unsupported values are not presented as facts.

## 7. Validate and prepare the demonstration

- Run pricing and revenue unit tests; fix failures.
- Manually inspect the four-market comparison, narrow-screen usability, calculation transparency, and that coffee is informational only.
- Prepare a short demo flow showing one input change, strategy comparison, assumptions, and revenue scenario limitations.
- **Checkpoint:** acceptance criteria in `requirements.md` are met and demo inputs are clearly labeled.

## Deferred beyond MVP

Subscriptions, database integration, live APIs, and App Store Connect integration remain deferred. Do not add them without explicit approval.
