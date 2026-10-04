import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCommercialLedger } from '../dist/commercial/in-memory-commercial-ledger.js';

const tenant = {
  id: 'tenant-acme',
  name: 'Acme Engineering',
  plan: 'team',
  createdAt: '2026-10-03T18:00:00.000Z'
};

const policy = {
  tenantId: tenant.id,
  effectiveAt: '2026-09-01T00:00:00.000Z',
  capabilities: [
    {
      capability: 'intelligence.company.search',
      monthlyUnitLimit: 2,
      unitPriceCents: 250,
      includedUnits: 1
    },
    {
      capability: 'runtime.governed_run',
      monthlyUnitLimit: 10,
      unitPriceCents: 1000,
      includedUnits: 0
    }
  ]
};

async function readyLedger(...runIds) {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);
  for (const runId of runIds) {
    await ledger.registerTrustedRun({ id: runId, tenantId: tenant.id, source: 'run-ledger', observedAt: '2026-10-03T18:00:00.000Z' });
  }
  await ledger.setEntitlementPolicy(policy);
  return ledger;
}

test('records usage only for known tenants with positive units and trusted run provenance', async () => {
  const ledger = new InMemoryCommercialLedger();
  await assert.rejects(
    () => ledger.recordUsage({
      id: 'usage-missing-tenant',
      tenantId: tenant.id,
      capability: 'intelligence.company.search',
      quantity: 1,
      source: 'sixtyfour',
      runId: 'run-1',
      occurredAt: '2026-10-03T18:01:00.000Z'
    }),
    /tenant/i
  );

  await ledger.createTenant(tenant);
  await ledger.setEntitlementPolicy(policy);

  await assert.rejects(
    () => ledger.recordUsage({
      id: 'usage-zero',
      tenantId: tenant.id,
      capability: 'intelligence.company.search',
      quantity: 0,
      source: 'sixtyfour',
      runId: 'run-1',
      occurredAt: '2026-10-03T18:01:00.000Z'
    }),
    /positive/i
  );

  await assert.rejects(
    () => ledger.recordUsage({
      id: 'usage-no-run',
      tenantId: tenant.id,
      capability: 'intelligence.company.search',
      quantity: 1,
      source: 'sixtyfour',
      runId: 'run-does-not-exist',
      occurredAt: '2026-10-03T18:01:00.000Z'
    }),
    /trusted run provenance/i
  );

  await ledger.registerTrustedRun({ id: 'run-1', tenantId: tenant.id, source: 'run-ledger', observedAt: '2026-10-03T18:00:00.000Z' });
  const usage = await ledger.recordUsage({
    id: 'usage-1',
    tenantId: tenant.id,
    capability: 'intelligence.company.search',
    quantity: 1,
    source: 'sixtyfour',
    runId: 'run-1',
    occurredAt: '2026-10-03T18:01:00.000Z'
  });
  assert.equal(usage.id, 'usage-1');
});

test('enforces capability entitlements per UTC month before recording usage', async () => {
  const ledger = await readyLedger('run-1', 'run-2', 'run-3', 'run-4');

  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });
  await ledger.recordUsage({ id: 'usage-2', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-2', occurredAt: '2026-10-03T18:02:00.000Z' });

  await assert.rejects(
    () => ledger.recordUsage({ id: 'usage-3', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-3', occurredAt: '2026-10-03T18:03:00.000Z' }),
    /entitlement limit/i
  );

  const nextMonth = await ledger.recordUsage({ id: 'usage-4', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-4', occurredAt: '2026-11-03T18:03:00.000Z' });
  assert.equal(nextMonth.id, 'usage-4');
});

test('records provider costs only with tenant, run, and usage provenance', async () => {
  const ledger = await readyLedger('run-1');
  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });

  await assert.rejects(
    () => ledger.recordCost({ id: 'cost-no-usage', tenantId: tenant.id, provider: 'sixtyfour', amountCents: 50, currency: 'USD', runId: 'run-1', usageEventId: 'missing', occurredAt: '2026-10-03T18:01:30.000Z' }),
    /usage/i
  );

  const cost = await ledger.recordCost({ id: 'cost-1', tenantId: tenant.id, provider: 'sixtyfour', amountCents: 50, currency: 'USD', runId: 'run-1', usageEventId: 'usage-1', occurredAt: '2026-10-03T18:01:30.000Z' });
  assert.equal(cost.amountCents, 50);
});

test('normalizes timestamps before billing-period comparisons', async () => {
  const ledger = await readyLedger('run-before', 'run-inside');
  await ledger.recordUsage({ id: 'usage-before', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-before', occurredAt: '2026-10-01T00:30:00+01:00' });
  await ledger.recordUsage({ id: 'usage-inside', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-inside', occurredAt: '2026-10-01T00:30:00Z' });

  const events = await ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z' });
  assert.deepEqual(events.flatMap((event) => event.evidenceEventIds), ['usage-inside']);
});

test('derives deterministic billing events from usage and pricing', async () => {
  const ledger = await readyLedger('run-1', 'run-2');
  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });
  await ledger.recordUsage({ id: 'usage-2', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-2', occurredAt: '2026-10-03T18:02:00.000Z' });

  const events = await ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z' });

  assert.deepEqual(events.map((event) => ({ capability: event.capability, quantity: event.quantity, billableQuantity: event.billableQuantity, amountCents: event.amountCents, entitlementEffectiveAt: event.entitlementEffectiveAt, evidenceEventIds: event.evidenceEventIds })), [
    { capability: 'intelligence.company.search', quantity: 2, billableQuantity: 1, amountCents: 250, entitlementEffectiveAt: policy.effectiveAt, evidenceEventIds: ['usage-1', 'usage-2'] }
  ]);
  assert.match(events[0].id, /2026-11-01T00:00:00\.000Z/);
});

test('preserves entitlement policy history for historical billing', async () => {
  const ledger = await readyLedger('run-oct', 'run-nov');
  await ledger.recordUsage({ id: 'usage-oct', tenantId: tenant.id, capability: 'runtime.governed_run', quantity: 1, source: 'runtime', runId: 'run-oct', occurredAt: '2026-10-10T00:00:00.000Z' });
  await ledger.setEntitlementPolicy({
    tenantId: tenant.id,
    effectiveAt: '2026-11-01T00:00:00.000Z',
    capabilities: [{ capability: 'runtime.governed_run', monthlyUnitLimit: 10, unitPriceCents: 5000, includedUnits: 0 }]
  });
  await ledger.recordUsage({ id: 'usage-nov', tenantId: tenant.id, capability: 'runtime.governed_run', quantity: 1, source: 'runtime', runId: 'run-nov', occurredAt: '2026-11-10T00:00:00.000Z' });

  const october = await ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z' });
  const november = await ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', generatedAt: '2026-12-01T00:00:01.000Z' });

  assert.equal(october.find((event) => event.capability === 'runtime.governed_run')?.amountCents, 1000);
  assert.equal(november.find((event) => event.capability === 'runtime.governed_run')?.amountCents, 5000);
});

test('rejects ambiguous billing periods instead of applying monthly included units repeatedly', async () => {
  const ledger = await readyLedger('run-1');
  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-15T00:00:00.000Z' });
  await assert.rejects(
    () => ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-15T00:00:00.000Z', generatedAt: '2026-10-15T00:00:01.000Z' }),
    /full UTC month/i
  );
});

test('rejects unsafe calculated billing amounts', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);
  await ledger.registerTrustedRun({ id: 'run-large', tenantId: tenant.id, source: 'run-ledger', observedAt: '2026-10-03T18:00:00.000Z' });
  await ledger.setEntitlementPolicy({ tenantId: tenant.id, effectiveAt: '2026-09-01T00:00:00.000Z', capabilities: [{ capability: 'runtime.governed_run', monthlyUnitLimit: Number.MAX_SAFE_INTEGER, unitPriceCents: Number.MAX_SAFE_INTEGER, includedUnits: 0 }] });
  await ledger.recordUsage({ id: 'usage-large', tenantId: tenant.id, capability: 'runtime.governed_run', quantity: 2, source: 'runtime', runId: 'run-large', occurredAt: '2026-10-10T00:00:00.000Z' });

  await assert.rejects(
    () => ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z' }),
    /amountCents.*safe integer/i
  );
});

test('stores source-backed account qualification evidence without inventing fit', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);

  await assert.rejects(
    () => ledger.recordAccountQualification({ id: 'qual-no-source', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: '', confidence: 0.8, fitReasons: ['software development consultancy'], riskSignals: [], observedAt: '2026-10-03T18:10:00.000Z' }),
    /source reference/i
  );

  await assert.rejects(
    () => ledger.recordAccountQualification({ id: 'qual-nan', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: 'source_id:1328565', confidence: Number.NaN, fitReasons: ['software development consultancy'], riskSignals: [], observedAt: '2026-10-03T18:10:00.000Z' }),
    /confidence/i
  );

  await assert.rejects(
    () => ledger.recordAccountQualification({ id: 'qual-blank-reason', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: 'source_id:1328565', confidence: 0.8, fitReasons: ['  '], riskSignals: [], observedAt: '2026-10-03T18:10:00.000Z' }),
    /fit reasons/i
  );

  const qualification = await ledger.recordAccountQualification({ id: 'qual-1', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: 'source_id:1328565', confidence: 0.8, fitReasons: ['software development consultancy', 'high active job posting count'], riskSignals: ['buyer not yet identified'], observedAt: '2026-10-03T18:10:00.000Z' });

  assert.equal(qualification.targetAccountName, 'AgileEngine');
  assert.deepEqual(await ledger.listAccountQualifications(tenant.id), [qualification]);
});
