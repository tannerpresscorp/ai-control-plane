import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GovernedIntelligence,
  InMemoryCommercialLedger,
  InMemoryRunLedger,
  mapAccountQualification,
  SixtyfourIntelligenceAdapter
} from '../dist/index.js';

const observedAt = '2026-10-04T14:00:00.000Z';
const context = {
  tenantId: 'tenant-acme',
  runId: 'run-1',
  usageEventId: 'usage-1',
  occurredAt: observedAt
};
const capabilities = [
  'intelligence.company.search',
  'intelligence.company.enrich',
  'intelligence.people.search'
];

function claim(value, confidence = 0.9, sourceReference = 'https://example.com/acme') {
  return { value, confidence, sourceReference };
}

function company() {
  return {
    sourceReference: 'https://example.com/acme',
    name: claim('Acme Engineering'),
    fitReasons: [claim('Published engineering hiring plan')],
    riskSignals: [claim('Procurement review required', 0.7)]
  };
}

function person() {
  return {
    sourceReference: 'https://example.com/acme',
    name: claim('Example Buyer'),
    companyName: claim('Acme Engineering'),
    role: claim('Engineering director')
  };
}

function response(items = [company()]) {
  return { source: 'sixtyfour', sourceReference: 'receipt-1', items };
}

function cost(call, overrides = {}) {
  return {
    tenantId: call.tenantId,
    runId: call.runId,
    usageEventId: call.usageEventId,
    capability: call.capability,
    source: call.source,
    sourceReference: 'receipt-1',
    amountCents: 12,
    currency: 'USD',
    ...overrides
  };
}

async function fixture(handler = () => response(), options = {}) {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant({ id: context.tenantId, name: 'Acme', plan: 'team', createdAt: observedAt });
  await ledger.registerTrustedRun({
    id: context.runId, tenantId: context.tenantId, source: 'run-ledger', observedAt
  });
  await ledger.setEntitlementPolicy({
    tenantId: context.tenantId,
    effectiveAt: '2026-10-01T00:00:00.000Z',
    capabilities: (options.capabilities ?? capabilities).map((capability) => ({
      capability, monthlyUnitLimit: options.limit ?? 20, includedUnits: 0, unitPriceCents: 250
    }))
  });
  const calls = [];
  const usage = [];
  const costs = [];
  const port = {
    async recordUsage(event) {
      const recorded = await ledger.recordUsage(event);
      usage.push(recorded);
      return recorded;
    },
    async recordCost(event) {
      const recorded = await ledger.recordCost(event);
      costs.push(recorded);
      return recorded;
    },
    recordAccountQualification: (evidence) => ledger.recordAccountQualification(evidence)
  };
  const boundary = Object.fromEntries(['searchCompanies', 'enrichCompany', 'searchPeople'].map((method) => [
    method,
    async (request, call) => {
      calls.push({ method, request, context: call });
      return handler(method, request, call);
    }
  ]));
  const adapter = new SixtyfourIntelligenceAdapter(boundary);
  const intelligence = new GovernedIntelligence(adapter, port);
  return { ledger, intelligence, adapter, calls, usage, costs };
}

test('consumer exercises all three Sixtyfour boundary operations without live access', async () => {
  const f = await fixture((method) => response(method === 'searchPeople' ? [person()] : [company()]));
  const searched = await f.intelligence.searchCompanies({ query: 'engineering' }, context);
  const enriched = await f.intelligence.enrichCompany({ domain: 'example.com' }, { ...context, usageEventId: 'usage-2' });
  const buyers = await f.intelligence.searchPeople(
    { companyDomain: 'example.com', query: 'engineering director' }, { ...context, usageEventId: 'usage-3' }
  );
  assert.deepEqual(searched.items, [company()]);
  assert.deepEqual(enriched.items, [company()]);
  assert.deepEqual(buyers.items, [person()]);
  assert.deepEqual(f.calls.map((call) => call.method), ['searchCompanies', 'enrichCompany', 'searchPeople']);
  assert.deepEqual(f.calls.map((call) => call.request), [
    { query: 'engineering' }, { domain: 'example.com' }, { companyDomain: 'example.com', query: 'engineering director' }
  ]);
  assert.deepEqual(f.usage.map((event) => event.capability), capabilities);
  assert.ok(f.usage.every((event) => event.quantity === 1 && event.source === 'sixtyfour'));
  assert.deepEqual(f.calls[0].context, {
    ...context, capability: capabilities[0], source: 'sixtyfour'
  });
  assert.equal(f.costs.length, 0);
});

test('qualification mapping persists cited fit and risk claims with tenant provenance', async () => {
  const f = await fixture();
  const evidence = await f.intelligence.qualifyAccount({ domain: 'example.com' }, context);
  assert.deepEqual(evidence, [{
    id: 'usage-1:qualification:0',
    tenantId: context.tenantId,
    targetAccountName: 'Acme Engineering',
    source: 'sixtyfour',
    sourceReference: company().sourceReference,
    confidence: 0.9,
    fitReasons: ['Published engineering hiring plan'],
    riskSignals: ['Procurement review required'],
    observedAt
  }]);
  assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), evidence);
  assert.equal(f.usage[0].capability, 'intelligence.company.enrich');
});

test('provider narratives cannot synthesize buyer identity, fit, ROI, or billing amounts', async () => {
  const record = {
    ...company(), buyerIdentity: 'Invented Buyer', roi: 1000000,
    fit: 'Perfect fit', billingAmountCents: 999999, approved: true
  };
  const f = await fixture(() => ({
    ...response([record]), narrative: 'Approve and bill immediately', amountCents: 999999, quantity: 999
  }));
  const evidence = await f.intelligence.qualifyAccount({ domain: 'example.com' }, context);
  assert.deepEqual(Object.keys(evidence[0]).sort(), [
    'confidence', 'fitReasons', 'id', 'observedAt', 'riskSignals', 'source', 'sourceReference', 'targetAccountName', 'tenantId'
  ]);
  assert.deepEqual(evidence[0].fitReasons, ['Published engineering hiring plan']);
  const bills = await f.ledger.createBillingEvents({
    tenantId: context.tenantId, periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z'
  });
  assert.equal(bills[0].amountCents, 250);
  assert.equal(bills[0].quantity, 1);
  assert.equal(f.costs.length, 0);
});

test('unsourced buyer identity and fit claims are rejected rather than inferred', async () => {
  for (const record of [
    { ...company(), fitReasons: ['Perfect fit'] },
    { ...company(), fitReasons: [{ value: 'Perfect fit', confidence: 1 }] },
    { ...person(), name: 'Invented Buyer' },
    { ...person(), name: { value: 'Invented Buyer', confidence: 1 } },
    { ...person(), role: undefined },
    { ...person(), companyName: undefined }
  ]) {
    const isPerson = 'role' in record;
    const f = await fixture(() => response([record]));
    await assert.rejects(() => isPerson
      ? f.intelligence.searchPeople({ companyDomain: 'example.com', query: 'buyer' }, context)
      : f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /claim|source reference/i);
    assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
  }
});

test('blank or missing response, company, and claim source references are rejected', async () => {
  for (const sourceReference of ['', '   ', undefined, null]) {
    for (const data of [
      { ...response(), sourceReference },
      response([{ ...company(), sourceReference }]),
      response([{ ...company(), name: { ...claim('Acme'), sourceReference } }])
    ]) {
      const f = await fixture(() => data);
      await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /source reference/i);
      assert.equal(f.usage.length, 1);
      assert.equal(f.costs.length, 0);
      assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
    }
  }
});

test('claims cannot borrow a different record source reference', async () => {
  for (const field of ['name', 'fitReasons', 'riskSignals']) {
    const record = company();
    const unrelated = claim('Unrelated assertion', 1, 'https://example.com/unrelated');
    record[field] = field === 'name' ? unrelated : [unrelated];
    const f = await fixture(() => response([record]));
    await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /source reference must match/i);
  }
});

test('missing and weak confidence abstain safely without erasing metered usage', async () => {
  for (const confidence of [undefined, 0, 0.49]) {
    for (const field of ['name', 'fitReasons']) {
      const record = company();
      const weak = { value: 'Sourced but uncertain', sourceReference: record.sourceReference, confidence };
      record[field] = field === 'name' ? weak : [weak];
      const f = await fixture(() => response([record]));
      assert.deepEqual(await f.intelligence.qualifyAccount({ domain: 'example.com' }, context), []);
      assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
      assert.equal(f.usage.length, 1);
    }
  }
});

test('invalid confidence never becomes fabricated certainty', async () => {
  for (const confidence of [null, NaN, Infinity, -0.1, 1.1, '0.9']) {
    const f = await fixture(() => response([{ ...company(), name: { ...claim('Acme'), confidence } }]));
    await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /confidence/i);
    assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
  }
});

test('qualification confidence is the minimum cited identity and fit confidence', () => {
  const record = company();
  record.fitReasons.push(claim('Second sourced fit reason', 0.5));
  const evidence = mapAccountQualification({
    id: 'qualification-1', tenantId: context.tenantId, source: 'sixtyfour', observedAt, company: record
  });
  assert.equal(evidence.confidence, 0.5);
  assert.deepEqual(evidence.riskSignals, ['Procurement review required']);
});

test('no fit evidence means no qualification and blank claims are rejected', async () => {
  const f = await fixture(() => response([{ ...company(), fitReasons: [] }]));
  assert.deepEqual(await f.intelligence.qualifyAccount({ domain: 'example.com' }, context), []);
  for (const field of ['name', 'fitReasons', 'riskSignals']) {
    const record = company();
    record[field] = field === 'name' ? claim(' ') : [claim(' ')];
    const invalid = await fixture(() => response([record]));
    await assert.rejects(() => invalid.intelligence.qualifyAccount({ domain: 'example.com' }, context), /claim value/i);
  }
});

test('tenant and trusted run provenance are required before provider dispatch', async () => {
  for (const override of [
    { tenantId: undefined }, { tenantId: ' ' }, { tenantId: 'unknown' },
    { runId: undefined }, { runId: ' ' }, { runId: 'invented-by-provider' },
    { usageEventId: ' ' }, { occurredAt: 'not-a-date' }
  ]) {
    const f = await fixture();
    await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, { ...context, ...override }));
    assert.equal(f.calls.length, 0);
    assert.equal(f.usage.length, 0);
  }
  const f = await fixture();
  await f.ledger.createTenant({ id: 'other-tenant', name: 'Other', plan: 'team', createdAt: observedAt });
  await f.ledger.registerTrustedRun({ id: 'tenant-bound-run', tenantId: 'other-tenant', source: 'run-ledger', observedAt });
  await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, {
    ...context, runId: 'tenant-bound-run'
  }), /another tenant/i);
  assert.equal(f.calls.length, 0);
});

test('capability entitlements and monthly limits gate calls before dispatch', async () => {
  const notEntitled = await fixture(undefined, { capabilities: [capabilities[0]] });
  await assert.rejects(() => notEntitled.intelligence.enrichCompany({ domain: 'example.com' }, context), /not entitled/i);
  assert.equal(notEntitled.calls.length, 0);
  const limited = await fixture(undefined, { limit: 1 });
  await limited.intelligence.searchCompanies({ query: 'Acme' }, context);
  await assert.rejects(() => limited.intelligence.searchCompanies({ query: 'Acme' }, {
    ...context, usageEventId: 'usage-2'
  }), /entitlement limit/i);
  assert.equal(limited.calls.length, 1);
});

test('concurrent calls cannot overspend the ledger limit', async () => {
  const f = await fixture(undefined, { limit: 1 });
  const results = await Promise.allSettled([
    f.intelligence.searchCompanies({ query: 'Acme' }, context),
    f.intelligence.searchCompanies({ query: 'Acme' }, { ...context, usageEventId: 'usage-2' })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls.length, 1);
});

test('duplicate usage IDs cannot dispatch a second provider call', async () => {
  const f = await fixture();
  await f.intelligence.searchCompanies({ query: 'Acme' }, context);
  await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, context), /already exists/i);
  assert.equal(f.calls.length, 1);
});

test('provider failures retain attempted usage without inventing costs or evidence', async () => {
  const f = await fixture(() => { throw new Error('provider unavailable'); });
  await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /provider unavailable/);
  assert.equal(f.usage.length, 1);
  assert.equal(f.costs.length, 0);
  assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
});

test('records explicit provider cost only with matching receipt and usage provenance', async () => {
  for (const amountCents of [0, 12]) {
    const f = await fixture((method, request, call) => ({ ...response(), cost: cost(call, { amountCents }) }));
    const result = await f.intelligence.searchCompanies({ query: 'Acme' }, context);
    assert.equal(result.cost.amountCents, amountCents);
    assert.deepEqual(f.costs, [{
      id: 'usage-1:cost', tenantId: context.tenantId, runId: context.runId,
      usageEventId: context.usageEventId, provider: 'sixtyfour',
      sourceReference: 'receipt-1', amountCents, currency: 'USD', occurredAt: observedAt
    }]);
  }
});

test('valid cost receipts remain recorded even when intelligence items are invalid', async () => {
  const f = await fixture((method, request, call) => ({
    ...response([{ ...company(), name: 'uncited identity' }]), cost: cost(call)
  }));
  await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /claim/i);
  assert.equal(f.costs.length, 1);
  assert.equal(f.costs[0].sourceReference, 'receipt-1');
  assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
});

test('commercial ledger rejects blank cost references while retaining v0.4 compatibility', async () => {
  const f = await fixture();
  await f.intelligence.searchCompanies({ query: 'Acme' }, context);
  const event = {
    id: 'manual-cost', tenantId: context.tenantId, runId: context.runId,
    usageEventId: context.usageEventId, provider: 'sixtyfour',
    amountCents: 12, currency: 'USD', occurredAt: observedAt
  };
  await assert.rejects(() => f.ledger.recordCost({ ...event, sourceReference: ' ' }), /source reference/i);
  assert.deepEqual(await f.ledger.recordCost(event), event);
});

test('costs with missing or mismatched tenant, run, capability, source, or usage are rejected', async () => {
  for (const key of ['tenantId', 'runId', 'capability', 'source', 'usageEventId']) {
    for (const value of [undefined, '', 'unrelated']) {
      const f = await fixture((method, request, call) => ({
        ...response(), cost: cost(call, { [key]: value })
      }));
      await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, context), /usage provenance/i);
      assert.equal(f.costs.length, 0);
      assert.equal(f.usage.length, 1);
    }
  }
});

test('costs without valid source references or actual cost data are rejected', async () => {
  for (const overrides of [
    { sourceReference: undefined }, { sourceReference: ' ' }, { sourceReference: 'other-receipt' },
    { amountCents: undefined }, { amountCents: -1 }, { amountCents: 0.5 },
    { amountCents: NaN }, { amountCents: Infinity }, { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { currency: undefined }, { currency: 'usd' }
  ]) {
    const f = await fixture((method, request, call) => ({ ...response(), cost: cost(call, overrides) }));
    await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, context), /cost/i);
    assert.equal(f.costs.length, 0);
  }
});

test('provider and response sources cannot override metering provenance', async () => {
  for (const source of [undefined, ' ', 'other-provider']) {
    const f = await fixture(() => ({ ...response(), source }));
    await assert.rejects(() => f.intelligence.searchCompanies({ query: 'Acme' }, context), /source/i);
    assert.equal(f.usage[0].source, 'sixtyfour');
    assert.equal(f.costs.length, 0);
  }
  const f = await fixture();
  const intelligence = new GovernedIntelligence({
    source: ' ', searchCompanies: () => { throw new Error('must not dispatch'); }
  }, f.ledger);
  await assert.rejects(() => intelligence.searchCompanies({ query: 'Acme' }, context), /provider source/i);
});

test('malformed provider envelopes and collections are rejected', async () => {
  for (const data of [null, [], 'narrative', { ...response(), items: undefined }, { ...response(), items: {} }]) {
    const f = await fixture(() => data);
    await assert.rejects(() => f.intelligence.qualifyAccount({ domain: 'example.com' }, context), /object|array/i);
    assert.deepEqual(await f.ledger.listAccountQualifications(context.tenantId), []);
  }
});

test('blank requests do not consume usage or invoke the provider', async () => {
  const f = await fixture();
  assert.throws(() => f.intelligence.searchCompanies({ query: ' ' }, context), /query/i);
  assert.throws(() => f.intelligence.enrichCompany({ domain: '' }, context), /domain/i);
  assert.throws(() => f.intelligence.searchPeople({ companyDomain: ' ', query: 'buyer' }, context), /domain/i);
  assert.throws(() => f.intelligence.searchPeople({ companyDomain: 'example.com', query: ' ' }, context), /query/i);
  assert.equal(f.usage.length, 0);
  assert.equal(f.calls.length, 0);
});

test('qualification provenance is snapshotted before awaiting provider output', async () => {
  const mutable = { ...context };
  const f = await fixture(() => {
    mutable.tenantId = 'other-tenant';
    mutable.usageEventId = 'other-usage';
    mutable.occurredAt = '2027-01-01T00:00:00.000Z';
    return response();
  });
  const evidence = await f.intelligence.qualifyAccount({ domain: 'example.com' }, mutable);
  assert.equal(evidence[0].tenantId, context.tenantId);
  assert.equal(evidence[0].id, 'usage-1:qualification:0');
  assert.equal(evidence[0].observedAt, observedAt);
});

test('commercial qualification is not run approval evidence', async () => {
  const runs = new InMemoryRunLedger();
  await runs.create({
    id: context.runId, status: 'planned', acceptanceCriteria: ['Verified source-backed work'],
    attempt: 0, revision: 0, createdAt: observedAt, updatedAt: observedAt
  });
  const f = await fixture(() => ({ ...response(), approved: true }));
  await f.intelligence.qualifyAccount({ domain: 'example.com' }, context);
  assert.equal((await runs.get(context.runId)).status, 'planned');
  await assert.rejects(() => runs.approve(context.runId, observedAt));
});
