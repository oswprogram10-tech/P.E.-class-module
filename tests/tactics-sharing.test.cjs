const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const T = require('../tactics-board');
const S = require('../tactics-sharing');
const { createTacticsHub } = require('../server/tactics-hub');
const { createLocalAdvisor, cleanCaseMatches } = require('../server/tactics-llm');
const secret = 'local-test-only-admin-key-32-characters';
function board() { const b = T.createBoard(); const team = T.addTeam(b); T.addToken(b, { teamId: team.id, x: 100, y: 150 }); b.reflection.planned = 'private-reflection-student-name'; b.title = 'private-class-name'; return b; }
async function start(options = {}) { const hub = createTacticsHub({ adminToken: secret, ...options }); hub.server.listen(0, '127.0.0.1'); await once(hub.server, 'listening'); return { server: hub.server, url: 'http://127.0.0.1:' + hub.server.address().port }; }
const close = server => new Promise(resolve => server.close(resolve));
const advice = { summary: '요청과 가까운 경기 사례를 찾았습니다.', caseMatches: [{ referenceId: 'basketball_case_01', similarity: '공간을 만드는 볼스크린 상황이 비슷합니다.' }], comparisonLimit: '당시 선수 구성과 경기 조건이 다를 수 있습니다.' };

test('anonymous layouts remove free text and original IDs; encrypted invites cannot be read with a different key', async () => {
  const original = board(); original.teams[0].id = 'private-person'; original.tokens[0].teamId = 'private-person';
  const clean = T.anonymousLayout(original);
  assert.ok(!JSON.stringify(clean).includes('private'));
  assert.equal(clean.teams[0].id, 'team-1');
  const key = require('node:crypto').randomBytes(32).toString('base64url');
  const envelope = await S.encrypt(original, key);
  assert.deepEqual(await S.decrypt(envelope, key), clean);
  await assert.rejects(S.decrypt(envelope, require('node:crypto').randomBytes(32).toString('base64url')), /복호화/);
  assert.throws(() => S.serverUrl('http://192.168.1.1:8788'), /HTTPS/);
  assert.throws(() => S.parseInvitation('anything'));
});

test('two clients share encrypted boards with read/edit separation, conflict protection, restart persistence and expiration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-tactics-')), dbPath = path.join(dir, 'state.sqlite');
  let time = Date.now(), hub = await start({ dbPath, clock: () => time });
  try {
    const original = board(), shared = await S.create(hub.url, secret, original);
    const readInvite = S.invitation(shared, 'read'), editInvite = S.invitation(shared, 'edit');
    const viewer = await S.join(readInvite), editor = await S.join(editInvite);
    assert.equal(viewer.board.reflection.planned, '');
    assert.equal(viewer.share.writeToken, undefined);
    await assert.rejects(S.publish(viewer.share, original), /읽기 전용/);
    await assert.rejects(S.request(hub.url, '/boards/' + shared.id, { token: viewer.share.readToken, method: 'DELETE' }), error => error.status === 403);
    original.tokens[0].x = 200;
    const result = await S.publish(shared, original); assert.equal(result.version, 2);
    await assert.rejects(S.publish(editor.share, viewer.board), error => error.status === 409);
    assert.equal((await S.read(editor.share)).board.tokens[0].x, 200);
    await assert.rejects(S.request(hub.url, '/boards/' + shared.id, { token: 'invalid' }), error => error.status === 403);
    const denied = await fetch(hub.url + '/tactics/v1/boards/' + shared.id, { headers: { Origin: 'https://untrusted.example', Authorization: 'Bearer ' + shared.readToken } });
    assert.equal(denied.status, 403);
    await close(hub.server); hub = await start({ dbPath, clock: () => time });
    const restored = { ...shared, server: hub.url };
    assert.equal((await S.read(restored)).version, 2);
    assert.ok(!fs.readFileSync(dbPath).includes(Buffer.from('private-reflection')));
    time += 86400001;
    await assert.rejects(S.read(restored), error => error.status === 404);
  } finally { await close(hub.server); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('share revocation removes server content without deleting downloaded local boards', async () => {
  const hub = await start();
  try { const original = board(), shared = await S.create(hub.url, secret, original); const local = await S.read(shared); await S.revoke(shared); assert.deepEqual(await S.revoke(shared), { ok: true }); await assert.rejects(S.read(shared), error => error.status === 404); assert.equal(local.board.tokens.length, 1); }
  finally { await close(hub.server); }
});

test('public sharing requires persistent storage and the configured HTTPS proxy and app origins', async t => {
  const http = require('node:http');
  const publicOrigin = 'https://school.example', nativeOrigin = 'https://appassets.androidplatform.net';
  assert.throws(() => createTacticsHub({ adminToken: secret, publicOrigin }), /영속 DB/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-tactics-https-'));
  const hub = await start({ publicOrigin, allowedOrigins: [nativeOrigin], dbPath: path.join(dir, 'share.sqlite') });
  t.after(async () => { await close(hub.server); fs.rmSync(dir, { recursive: true, force: true }); });
  function call(method, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(hub.url + '/tactics/v1/boards', {
        method, headers: { host: 'school.example', 'x-forwarded-proto': 'https', Origin: publicOrigin, ...headers },
      }, res => { res.resume(); resolve(res); });
      req.on('error', reject);
      req.end();
    });
  }
  assert.equal((await call('OPTIONS', { host: 'invalid.example' })).statusCode, 403);
  assert.equal((await call('OPTIONS', { 'x-forwarded-proto': 'http' })).statusCode, 403);
  assert.equal((await call('OPTIONS', { Origin: 'https://unknown.example' })).statusCode, 403);
  assert.equal((await call('OPTIONS', { Origin: 'http://localhost:3300' })).statusCode, 403);
  assert.equal((await call('OPTIONS')).statusCode, 204);
  const cors = await call('OPTIONS', { Origin: nativeOrigin });
  assert.equal(cors.statusCode, 204);
  assert.equal(cors.headers['access-control-allow-origin'], nativeOrigin);
  assert.equal((await call('POST')).statusCode, 401);
});

test('local Ollama selects sourced match cases from anonymous geometry and the team request', async () => {
  const requests = [];
  const advisor = createLocalAdvisor({ model: 'test-local-model', fetcher: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ message: { content: JSON.stringify(advice) } }) }; } });
  const hub = await start({ advisor });
  try {
    const input = { board: board(), sport: 'basketball', goal: 'spacing', request: '드롭 수비를 상대로 픽앤롤에서 속도와 각도를 바꿔 2대1을 만들고 깊게 롤한 선수를 찾은 경기 사례를 비교해 주세요.' };
    const result = await S.request(hub.url, '/suggestions', { token: secret, body: input });
    assert.equal(result.model, 'test-local-model');
    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0].id, 'basketball_case_01');
    assert.equal(result.cases[0].reviewStatus, 'draft');
    assert.match(result.cases[0].sourceUrl, /^https:\/\//);
    assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/chat');
    assert.ok(!JSON.stringify(requests).includes('private'));
    await assert.rejects(S.request(hub.url, '/suggestions', { token: secret, body: input }), error => error.status === 429);
    await assert.rejects(S.request(hub.url, '/training-examples', { token: secret, body: { ...input, advice, reviewed: false } }), error => error.status === 400);
    await S.request(hub.url, '/training-examples', { token: secret, body: { ...input, advice, reviewed: true } });
    const exported = await S.request(hub.url, '/training-examples', { token: secret });
    const example = JSON.parse(exported.jsonl);
    assert.equal(example.messages[2].role, 'assistant');
    const compared = JSON.parse(example.messages[2].content);
    assert.equal(compared.cases[0].id, 'basketball_case_01');
    assert.equal(compared.cases[0].sourceUrl, result.cases[0].sourceUrl);
    assert.ok(!exported.jsonl.includes('private'));
    await S.request(hub.url, '/training-examples', { token: secret, method: 'DELETE' });
    assert.equal((await S.request(hub.url, '/training-examples', { token: secret })).jsonl, '');
  } finally { await close(hub.server); }
});

test('unconfigured or invalid local models fail explicitly rather than producing a rule-based AI answer', async () => {
  assert.throws(() => createLocalAdvisor({ url: 'https://external.example' }), /로컬 LLM/);
  const hub = await start();
  try { await assert.rejects(S.request(hub.url, '/suggestions', { token: secret, body: { board: board(), sport: 'basketball', goal: 'spacing', request: '비슷한 사례를 찾아 주세요.' } }), error => error.status === 503); }
  finally { await close(hub.server); }
    const invalid = createLocalAdvisor({ model: 'test', fetcher: async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ ...advice, caseMatches: [{ referenceId: 'made-up-reference', similarity: '가깝습니다.' }] }) } }) }) });
  await assert.rejects(invalid.suggest({ board: board(), sport: 'basketball', goal: 'spacing', request: '픽앤롤에서 패스와 수비 장면을 찾아 주세요.' }), /출처/);
});

test('case search requires a team description and rejects recognizable personal identifiers', async () => {
  const advisor = createLocalAdvisor({ model: 'test' });
  const input = { board: board(), sport: 'basketball', goal: 'passing' };
  assert.throws(() => advisor.prepare(input), /상황/);
  assert.throws(() => advisor.prepare({ ...input, request: '학생 연락처 010-1234-5678 상황입니다.' }), /연락처/);
  assert.throws(() => advisor.prepare({ ...input, request: '학번: 20304인 학생의 패스 상황' }), /식별번호/);
  assert.throws(() => advisor.prepare({ ...input, request: '학생 이름 a.student@example.com의 상황' }), /연락처/);
});

test('no relevant sourced cases returns an empty result instead of a generated tactic', async () => {
  const advisor = createLocalAdvisor({ model: 'test', fetcher: async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ caseMatches: [], comparisonLimit: '제공된 경기 사례와 팀 상황의 조건이 다를 수 있습니다.' }) } }) }) });
  const result = await advisor.suggest({ board: board(), sport: 'basketball', goal: 'overall', request: '비슷한 랠리 흐름을 찾고 싶어요.' });
  assert.deepEqual(result.cases, []);
  assert.match(result.summary, /찾지 못했습니다/);
});

test('team match cases are available for soccer, teeball, and dodgeball with rule context kept visible', async () => {
  const advisor = createLocalAdvisor({ model: 'test' });
  const soccer = advisor.prepare({ board: board(), sport: 'soccer', goal: 'overall', request: 'Dortmund의 3-2-2-3 후방 3인 전개로 Atlético의 5-3-2 전방 압박을 상대했던 빌드업 사례를 보고 싶어요.' });
  assert.ok(soccer.references.length > 0 && soccer.references.length <= 8);
  assert.ok(soccer.references.every(row => row.sport === 'soccer' && row.sourceUrl.startsWith('https://') && row.factStatus === 'verified' && row.candidateGrade !== 'C'));
  assert.ok(soccer.references.find(row => row.id === 'soccer_case_29').tacticTags.includes('3-2 빌드업'));
  const teeball = advisor.prepare({ board: board(), sport: 'teeball', goal: 'overall', request: '3루 주자가 뜬공 뒤 태그업을 시도했고 우익수 송구로 아웃시킨 경기 사례를 보고 싶어요.' });
  assert.ok(teeball.references.length > 0 && teeball.references.length <= 8);
  assert.ok(teeball.references.every(row => (row.sport === 'teeball' && row.factStatus === 'verified' || row.sport === 'baseball' && row.targetSport === 'teeball' && row.comparisonType === 'shared-skill' && row.factStatus === 'article-checked') && row.sourceUrl.startsWith('https://') && row.reviewStatus === 'draft'));
  assert.ok(teeball.references.some(row => /태그업/.test(row.title)));
  const dodgeball = advisor.prepare({ board: board(), sport: 'dodgeball', goal: 'overall', request: 'GVSU가 수적 열세에서 상대 팀 투구를 버티고 타임아웃 뒤 동점을 만든 경기 사례를 보고 싶어요.' });
  assert.ok(dodgeball.references.length > 0 && dodgeball.references.length <= 8);
  assert.ok(dodgeball.references.every(row => row.sport === 'dodgeball' && row.sourceUrl.startsWith('https://') && row.reviewStatus === 'draft' && ['verified', 'article-checked'].includes(row.factStatus)));
  const selected = cleanCaseMatches({ caseMatches: [{ referenceId: 'dodgeball_case_03', similarity: '수적 우위 뒤 팀 투구가 나온 점을 비교할 수 있습니다.' }], comparisonLimit: '대학 경기 규칙과 학교 수업 규칙이 다를 수 있습니다.' }, dodgeball.references);
  assert.equal(selected.cases[0].sourceTitle, require('../server/tactics-knowledge.json').find(row => row.id === 'dodgeball_case_03').sourceTitle);
  assert.match(selected.cases[0].context, /학교 피구 규칙/);
});
