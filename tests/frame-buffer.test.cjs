const { test } = require('node:test');
const assert = require('node:assert/strict');
const FrameBuffer = require('../frame-buffer.js');

test('simulated 40-minute capture keeps only the latest five minutes', () => {
  const buffer = new FrameBuffer();
  const blob = { size: 8192 };
  for (let time = 0; time <= 40 * 60 * 1000; time += 100) buffer.add({ time, blob });
  assert.equal(buffer.duration, 300000);
  assert.equal(buffer.frames.length, 3001);
  assert.equal(buffer.bytes, 3001 * blob.size);
  assert.equal(buffer.frames[0].time, 35 * 60 * 1000);
});

test('byte limit, frame limit, oversize frames and timestamp order are enforced', () => {
  const buffer = new FrameBuffer({ maxBytes: 10, maxFrames: 3 });
  for (let time = 0; time < 6; time++) buffer.add({ time, blob: { size: 4 } });
  assert.equal(buffer.bytes, 8);
  assert.equal(buffer.frames.length, 2);
  assert.equal(buffer.capacityLimited, true);
  assert.equal(buffer.add({ time: 4, blob: { size: 1 } }), false);
  assert.equal(buffer.add({ time: 7, blob: { size: 11 } }), false);
  const tinyFrames = new FrameBuffer({ maxFrames: 2 });
  for (let time = 0; time < 5; time++) tinyFrames.add({ time, blob: { size: 0 } });
  assert.equal(tinyFrames.frames.length, 2);
});

test('a selected snapshot survives live buffer rotation; clear releases live references', () => {
  const buffer = new FrameBuffer({ durationMs: 100 });
  buffer.add({ time: 0, blob: { size: 4 } });
  const selected = buffer.snapshot();
  buffer.add({ time: 200, blob: { size: 5 } });
  assert.equal(selected[0].time, 0);
  assert.equal(buffer.frames[0].time, 200);
  buffer.clear();
  assert.equal(buffer.bytes, 0);
  assert.equal(buffer.frames.length, 0);
  assert.equal(buffer.capacityLimited, false);
});
