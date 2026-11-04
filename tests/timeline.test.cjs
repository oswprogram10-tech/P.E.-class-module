const { test } = require('node:test');
const assert = require('node:assert/strict');
const Timeline = require('../timeline.js');

test('capture gaps hold the previous frame rather than advancing the scene early', () => {
  const frames = [{ time: 100 }, { time: 200 }, { time: 900 }];
  assert.equal(Timeline.frameAt(frames, 800), frames[1]);
  assert.equal(Timeline.frameAt(frames, 900), frames[2]);
  assert.equal(Timeline.frameAt(frames, 10000), frames[2]);
});
test('boundary and empty selections are handled', () => {
  assert.equal(Timeline.frameAt([], 0), null);
  const frames = [{ time: 100 }];
  assert.equal(Timeline.frameAt(frames, 0), frames[0]);
});

test('selection includes a predecessor frame and covers the entire selected time', () => {
  const frames = Array.from({ length: 121 }, (_, index) => ({ time: index * 100 }));
  const selected = Timeline.select(frames, 10550, 5);
  assert.equal(selected.valid, true);
  assert.equal(selected.start, 5550);
  assert.equal(selected.frames[0].time, 5500);
  assert.equal(selected.frames.at(-1).time, 10500);
});
test('insufficient coverage, capture gaps and invalid duration cannot be saved', () => {
  const frames = Array.from({ length: 101 }, (_, index) => ({ time: index * 100 }));
  assert.equal(Timeline.select(frames, 4000, 5).valid, false);
  assert.equal(Timeline.select(frames, 12000, 5).valid, false);
  assert.equal(Timeline.select(frames, 8000, 31).valid, false);
  const gap = frames.filter(frame => frame.time < 5000 || frame.time > 6000);
  assert.equal(Timeline.select(gap, 9000, 5).valid, false);
});
