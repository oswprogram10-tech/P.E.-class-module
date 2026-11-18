'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const BUCKETS = new Set(['items', 'operations', 'deleted', 'modes', 'clips']);
const MAX_CLASS_BYTES = 64 * 1024 * 1024;
const MAX_CLASS_ROWS = 10000;
const WITHDRAWAL_RESERVE_BYTES = 8 * 1024 * 1024;

function createProductionStore({ dbPath, dataKey }) {
  if (typeof dbPath !== 'string' || !dbPath || dbPath === ':memory:') throw new Error('A persistent database path is required');
  if (!/^[0-9a-fA-F]{64}$/.test(dataKey || '')) throw new Error('A 32-byte hex data key is required');
  const master = Buffer.from(dataKey, 'hex');
  const encKey = crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'classroom-encryption-v1', 32);
  const indexKey = crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'classroom-index-v1', 32);
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(dbPath, 'a', 0o600);
  fs.closeSync(descriptor);
  fs.chmodSync(dbPath, 0o600);
  const db = new DatabaseSync(dbPath);
  try {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hub_state'").get()) throw new Error('Unsupported snapshot database schema');
    db.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value BLOB NOT NULL); CREATE TABLE IF NOT EXISTS records (class_hash TEXT NOT NULL, bucket TEXT NOT NULL, row_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(class_hash,bucket,row_hash)); CREATE INDEX IF NOT EXISTS records_expiry ON records(expires_at);');
    function digest(...parts) { return crypto.createHmac('sha256', indexKey).update(JSON.stringify(parts)).digest('hex'); }
    function seal(value, aad) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      cipher.setAAD(Buffer.from(aad));
      return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
    }
    function unseal(body, aad) {
      const bytes = Buffer.from(body);
      if (bytes.length < 28) throw new Error('Invalid encrypted record');
      const cipher = crypto.createDecipheriv('aes-256-gcm', encKey, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(aad));
      cipher.setAuthTag(bytes.subarray(bytes.length - 16));
      return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString());
    }
    const verifier = db.prepare("SELECT value FROM metadata WHERE name='key-check'").get();
    if (verifier) {
      if (unseal(verifier.value, 'key-check') !== 'classroom-hub-v1') throw new Error('Invalid database key');
    } else {
      if (db.prepare('SELECT 1 FROM records LIMIT 1').get()) throw new Error('Database key verification missing');
      db.prepare("INSERT INTO metadata(name,value) VALUES ('key-check',?)").run(seal('classroom-hub-v1', 'key-check'));
    }
    function indices(classId, bucket, id) {
      if (typeof classId !== 'string' || !classId || !BUCKETS.has(bucket) || typeof id !== 'string' || !id) throw new Error('Invalid record key');
      const classHash = digest('class', classId), rowHash = digest('row', classId, bucket, id);
      return { classHash, rowHash, aad: JSON.stringify([classHash, bucket, rowHash]) };
    }
    function transaction(callback) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = callback(); if (result && typeof result.then === 'function') throw new Error('Transaction callback must be synchronous'); db.exec('COMMIT'); return result; }
      catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
    function get(classId, bucket, id) {
      const { classHash, rowHash, aad } = indices(classId, bucket, id);
      const row = db.prepare('SELECT body FROM records WHERE class_hash=? AND bucket=? AND row_hash=?').get(classHash, bucket, rowHash);
      return row ? unseal(row.body, aad) : undefined;
    }
    function list(classId, bucket) {
      const { classHash } = indices(classId, bucket, '_');
      return db.prepare('SELECT row_hash,body FROM records WHERE class_hash=? AND bucket=?').all(classHash, bucket).map(row => unseal(row.body, JSON.stringify([classHash, bucket, row.row_hash])));
    }
    function put(classId, bucket, id, value, { withdrawal = false } = {}) {
      if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new Error('A valid expiry is required');
      const { classHash, rowHash, aad } = indices(classId, bucket, id);
      const body = seal(value, aad);
      const totals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(body)),0) AS size FROM records WHERE class_hash=?').get(classHash);
      const previous = db.prepare('SELECT length(body) AS size FROM records WHERE class_hash=? AND bucket=? AND row_hash=?').get(classHash, bucket, rowHash);
      // Withdrawing a live item must still be possible when the normal quota is full.
      const reserved = withdrawal && (bucket === 'deleted' || bucket === 'operations');
      const maxBytes = MAX_CLASS_BYTES + (reserved ? WITHDRAWAL_RESERVE_BYTES : 0);
      const maxRows = MAX_CLASS_ROWS * (reserved ? 2 : 1);
      if (totals.size - (previous?.size || 0) + body.length > maxBytes || totals.count + (previous ? 0 : 1) > maxRows) {
        const error = new Error('Class storage quota exceeded'); error.status = 507; throw error;
      }
      db.prepare('INSERT INTO records(class_hash,bucket,row_hash,expires_at,body) VALUES (?,?,?,?,?) ON CONFLICT(class_hash,bucket,row_hash) DO UPDATE SET expires_at=excluded.expires_at, body=excluded.body').run(classHash, bucket, rowHash, value.expiresAt, body);
    }
    function remove(classId, bucket, id) {
      const { classHash, rowHash } = indices(classId, bucket, id);
      db.prepare('DELETE FROM records WHERE class_hash=? AND bucket=? AND row_hash=?').run(classHash, bucket, rowHash);
    }
    function clean(now) {
      if (!Number.isSafeInteger(now)) throw new Error('Invalid cleanup time');
      return db.prepare('DELETE FROM records WHERE expires_at<=?').run(now).changes;
    }
    return { transaction, get, list, put, remove, clean, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
module.exports = { createProductionStore };
