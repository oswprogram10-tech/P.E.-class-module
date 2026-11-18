(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticsLocalPrompt = factory();
})(globalThis, function () {
  'use strict';
  function unique(values) { return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]; }
  function compactReference(row) {
    const scopes = [];
    const includesConditions = (whole, part) => {
      if (typeof whole !== 'string' || typeof part !== 'string') return false;
      const items = new Set(whole.split(';').map(value => value.trim()));
      return part.split(';').every(value => items.has(value.trim()));
    };
    for (const scope of row.scopes || []) {
      const entry = { supported: scope.supported, missing: scope.missing, ruleScope: scope.ruleScope };
      const same = other => other.supported === entry.supported && other.ruleScope === entry.ruleScope;
      if (scopes.some(other => same(other) && includesConditions(other.missing, entry.missing))) continue;
      for (let i = scopes.length - 1; i >= 0; i--) if (same(scopes[i]) && includesConditions(entry.missing, scopes[i].missing)) scopes.splice(i, 1);
      scopes.push(entry);
    }
    const limitations = unique(row.limitations || []);
    // Context is made of exact fields joined by this delimiter; remove only exact duplicates that remain in other fields.
    const duplicated = new Set([...limitations, ...scopes.map(scope => scope.ruleScope)].filter(Boolean));
    const context = typeof row.context === 'string' ? row.context.split(' · ').filter(part => !duplicated.has(part.trim())).join(' · ') : row.context;
    return {
      id: row.id, sourceSport: row.sourceSport || row.sport, targetSport: row.targetSport || row.sport,
      observed: row.observed, context, candidateGrade: row.candidateGrade,
      factStatus: row.factStatus, pilotMaterialReviewStatus: row.pilotMaterialReviewStatus,
      claimCheckStatus: row.claimCheckStatus, videoReviewStatus: row.videoReviewStatus,
      relevance: row.relevance, unmatchedConditions: row.unmatchedConditions,
      differingConditions: row.differingConditions, ruleExplanation: row.ruleExplanation,
      limitations, scopes,
    };
  }
  function compactReferences(rows, max = 3) { return rows.slice(0, max).map(compactReference); }
  function selectionReferences(rows, max = 2) {
    return rows.slice(0, max).map(row => ({ id: row.id, sourceSport: row.sourceSport || row.sport, targetSport: row.targetSport || row.sport, observed: row.observed, relevance: row.relevance, unmatchedConditions: row.unmatchedConditions, differingConditions: row.differingConditions }));
  }
  function candidateProfiles(rows, max = 8) {
    return rows.slice(0, max).map(row => {
      const matched = new Set(row.matchedConditions || []);
      const scopes = row.scopes || [];
      let best = null, score = -1;
      for (const scope of scopes) {
        const overlap = (scope.matchedConditions || []).filter(condition => matched.has(condition)).length;
        if (overlap > score) { best = scope; score = overlap; }
      }
      // Scope fields and observed text remain exact; this is a limited evidence profile, not a summary.
      const evidence = best && score > 0 ? [best.supported || '', best.missing || '', best.ruleScope || ''] : row.observed;
      return [row.id, row.sourceSport || row.sport || '', row.targetSport || row.sport || '', row.relevance || '', row.unmatchedConditions || [], row.differingConditions || [], row.ruleStatus || 'unconfirmed', row.candidateGrade || '', evidence];
    });
  }
  function planCandidates({ request, sport, references, tokenCount, budget = 512 }) {
    const profiles = candidateProfiles(references, 8);
    const ids = references.map(row => row.id);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id))) throw new Error('후보 ID 형식이 올바르지 않습니다.');
    const instruction = 'Select up to two relevant IDs. Return only JSON referenceIds. Profiles are limited evidence, not full cases; partial and unconfirmed do not mean exact matches. B is material-level evidence. Fields: id, source sport, target sport, relevance, unmatched, differing, rule status, grade, evidence. Evidence is complete observed text or one [supported, missing, rule scope]. Other source context, scopes and limits are omitted; do not infer their absence.';
    const makePrompt = rows => `<|im_start|>system\n${instruction}<|im_end|>\n<|im_start|>user\n${JSON.stringify({ request, sport, totalCandidates: references.length, shownCandidates: rows.length, references: rows })}<|im_end|>\n<|im_start|>assistant\n`;
    let included = [], prompt = makePrompt(included), tokens = tokenCount(prompt);
    for (const profile of profiles) {
      const next = [...included, profile], candidate = makePrompt(next), count = tokenCount(candidate);
      if (count <= budget) { included = next; prompt = candidate; tokens = count; }
    }
    if (!included.length || tokens > budget) throw new Error('사례와 요청이 모델 입력 한도를 넘습니다. 검색된 자료를 직접 확인해 주세요.');
    const includedIds = new Set(included.map(row => row[0]));
    const omittedIds = references.filter(row => !includedIds.has(row.id)).map(row => row.id);
    return { prompt, tokens, references: included, totalCount: references.length, omittedCount: omittedIds.length, omittedIds };
  }
  function validateSelection(value, references) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.referenceIds) || value.referenceIds.length > 2) throw new Error('모델의 사례 선택 형식을 확인하지 못했습니다.');
    const seen = new Set(); return value.referenceIds.map(id => {
      if (typeof id !== 'string' || seen.has(id)) throw new Error('모델의 사례 선택 ID를 확인하지 못했습니다.');
      const row = references.find(reference => reference.id === id); if (!row) throw new Error('모델이 제공되지 않은 사례 ID를 선택했습니다.');
      seen.add(id); return row;
    });
  }
  function responseGrammar(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id))) throw new Error('후보 ID 형식이 올바르지 않습니다.');
    const alternatives = [[], ...ids.map(id => [id])];
    for (const first of ids) for (const second of ids) if (first !== second) alternatives.push([first, second]);
    return `root ::= "{\\\"referenceIds\\\":" selection "}"\nselection ::= ${alternatives.map(ids => JSON.stringify(JSON.stringify(ids))).join(' | ')}`;
  }
  return { compactReference, compactReferences, selectionReferences, candidateProfiles, planCandidates, validateSelection, responseGrammar };
});
