'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), script=path.join(root,'scripts/manual/tactics-stage5-3b.cjs');
test('manifest is deterministic, stratified, and does not overwrite an existing result',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pe-stage5-test-'));try {
    const a=path.join(dir,'a.json'), b=path.join(dir,'b.json'), run=out=>spawnSync(process.execPath,[script,'/not/used/model.gguf',out,'--manifest-only'],{cwd:root,encoding:'utf8'});
    assert.equal(run(a).status,0);assert.equal(run(b).status,0);const x=JSON.parse(fs.readFileSync(a)),y=JSON.parse(fs.readFileSync(b));assert.deepEqual(x.sample,y.sample);assert.equal(x.sample.length,15);
    for(const sport of ['basketball','volleyball','soccer','teeball','dodgeball']){const rows=x.sample.filter(q=>q.sport===sport);assert.equal(rows.length,3);assert.deepEqual(rows.map(q=>q.prior.noCandidates),[false,false,true]);assert.notEqual(rows[0].scenario_family,rows[1].scenario_family);}
    const before=fs.readFileSync(a,'utf8');assert.equal(run(a).status,2);assert.equal(fs.readFileSync(a,'utf8'),before);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('saved batch records actual selection and no-candidate engine bypass',()=>{
  const x=JSON.parse(fs.readFileSync(path.join(root,'docs/tactics-stage5-model-2026-11-16.json')));assert.equal(x.results.length,15);assert.ok(x.completedAt);
  for(const r of x.results){const b=r.browser;assert.ok(!r.error&&!b.error);if(r.kind==='noCandidate'){assert.equal(b.calls.loads,0);assert.equal(b.calls.completions,0);assert.deepEqual(b.result.cases,[]);continue;}assert.equal(b.calls.loads,1);assert.equal(b.calls.completions,1);const raw=JSON.parse(b.calls.raw);assert.deepEqual(raw.referenceIds,b.result.cases.map(c=>c.id));assert.ok(raw.referenceIds.every(id=>b.promptIds.includes(id)));assert.ok(b.promptIds.every(id=>b.preBudgetIds.includes(id)));assert.ok(b.preBudgetIds.every(id=>b.allowedIds.includes(id)));assert.ok(b.retrievalReferenceFieldsPreserved.every(v=>v.preserved));assert.ok(b.inputTokens<=512);}
  assert.equal(x.requests.filter(r=>r.external).length,0);
});
