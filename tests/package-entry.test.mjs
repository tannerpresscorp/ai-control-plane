import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';

test('compiled package entry point exposes the public API', () => {
  assert.equal(typeof api.approveRun, 'function');
  assert.equal(typeof api.InMemoryRunLedger, 'function');
  assert.equal(typeof api.SupabaseRunLedger, 'function');
  assert.equal(typeof api.CapabilityRegistry, 'function');
});
