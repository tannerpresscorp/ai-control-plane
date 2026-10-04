import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';

test('compiled package entry point exposes the public API', () => {
  assert.equal(typeof api.transitionRun, 'function');
  assert.equal('approveRun' in api, false);
  assert.equal(typeof api.InMemoryRunLedger, 'function');
  assert.equal(typeof api.SupabaseRunLedger, 'function');
  assert.equal(typeof api.CapabilityRegistry, 'function');
  assert.equal(typeof api.OpenAIAgentsRuntime, 'function');
  assert.equal(typeof api.GovernedAgentCycle, 'function');
  assert.equal(typeof api.InMemoryCommercialLedger, 'function');
  assert.equal(typeof api.GovernedIntelligence, 'function');
  assert.equal(typeof api.SixtyfourIntelligenceAdapter, 'function');
  assert.equal(typeof api.mapAccountQualification, 'function');
});
