'use strict';
// Evaluation-only: question IDs and proposed case links never enter the runtime search.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { parseCsv, loadPilot } = require('../server/tactics-pilot-loader');
const { createLocalAdvisor } = require('../server/tactics-llm');
const root = path.resolve(__dirname, '..');
const rel = p => path.join(root, p);
const inputs = ['docs/tactics-query-evaluation.csv', 'docs/tactics-teeball-baseball-links.csv', 'docs/tactics-four-sport-gapfill-links.csv', 'docs/tactics-pilot-status.json', 'docs/tactics-teeball-baseball-candidates.json', 'docs/tactics-four-sport-gapfill-candidates.json', 'server/tactics-knowledge.json', 'server/tactics-llm.js', 'server/tactics-relevance.js', 'server/tactics-pilot-loader.js', 'tactics-board.js', 'tactics-search-local.js', 'scripts/build-tactics-local.cjs', 'scripts/evaluate-tactics-retrieval.cjs'];
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(rel(file))).digest('hex');
const hashes = Object.fromEntries(inputs.map(file => [file, sha256(file)]));
const csv = file => parseCsv(fs.readFileSync(rel(file), 'utf8'));
const questions = csv(inputs[0]), links = [...csv(inputs[1]), ...csv(inputs[2])];
if (questions.length !== 450 || new Set(questions.map(q => q.question_id)).size !== 450 || questions.some(q => !q.question_id || !q.sport || !q.scenario_family || !q.question)) throw new Error('평가 질문 형식 또는 개수 오류');
const linkMap = new Map();
for (const link of links.filter(link => link.link_purpose === 'scene-comparison')) {
  const list = linkMap.get(link.question_id) || []; list.push(link.research_case_id); linkMap.set(link.question_id, list);
}
const original = [...JSON.parse(fs.readFileSync(rel('server/tactics-knowledge.json'), 'utf8')), ...loadPilot(rel('docs/tactics-pilot-status.json'))];
const catalog = new Map(original.map(row => [row.id, row]));
const advisor = createLocalAdvisor();
const browserContext = { TacticsBoard: require('../tactics-board'), URL, fetch: async () => { throw new Error('unexpected network'); } };
vm.createContext(browserContext); vm.runInContext(fs.readFileSync(rel('tactics-search-local.js'), 'utf8'), browserContext);
const browserAdvisor = browserContext.TacticsLocalSearch.createLocalAdvisor();
const scopeKey = s => JSON.stringify([s.purpose, s.supported, s.missing, s.ruleScope]);
function diagnostics(row, sport) {
  const origin = catalog.get(row.id);
  const wrongSport = !(row.sport === sport || sport === 'teeball' && row.sourceSport === 'baseball' && row.targetSport === 'teeball' && row.comparisonType === 'shared-skill');
  const blocked = !origin || origin.aiUseBlocked === true || origin.candidateGrade === 'C' || !['verified', 'article-checked'].includes(origin.factStatus);
  const allowed = new Set((origin?.sceneScopes || []).map(scopeKey));
  const badScope = row.pilotMaterialReviewStatus === 'accepted' && (row.relevance !== 'partial' || [row.scopes, row.sceneScopes].some(scopes => !Array.isArray(scopes) || !scopes.length || scopes.some(scope => scope.purpose !== 'scene-comparison' || !scope.supported || !scope.missing || !scope.ruleScope || !allowed.has(scopeKey(scope)))));
  return { wrongSport, blocked, badScope };
}
const results = questions.map(q => {
  // This call contains only the natural-language request and chosen sport/goal: no question ID or evaluation mapping.
  const input = { sport: q.sport, goal: 'overall', request: q.question };
  const refs = advisor.prepareText(input).references;
  const browserRefs = browserAdvisor.prepareText(input).references;
  const browserMismatch = JSON.stringify(refs) !== JSON.stringify(browserRefs);
  const proposed = [...new Set([...(q.candidate_case_ids ? q.candidate_case_ids.split('|').filter(Boolean) : []), ...(linkMap.get(q.question_id) || [])])];
  const found = refs.map(row => row.id), hits = found.filter(id => proposed.includes(id));
  const checks = refs.map(row => diagnostics(row, q.sport));
  return { browserMismatch, questionId: q.question_id, sport: q.sport, scenarioFamily: q.scenario_family, candidateCount: refs.length, foundIds: found, referenceIds: proposed, hitIds: hits, noReferenceList: proposed.length === 0, noCandidates: refs.length === 0, schoolRulesNotVerified: refs.some(row => row.ruleStatus === 'unconfirmed' || row.ruleStatus === 'not-compared'), wrongSportIds: refs.filter((_, i) => checks[i].wrongSport).map(row => row.id), blockedIds: refs.filter((_, i) => checks[i].blocked).map(row => row.id), scopeViolationIds: refs.filter((_, i) => checks[i].badScope).map(row => row.id) };
});
const groups = ['basketball','volleyball','soccer','teeball','dodgeball'];
function summarize(rows) { return { questions: rows.length, noCandidates: rows.filter(r => r.noCandidates).length, totalCandidates: rows.reduce((n, r) => n + r.candidateCount, 0), referenceHitQuestions: rows.filter(r => r.hitIds.length).length, referenceListMissing: rows.filter(r => r.noReferenceList).length, schoolRulesNotVerified: rows.filter(r => r.schoolRulesNotVerified).length, wrongSportCards: rows.reduce((n, r) => n + r.wrongSportIds.length, 0), blockedCards: rows.reduce((n, r) => n + r.blockedIds.length, 0), scopeViolationCards: rows.reduce((n, r) => n + r.scopeViolationIds.length, 0), browserMismatchQuestions: rows.filter(r => r.browserMismatch).length };  }
const bySport = Object.fromEntries(groups.map(sport => [sport, summarize(results.filter(row => row.sport === sport))]));
const families = [...new Set(results.map(row => `${row.sport}\0${row.scenarioFamily}`))].map(key => { const [sport, scenarioFamily] = key.split('\0'); const rows = results.filter(row => row.sport === sport && row.scenarioFamily === scenarioFamily); return { sport, scenarioFamily, variants: rows.length, noCandidates: rows.filter(row => row.noCandidates).length, referenceHits: rows.filter(row => row.hitIds.length).length, referenceListMissing: rows.filter(row => row.noReferenceList).length, referenceListsIdentical: new Set(rows.map(row => JSON.stringify([...row.referenceIds].sort()))).size === 1 }; });
if (families.some(family => family.variants !== 6)) throw new Error('상황군 변형 개수 오류');
const report = { families, evaluationDate: new Date().toISOString().slice(0, 10), sourceDatasetDate: '2026-11-15', command: ['node', 'scripts/evaluate-tactics-retrieval.cjs', ...process.argv.slice(2)].join(' '), purpose: '기존 연결 참고목록과의 검색 대조; 전문가 검증 정답 또는 정확도가 아님', questions: 450, scenarioFamilies: new Set(questions.map(q => `${q.sport}\0${q.scenario_family}`)).size, sourceHashesSha256: hashes, totals: summarize(results), bySport, results };
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-prefix' || !args[1])) throw new Error('사용법: node scripts/evaluate-tactics-retrieval.cjs [--output-prefix 경로]');
const prefix = args[1] || 'docs/tactics-retrieval-evaluation-2026-11-15';
fs.mkdirSync(path.dirname(path.resolve(root, prefix)), { recursive: true });
fs.writeFileSync(path.resolve(root, prefix + '.json'), JSON.stringify(report, null, 2) + '\n');
const headers = ['questionId','sport','scenarioFamily','candidateCount','foundIds','referenceIds','hitIds','noReferenceList','noCandidates','schoolRulesNotVerified','wrongSportIds','blockedIds','scopeViolationIds','browserMismatch'];
const escape = v => { const x = Array.isArray(v) ? v.join('|') : String(v); return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
fs.writeFileSync(path.resolve(root, prefix + '.csv'), '\uFEFF' + [headers.join(','), ...results.map(row => headers.map(key => escape(row[key])).join(','))].join('\n') + '\n');
const lines = ['# 경기 사례 검색 대조 실행 기록', '', `실행일(UTC): ${report.evaluationDate}. 평가 자료 기록일: ${report.sourceDatasetDate}.`, '', `명령: \`${report.command}\` (기기 모델 호출 없음). 450문항은 75개 상황군에 표현 6개씩이므로 서로 독립된 450개 상황이 아니다.`, '', '기존 카드 candidate_case_ids와 시범 연결 CSV의 scene-comparison만 합친 **기존 연결 참고목록**과 대조했다. 사람 검증 정답이나 검색 정확도가 아니다. 관찰 범위 전용 연결은 제외한다. 검색에는 질문 문장·종목·overall만 전달하며 질문 ID·연결 목록은 검색 후 평가에만 사용한다.', '', '| 종목 | 문항 | 후보 없음 | 후보 총수 | 참고 연결 1개 이상 발견 | 참고 목록 없음 | 학교 규칙 미확인 후보가 있는 질문 | 종목 혼합 카드 | 차단 자료 카드 | 구조상 근거 범위 위반 카드 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for (const sport of groups) { const r = bySport[sport]; lines.push(`| ${sport} | ${r.questions} | ${r.noCandidates} | ${r.totalCandidates} | ${r.referenceHitQuestions} | ${r.referenceListMissing} | ${r.schoolRulesNotVerified} | ${r.wrongSportCards} | ${r.blockedCards} | ${r.scopeViolationCards} |`); }
const t = report.totals; const mixedEmpty = families.filter(f => f.noCandidates > 0 && f.noCandidates < f.variants).length; const mixedHit = families.filter(f => f.referenceHits > 0 && f.referenceHits < f.variants).length; const sameListMixedHit = families.filter(f => f.referenceListsIdentical && f.referenceHits > 0 && f.referenceHits < f.variants).length; lines.push(`| 합계 | ${t.questions} | ${t.noCandidates} | ${t.totalCandidates} | ${t.referenceHitQuestions} | ${t.referenceListMissing} | ${t.schoolRulesNotVerified} | ${t.wrongSportCards} | ${t.blockedCards} | ${t.scopeViolationCards} |`, '', `75개 상황군 중 ${mixedEmpty}개는 6개 표현 사이에 후보 없음 여부가 달랐고, ${mixedHit}개는 기존 연결 참고목록 적중 여부가 달랐다. 참고 적중 여부가 다른 가족 중 ${sameListMixedHit}개는 여섯 표현의 참고목록이 같고, 나머지는 표현별 참고목록도 다르다. 따라서 ${mixedHit}개 전체를 순수한 표현 차이의 효과로 해석할 수 없다. 상황군별 0~6개 집계와 목록 동일 여부는 JSON의 families에 있다. 이는 탐색적 대조이며 관련성 정답 검증이 아니다.`, '', `동일 입력 450개를 서버 검색과 생성된 브라우저 검색 번들 양쪽에 전달해 결과 전체를 비교했다. 서로 다른 결과는 ${t.browserMismatchQuestions}문항이다.`, '', '학교 규칙 미확인은 해당 질문의 결과 중 규칙 대조를 하지 않았거나 확인되지 않은 카드가 하나 이상 있다는 뜻이며 오류로 집계하지 않는다. 종목·차단·범위 위반은 반환 카드의 종목과 원본 차단 상태, 시범 연결의 부분 관련과 scopes·sceneScopes 양쪽의 scene-comparison·지원/누락/규칙 필드 보존을 확인한 구조 검사다. 문장 의미의 실제 관련성이나 빠진 규칙을 올바르게 이해했는지는 사람이 검토해야 한다. 같은 질문에서 여러 위반 카드가 있으면 각각 센다.', '', '기존 연결이 없거나 적중하지 않은 질문도 무조건 실패가 아니다. 모델 응답, 450회 모델 생성, 자료 이용 권리, 전문가 검토, Android·학교 환경 및 답변 품질은 이 실행으로 검증하지 않았다. 질문별 ID·후보·연결·경계 점검과 입력별 SHA-256은 [JSON](${path.basename(prefix)}.json) 및 [CSV](${path.basename(prefix)}.csv)에 기록했다.');
fs.writeFileSync(path.resolve(root, prefix + '.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ totals: report.totals, bySport, scenarioFamilies: report.scenarioFamilies }, null, 2));
