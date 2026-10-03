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
  effectiveAt: '2026-10-03T18:00:00.000Z',
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

test('records usage only for known tenants with positive units and provenance', async () => {
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
      occurredAt: '2026-10-03T18:01:00.000Z'
    }),
    /provenance/i
  );

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

test('enforces capability entitlements before recording usage', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);
  await ledger.setEntitlementPolicy(policy);

  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });
  await ledger.recordUsage({ id: 'usage-2', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-2', occurredAt: '2026-10-03T18:02:00.000Z' });

  await assert.rejects(
    () => ledger.recordUsage({ id: 'usage-3', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-3', occurredAt: '2026-10-03T18:03:00.000Z' }),
    /entitlement limit/i
  );
});

test('records provider costs only with tenant, run, and usage provenance', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);
  await ledger.setEntitlementPolicy(policy);
  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });

  await assert.rejects(
    () => ledger.recordCost({ id: 'cost-no-usage', tenantId: tenant.id, provider: 'sixtyfour', amountCents: 50, currency: 'USD', runId: 'run-1', usageEventId: 'missing', occurredAt: '2026-10-03T18:01:30.000Z' }),
    /usage/i
  );

  const cost = await ledger.recordCost({ id: 'cost-1', tenantId: tenant.id, provider: 'sixtyfour', amountCents: 50, currency: 'USD', runId: 'run-1', usageEventId: 'usage-1', occurredAt: '2026-10-03T18:01:30.000Z' });
  assert.equal(cost.amountCents, 50);
});

test('derives deterministic billing events from usage and pricing', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);
  await ledger.setEntitlementPolicy(policy);
  await ledger.recordUsage({ id: 'usage-1', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-1', occurredAt: '2026-10-03T18:01:00.000Z' });
  await ledger.recordUsage({ id: 'usage-2', tenantId: tenant.id, capability: 'intelligence.company.search', quantity: 1, source: 'sixtyfour', runId: 'run-2', occurredAt: '2026-10-03T18:02:00.000Z' });

  const events = await ledger.createBillingEvents({ tenantId: tenant.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', generatedAt: '2026-11-01T00:00:01.000Z' });

  assert.deepEqual(events.map((event) => ({ capability: event.capability, quantity: event.quantity, billableQuantity: event.billableQuantity, amountCents: event.amountCents, evidenceEventIds: event.evidenceEventIds })), [
    { capability: 'intelligence.company.search', quantity: 2, billableQuantity: 1, amountCents: 250, evidenceEventIds: ['usage-1', 'usage-2'] }
  ]);
});

test('stores source-backed account qualification evidence without inventing fit', async () => {
  const ledger = new InMemoryCommercialLedger();
  await ledger.createTenant(tenant);

  await assert.rejects(
    () => ledger.recordAccountQualification({ id: 'qual-no-source', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: '', confidence: 0.8, fitReasons: ['software development consultancy'], riskSignals: [], observedAt: '2026-10-03T18:10:00.000Z' }),
    /source reference/i
  );

  const qualification = await ledger.recordAccountQualification({ id: 'qual-1', tenantId: tenant.id, targetAccountName: 'AgileEngine', source: 'sixtyfour', sourceReference: 'source_id:1328565', confidence: 0.8, fitReasons: ['software development consultancy', 'high active job posting count'], riskSignals: ['buyer not yet identified'], observedAt: '2026-10-03T18:10:00.000Z' });

  assert.equal(qualification.targetAccountName, 'AgileEngine');
  assert.deepEqual(await ledger.listAccountQualifications(tenant.id), [qualification]);
});
