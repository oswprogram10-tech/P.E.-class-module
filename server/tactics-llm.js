'use strict';
const fs = require('node:fs');
const path = require('node:path');
const T = require('../tactics-board');
const { loadPilot } = require('./tactics-pilot-loader');
const { classify } = require('./tactics-relevance');
const SPORTS = ['basketball', 'volleyball', 'soccer', 'teeball', 'dodgeball'];
const GOALS = ['overall', 'spacing', 'passing', 'defense'];
const MAX_REFERENCE_CANDIDATES = 8;
const MAX_CASES_PER_SOURCE = 2;
const GOAL_TERMS = Object.freeze({
  spacing: ['간격', '공간', '폭', '깊이', '침투', 'spacing', 'space'],
  passing: ['패스', '연결', '전개', '패싱', 'passing', 'pass'],
  defense: ['수비', '방어', '압박', '블록', '차단', '커버', 'defense', 'press', 'block'],
});
const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'their', 'they', 'then', 'when', 'while', 'after', 'before', 'match', 'game', 'case',
  '그리고', '하지만', '또는', '대한', '대해', '에서', '으로', '에게', '까지', '부터', '하고', '하는', '했다', '하며', '있는', '있다', '없다', '했다', '되다', '된다', '것', '수', '때', '등', '각', '통해', '같은', '이후', '당시', '실제', '경기', '사례', '팀', '찾아', '싶어요', '주세요', '보고', '위해', '이번', '상황', '원하는',
]);
const schema = {
  type: 'object', additionalProperties: false, required: ['caseMatches', 'comparisonLimit'],
  properties: {
    comparisonLimit: { type: 'string' },
    caseMatches: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['referenceId', 'similarity'], properties: { referenceId: { type: 'string' }, similarity: { type: 'string' } } } },
  },
};
const text = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('모델 응답 형식이 올바르지 않아요.'); return value.trim(); };
function searchTerms(value, weight = 1) {
  const terms = new Map();
  if (typeof value !== 'string') return terms;
  const add = (term, amount) => {
    if (!term || SEARCH_STOP_WORDS.has(term) || term.length < 2) return;
    terms.set(term, (terms.get(term) || 0) + amount);
  };
  for (const raw of value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const isHangul = /[가-힣]/u.test(raw);
    const word = isHangul ? raw : raw.normalize('NFD').replace(/\p{M}/gu, '');
    if (SEARCH_STOP_WORDS.has(word) || word.length < 2) continue;
    add(word, weight);
    if (isHangul && word.length >= 3) {
      for (let i = 0; i < word.length - 1; i++) add(`ko:${word.slice(i, i + 2)}`, weight * 0.28);
    }
  }
  return terms;
}
function indexedDocument(row) {
  const frequencies = new Map(); let length = 0;
  for (const [value, weight] of [
    [row.title, 2.4], [row.observed, 1.7], [row.sceneScopes?.map(scope => scope.supported).join(' ') || '', 1.0], [row.tacticTags?.join(' ') || '', 2.1], 
  ]) {
    for (const [term, count] of searchTerms(value, weight)) { frequencies.set(term, (frequencies.get(term) || 0) + count); length += count; }
  }
  return { row, frequencies, length };
}
function retrieveReferences(input, eligible) {
  const documents = eligible.map(indexedDocument);
  if (!documents.length) return [];
  const documentFrequency = new Map();
  for (const document of documents) for (const term of document.frequencies.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  const query = searchTerms(input.request, 1);
  for (const term of GOAL_TERMS[input.goal] || []) for (const [key, value] of searchTerms(term, 0.42)) query.set(key, (query.get(key) || 0) + value);
  for (const kind of input.board.arrows.map(row => row.kind)) {
    const term = kind === 'pass' ? '패스' : '이동';
    for (const [key, value] of searchTerms(term, 0.22)) query.set(key, (query.get(key) || 0) + value);
  }
  for (const kind of input.board.marks.map(row => row.kind)) {
    const term = kind === 'attack' ? '공격' : '수비';
    for (const [key, value] of searchTerms(term, 0.18)) query.set(key, (query.get(key) || 0) + value);
  }
  if (!query.size) return [];
  const averageLength = documents.reduce((sum, row) => sum + row.length, 0) / documents.length || 1;
  const k1 = 1.2, b = 0.75;
  const scored = documents.map(document => {
    let score = 0;
    for (const [term, queryWeight] of query) {
      const frequency = document.frequencies.get(term) || 0;
      if (!frequency) continue;
      const count = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (documents.length - count + 0.5) / (count + 0.5));
      const denominator = frequency + k1 * (1 - b + b * document.length / averageLength);
      score += queryWeight * idf * frequency * (k1 + 1) / denominator;
    }
    // A confirmed specific condition is stronger evidence than incidental word overlap.
    const specific = new Set(['full_court_press','high_press','between_lines','serve_disrupt','backcourt_dig','outfield_reposition','force_choice','recovery_return','game_start']);
    const confirmed = [...(document.row.matchedConditions || []), ...(document.row.differingConditions || [])].filter(key => specific.has(key)).length;
    score += confirmed * 5;
    return { row: document.row, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const selected = [], sourceCounts = new Map();
  for (const result of scored) {
    const source = new URL(result.row.sourceUrl);
    const sourceKey = `${source.origin}${source.pathname.replace(/\/+$/, '')}${source.search}`;
    const count = sourceCounts.get(sourceKey) || 0;
    if (count >= MAX_CASES_PER_SOURCE) continue;
    selected.push(result.row); sourceCounts.set(sourceKey, count + 1);
    if (selected.length >= MAX_REFERENCE_CANDIDATES) break;
  }
  return selected;
}
function cleanTextInput(input) {
  if (!input || !SPORTS.includes(input.sport) || !GOALS.includes(input.goal)) throw new Error('종목과 사례 탐색 기준을 선택해 주세요.');
  if (typeof input.request !== 'string' || !input.request.trim() || input.request.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.request)) throw new Error('팀이 찾고 싶은 상황을 1,000자 이내로 입력해 주세요.');
  const request = input.request.trim();
  if (/(?:\b\d{6}[- ]?[1-4]\d{6}\b|\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:학생\s*(?:번호|id)|학번)\s*[:#]?\s*[A-Z0-9-]{1,24}|\d{1,4}\s*번\s*학생)/iu.test(request)) throw new Error('학생 이름이나 연락처·식별번호를 빼고 상황만 적어 주세요.');
  return { sport: input.sport, goal: input.goal, request };
}
function cleanInput(input) {
  const clean = cleanTextInput(input);
  const board = T.anonymousLayout(input.board);
  if (!board.tokens.length) throw new Error('전술판에 익명 토큰을 먼저 배치해 주세요.');
  return { ...clean, board };
}
function cleanCaseMatches(value, references) {
  if (!value || !Array.isArray(value.caseMatches) || value.caseMatches.length > 3) throw new Error('모델이 사례 일치 결과를 확인하지 못했어요. 다시 요청해 주세요.');
  const seen = new Set();
  const cases = value.caseMatches.map(match => {
    if (!match || typeof match.referenceId !== 'string' || seen.has(match.referenceId)) throw new Error('모델이 사례 출처를 확인하지 못했어요.');
    const reference = references.find(row => row.id === match.referenceId);
    if (!reference) throw new Error('모델이 제공한 사례 출처를 확인하지 못했어요.');
    seen.add(match.referenceId);
    return { ...reference, similarity: text(match.similarity, 700) };
  });
  return { summary: cases.length ? `${cases.length}개의 비교할 경기 사례를 찾았습니다.` : '요청과 가까운 경기 사례를 참고자료에서 찾지 못했습니다.', cases, comparisonLimit: text(value.comparisonLimit, 700) };
}
function createLocalAdvisor({ url = 'http://127.0.0.1:11434', model = '', knowledgePath, pilotManifestPath, fetcher = fetch } = {}) {
  const defaultKnowledge = !knowledgePath;
  knowledgePath ||= path.join(__dirname, 'tactics-knowledge.json');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('로컬 LLM은 이 서버 컴퓨터의 localhost HTTP Ollama 주소를 사용해 주세요.');
  const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  if (!Array.isArray(knowledge) || !knowledge.length || knowledge.length > 250 || new Set(knowledge.map(row => row.id)).size !== knowledge.length || knowledge.some(row => {
    let source;
    try { source = new URL(row.sourceUrl); } catch { return true; }
    return !/^[a-z0-9_-]{1,60}$/.test(row.id) || !SPORTS.includes(row.sport) || !['draft', 'teacher-reviewed'].includes(row.reviewStatus) || !['A', 'B', 'C'].includes(row.candidateGrade) || !['verified', 'partial', 'pending', 'conflicted', 'rejected'].includes(row.factStatus) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 160 || typeof row.observed !== 'string' || !row.observed.trim() || row.observed.length > 4000 || typeof row.context !== 'string' || !row.context.trim() || row.context.length > 4000 || typeof row.sourceTitle !== 'string' || !row.sourceTitle.trim() || row.sourceTitle.length > 200 || (row.aiUseBlocked !== undefined && typeof row.aiUseBlocked !== 'boolean') || (row.tacticTags !== undefined && (!Array.isArray(row.tacticTags) || row.tacticTags.length > 8 || row.tacticTags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 60))) || source.protocol !== 'https:';
  })) throw new Error('실제 경기 사례 참고자료와 HTTPS 출처 형식을 확인해 주세요.');
  if (defaultKnowledge || pilotManifestPath) knowledge.push(...loadPilot(pilotManifestPath || path.join(__dirname, '../docs/tactics-pilot-status.json'), knowledge.map(row => row.id)));
  function prepareInput(input) {
    const eligible = knowledge.filter(row => row.aiUseBlocked !== true && row.candidateGrade !== 'C' && ((row.factStatus === 'verified' && row.sport === input.sport) || (row.factStatus === 'article-checked' && row.pilotMaterialReviewStatus === 'accepted' && row.targetSport === input.sport && row.sceneScopes.length > 0 && ((row.comparisonType === 'same-sport-partial' && row.sourceSport === input.sport) || (input.sport === 'teeball' && row.sourceSport === 'baseball' && row.comparisonType === 'shared-skill')))));
    const scoped = eligible.map(row => { const assessment = classify(input.request, row); return assessment ? { ...row, ...assessment } : null; }).filter(Boolean);
    const references = retrieveReferences(input, scoped);
    const messages = [
      { role: 'system', content: '당신은 전술을 정답으로 판정하거나 팀에 실행을 지시하는 코치가 아니다. 한국어로 팀이 request.request에 직접 설명한 상황을 주된 검색 질문으로 삼고, request.goal은 선택한 보조 비교 관점으로만 반영하는 사례 비교 도구다. references는 전체 카탈로그가 아니라 서버에서 오프라인 검색한 후보이며, 그 안에서 실제 경기 사례를 최대 3개 고른다. 서버의 relevance, scopes, ruleStatus를 지키며 부분 관련도 한계를 명시해 비교할 수 있다. unmatchedConditions는 요청에서 확인되지 않은 조건이고 differingConditions는 성공·실패 등 요청과 사례의 다른 조건이다. 이들을 공통 사실로 서술하지 말고 차이와 미확인 상태를 명시한다. 비교 가능한 후보가 없으면 caseMatches를 빈 배열로 반환한다. 제공된 references의 경기 기록만 사용하고 referenceId를 정확히 골라 새 출처나 경기 사실을 만들지 않는다. 시범 자료는 기사에 적힌 주장만 대조했으며 경기 전체나 영상 검증이 아니다. pilotMaterialReviewStatus는 사용자 시범 수용이며 교사·전문가 검토가 아니다. scopes의 supported와 missing은 연결별 범위이지 모든 조건이 요청과 일치한다는 뜻이 아니다. evidence-boundary-reference는 관찰 한계로만 사용하고 장면 근거로 사용하지 않는다. 야구 원본은 티볼과 공통 기술만 부분 비교하며 규칙을 전용하지 않는다. candidateGrade A는 특정 장면 후보, B는 경기 흐름 요약이며 B 자료를 단일 랠리·포제션처럼 묘사하지 않는다. factStatus verified는 카드의 적힌 범위에서 출처 대조가 끝났다는 뜻이다. 둘 다 교사 승인이나 이용 허가를 뜻하지 않는다. reference의 tacticTags는 검색용 분류어일 뿐 경기 기록에서 확인되지 않은 전술을 사례에 덧씌우는 근거가 아니다. 이미지 속 용어는 성격이 서로 다르므로 빌드업 구조·수비 국면·역사적 팀 모델·속어를 동의어처럼 취급하지 않는다. 티볼 사례는 팀·대회별 규칙과 연령이 다를 수 있고, 피구 사례도 WDBF·대학·클럽 대회 형식이 서로 다를 수 있다. 기록에 없는 규칙·선수 행동·점수·시각을 추측하지 말고 학교 규칙으로 바로 옮길 수 있다고 말하지 않는다. 규칙·훈련·전술 프레임워크만을 실제 경기 사례로 바꿔 말하지 않는다. similarity에는 팀 요청과 사례가 닮은 조건과 다른 조건만 설명한다. 전술을 추천·처방하거나 학생·팀이 그대로 실행하라고 말하지 않는다. 토큰 좌표만으로 공 소유권, 경기 시각·점수, 선수 능력, 수비 약속을 추측하지 않는다. comparisonLimit에는 입력과 실제 경기 사이의 맥락 차이 및 자료 한계를 적는다. 승리·성공 사례도 보편적 정답이나 인과적 효과로 표현하지 않는다. JSON schema를 정확히 따른다.' },
      { role: 'user', content: JSON.stringify({ request: input, references: references.map(({ scopes, ...row }) => ({ ...row, scopes: scopes?.filter(scope => scope.purpose === 'scene-comparison') })) }) },
    ];
    return { input, references, messages };
  }
  const prepare = raw => prepareInput(cleanInput(raw));
  const prepareText = raw => prepareInput({ ...cleanTextInput(raw), board: { tokens: [], arrows: [], marks: [] } });
  return {
    available: Boolean(model), model, prepare, prepareText,
    async suggest(raw, signal) {
      if (!model) { const error = new Error('로컬 LLM 모델이 설정되지 않았어요. 운영자가 Ollama 모델을 설치하고 PE_TACTICS_LLM_MODEL을 설정해 주세요.'); error.status = 503; throw error; }
      const prepared = prepare(raw);
      if (!prepared.references.length) return { summary: '요청과 가까운 출처 대조 완료 경기 사례를 찾지 못했습니다.', cases: [], comparisonLimit: '검증된 사례 후보가 없어 모델을 호출하지 않았습니다. 팀이 설명한 경기 국면·행동·막힌 지점을 더 구체적으로 적어 주세요.', model, modelUsed: false, generatedAt: Date.now() };
      let response;
      try { response = await fetcher(endpoint.origin + '/api/chat', { method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(55000), ...(signal ? [signal] : [])]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, think: false, format: schema, messages: prepared.messages, options: { temperature: 0.2, num_predict: 900 } }) }); }
      catch { const error = new Error('로컬 LLM에 연결하지 못했거나 응답 시간이 초과됐어요. Ollama 실행과 모델을 확인해 주세요.'); error.status = 503; throw error; }
      if (!response.ok) { const error = new Error('로컬 LLM이 요청을 처리하지 못했어요. 모델 설치와 메모리를 확인해 주세요.'); error.status = 503; throw error; }
      const data = await response.json();
      if (data.message?.content?.length > 12000) throw new Error('모델 응답이 너무 길어요.');
      const result = cleanCaseMatches(JSON.parse(data.message.content), prepared.references);
      return { ...result, model, modelUsed: true, generatedAt: Date.now() };
    },
    trainingExample(raw) {
      if (raw?.reviewed !== true) throw new Error('교사가 사례 출처·사실·관련성·비교 한계를 검토한 예제만 저장할 수 있어요.');
      const prepared = prepare(raw);
      const submitted = raw.advice && { ...raw.advice, caseMatches: Array.isArray(raw.advice.cases) ? raw.advice.cases.map(row => ({ referenceId: row.id, similarity: row.similarity })) : raw.advice.caseMatches };
      const result = cleanCaseMatches(submitted, prepared.references);
      if (!result.cases.length) throw new Error('출처가 확인된 경기 사례가 있는 결과만 비교 예제로 저장할 수 있어요.');
      return { messages: [...prepared.messages, { role: 'assistant', content: JSON.stringify({ summary: result.summary, cases: result.cases.map(row => ({ ...row })), comparisonLimit: result.comparisonLimit }) }] };
    },
  };
}
module.exports = { createLocalAdvisor, cleanInput, cleanTextInput, cleanCaseMatches, retrieveReferences, SPORTS, GOALS };
