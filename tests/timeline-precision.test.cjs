const { test } = require('node:test');
const assert = require('node:assert/strict');
const Timeline = require('../timeline.js');

function jitteredFrames(start, end, interval = 100) {
  const frames = [];
  for (let time = start, index = 0; time <= end; index++) {
    frames.push({ time });
    time += interval + ((index * 17) % 23) - 11;
  }
  if (frames.at(-1).time < end) frames.push({ time: end });
  return frames;
}

test('fractional selection preserves the requested 5.25-second interval and neighboring frames', () => {
  const frames = jitteredFrames(0, 12000);
  const end = 11003.5;
  const selected = Timeline.select(frames, end, 5.25);
  assert.equal(selected.valid, true);
  assert.equal(selected.start, end - 5250);
  assert.equal(selected.end, end);
  assert.ok(selected.frames[0].time <= selected.start);
  assert.ok(selected.frames.at(-1).time <= selected.end);
  assert.ok(selected.frames.at(-1).time >= selected.end - 150);
});

test('the exact 30-second upper boundary is valid and anything longer is rejected', () => {
  const frames = jitteredFrames(0, 40000);
  assert.equal(Timeline.select(frames, 35000, 30).valid, true);
  assert.equal(Timeline.select(frames, 35000, 30.001).valid, false);
});

test('fractional ranges still reject insufficient coverage and timestamp gaps', () => {
  const full = jitteredFrames(0, 12000);
  assert.equal(Timeline.select(full.slice(0, 20), 8000, 5.25).valid, false);
  const gap = full.filter(frame => frame.time < 5000 || frame.time > 6000);
  assert.equal(Timeline.select(gap, 9000, 5.25).valid, false);
});

test('frameAt selects the last captured frame at jittered timestamp boundaries', () => {
  const frames = [{ time: 100 }, { time: 207 }, { time: 299 }, { time: 411 }];
  assert.equal(Timeline.frameAt(frames, 206), frames[0]);
  assert.equal(Timeline.frameAt(frames, 207), frames[1]);
  assert.equal(Timeline.frameAt(frames, 410), frames[2]);
  assert.equal(Timeline.frameAt(frames, 411), frames[3]);
});
