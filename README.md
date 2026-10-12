# CupOfCoffee

**Localized app pricing intelligence for independent developers.**

CupOfCoffee helps developers compare an app's current price with localized suggestions for the United States, Türkiye, the United Kingdom, and Germany. It combines currency conversion, a purchasing-power adjustment, configurable pricing strategies, and familiar local coffee context. Recommendations are transparent decision support—not predictions of demand or a guaranteed optimal price.

## What it does

- Compare **Accessible**, **Balanced**, and **Premium** one-time app prices across four markets.
- Show each calculation stage, its inputs, price-point rounding, and data provenance.
- Retrieve daily reference exchange rates from [Frankfurter](https://www.frankfurter.dev/) without an API key. Matching base/market currencies use an identity rate; unavailable quotes fall back to clearly labeled illustrative values.
- Load comparable private-consumption purchasing-power data from the [World Bank](https://api.worldbank.org/) when available. The app normalizes to a United States baseline and labels the source and observation year. If comparable data is unavailable, configured illustrative factors remain clearly identified.
- Search the US App Store and compare the selected app's download price in the US, Türkiye, UK, and Germany using Apple's public iTunes Search and Lookup APIs.
- Compare eligible same-currency coffee benchmarks as context. Coffee prices never change app recommendations.
- Simulate hypothetical market revenue scenarios from audience, conversion, local app price, and platform-fee assumptions.

## Markets

| Market | Currency | Apple storefront |
| --- | --- | --- |
| United States | USD | `us` |
| Türkiye | TRY | `tr` |
| United Kingdom | GBP | `gb` |
| Germany | EUR | `de` |

## How pricing works

For a base price `P`, the engine applies these steps in order:

1. Convert using the configured rate: `converted = P × rateToLocal`.
2. Apply the relative purchasing-power factor: `localAnchor = converted × purchasingPowerFactor`.
3. Apply the selected strategy factor: `strategyAnchor = localAnchor × strategyFactor`.
4. Select the nearest configured local price point. Exact ties resolve to the lower price.
5. Show a coffee-equivalent comparison only when the benchmark is eligible and in the same currency. It is informational only.

The pricing engine is deterministic and separate from network access and revenue simulation. Strategy factors and price points are configurable product assumptions; the initial demo configuration is illustrative, not verified market pricing data.

## Data and limitations

- Live exchange rates do **not** verify the purchasing-power factors, strategy factors, coffee benchmarks, or local price points.
- Missing or invalid live rate quotes use labeled illustrative fallbacks; the app does not present fallbacks as live rates.
- Coffee reference records currently include candidate third-party observations that remain unverified. They do not qualify for a coffee ratio. A user-entered benchmark is labeled as such and is not independently verified.
- Coffee ratios require a positive, valid, same-currency benchmark with an eligible status and an observation date within the app's freshness policy.
- Apple data here is for **App Store downloads only**. It does not include in-app purchases or subscriptions. A missing storefront listing is shown as unavailable; the app does not substitute another app.
- Revenue outputs are hypothetical scenarios, not forecasts. The model does not estimate market reach or demand response to price and does not include taxes, refunds, platform rules, rankings, or cross-market behavior.
- There is no account system or database. User-edited strategy factors and coffee overrides are stored locally in the browser.

## Run locally

Use a Node.js version supported by the installed Next.js release.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No API keys or `.env.local` values are required for the current public data sources. Keep private environment files out of version control.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npx next build --webpack
npm run start
```

Tests use deterministic fixtures and mocked network responses; they do not require live API credentials.

## Project structure

```text
src/
  app/                 App Router pages and server API routes
  components/          Discovery flow and pricing dashboard
  lib/apple-app-store/ Apple search and storefront lookup
  lib/exchange-rates/  Frankfurter rate mapping and formatting
  lib/pricing/         Pricing, purchasing power, coffee, revenue, and tests
specs/pricing-intelligence/
                       Product requirements, design, and task plan
```

## Scope

CupOfCoffee currently focuses on paid mobile apps with one-time purchases. Subscriptions, database-backed accounts, paid data providers, App Store Connect integration, and automatic competitor-driven pricing are outside the current scope.
