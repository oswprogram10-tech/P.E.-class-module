'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createLocalAdvisor } = require('./tactics-llm');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOCAL_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
function createTacticsHub({ adminToken, dbPath = ':memory:', publicOrigin = '', allowedOrigins = [], clock = Date.now, advisor = createLocalAdvisor() } = {}) {
  if (typeof adminToken !== 'string' || adminToken.length < 32) throw new Error('32자 이상의 전술판 서버 관리자 비밀값을 설정해 주세요.');
  const publicUrl = publicOrigin ? new URL(publicOrigin) : null;
  if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.origin !== publicOrigin)) throw new Error('외부 서버 주소는 경로 없는 HTTPS origin이어야 해요.');
  const origins = new Set(allowedOrigins.map(value => { const url = new URL(value); if (url.origin !== value || url.protocol !== 'https:') throw new Error('허용 앱 주소는 HTTPS origin이어야 해요.'); return value; }));
  if (publicUrl) {
    origins.add(publicOrigin);
    if (dbPath === ':memory:') throw new Error('HTTPS 전술판 공유에는 영속 DB 경로가 필요해요.');
  }
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
    fs.closeSync(fs.openSync(dbPath, 'a', 0o600));
    fs.chmodSync(dbPath, 0o600);
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, readHash TEXT NOT NULL, writeHash TEXT NOT NULL, version INTEGER NOT NULL, envelope TEXT NOT NULL, expiresAt INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS examples (id TEXT PRIMARY KEY, example TEXT NOT NULL, expiresAt INTEGER NOT NULL)');
  } catch (error) {
    db.close();
    throw error;
  }
  const adminHash = hash(adminToken), limits = new Map(); let aiBusy = false;
  function cleanup() { const now = clock(); db.prepare('DELETE FROM boards WHERE expiresAt <= ?').run(now); db.prepare('DELETE FROM examples WHERE expiresAt <= ?').run(now); for (const [key, value] of limits) if (value.until <= now) limits.delete(key); }
  const timer = setInterval(() => {
    try { cleanup(); }
    catch (error) { console.error('Tactics cleanup failed:', error.code || error.name); }
  }, 60000);
  timer.unref();
  function envelope(value) {
    if (!value || value.version !== 1 || typeof value.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(value.iv) || typeof value.ciphertext !== 'string' || !/^[A-Za-z0-9_-]{22,150000}$/.test(value.ciphertext) || Object.keys(value).some(key => !['version', 'iv', 'ciphertext'].includes(key))) fail(400, '암호화 전술판 형식이 올바르지 않아요.');
    return JSON.stringify(value);
  }
  function board(id, token, write = false) {
    const row = db.prepare('SELECT * FROM boards WHERE id = ? AND expiresAt > ?').get(id, clock());
    if (!row) fail(404, '전술판 공유가 만료되었거나 종료됐어요.');
    const digest = hash(token);
    if (row.writeHash !== digest && (write || row.readHash !== digest)) fail(403, '이 전술판에 대한 권한이 없어요.');
    return row;
  }
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    const send = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(value)); } };
    try {
      const host = new URL('http://' + req.headers.host);
      const validHost = publicUrl
        ? req.headers.host === publicUrl.host && req.headers['x-forwarded-proto'] === 'https' && LOCAL_PEERS.has(req.socket.remoteAddress)
        : LOOPBACK.has(host.hostname) && host.port === String(server.address().port);
      if (!validHost) fail(403, '허용하지 않은 서버 주소예요.');
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const localDev = !publicUrl && origin.protocol === 'http:' && LOOPBACK.has(origin.hostname);
        if (origin.origin !== req.headers.origin || (!origins.has(origin.origin) && !localDev)) fail(403, '이 앱 주소는 서버에서 허용하지 않았어요.');
        res.setHeader('Access-Control-Allow-Origin', origin.origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      cleanup();
      const route = new URL(req.url, 'http://localhost').pathname.replace(/^\/tactics\/v1/, '');
      if (!req.url.startsWith('/tactics/v1/')) fail(404, '경로가 올바르지 않아요.');
      const token = /^Bearer (.{1,512})$/.exec(req.headers.authorization || '')?.[1];
      if (!token || token.length > 512) fail(401, '서버 접속 권한이 필요해요.');
      const admin = hash(token) === adminHash;
      let body = {};
      if (['POST', 'PUT'].includes(req.method)) {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 180000) fail(413, '전술판 요청이 너무 커요.'); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if (route === '/boards' && req.method === 'POST') {
        if (!admin) fail(403, '새 공유를 만들려면 서버 관리자 비밀값이 필요해요.');
        if (db.prepare('SELECT count(*) AS n FROM boards').get().n >= 1000) fail(429, '공유 전술판 수 한도에 도달했어요.');
        const id = random(), readToken = random(), writeToken = random(), expiresAt = clock() + 86400000;
        db.prepare('INSERT INTO boards VALUES (?, ?, ?, 1, ?, ?)').run(id, hash(readToken), hash(writeToken), envelope(body.envelope), expiresAt);
        return send(201, { id, readToken, writeToken, version: 1, expiresAt });
      }
      const match = route.match(/^\/boards\/([A-Za-z0-9_-]{43})$/);
      if (match) {
        const row = board(match[1], token, req.method !== 'GET');
        if (req.method === 'GET') return send(200, { envelope: JSON.parse(row.envelope), version: row.version, expiresAt: row.expiresAt });
        if (req.method === 'DELETE') { db.prepare('DELETE FROM boards WHERE id = ?').run(row.id); return send(200, { ok: true }); }
        if (req.method === 'PUT') {
          if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== row.version) fail(409, '다른 기기에서 수정했어요. 로컬 배치를 보존한 뒤 최신 배치를 새 전술판으로 불러와 비교해 주세요.');
          const changed = db.prepare('UPDATE boards SET envelope = ?, version = version + 1 WHERE id = ? AND version = ?').run(envelope(body.envelope), row.id, body.expectedVersion);
          if (!changed.changes) fail(409, '다른 기기에서 먼저 수정했어요. 최신 배치를 확인해 주세요.');
          return send(200, { version: row.version + 1, expiresAt: row.expiresAt });
        }
      }
      if (['/suggestions', '/training-examples'].includes(route)) {
        if (!admin) { if (!/^[A-Za-z0-9_-]{43}$/.test(body.shareId || '')) fail(403, '관리자 또는 공유 편집 권한이 필요해요.'); board(body.shareId, token, true); }
        if (route === '/suggestions' && req.method === 'POST') {
          if (!advisor.available) fail(503, '로컬 LLM 모델이 설정되지 않았어요. 운영자가 Ollama와 PE_TACTICS_LLM_MODEL을 준비해 주세요.');
          const rateKey = hash(token), previous = limits.get(rateKey);
          if (aiBusy || (previous && previous.until > clock())) fail(429, '로컬 모델이 처리 중이거나 최근 요청이 있어요. 잠시 후 다시 요청해 주세요.');
          limits.set(rateKey, { until: clock() + 60000 }); aiBusy = true;
          try { return send(200, await advisor.suggest(body)); } finally { aiBusy = false; }
        }
        if (route === '/training-examples' && req.method === 'POST') {
          if (db.prepare('SELECT count(*) AS n FROM examples').get().n >= 5000) fail(429, '학습 예제 수 한도에 도달했어요.');
          const example = advisor.trainingExample(body), id = random(), expiresAt = clock() + 30 * 86400000;
          db.prepare('INSERT INTO examples VALUES (?, ?, ?)').run(id, JSON.stringify(example), expiresAt);
          return send(201, { id, expiresAt });
        }
        if (route === '/training-examples' && req.method === 'GET' && admin) return send(200, { jsonl: db.prepare('SELECT example FROM examples ORDER BY rowid').all().map(row => row.example).join('\n') });
        if (route === '/training-examples' && req.method === 'DELETE' && admin) { db.prepare('DELETE FROM examples').run(); return send(200, { ok: true }); }
      }
      fail(404, '경로가 올바르지 않아요.');
    } catch (error) {
      const dbError = error.code?.startsWith('SQLITE') || error.code === 'ERR_SQLITE_ERROR';
      const status = error.status || (dbError ? 503 : 400);
      if (dbError) console.error('Tactics storage request failed:', error.code);
      send(status, { message: error.status ? error.message : (dbError ? '공유 서버 저장소에 일시적으로 접근하지 못했어요.' : '요청 형식 또는 로컬 모델 응답을 확인하지 못했어요.') });
    }
  });
  server.on('close', () => { clearInterval(timer); db.close(); });
  return { server };
}
if (require.main === module) {
  const advisor = createLocalAdvisor({ url: process.env.PE_TACTICS_LLM_URL || 'http://127.0.0.1:11434', model: process.env.PE_TACTICS_LLM_MODEL || '', ...(process.env.PE_TACTICS_KNOWLEDGE ? { knowledgePath: process.env.PE_TACTICS_KNOWLEDGE } : {}) });
  const hub = createTacticsHub({ adminToken: process.env.PE_TACTICS_ADMIN_TOKEN, dbPath: process.env.PE_TACTICS_DB || path.join(process.cwd(), '.pe-loop-data/tactics.sqlite'), publicOrigin: process.env.PE_TACTICS_PUBLIC_ORIGIN || '', allowedOrigins: (process.env.PE_TACTICS_ALLOWED_ORIGINS || '').split(',').filter(Boolean), advisor });
  const port = Number(process.env.PE_TACTICS_PORT || 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PE_TACTICS_PORT를 확인해 주세요.');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => hub.server.close());
  hub.server.listen(port, '127.0.0.1', () => process.stdout.write('전술판 공유 서버가 loopback에서 시작됐어요. 외부 기기는 HTTPS 프록시를 통해 연결해 주세요.\n'));
}
module.exports = { createTacticsHub };
