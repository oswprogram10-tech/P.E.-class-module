'use strict';
// Structural evaluation only; does not run or score a model.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseCsv } = require('../server/tactics-pilot-loader');
const prompt = require('../tactics-local-prompt');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-prefix' || !args[1])) throw new Error('사용법: node scripts/evaluate-tactics-answer-contract.cjs [--output-prefix 경로]');
const outputPrefix = args[1] || 'docs/tactics-stage5-evidence-contract';
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const questions = parseCsv(read('docs/tactics-query-evaluation.csv'));
const context = { TacticsBoard: require('../tactics-board'), TacticsLocalPrompt: prompt, URL, fetch: async () => { throw Error('unexpected network'); }, document: { currentScript: { src: 'https://example.invalid/tactics-local-advisor.js' } } };
vm.createContext(context);
vm.runInContext(read('tactics-search-local.js'), context);
vm.runInContext(read('tactics-local-advisor.js'), context);
const advisor = context.TacticsLocalSearch.createLocalAdvisor();
const fields = ['observed','context','sourceSport','targetSport','relevance','scopes','sceneScopes','unmatchedConditions','differingConditions','ruleExplanation','ruleStatus','limitations','sourceTitle','sourceUrl','reviewStatus','factStatus','pilotMaterialReviewStatus','claimCheckStatus','videoReviewStatus','evidenceLocator','educatorReviewStatus','expertReviewStatus','reuseStatus'];
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
 const rows = [];
 for (const q of questions) {
  const input = { sport: q.sport, goal: 'overall', request: q.question };
  const refs = advisor.prepareText(input).references;
  const output = await context.TacticsLocalAdvisor.search(input);
  assert.equal(output.cases.length, refs.length);
  const offered = prompt.selectionReferences(refs, 2);
  const selected = prompt.validateSelection({referenceIds: offered.map(r => r.id)}, refs.filter(r => offered.some(x => x.id === r.id)));
  assert.deepEqual(Array.from(selected, x => x.id), Array.from(offered, x => x.id));
  const projectionErrors = [];
  output.cases.forEach((card,i) => fields.forEach(field => { if (!equal(card[field], refs[i][field])) projectionErrors.push(`${card.id}:${field}`); }));
  rows.push({questionId:q.question_id,sport:q.sport,family:q.scenario_family,foundIds:Array.from(refs,r=>r.id),preBudgetOfferedIds:Array.from(offered,r=>r.id),projectionErrors});
 }
 assert.equal(rows.length,450);
 const sample=[{id:'A'}, {id:'B'}];
 for (const value of [{referenceIds:['A','A']},{referenceIds:['unknown']},{referenceIds:['A'],extra:true},{referenceIds:['A','B','A']},{referenceIds:[1]},[],null]) assert.throws(() => prompt.validateSelection(value,sample));
 assert.deepEqual(prompt.validateSelection({referenceIds:[]},sample),[]);
 assert.deepEqual(prompt.validateSelection({referenceIds:['B','A']},sample),[sample[1],sample[0]]);
 const links = ['docs/tactics-teeball-baseball-links.csv','docs/tactics-four-sport-gapfill-links.csv'].flatMap(file => parseCsv(read(file))).filter(link => link.link_purpose === 'scene-comparison');
 const referenceListComparison = {};
 for (const q of questions) {
  const row = rows.find(r => r.questionId === q.question_id);
  const ids = new Set([...(q.candidate_case_ids || '').split('|'), ...links.filter(link => link.question_id === q.question_id).map(link => link.research_case_id)].filter(Boolean));
  const any = row.foundIds.some(id => ids.has(id));
  const top = row.preBudgetOfferedIds.some(id => ids.has(id));
  const total = referenceListComparison[q.sport] ||= {any:0, preBudgetTop2:0, belowTop2Only:0};
  total.any += Number(any); total.preBudgetTop2 += Number(top); total.belowTop2Only += Number(any && !top);
 }
 const files = ['docs/tactics-query-evaluation.csv','docs/tactics-pilot-status.json','docs/tactics-teeball-baseball-candidates.json','docs/tactics-teeball-baseball-links.csv','docs/tactics-four-sport-gapfill-candidates.json','docs/tactics-four-sport-gapfill-links.csv','server/tactics-knowledge.json','tactics-search-local.js','tactics-local-advisor.js','tactics-local-prompt.js','tactics-board.js','scripts/evaluate-tactics-answer-contract.cjs'];
 const sourceHashesSha256 = Object.fromEntries(files.map(p => [p, crypto.createHash('sha256').update(read(p)).digest('hex')]));
 const report = {date:new Date().toISOString().slice(0,10), command:['node','scripts/evaluate-tactics-answer-contract.cjs',...process.argv.slice(2)].join(' '), sourceHashesSha256, referenceListComparison, method:'Actual shared browser search, selection validation, and local source projection. Synthetic selections; no model inference.', questions:rows.length, candidates:rows.reduce((n,r)=>n+r.foundIds.length,0), totalReturns:rows.reduce((n,r)=>n+r.foundIds.length,0), uniqueReturnedCaseIdsCount:new Set(rows.flatMap(r=>r.foundIds)).size, empty:rows.filter(r=>!r.foundIds.length).length, projectionErrors:rows.flatMap(r=>r.projectionErrors.map(e=>`${r.questionId}:${e}`)), invalidSelectionCases:7, results:rows};
 fs.mkdirSync(path.dirname(path.resolve(root, outputPrefix)), { recursive: true });
 fs.writeFileSync(path.resolve(root, outputPrefix + '.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({questions:report.questions,candidates:report.candidates,empty:report.empty,projectionErrors:report.projectionErrors.length,invalidSelectionCases:report.invalidSelectionCases}));
})().catch(e => { console.error(e); process.exitCode=1; });
