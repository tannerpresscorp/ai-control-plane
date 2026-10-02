import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../dist/core/capabilities.js';

test('requires explicit registration before a capability can be resolved', () => {
  const registry = new CapabilityRegistry();
  registry.register({ name: 'repo.read', risk: 'read', provider: 'github' });
  assert.equal(registry.resolve('repo.read')?.provider, 'github');
  assert.equal(registry.resolve('repo.write'), undefined);
});

test('refuses duplicate capability registration', () => {
  const registry = new CapabilityRegistry();
  registry.register({ name: 'repo.read', risk: 'read', provider: 'github' });
  assert.throws(() => registry.register({ name: 'repo.read', risk: 'write', provider: 'other' }));
});
