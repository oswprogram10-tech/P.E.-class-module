const test=require('node:test');
const assert=require('node:assert/strict');
const {matchEvents,evaluate,fixtures}=require('../scripts/shot-evaluation.cjs');
test('inclusive one-to-one matching counts duplicate and out-of-window events as FP',()=>{
  const r=matchEvents([301,200,100,200],[{start:100,end:200},{start:300,end:300}]);
  assert.deepEqual([r.tp,r.fp,r.fn],[1,3,1]);
  assert.deepEqual(r.matches,[{timestamp:100,referenceIndex:0}]);
});
test('zero denominators stay null and unmatched references are FN',()=>{
  assert.deepEqual([matchEvents([],[]).precision,matchEvents([],[]).recall],[null,null]);
  const miss=matchEvents([],[{start:0,end:0}]); assert.equal(miss.precision,null); assert.equal(miss.recall,0); assert.equal(miss.fn,1);
  const falseAlarm=matchEvents([0],[]); assert.equal(falseAlarm.precision,0); assert.equal(falseAlarm.recall,null);
  assert.equal(matchEvents([0],[{start:0,end:0}]).tp,1);
});
test('malformed truth is rejected',()=>{
  assert.throws(()=>matchEvents([NaN],[]),TypeError);
  assert.throws(()=>matchEvents([],[{start:2,end:1}]),TypeError);

});
test('fixed synthetic suite exposes known false alarm and missed events with micro groups',()=>{
  const r=evaluate(); assert.deepEqual(r.overall,{tp:3,fp:1,fn:2,precision:.75,recall:.6});
  assert.equal(r.cases.find(c=>c.id==='non-shot-raise').fp,1);
  assert.equal(r.cases.find(c=>c.id==='occlusion').fn,1);
  for(const grouping of [r.byDirection,r.byCondition]) for(const key of ['tp','fp','fn']) assert.equal(Object.values(grouping).reduce((n,v)=>n+v[key],0),r.overall[key]);
  assert.deepEqual(evaluate(fixtures()),r);
});

test('overlapping windows use earliest deadline to maximize one-to-one matches',()=>{
  const r=matchEvents([2,4],[{start:1,end:5},{start:1,end:3}]);
  assert.equal(r.tp,2); assert.deepEqual(r.matches,[{timestamp:2,referenceIndex:1},{timestamp:4,referenceIndex:0}]);
});
