'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const MAX_BODY = 12 * 1024 * 1024;
const DAY = 86400000;
const token = () => crypto.randomBytes(32).toString('base64url');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function createHub({ teacherSecret = token(), clock = Date.now } = {}) {
  const sessions = new Map(), capabilities = new Map();
  const data = { classes: {} };
  function clean() { const now = clock(); for (const c of Object.values(data.classes)) { for (const [id, v] of Object.entries(c.items)) if (v.expiresAt <= now) delete c.items[id]; for (const [id, v] of Object.entries(c.operations)) if (v.expiresAt <= now) delete c.operations[id]; for (const [id, v] of Object.entries(c.deleted)) if (v.expiresAt <= now) delete c.deleted[id]; } for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k); for (const [k, v] of capabilities) if (v.expiresAt <= now) capabilities.delete(k); }
  const cleaner = setInterval(clean, 60000); cleaner.unref();
  function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); }
  function issue(role, classId, studentId, lessonId, deviceId, mode, groupId) { const key = token(); sessions.set(key, { role, classId, studentId, lessonId, deviceId, mode, groupId, expiresAt: clock() + 8 * 60 * 60 * 1000 }); return key; }
  const server = http.createServer(async (req, res) => {
    try {
      const host = new URL(`http://${req.headers.host}`).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'host' });
      if (req.headers.origin) { const origin = new URL(req.headers.origin); if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return send(res, 403, { error: 'origin' }); res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      clean();
      let body = {}; if (req.method === 'POST') { let size = 0, chunks = []; for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(res, 413, { error: 'too_large' }); chunks.push(chunk); } body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      const route = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'POST' && route === '/teacher') {
        const a = Buffer.from(String(body.secret || '')), b = Buffer.from(teacherSecret);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || !validId(body.classId)) return send(res, 403, { error: 'forbidden' });
        return send(res, 200, { token: issue('teacher', body.classId), classId: body.classId, role: 'teacher' });
      }
      if (req.method === 'POST' && route === '/join') {
        const cap = capabilities.get(body.capability); if (!cap || cap.expiresAt <= clock()) return send(res, 403, { error: 'invalid_capability' });
        capabilities.delete(body.capability); return send(res, 200, { token: issue('student', cap.classId, cap.studentId, cap.lessonId, cap.deviceId, cap.mode, cap.groupId), classId: cap.classId, studentId: cap.studentId, lessonId: cap.lessonId, deviceId: cap.deviceId, mode: cap.mode, groupId: cap.groupId || null, role: 'student' });
      }
      const sessionToken = (req.headers.authorization || '').replace(/^Bearer /, '');
      const session = sessions.get(sessionToken); if (!session) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'POST' && route === '/logout') { sessions.delete(sessionToken); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && route === '/capabilities') {
        if (session.role !== 'teacher' || !validId(body.studentId) || !validId(body.lessonId) || !validId(body.deviceId) || (body.groupId && !validId(body.groupId)) || !['student', 'station'].includes(body.mode)) return send(res, 403, { error: 'forbidden' });
        const capability = token(); capabilities.set(capability, { classId: session.classId, studentId: body.studentId, lessonId: body.lessonId, deviceId: body.deviceId, mode: body.mode, groupId: body.groupId || null, expiresAt: clock() + 10 * 60000 }); return send(res, 200, { capability, expiresAt: clock() + 10 * 60000 });
      }
      const c = data.classes[session.classId] ||= { items: {}, operations: {}, deleted: {}, modes: {} };
      if (req.method === 'POST' && route === '/mode') {
        if (session.role !== 'teacher') return send(res, 403, { error: 'forbidden' });
        if (!validId(body.deviceId) || !validId(body.lessonId) || !['student', 'station'].includes(body.mode)) return send(res, 400, { error: 'invalid_mode' });
        c.modes[body.deviceId] = { deviceId: body.deviceId, lessonId: body.lessonId, mode: body.mode };
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && route === '/moderate') {
        if (session.role !== 'teacher') return send(res, 403, { error: 'forbidden' });
        const item = c.items[body.id];
        if (!item || item.kind !== 'feedback' || !['approve', 'hide'].includes(body.action)) return send(res, 400, { error: 'invalid_feedback' });
        item.moderation = body.action === 'approve' ? 'approved' : 'hidden';
        return send(res, 200, { ok: true, moderation: item.moderation });
      }
      if (req.method === 'GET' && route === '/state') return send(res, 200, { items: Object.values(c.items).filter(item => session.role === 'teacher' || (item.lessonId === session.lessonId && (item.kind === 'feedback' ? item.moderation === 'approved' || item.studentId === session.studentId : item.studentId === session.studentId))), modes: session.role === 'teacher' ? Object.values(c.modes) : (c.modes[session.deviceId]?.lessonId === session.lessonId ? [c.modes[session.deviceId]] : []) });
      if (req.method === 'POST' && route === '/operations') {
        if (!validId(body.id) || !['submit', 'delete', 'feedback'].includes(body.kind) || !body.payload || typeof body.payload !== 'object') return send(res, 400, { error: 'invalid_operation' });
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
        if (c.operations[body.id]) {
          const previous = c.operations[body.id];
          if (session.role !== 'teacher' && (previous.studentId !== session.studentId || previous.lessonId !== session.lessonId)) return send(res, 403, { error: 'forbidden' });
          return previous.fingerprint === fingerprint ? send(res, 200, previous.result) : send(res, 409, { error: 'id_conflict' });
        }
        const p = body.payload; if (!validId(p.id) || (p.classId && p.classId !== session.classId)) return send(res, 400, { error: 'invalid_payload' });
        if (body.kind === 'delete') {
          const old = c.items[p.id] || c.deleted[p.id]; if (old && session.role !== 'teacher' && (old.studentId !== session.studentId || old.lessonId !== session.lessonId)) return send(res, 403, { error: 'forbidden' }); delete c.items[p.id]; c.deleted[p.id] = { studentId: old?.studentId || session.studentId, lessonId: old?.lessonId || session.lessonId, expiresAt: clock() + 7 * DAY };
        } else {
          if ((!validId(p.studentId) && !(body.kind === 'feedback' && !p.studentId)) || !validId(p.lessonId) || (session.role === 'student' && (p.studentId !== session.studentId || p.lessonId !== session.lessonId))) return send(res, 403, { error: 'forbidden' });
          if (c.items[p.id] || c.deleted[p.id]) return send(res, 409, { error: 'item_conflict' });
          if (body.kind === 'submit' && Object.values(c.items).some(item => item.kind === 'submit' && item.studentId === p.studentId && item.lessonId === p.lessonId && item.clipId === p.clipId)) return send(res, 409, { error: 'duplicate' });
          if (body.kind === 'submit' && (!validId(p.clipId) || !Number.isFinite(p.clipExpiresAt) || p.expiresAt > p.clipExpiresAt || typeof p.clipData !== 'string' || !/^data:video\/webm;base64,[A-Za-z0-9+/=]+$/.test(p.clipData))) return send(res, 400, { error: 'invalid_clip' });
          if (body.kind === 'feedback' && (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 1000)) return send(res, 400, { error: 'invalid_text' });
          const expiresAt = p.expiresAt; if (!Number.isFinite(expiresAt) || expiresAt <= clock() || expiresAt > clock() + 7 * DAY) return send(res, 400, { error: 'invalid_retention' });
          const allowed = body.kind === 'submit' ? ['id', 'studentId', 'lessonId', 'clipId', 'clipData', 'clipExpiresAt', 'reflection', 'expiresAt'] : ['id', 'studentId', 'lessonId', 'text', 'expiresAt'];
          if (Object.keys(p).some(key => key !== 'classId' && !allowed.includes(key))) return send(res, 400, { error: 'invalid_fields' });
          if (p.reflection !== undefined && (typeof p.reflection !== 'object' || p.reflection === null || Object.keys(p.reflection).some(k => !['good', 'retry'].includes(k)) || Object.values(p.reflection).some(v => typeof v !== 'string' || v.length > 1000))) return send(res, 400, { error: 'invalid_reflection' });
          c.items[p.id] = { ...p, classId: session.classId, kind: body.kind, expiresAt, ...(body.kind === 'feedback' ? { moderation: session.role === 'teacher' ? 'approved' : 'pending' } : {}) };
        }
        const result = { ok: true, id: body.id }; c.operations[body.id] = { fingerprint, result, studentId: session.studentId || p.studentId, lessonId: session.lessonId || p.lessonId, expiresAt: clock() + 7 * DAY }; return send(res, 200, result);
      }
      return send(res, 404, { error: 'not_found' });
    } catch (error) { return send(res, 400, { error: 'bad_request' }); }
  });
  server.on('close', () => clearInterval(cleaner));
  return { server, teacherSecret };
}
if (require.main === module) {
  const teacherSecret = process.env.PE_HUB_SECRET;
  if (!teacherSecret || teacherSecret.length < 24) throw new Error('Set PE_HUB_SECRET to a private random value of at least 24 characters.');
  const hub = createHub({ teacherSecret });
  hub.server.listen(Number(process.env.PE_HUB_PORT || 8787), '127.0.0.1', () => { process.stdout.write(`Local hub http://127.0.0.1:${hub.server.address().port}\n`); });
}
module.exports = { createHub };
