'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Strict RFC-style CSV parser: reject truncated quotes and malformed row widths.
function parseCsv(input) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { if (field || closed) throw new Error('잘못된 CSV 따옴표'); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') { row.push(field); field = ''; closed = false; if (c !== ',') { if (c === '\r' && input[i + 1] === '\n') i++; rows.push(row); row = []; } }
    else { if (closed) throw new Error('잘못된 CSV 따옴표'); field += c; }
  }
  if (quoted) throw new Error('잘못된 CSV 따옴표');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length || headers.some(x => !x) || rows.some(r => r.length !== headers.length)) throw new Error('잘못된 CSV 열');
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
function loadPilot(manifestPath, existingIds = []) {
  const root = path.dirname(path.resolve(manifestPath));
  const read = name => { if (typeof name !== 'string' || path.basename(name) !== name || !name || name === '.' || name === '..') throw new Error('시범 자료 경로 오류'); const file = path.join(root, name); if (path.dirname(fs.realpathSync(file)) !== fs.realpathSync(root)) throw new Error('시범 자료 경로 오류'); return fs.readFileSync(file, 'utf8'); };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.pilotMaterialReviewStatus !== 'accepted' || manifest.approvalType !== 'user-pilot-acceptance') return [];
  if (!Array.isArray(manifest.acceptedResearchBundles)) throw new Error('시범 자료 목록 오류');
  const seen = new Set(existingIds); const output = [];
  for (const bundle of manifest.acceptedResearchBundles) {
    const cases = JSON.parse(read(bundle.caseFile)).cases, links = parseCsv(read(bundle.linkFile));
    if (!Array.isArray(cases) || !Array.isArray(bundle.caseIds) || cases.length !== bundle.caseCount || links.length !== bundle.linkCount || new Set(bundle.caseIds).size !== bundle.caseIds.length || cases.length !== bundle.caseIds.length) throw new Error('시범 자료 개수 오류');
    const ids = new Set(bundle.caseIds);
    const linkKeys = new Set();
    for (const link of links) {
      const key = `${link.research_case_id}\0${link.question_id}`; if (linkKeys.has(key)) throw new Error('시범 연결 ID 중복'); linkKeys.add(key);
      if (!ids.has(link.research_case_id) || !link.question_id || !link.supported_conditions || !link.missing_conditions || !['scene-comparison', 'evidence-boundary-reference'].includes(link.link_purpose) || !['partial', 'candidate'].includes(link.proposed_relevance) || !link.rule_scope && !link.rules_context) throw new Error('시범 연결 자료 오류');
    }
    for (const c of cases) {
      if (!ids.has(c.id) || seen.has(c.id) || !/^[A-Z0-9-]{1,60}$/.test(c.id)) throw new Error('시범 사례 ID 오류');
      seen.add(c.id);
      const own = links.filter(l => l.research_case_id === c.id);
      const isBaseball = c.sourceSport === 'baseball' && c.targetSport === 'teeball' && c.comparisonType === 'shared-skill';
      const same = ['basketball','volleyball','soccer','dodgeball'].includes(c.sourceSport) && c.sourceSport === c.targetSport && c.sport === c.sourceSport && c.comparisonType === 'same-sport-partial';
      if ((!isBaseball && !same) || c.claimCheckStatus !== 'article-checked' || !c.title || !c.sourceClaim || !c.evidenceLocator || !c.publisher || !own.length || own.some(l => l.source_sport !== c.sourceSport || l.target_sport !== c.targetSport || l.comparison_type !== c.comparisonType)) throw new Error('시범 사례 형식 오류');
      const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
      if (![c.title, c.publisher].every(v => validText(v, 200)) || !validText(c.sourceClaim, 4000) || !validText(c.evidenceLocator, 1000) || !validText(c.matchLabel, 500) || !validText(c.period, 500) || (c.aiUseBlocked !== undefined && typeof c.aiUseBlocked !== 'boolean') || [c.rulesContext, c.tballDifferences, c.limitations].some(v => v != null && (typeof v !== 'string' || v.length > 4000))) throw new Error('시범 사례 필드 오류');
      let url; try { url = new URL(c.sourceUrl); } catch { throw new Error('시범 출처 오류'); } if (url.protocol !== 'https:') throw new Error('시범 출처 오류');
      const scopes = own.map(l => ({ questionId: l.question_id, purpose: l.link_purpose, supported: l.supported_conditions, missing: l.missing_conditions, ruleScope: l.rule_scope || l.rules_context, relevance: l.proposed_relevance }));
      const sceneScopes = scopes.filter(l => l.purpose === 'scene-comparison');
      output.push({ id: c.id, sport: c.sourceSport, sourceSport: c.sourceSport, targetSport: c.targetSport, comparisonType: c.comparisonType, title: c.title, observed: c.sourceClaim, context: [c.matchLabel, c.period, c.rulesContext, c.tballDifferences, c.limitations].filter(Boolean).join(' · '), sourceTitle: c.publisher, sourceUrl: c.sourceUrl, evidenceLocator: c.evidenceLocator, claimCheckStatus: c.claimCheckStatus, factStatus: 'article-checked', candidateGrade: 'A', reviewStatus: 'draft', aiUseBlocked: c.aiUseBlocked === true, pilotMaterialReviewStatus: 'accepted', videoReviewStatus: c.videoReviewStatus, matchDateStatus: c.matchDateStatus, educatorReviewStatus: c.educatorReviewStatus, expertReviewStatus: c.expertReviewStatus, reuseStatus: c.reuseStatus, limitations: [c.limitations, c.tballDifferences].filter(Boolean), scopes, sceneScopes });
    }
  }
  return output;
}
module.exports = { loadPilot, parseCsv };
