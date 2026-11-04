const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expiry, RETENTION } = require('../clip-repository.js');
test('seven-day expiry cannot be extended by an inconsistent expiresAt field', () => {
  const createdAt = 1000;
  assert.equal(expiry({ createdAt, expiresAt: createdAt + RETENTION }), createdAt + RETENTION);
  assert.equal(expiry({ createdAt, expiresAt: createdAt + RETENTION * 2 }), createdAt + RETENTION);
  assert.equal(expiry({ createdAt, expiresAt: 2000 }), 2000);
});
test('unknown expiry is distinguished from a valid expiration', () => {
  assert.equal(expiry({ createdAt: NaN, expiresAt: 10 }), null);
  assert.equal(expiry({ createdAt: 10 }), null);
  assert.equal(expiry({ createdAt: Infinity, expiresAt: 10 }), null);
});
