'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),P=require('../model-profiles.js'),A=require('../pose-assets.js');
test('only pinned Lite assets and explicit output/provenance are exposed',()=>{const p=P.resolve(P.DEFAULT_ID);assert.deepEqual(p.files,A.files);assert.equal(p.output.landmarks,33);assert.equal(p.output.maxPeople,1);assert.match(p.provenance.modelLicense,/family/);assert.equal(P.list().length,1);});
test('profiles and nested file records cannot be mutated',()=>{const p=P.resolve(P.DEFAULT_ID);assert.throws(()=>p.files[0].url='https://bad',TypeError);assert.throws(()=>p.output.landmarks=17,TypeError);assert.throws(()=>P.list().push({}),TypeError);});
test('unknown, URL, object and override arguments are rejected',()=>{for(const id of ['full','https://bad',{},null,undefined,'__proto__'])assert.throws(()=>P.resolve(id),TypeError);assert.throws(()=>P.resolve(P.DEFAULT_ID,{}),TypeError);});
