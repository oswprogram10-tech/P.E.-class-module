const { test } = require('node:test');
const assert = require('node:assert/strict');
const Vault = require('../local-vault.js');
test('non-extractable PIN key verifies and encrypts without storing plaintext', async () => {
  const { key, config } = await Vault.create('123456');
  assert.equal(key.extractable, false);
  assert.equal(Vault.validConfig(config), true);
  await assert.rejects(crypto.subtle.exportKey('raw', key));
  const verified = await Vault.verify('123456', config);
  const source = new TextEncoder().encode('가상학생');
  const first = await Vault.encrypt(source, key);
  const second = await Vault.encrypt(source, key);
  assert.notEqual(first.iv, second.iv);
  assert.equal(new TextDecoder().decode(await Vault.decrypt(first.ciphertext, first.iv, verified)), '가상학생');
  await assert.rejects(Vault.verify('654321', config));
  const other = await Vault.create('654321');
  await assert.rejects(Vault.decrypt(first.ciphertext, first.iv, other.key));
});
test('malformed PIN configuration, invalid PIN and tampered cipher fail closed', async () => {
  assert.equal(Vault.validConfig({}), false);
  await assert.rejects(Vault.create('12345'));
  await assert.rejects(Vault.verify('123456', {}));
  const { key } = await Vault.create('123456');
  const stored = await Vault.encrypt(new Uint8Array([1, 2, 3]), key);
  new Uint8Array(stored.ciphertext)[0] ^= 1;
  await assert.rejects(Vault.decrypt(stored.ciphertext, stored.iv, key));
});
