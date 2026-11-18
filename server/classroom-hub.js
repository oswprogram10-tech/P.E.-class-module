'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const MAX_UPLOAD = 12 * 1024 * 1024;
const DAY = 86400000;
const KEEP = 7 * DAY;
const QR_LIFETIME = 10 * 60000;
const SESSION_LIFETIME = 8 * 60 * 60000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const token = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const validMode = value => value === 'student' || value === 'station';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const problem = (status, error) => ({ status, body: { error } });
const okay = (body = { ok: true }) => ({ status: 200, body });

function createMemoryStore() {
  const rows = new Map();
  const key = (classId, bucket, id) => [classId, bucket, id].join('/');
  return {
    transaction: run => run(),
    get: (classId, bucket, id) => rows.get(key(classId, bucket, id)),
    put: (classId, bucket, id, value) => rows.set(key(classId, bucket, id), value),
    remove: (classId, bucket, id) => rows.delete(key(classId, bucket, id)),
    list(classId, bucket) {
      const prefix = key(classId, bucket, '');
      return Array.from(rows).filter(([id]) => id.startsWith(prefix)).map(([, row]) => row);
    },
    clean(now) {
      for (const [id, row] of rows) if (row.expiresAt <= now) rows.delete(id);
    },
    close() {},
  };
}

function send(res, { status, body }) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  try {
    const body = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    return object(body) ? body : false;
  } catch {
    return false;
  }
}

const clipKey = item => digest(JSON.stringify([item.studentId, item.lessonId, item.clipId])).toString('hex');

function applyOperation(store, session, operation, now) {
  const { id, kind, payload } = operation;
  if (!validId(id) || !['submit', 'delete', 'feedback'].includes(kind) || !object(payload)) {
    return problem(400, 'invalid_operation');
  }
  const { classId, role } = session;
  if (!validId(payload.id) || ('classId' in payload && payload.classId !== classId)) {
    return problem(400, 'invalid_payload');
  }
  const fingerprint = digest(JSON.stringify(operation)).toString('hex');
  const previous = store.get(classId, 'operations', id);
  const owns = value => role === 'teacher' || (value.studentId === session.studentId && value.lessonId === session.lessonId);
  if (previous) {
    if (!owns(previous)) return problem(403, 'forbidden');
    return previous.fingerprint === fingerprint ? okay({ ok: true, id }) : problem(409, 'id_conflict');
  }

  const item = store.get(classId, 'items', payload.id);
  const deleted = store.get(classId, 'deleted', payload.id);
  const withdrawal = kind === 'delete' && Boolean(item);
  let owner = payload;
  if (kind === 'delete') {
    if (Object.keys(payload).some(name => name !== 'id' && name !== 'classId')) return problem(400, 'invalid_fields');
    owner = item || deleted || session;
    if (!owns(owner)) return problem(403, 'forbidden');
    if (item?.kind === 'submit') store.remove(classId, 'clips', clipKey(item));
    store.remove(classId, 'items', payload.id);
    store.put(classId, 'deleted', payload.id, {
      studentId: owner.studentId, lessonId: owner.lessonId, expiresAt: now + KEEP,
    }, { withdrawal });
  } else {
    if ((!validId(payload.studentId) && !(kind === 'feedback' && payload.studentId == null)) || !validId(payload.lessonId) || !owns(payload)) {
      return problem(403, 'forbidden');
    }
    if (item || deleted) return problem(409, 'item_conflict');
    const { expiresAt } = payload;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + KEEP) return problem(400, 'invalid_retention');
    const fields = kind === 'submit'
      ? ['id', 'classId', 'studentId', 'lessonId', 'clipId', 'clipData', 'clipExpiresAt', 'reflection', 'expiresAt']
      : ['id', 'classId', 'studentId', 'lessonId', 'text', 'expiresAt'];
    if (Object.keys(payload).some(name => !fields.includes(name))) return problem(400, 'invalid_fields');
    if (kind === 'submit') {
      const { clipId, clipData, clipExpiresAt, reflection } = payload;
      if (!validId(clipId) || !Number.isSafeInteger(clipExpiresAt) || expiresAt > clipExpiresAt || typeof clipData !== 'string' ||
          !/^data:video\/webm;base64,[A-Za-z0-9+/]+={0,2}$/.test(clipData)) {
        return problem(400, 'invalid_clip');
      }
      if (reflection !== undefined && (!object(reflection) || Object.entries(reflection).some(([name, value]) =>
        !['good', 'retry'].includes(name) || typeof value !== 'string' || value.length > 1000))) return problem(400, 'invalid_reflection');
      const key = clipKey(payload);
      if (store.get(classId, 'clips', key)) return problem(409, 'duplicate');
      store.put(classId, 'clips', key, { expiresAt });
    } else if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 1000) {
      return problem(400, 'invalid_text');
    }
    store.put(classId, 'items', payload.id, {
      ...payload, classId, kind, ...(kind === 'feedback' ? { moderation: role === 'teacher' ? 'approved' : 'pending' } : {}),
    });
  }
  store.put(classId, 'operations', id, {
    fingerprint, studentId: session.studentId || owner.studentId, lessonId: session.lessonId || owner.lessonId, expiresAt: now + KEEP,
  }, { withdrawal });
  return okay({ ok: true, id });
}

function createHub({ teacherSecret = token(), clock = Date.now, production = null } = {}) {
  let origin, teacherSecrets;
  if (production) {
    origin = new URL(production.origin);
    if (origin.protocol !== 'https:' || origin.origin !== production.origin) throw new Error('Expected canonical HTTPS PE_HUB_ORIGIN');
    if (!object(production.teacherSecrets)) throw new Error('Expected a JSON object of class IDs and secrets');
    const entries = Object.entries(production.teacherSecrets);
    if (!entries.length || entries.some(([id, secret]) => !validId(id) || typeof secret !== 'string' || secret.length < 24 || secret.length > 512) ||
        new Set(entries.map(([, secret]) => secret)).size !== entries.length) {
      throw new Error('Configure a distinct 24–512 character secret for each class');
    }
    teacherSecrets = new Map(entries.map(([id, secret]) => [id, digest(secret)]));
  }
  const store = production ? require('./classroom-hub-store').createProductionStore(production) : createMemoryStore();
  const devTeacherSecret = production ? null : digest(teacherSecret);
  const sessions = new Map(), capabilities = new Map();
  const authAttempts = { end: 0, teacher: 0, join: 0 };

  function clean(now) {
    for (const entries of [sessions, capabilities]) {
      for (const [id, row] of entries) if (row.expiresAt <= now) entries.delete(id);
    }
    store.clean(now);
  }
  const cleaner = setInterval(() => {
    try { store.transaction(() => clean(clock())); }
    catch (error) { console.error('Classroom expiry cleanup failed:', error.code || error.name); }
  }, 60000);
  cleaner.unref();

  function issue(context, now) {
    const value = token();
    sessions.set(value, { ...context, expiresAt: now + SESSION_LIFETIME });
    return okay({ token: value, ...context });
  }

  function handle(route, method, body, sessionToken, now) {
    clean(now);
    if (method === 'POST' && (route === '/teacher' || route === '/join')) {
      if (production) {
        if (authAttempts.end <= now) Object.assign(authAttempts, { end: now + 60000, teacher: 0, join: 0 });
        if (++authAttempts[route.slice(1)] > 240 || sessions.size >= 2048) return problem(429, 'try_later');
      }
      if (route === '/teacher') {
        const { classId, secret } = body;
        const expected = production ? teacherSecrets.get(classId) : devTeacherSecret;
        if (!validId(classId) || typeof secret !== 'string' || !expected || !crypto.timingSafeEqual(digest(secret), expected)) {
          return problem(403, 'forbidden');
        }
        return issue({ role: 'teacher', classId }, now);
      }
      const cap = capabilities.get(body.capability);
      if (!cap) return problem(403, 'invalid_capability');
      capabilities.delete(body.capability);
      const { expiresAt, ...context } = cap;
      return issue({ ...context, role: 'student' }, now);
    }

    const session = sessions.get(sessionToken);
    if (!session) return problem(401, 'unauthorized');
    const { classId, role } = session;
    if (method === 'GET' && route === '/state') {
      const items = store.list(classId, 'items').filter(item => role === 'teacher' || (
        item.lessonId === session.lessonId && (item.kind === 'feedback'
          ? item.moderation === 'approved' || (item.moderation === 'pending' && item.studentId === session.studentId)
          : item.studentId === session.studentId)
      ));
      const mode = role === 'student' ? store.get(classId, 'modes', session.deviceId) : null;
      const modes = role === 'teacher' ? store.list(classId, 'modes') : (mode?.lessonId === session.lessonId ? [mode] : []);
      return okay({ items, modes: modes.map(({ expiresAt, ...value }) => value) });
    }
    if (method !== 'POST') return problem(404, 'not_found');
    if (route === '/logout') {
      sessions.delete(sessionToken);
      return okay();
    }
    if (route === '/operations') return applyOperation(store, session, body, now);
    if (!['/capabilities', '/mode', '/moderate'].includes(route)) return problem(404, 'not_found');
    if (role !== 'teacher') return problem(403, 'forbidden');
    if (route === '/capabilities') {
      const { studentId, lessonId, deviceId, groupId, mode } = body;
      if (![studentId, lessonId, deviceId].every(validId) || (groupId != null && !validId(groupId)) || !validMode(mode)) {
        return problem(403, 'forbidden');
      }
      if (production && capabilities.size >= 2048) return problem(429, 'try_later');
      const capability = token(), expiresAt = now + QR_LIFETIME;
      capabilities.set(capability, { classId, studentId, lessonId, deviceId, groupId: groupId || null, mode, expiresAt });
      return okay({ capability, expiresAt });
    }
    if (route === '/mode') {
      const { deviceId, lessonId, mode } = body;
      if (![deviceId, lessonId].every(validId) || !validMode(mode)) return problem(400, 'invalid_mode');
      store.put(classId, 'modes', deviceId, { deviceId, lessonId, mode, expiresAt: now + KEEP });
      return okay();
    }
    const { id, action } = body;
    const item = validId(id) ? store.get(classId, 'items', id) : null;
    if (item?.kind !== 'feedback' || !['approve', 'hide'].includes(action)) return problem(400, 'invalid_feedback');
    const moderation = action === 'approve' ? 'approved' : 'hidden';
    store.put(classId, 'items', id, { ...item, moderation });
    return okay({ ok: true, moderation });
  }

  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    try {
      if (production) {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
            req.headers.host !== origin.host || req.headers['x-forwarded-proto'] !== 'https' ||
            (req.headers.origin && req.headers.origin !== origin.origin)) return send(res, problem(403, 'origin'));
      } else {
        const host = new URL('http://' + req.headers.host).hostname;
        if (!LOOPBACK.has(host)) return send(res, problem(403, 'host'));
        if (req.headers.origin) {
          const from = new URL(req.headers.origin);
          if (!LOOPBACK.has(from.hostname)) return send(res, problem(403, 'origin'));
          res.setHeader('Access-Control-Allow-Origin', from.origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
        if (req.method === 'OPTIONS') return res.writeHead(204).end();
      }
      const { pathname, search } = new URL(req.url, 'http://localhost');
      if (search || !req.url.startsWith('/')) return send(res, problem(400, 'bad_request'));
      const sessionToken = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      if (pathname === '/operations' && !(sessions.get(sessionToken)?.expiresAt > clock())) {
        req.resume();
        return send(res, problem(401, 'unauthorized'));
      }
      const limit = pathname === '/operations' ? MAX_UPLOAD : 16 * 1024;
      if (Number(req.headers['content-length']) > limit) {
        req.resume();
        return send(res, problem(413, 'too_large'));
      }
      const body = req.method === 'POST' ? await readBody(req, limit) : {};
      if (body === null) return send(res, problem(413, 'too_large'));
      if (body === false) return send(res, problem(400, 'bad_request'));
      const result = store.transaction(() => handle(pathname, req.method, body, sessionToken, clock()));
      return send(res, result);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      if (error.status === 507) return send(res, problem(507, 'storage_limit'));
      if (production) console.error('Classroom request failed:', error.code || error.name);
      return send(res, problem(503, 'server_unavailable'));
    }
  });
  server.on('close', () => { clearInterval(cleaner); store.close(); });
  return { server, teacherSecret };
}

if (require.main === module) {
  const mode = process.env.PE_HUB_MODE || 'development';
  if (!['development', 'production'].includes(mode)) throw new Error('Set PE_HUB_MODE to development or production');
  const fs = require('node:fs');
  const production = mode === 'production' ? {
    origin: process.env.PE_HUB_ORIGIN,
    dbPath: process.env.PE_HUB_DB,
    dataKey: process.env.PE_HUB_DATA_KEY,
    teacherSecrets: JSON.parse(fs.readFileSync(process.env.PE_HUB_TEACHER_SECRETS_FILE, 'utf8')),
  } : null;
  const teacherSecret = process.env.PE_HUB_SECRET;
  if (!production && (!teacherSecret || teacherSecret.length < 24)) throw new Error('Set PE_HUB_SECRET to a private random value of at least 24 characters.');
  const port = Number(process.env.PE_HUB_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PE_HUB_PORT');
  const hub = createHub({ teacherSecret, production });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => hub.server.close());
  hub.server.listen(port, '127.0.0.1', () => console.log(`Classroom hub (${mode}) listening on 127.0.0.1:${port}`));
}
module.exports = { createHub };
