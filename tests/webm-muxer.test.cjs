const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebM = require('../webm-muxer.js');
test('EBML variable sizes reserve the all-ones marker', () => {
  assert.deepEqual([...WebM.size(0)], [0x80]);
  assert.deepEqual([...WebM.size(126)], [0xfe]);
  assert.deepEqual([...WebM.size(127)], [0x40, 0x7f]);
  assert.throws(() => WebM.size(-1));
});
test('overshooting timestamps, missing keyframes and excessive duration are rejected', () => {
  const chunk = { timestamp: 0, key: true, data: new Uint8Array([1]) };
  const base = { chunks: [chunk], width: 640, height: 360, durationMs: 100 };
  assert.throws(() => WebM.mux({ ...base, durationMs: 30001 }));
  assert.throws(() => WebM.mux({ ...base, chunks: [{ ...chunk, key: false }] }));
  assert.throws(() => WebM.mux({ ...base, durationMs: 200, chunks: [chunk, { ...chunk, timestamp: 150000 }] }));
  assert.throws(() => WebM.mux({ ...base, durationMs: 5000 }));
  assert.equal(WebM.mux(base).type, 'video/webm');
});
