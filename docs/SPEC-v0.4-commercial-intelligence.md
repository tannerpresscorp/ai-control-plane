# Spec: AI Control Plane v0.4 Commercial Intelligence Foundation

## Objective

Add the first deterministic commercial layer without introducing live provider writes or billing-system side effects. v0.4 makes monetization inspectable by recording tenants, capability entitlements, usage, provider costs, deterministic billing events, and source-backed account qualification evidence.

## Scope

This slice is intentionally provider-neutral. Sixtyfour, Sales, Shopify, Atlassian, and future model gateways should plug into this layer by recording usage, costs, and qualification evidence. They should not bypass the control-plane ledger or mutate billing state without tenant/run provenance.

## Entities

- `TenantRecord`: commercial customer account boundary.
- `EntitlementPolicy`: per-tenant capability limits and unit pricing.
- `UsageEvent`: billable or included capability consumption tied to a governed run.
- `CostEvent`: provider-side cost tied to tenant, run, and usage provenance.
- `BillingEvent`: deterministic invoice line derived from usage and entitlement pricing.
- `AccountQualificationEvidence`: source-backed sales qualification evidence from intelligence tools such as Sixtyfour.

## Governance Rules

### Always

- Record usage only for known tenants.
- Require positive safe-integer usage quantities.
- Require run provenance for usage.
- Enforce capability entitlement limits before recording usage.
- Record provider costs only with matching tenant, run, and usage provenance.
- Derive billing events deterministically from usage and entitlement pricing.
- Preserve source references for account qualification evidence.

### Never

- Invent fit, ROI, buyer identity, or billing amounts without source-backed evidence.
- Treat provider identity as a policy boundary; use capability names and entitlement rules instead.
- Allow unbounded usage that can create untracked model or intelligence-provider spend.
- Record provider costs without tenant/run/usage traceability.

## Current Implementation

- In-memory commercial ledger for local deterministic tests.
- Public exports for commercial types and `InMemoryCommercialLedger`.
- No live Sixtyfour API adapter in this slice.
- No external billing-provider writes in this slice.

## Follow-ups

- Add a persistent SQL-backed commercial ledger.
- Add a Sixtyfour adapter that records `intelligence.*` usage and cost events.
- Add Sales workflow integration that consumes account qualification evidence.
- Add customer-facing usage and gross-margin reports.
- Add pricing-package presets for Starter, Team, and Business plans.
