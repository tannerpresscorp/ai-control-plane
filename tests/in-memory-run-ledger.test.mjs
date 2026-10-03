import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';

const run={id:'run-1',objective:'test',status:'planned',acceptanceCriteria:['tests'],requestedCapabilities:['repo.read'],attempt:0,revision:0,createdAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z'};

test('create/get/update enforce governed transitions',async()=>{
  const ledger=new InMemoryRunLedger(); await ledger.create(run);
  await ledger.update({...run,status:'building',attempt:1,revision:1});
  assert.equal((await ledger.get(run.id))?.status,'building');
  await assert.rejects(()=>ledger.update({...run,status:'building',attempt:0,revision:2}),/attempt transition/);
});
test('rejects blank criteria and unsafe revisions',async()=>{
  for(const candidate of [
    {...run,acceptanceCriteria:['   ']},
    {...run,revision:Infinity}
  ]) {
    const ledger=new InMemoryRunLedger();
    await assert.rejects(()=>ledger.create(candidate));
  }
});
test('evidence order, revision invalidation, and atomic approval use latest evidence',async()=>{
  const ledger=new InMemoryRunLedger();
  await ledger.create({...run,status:'verifying',attempt:1,revision:2});
  await ledger.appendEvidence(run.id,{criterionId:'tests',status:'pass',source:'ci',detail:'first',attempt:1});
  await ledger.appendEvidence(run.id,{criterionId:'tests',status:'fail',source:'ci',detail:'latest',attempt:1});
  assert.equal((await ledger.get(run.id))?.revision,4);
  await assert.rejects(()=>ledger.approve(run.id,'2026-10-02T00:01:00Z'),/failed: tests/);
});
test('rejects evidence before building',async()=>{
  const ledger=new InMemoryRunLedger(); await ledger.create(run);
  await assert.rejects(()=>ledger.appendEvidence(run.id,{criterionId:'tests',status:'pass',source:'ci',detail:'early',attempt:0}),/building or verifying/);
});
test('approved runs reject later evidence',async()=>{
  const ledger=new InMemoryRunLedger();
  await ledger.create({...run,status:'verifying',attempt:1,revision:2});
  await ledger.appendEvidence(run.id,{criterionId:'tests',status:'pass',source:'ci',detail:'ok',attempt:1});
  const approved=await ledger.approve(run.id,'2026-10-02T00:01:00Z');
  assert.equal(approved.status,'approved');
  await assert.rejects(()=>ledger.appendEvidence(run.id,{criterionId:'tests',status:'fail',source:'ci',detail:'late',attempt:1}),/building or verifying/);
});
test('checked revision increment rejects overflow',async()=>{
  const ledger=new InMemoryRunLedger();
  await ledger.create({...run,status:'building',attempt:1,revision:Number.MAX_SAFE_INTEGER});
  await assert.rejects(()=>ledger.appendEvidence(run.id,{criterionId:'tests',status:'pass',source:'ci',detail:'x',attempt:1}),/cannot be incremented safely/);
});
