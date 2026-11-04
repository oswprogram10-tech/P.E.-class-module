(function (root) {
  const ITERATIONS = 250000;
  const CHECK = 'PE-LOOP-TEACHER-KEY';
  const encode = bytes => btoa(String.fromCharCode(...bytes));
  const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  function validConfig(config) {
    try {
      return !!config && decode(config.pinSalt).length === 16 && decode(config.pinCheckIv).length === 12 &&
        decode(config.pinCheck).length >= 16 && (config.pinKdfIterations ?? ITERATIONS) === ITERATIONS;
    } catch { return false; }
  }
  async function derive(pin, salt) {
    if (!/^\d{6}$/.test(pin)) throw new Error('PIN은 숫자 6자리로 입력해 주세요.');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function create(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await derive(pin, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const check = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(CHECK));
    return { key, config: { pinSalt: encode(salt), pinCheckIv: encode(iv), pinCheck: encode(new Uint8Array(check)),
      pinKdfIterations: ITERATIONS, revision: crypto.randomUUID() } };
  }
  async function verify(pin, config) {
    if (!validConfig(config)) throw new Error('PIN 설정을 읽을 수 없어요. 기기 초기화 안내를 확인해 주세요.');
    const candidate = await derive(pin, decode(config.pinSalt));
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(config.pinCheckIv) }, candidate, decode(config.pinCheck));
      if (new TextDecoder().decode(plain) !== CHECK) throw new Error();
      return candidate;
    } catch { throw new Error('PIN이 맞지 않아요. 다시 입력해 주세요.'); }
  }
  async function encrypt(data, key) {
    if (!key) throw new Error('교사 PIN을 입력한 뒤 다시 시도해 주세요.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv: encode(iv), ciphertext: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data) };
  }
  async function decrypt(ciphertext, iv, key) {
    if (!key) throw new Error('교사 PIN을 입력한 뒤 다시 시도해 주세요.');
    const nonce = decode(iv);
    if (nonce.length !== 12) throw new Error('클립 정보가 손상됐어요.');
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
  }
  const api = { create, verify, encrypt, decrypt, validConfig };
  if (typeof module !== 'undefined') module.exports = api;
  else root.LocalVault = api;
})(globalThis);
