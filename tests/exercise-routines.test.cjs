const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../exercise-routines.js');

const selections = { stretching: 'stretch-reach', strength: 'strength-chair', movement: 'move-walk' };
const approval = id => ({ id, approved: true, safetyReviewed: true, suitabilityReviewed: true });
const approvals = Core.ACTIVITIES.map(item => approval(item.id));
const options = () => ({ selections, approvals });

test('sample activities are text-only and explicitly awaiting teacher review', () => {
  assert.equal(Core.validateCatalog(Core.ACTIVITIES), true);
  assert.ok(Core.ACTIVITIES.every(item => item.suitability === 'teacher-review-required' && item.safetyStatus === 'teacher-review-required' && item.media === null));
  assert.ok(Object.isFrozen(Core.ACTIVITIES[0]));
  const routine = Core.buildRoutine(options());
  assert.deepEqual(routine.steps.map(item => item.seconds), [180, 360, 360]);
  assert.equal(routine.totalSeconds, 900);
});

test('catalog and selection validation reject unsafe, duplicate, incomplete, and unreviewed items', () => {
  const clone = () => Core.ACTIVITIES.map(item => ({ ...item }));
  for (const mutate of [
    c => { c[1].id = c[0].id; }, c => { c[0].id = ''; },
    c => { c[0].seconds = 0; }, c => { c[0].seconds = 181; },
    c => { c[0].safetyStatus = 'unsafe'; }, c => { c[0].safetyNotes = ''; },
    c => { c[0].suitability = 'approved'; }, c => { c[0].media = 'https://example.org'; },
  ]) { const catalog = clone(); mutate(catalog); assert.throws(() => Core.validateCatalog(catalog)); }
  assert.throws(() => Core.buildRoutine({ selections, approvals: [] }));
  assert.throws(() => Core.buildRoutine({ selections, approvals: approvals.map(a => ({ ...a, safetyReviewed: false })) }));
  assert.throws(() => Core.buildRoutine({ selections, approvals: [...approvals, approvals[0]] }));
  assert.throws(() => Core.buildRoutine({ selections: { ...selections, strength: 'unknown' }, approvals }));
  assert.throws(() => Core.buildRoutine({ selections: { ...selections, strength: 'move-walk' }, approvals }));
});

test('player handles pause, resume, elapsed time, alternate and skip deterministically', () => {
  const p = Core.createPlayer(options());
  assert.equal(p.tick(10).remainingSeconds, 180);
  p.resume();
  assert.equal(p.tick(30).remainingSeconds, 150);
  assert.equal(p.alternate('stretch-side').remainingSeconds, 150);
  assert.throws(() => p.alternate('strength-wall'));
  p.pause();
  assert.equal(p.tick(100).remainingSeconds, 150);
  assert.equal(p.skip().current.id, 'strength-chair');
  assert.equal(p.getState().status, 'paused');
  p.resume();
  assert.equal(p.tick(360).current.id, 'move-walk');
  assert.equal(p.tick(1000).status, 'complete');
  assert.equal(p.resume().status, 'complete');
  assert.throws(() => p.alternate('move-steps'));
  assert.throws(() => p.tick(-1));
  assert.throws(() => p.tick(0.5));
  const a = Core.createPlayer(options()); const b = Core.createPlayer(options());
  a.resume(); b.resume();
  assert.deepEqual(a.tick(500), b.tick(500));
  assert.deepEqual(Object.keys(a.getState()).sort(), ['current', 'index', 'remainingSeconds', 'status', 'totalSeconds']);
});

test('alternatives require their own approval and source mutations cannot change a running player', () => {
  const catalog = Core.ACTIVITIES.map(item => ({ ...item }));
  const p = Core.createPlayer({ selections: { ...selections }, approvals: Object.values(selections).map(approval), catalog });
  assert.throws(() => p.alternate('stretch-side'));
  catalog[0].seconds = 1;
  assert.equal(p.getState().current.seconds, 180);
});

test('browser global exposes the same API without dependencies', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../exercise-routines.js'), 'utf8'), context);
  assert.equal(context.ExerciseRoutines.buildRoutine({ selections, approvals }).totalSeconds, 900);
});
