# Spec: AI Control Plane v0.5 Sixtyfour Intelligence

## Boundary

`IntelligenceProvider` supplies company search, company enrichment, and people/buyer
search through provider-neutral request types. `SixtyfourIntelligenceAdapter` delegates
to an injected `SixtyfourBoundary`. This is a normalized application boundary, **not**
a live API integration or a claim of compatibility with a Sixtyfour SDK. A future
server-side transport must translate actual provider responses into this contract.
There are no credentials, network calls, new dependencies, or billing-provider writes
in this slice.

Consumers use `GovernedIntelligence`, not the raw provider boundary. The consumer
validates untrusted responses and meters calls through the `IntelligenceLedger` port,
implemented by the v0.4 `InMemoryCommercialLedger`.

## Normalized provider responses

Each response has `source`, a nonblank `sourceReference` identifying the request
receipt, and `items`. Sixtyfour responses must identify `source: 'sixtyfour'`.
Each company/person record has its own nonblank source reference. Every claim is
`{ value, sourceReference, confidence }`; its reference must match the record's
reference. Multi-source records must be split upstream rather than flattening
unrelated citations into one qualification.

- Company: cited `name`, `fitReasons` array, and `riskSignals` array.
- Person: cited `name`, `companyName`, and `role`; no buyer identity is inferred.
- Claim values must be nonblank. References identify evidence; their existence does
  not prove factual truth. Source retrieval/verification remains a downstream gate.
- Missing claim confidence is normalized to zero. Supplied confidence must be a
  finite number in `[0, 1]`; invalid values are rejected rather than clamped.
- Unknown fields, including narrative, ROI, buyer identity, fit summaries, approval,
  prices, and billing amounts, are discarded, not converted into claims.

## Qualification mapping

`mapAccountQualification` implements the provider-neutral `AccountQualificationMapper`
contract. It copies cited identity, fit reasons, and risk signals into
`AccountQualificationEvidence` without generating sales claims. Confidence is the
minimum across company identity and all fit claims. Below `0.5`, or with no fit
claims, mapping abstains (`undefined`). Blank claims or missing citations reject the
response. Risk signals are retained even when their confidence is weak.

`GovernedIntelligence.qualifyAccount` calls governed company enrichment and persists
only mapped qualifications. Tenant, observation time, and evidence IDs come from a
snapshotted caller context, never provider narrative. Evidence IDs are derived from
the usage ID and result position. Qualification does not append run-verification
evidence or approve runs. Provider output remains advisory.

## Metering and cost provenance

Each invocation requires `{ tenantId, runId, usageEventId, occurredAt }`. The trusted
application registers run provenance with the commercial ledger separately; the
adapter cannot register or trust a provider-invented run.

Before provider dispatch, the ledger records **one attempted-call unit** for:

- `intelligence.company.search`
- `intelligence.company.enrich`
- `intelligence.people.search`

Qualification uses company-enrichment units, not a second charge. The ledger enforces
known tenants, trusted run binding, effective capability entitlements, duplicate IDs,
and UTC-month limits before any provider access. Failed calls and invalid responses
retain usage; retrying requires a new usage ID and consumes another unit. There is no
automatic retry, refund, pagination, or provider-selected quantity.

Cost is optional; absence never produces an estimated cost. When present it must
contain `tenantId`, `runId`, `usageEventId`, `capability`, `source`, `sourceReference`,
`amountCents`, and `currency`. All context fields must exactly match recorded usage;
the cost reference must match the response receipt. Amounts are non-negative safe
integers in cents (including explicit zero); currency is a three-letter uppercase
code. Validated costs are recorded against the usage ID with the receipt reference
preserved in `CostEvent.sourceReference` (optional for legacy v0.4 callers). Valid cost
receipts remain recorded even if intelligence items fail validation. Invalid cost
data rejects the response without recording costs or qualification.

Usage, costs, and qualification appends are separate ledger operations, not a
transaction. Downstream persistence failures surface to the caller; prior appends
remain. Deterministic billing still uses ledger entitlement pricing, never provider
costs or narrative. Deployments must supply trusted server-side tenant/run context,
time, transport, and cost receipts; this boundary is not a public authorization API.

## Validation

`tests/sixtyfour-intelligence.test.mjs` exercises all operations through the governed
consumer with a normalized fake Sixtyfour boundary and the real commercial ledger.
Tests require no live access. They cover citations, confidence, narrative isolation,
qualification persistence, provenance, costs, entitlement gating, concurrent limits,
failure behavior, and approval separation. Run `npm run check` for the complete
TypeScript suite.
