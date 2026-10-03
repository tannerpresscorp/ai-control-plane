import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';

const verifyingRun={id:'run-approval',objective:'Approve safely',status:'verifying',acceptanceCriteria:['tests-pass'],requestedCapabilities:['repo.read'],attempt:1,revision:2,createdAt:'2026-10-03T00:00:00.000Z',updatedAt:'2026-10-03T00:00:00.000Z'};
const dbRun={id:verifyingRun.id,objective:verifyingRun.objective,status:verifyingRun.status,acceptance_criteria:[...verifyingRun.acceptanceCriteria],requested_capabilities:[...verifyingRun.requestedCapabilities],attempt:1,revision:2,created_at:verifyingRun.createdAt,updated_at:verifyingRun.updatedAt};
function thenable(value){return{then(resolve){return Promise.resolve(resolve(value));}};}
function fakeSupabase(){
  const runs=[structuredClone(dbRun)], evidence=[];
  const builder=(selection)=>{let current=selection;return{
    eq(c,v){current=current.filter(r=>r[c]===v);return this;},select(){return this;},
    maybeSingle(){return thenable({data:current[0]??null,error:null});},
    order(c,{ascending}){current=[...current].sort((a,b)=>ascending?a[c]-b[c]:b[c]-a[c]);return this;},
    range(f,t){return thenable({data:current.slice(f,t+1),error:null});}
  };};
  return{
    rpc(name,args){
      const run=runs.find(r=>r.id===args.p_run_id);
      if(!run)return thenable({data:null,error:{message:'Run not found'}});
      if(name==='append_control_plane_evidence'){
        evidence.push({id:evidence.length+1,run_id:run.id,attempt:args.p_attempt,criterion_id:args.p_criterion_id,status:args.p_status,source:args.p_source,detail:args.p_detail});run.revision+=1;return thenable({data:null,error:null});
      }
      if(name==='approve_control_plane_run'){
        for(const criterion of run.acceptance_criteria){
          const latest=evidence.filter(e=>e.run_id===run.id&&e.attempt===run.attempt&&e.criterion_id===criterion).at(-1);
          if(!latest||latest.status!=='pass')return thenable({data:null,error:{message:'Verification did not pass'}});
        }
        run.status='approved';run.updated_at=args.p_updated_at;run.revision+=1;return thenable({data:structuredClone(run),error:null});
      }
      return thenable({data:null,error:{message:'unknown rpc'}});
    },
    from(table){const source=table==='control_plane_runs'?runs:evidence;return{
      insert(v){source.push(...(Array.isArray(v)?v:[v]).map(structuredClone));return thenable({data:null,error:null});},
      select(){return builder(source);}
    };}
  };
}
test('in-memory approval uses latest current-attempt evidence',async()=>{
  const ledger=new InMemoryRunLedger();await ledger.create(verifyingRun);
  await ledger.appendEvidence(verifyingRun.id,{criterionId:'tests-pass',status:'pass',source:'ci',detail:'first',attempt:1});
  await ledger.appendEvidence(verifyingRun.id,{criterionId:'tests-pass',status:'fail',source:'ci',detail:'latest',attempt:1});
  await assert.rejects(()=>ledger.approve(verifyingRun.id,'2026-10-03T00:01:00Z'),/failed: tests-pass/);
});
test('Supabase approval delegates to atomic approval RPC',async()=>{
  const ledger=new SupabaseRunLedger(fakeSupabase());
  await ledger.appendEvidence(verifyingRun.id,{criterionId:'tests-pass',status:'pass',source:'ci',detail:'passed',attempt:1});
  assert.equal((await ledger.approve(verifyingRun.id,'2026-10-03T00:02:00Z')).status,'approved');
});
test('generic create/update cannot persist approved state',async()=>{
  const ledger=new InMemoryRunLedger();
  await assert.rejects(()=>ledger.create({...verifyingRun,status:'approved'}),/ledger approval/);
  await ledger.create(verifyingRun);
  await assert.rejects(()=>ledger.update({...verifyingRun,status:'approved',revision:3}),/ledger approval/);
});
