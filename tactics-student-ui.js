(function (root) {
  'use strict';
  const host = document.getElementById('studentTacticsRoot'), panel = document.getElementById('studentTacticsPanel');
  if (!host || !panel) return;
  const el = (tag, text = '', props = {}) => { const node = document.createElement(tag); node.textContent = text; Object.assign(node, props); return node; };
  const paragraph = text => host.append(el('p', text));
  const field = (title, id, placeholder) => { const label = el('label', title), input = el('textarea', '', { id, rows: 2, maxLength: 300, placeholder }); label.append(input); host.append(label); return input; };
  paragraph('모둠의 경기 상황을 적고 실제 경기 자료를 비교해 보세요. 이름·학번·학교명·연락처는 적지 마세요. 입력과 결과는 이 화면에만 표시하고 저장하거나 외부로 보내지 않습니다.');
  paragraph('검색은 모델 설치 없이 사용할 수 있어요. AI 선택에는 교사가 설정에서 설치한 모델이 필요하며, 시간이 오래 걸릴 수 있어요. 자료는 교사·코치 검토 전 초안이며 정답이나 실행 지시가 아닙니다.');
  const sportLabel = el('label', '종목'), sport = el('select', '', { id: 'studentTacticsSport' });
  for (const [value, title] of [['basketball', '농구'], ['volleyball', '배구'], ['soccer', '축구'], ['teeball', '티볼'], ['dodgeball', '피구']]) sport.append(el('option', title, { value })); sportLabel.append(sport); host.append(sportLabel);
  const situation = field('현재 어떤 상황인가요?', 'studentTacticsSituation', '예: 상대가 우리 팀을 압박해요.');
  const difficulty = field('어떤 점이 막히나요?', 'studentTacticsDifficulty', '예: 패스할 공간을 찾기 어려워요.');
  const comparison = field('어떤 점을 비교하고 싶나요?', 'studentTacticsComparison', '예: 다른 팀은 어떤 간격으로 움직였나요?');
  const status = el('p', '', { id: 'studentTacticsStatus', role: 'status' }); host.append(status);
  const searchButton = el('button', '자료에서 사례 찾기', { type: 'button', id: 'studentTacticsSearch' });
  const selectButton = el('button', 'AI로 비교 사례 고르기', { type: 'button', id: 'studentTacticsSelect' });
  const cancelButton = el('button', 'AI 선택 취소', { type: 'button', id: 'studentTacticsCancel' }); host.append(searchButton, selectButton, cancelButton);
  const handoffButton = el('button', '교사와 전술판에서 검토', { type: 'button', id: 'studentTacticsHandoff' });
  const resetButton = el('button', '모둠 초기화', { type: 'button', id: 'studentTacticsReset' }); host.append(handoffButton, resetButton);
  const releaseButton = el('button', 'AI 메모리 비우기', { type: 'button', id: 'studentTacticsRelease' }); host.append(releaseButton);
  paragraph('AI 메모리를 비워도 설치한 모델 파일은 삭제되지 않아요. 다시 사용할 때 준비 시간이 필요할 수 있어요.');
  const output = el('div', '', { id: 'studentTacticsOutput' }); host.append(output);
  const compare = el('section', '', { id: 'studentTacticsCompare' }); compare.setAttribute('aria-live', 'polite'); host.append(compare);
  let controller = null, revision = 0, currentCases = [], selected = new Set(), searchCompleted = false;
  function clearResults() { searchCompleted = false; currentCases = []; selected.clear(); output.replaceChildren(); compare.replaceChildren(); root.TacticsTeamRequest?.clear(); }

  const labels = { relay:'중계', throw:'송구·투구', pass:'패스', receive:'받기', backup:'백업', movement:'이동', position:'위치', spacing:'간격', direction:'방향', communication:'의사소통', defense:'수비', attack:'공격', rebound:'리바운드', transition:'전환', shot:'슛', screen:'스크린', buildup:'빌드업', evade:'회피', catch:'캐치', regroup:'재정비', collision:'충돌', save:'공 살리기', corner:'코너킥', freekick:'프리킥', header:'헤더', advantage:'점수 동점·역전', set:'세트', serve:'서브', hit:'타격', running:'주루', possession:'점유', player_advantage:'수적 우위', player_disadvantage:'수적 열세', timeout:'타임아웃', overtime:'연장전', late_stage:'종료 직전', role_assignment:'역할 조정', lineup_selection:'선수 구성·기용', ball_loss:'공 소유 상실', uncertainty:'혼선', ball_recovery:'공 되찾기', third_man:'제3자 연결', run_into_space:'공간 침투', drop_back:'내려오기', corner_area:'코트 가장자리', position_hold:'위치 유지', full_court_press:'전면·풀코트 압박', high_press:'전방 압박', between_lines:'라인 사이', serve_disrupt:'서브에 의한 리시브 흔들림', backcourt_dig:'후위 수비 받기', outfield_reposition:'외야 위치 변경', force_choice:'포스아웃 선택', base_choice:'송구할 베이스 선택', recovery_return:'회수 후 복귀', game_start:'경기 시작', prior_hitter_adjustment:'앞선 타구에 따른 다음 타석 조정' };
  const show = values => values.map(value => labels[value] || value).join(' · ');
  function input() {
    const parts = [situation.value.trim(), difficulty.value.trim(), comparison.value.trim()];
    if (!parts.some(Boolean)) throw new Error('경기 상황이나 막힌 점을 적어 주세요.');
    return { sport: sport.value, goal: 'overall', request: parts.filter(Boolean).join(' ') };
  }
  function modelNotice(result) {
    const coverage = result.modelCoverage;
    const lines = [result.cases.length ? '기기 AI가 실행되어 비교할 사례를 선택했어요.' : '기기 AI가 실행되었지만 사례를 선택하지 않았어요. 검색 결과는 그대로 남아 있어요.'];
    if (coverage) lines.push(`AI 검토 범위: 검색된 ${coverage.retrieved}개 중 ${coverage.shown}개를 모델에 보여 주었어요. 모든 검색 결과를 검토한 것은 아닐 수 있어요.`);
    if (result.comparisonLimit) lines.push(`AI 비교 한계: ${result.comparisonLimit}`);
    return lines;
  }
  function render(result) {
    clearResults(); searchCompleted = true; currentCases = result.cases.slice();
    output.replaceChildren(el('p', result.modelUsed ? '기기 AI가 자료 중 비교할 사례를 골랐어요.' : '자료에서 찾은 경기 사례'));
    output.append(el('p', result.summary));
    if (result.modelUsed) for (const line of modelNotice(result)) output.append(el('p', line));
    if (!result.cases.length) output.append(el('p', '등록된 자료에서 비교할 사례를 찾지 못했어요.'));
    for (const c of result.cases) {
      const card = el('article', '', { className: 'classroom-item' });
      const selectLabel = el('label', '이 사례를 비교에 선택'), check = el('input', '', { type: 'checkbox', value: c.id, className: 'student-tactics-case-select' });
      selectLabel.prepend(check); card.append(selectLabel);
      check.addEventListener('change', () => {
        if (check.checked && selected.size >= 2) { check.checked = false; status.textContent = '사례는 최대 두 개까지 선택할 수 있어요.'; return; }
        if (check.checked) selected.add(c.id); else selected.delete(c.id);
        const hadPending = Boolean(root.TacticsTeamRequest?.peek()); root.TacticsTeamRequest?.clear(); renderComparison();
        if (hadPending) status.textContent = '비교 선택이 바뀌었어요. 교사 검토 요청을 다시 준비해 주세요.';
      });
      card.append(el('h4', c.title), el('p', c.pilotMaterialReviewStatus === 'accepted' ? `자료 상태: ${c.candidateGrade === 'A' ? '특정 장면 후보' : '경기 흐름 요약'} · 사용자 시범 수용 · 부분 관련 · 교사·전문가 검토 대기` : `자료 상태: ${c.candidateGrade === 'A' ? '특정 장면 후보' : '경기 흐름 요약'} · 교사·코치 검토 전 초안`), ...(c.sourceSport === 'baseball' ? [el('p', '야구 원본과 티볼의 공통 기술을 부분 비교합니다. 대회 규칙은 다를 수 있어요.')] : []), el('p', `자료에 기록된 경기 내용: ${c.observed}`), el('p', `조건·맥락: ${c.context}`));
      if (c.videoReviewStatus === 'not-viewed') card.append(el('p', '영상은 확인하지 않았습니다.'));
      if (c.matchDateStatus?.includes('not-separately-verified')) card.append(el('p', '경기 날짜는 별도로 확인하지 않았습니다.'));
      if (c.similarity) card.append(el('p', c.similarity));
      if (c.relevanceExplanation) card.append(el('p', `관련성: ${c.relevanceExplanation}`));
      if (c.matchedConditions?.length) card.append(el('p', `겹친 조건: ${show(c.matchedConditions)}`));
      if (c.differingConditions?.length) card.append(el('p', `조건 차이: ${show(c.differingConditions)}`));
      if (c.unmatchedConditions?.length) card.append(el('p', `확인되지 않은 조건: ${show(c.unmatchedConditions)}`));
      if (c.ruleExplanation) card.append(el('p', `규칙 범위: ${c.ruleExplanation}`));
      for (const scope of c.scopes || []) card.append(el('p', `확인 범위: ${scope.supported} · 확인되지 않은 점: ${scope.missing} · 규칙 범위: ${scope.ruleScope}`));
      for (const limit of c.limitations || []) card.append(el('p', `자료 한계: ${limit}`));
      const line = el('p', '출처: '), link = el('a', c.sourceTitle, { href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }); line.append(link); card.append(line); output.append(card);
    }
    output.append(el('p', `비교 한계: ${result.comparisonLimit}`), el('p', '경기 조건과 학교 규칙의 차이를 함께 살펴보세요. 사례는 정답이나 실행 지시가 아닙니다.'));
  }
  function renderComparison() {
    compare.replaceChildren(el('h3', '선택한 경기 사례 비교'));
    const chosen = currentCases.filter(c => selected.has(c.id));
    if (chosen.length < 2) { compare.append(el('p', chosen.length ? '한 사례를 더 선택하면 두 사례를 비교할 수 있어요.' : '비교할 사례를 최대 두 개 선택해 주세요.')); return; }
    const [a, b] = chosen, left = new Set(a.matchedConditions || []), right = new Set(b.matchedConditions || []);
    const common = [...left].filter(key => right.has(key));
    compare.append(el('p', common.length ? `두 사례가 우리 모둠 설명과 공통으로 겹친 조건: ${show(common)}` : '우리 모둠 설명과 두 사례가 공통으로 겹친 조건은 확인되지 않았어요.'));
    const grid = el('div', '', { className: 'student-tactics-compare-grid' });
    for (const [c, other] of [[a, right], [b, left]]) {
      const row = el('article', '', { className: 'classroom-item' }), only = (c.matchedConditions || []).filter(key => !other.has(key));
      row.append(el('h4', c.title), el('p', `우리 모둠 설명과 이 사례에만 겹친 조건: ${only.length ? show(only) : '없음'}`), el('p', `우리 모둠 설명과 다르게 기록된 조건: ${c.differingConditions?.length ? show(c.differingConditions) : '자료에서 별도로 확인하지 못했어요'}`), el('p', `우리 모둠 설명 중 확인되지 않은 조건: ${c.unmatchedConditions?.length ? show(c.unmatchedConditions) : '없음으로 단정할 수 없음'}`), el('p', `기록된 경기 내용: ${c.observed}`), el('p', `경기 맥락: ${c.context}`));
      if (c.ruleExplanation) row.append(el('p', `규칙 범위: ${c.ruleExplanation}`));
      if (c.sourceSport === 'baseball') row.append(el('p', '야구 원본과 티볼 공통 기술의 부분 비교입니다.'));
      row.append(el('p', `${c.candidateGrade === 'A' ? '특정 장면 후보' : '경기 흐름 요약'} · ${c.pilotMaterialReviewStatus === 'accepted' ? '사용자 시범 수용 · 부분 관련 · 교사·전문가 검토 대기' : '교사·코치 검토 전 초안'}`));
      if (c.videoReviewStatus === 'not-viewed') row.append(el('p', '영상은 확인하지 않았습니다.'));
      if (c.matchDateStatus?.includes('not-separately-verified')) row.append(el('p', '경기 날짜는 별도로 확인하지 않았습니다.')); 
      for (const scope of c.scopes || []) row.append(el('p', `확인 범위: ${scope.supported} · 확인되지 않은 점: ${scope.missing} · 규칙 범위: ${scope.ruleScope}`));
      for (const limit of c.limitations || []) row.append(el('p', `자료 한계: ${limit}`));
      const line = el('p', '출처: '); line.append(el('a', c.sourceTitle, { href: c.sourceUrl, target: '_blank', rel: 'noopener noreferrer' })); row.append(line); grid.append(row);
    }
    compare.append(grid);
  }
  async function run(model) {
    let value; try { value = input(); } catch (error) { status.textContent = error.message; return; }
    if (model && controller) { status.textContent = '이전 AI 작업을 정리 중이에요. 정리가 끝나면 다시 시도해 주세요.'; return; }
    if (!model) controller?.abort();
    const ownRevision = ++revision; clearResults();
    status.textContent = '자료를 찾는 중이에요.';
    try {
      if (!root.TacticsLocalAdvisor) throw new Error('자료 검색 도구를 불러오지 못했어요. 앱을 다시 열어 주세요.');
      const base = await root.TacticsLocalAdvisor.search(value);
      if (ownRevision !== revision) return;
      render(base); status.textContent = base.cases.length ? '출처와 경기 조건을 함께 비교해 보세요.' : '일치하는 자료가 없어요.';
      if (!model || !base.cases.length) return;
      const task = new AbortController(); controller = task; selectButton.disabled = true;
      status.textContent = '기기 AI가 자료를 고르는 중이에요. 오래 걸릴 수 있어요.';
      try {
        const result = await root.TacticsLocalAdvisor.suggest(value, { signal: task.signal, onProgress: info => { if (!task.signal.aborted && ownRevision === revision) status.textContent = info.message || '기기에서 처리 중이에요.'; } });
        if (task.signal.aborted || ownRevision !== revision) return;
        if (!result.cases.length) { for (const line of modelNotice(result)) output.append(el('p', line)); status.textContent = 'AI가 사례를 선택하지 않았어요. 기존 자료는 남아 있어요.'; return; }
        render(result); status.textContent = '출처와 경기 조건을 함께 비교해 보세요.';
      } catch (error) { if (!task.signal.aborted && ownRevision === revision) status.textContent = `AI 선택을 마치지 못했어요. 기존 자료는 남아 있어요. ${error.message}`; }
      finally { if (controller === task) controller = null; selectButton.disabled = false; }
    } catch (error) { if (ownRevision === revision) status.textContent = error.message; }
  }
  searchButton.addEventListener('click', () => void run(false)); selectButton.addEventListener('click', () => void run(true));
  cancelButton.addEventListener('click', () => { if (controller) { controller.abort(); status.textContent = '취소를 요청했어요. 기존 자료는 남아 있어요.'; } });
  for (const inputNode of [sport, situation, difficulty, comparison]) inputNode.addEventListener('input', () => { revision++; controller?.abort(); clearResults(); status.textContent = '입력이 바뀌었어요. 자료를 다시 찾아 주세요.'; });
  handoffButton.addEventListener('click', () => {
    try {
      if (!searchCompleted) throw new Error('먼저 자료를 찾아 주세요.');
      const value = input(); revision++; controller?.abort(); root.TacticsTeamRequest.offer({ sport: value.sport, request: value.request, caseIds: [...selected] });
      status.textContent = '검토 요청을 이 탭에 준비했어요. 교사 메뉴에서 잠금을 풀고 전술판의 모둠 요청 가져오기를 눌러 주세요.';
    } catch (error) { status.textContent = error.message; }
  });
  function releaseMemory() { return Promise.resolve().then(() => root.TacticsLocalAdvisor?.release?.()); }
  releaseButton.addEventListener('click', async () => { revision++; controller?.abort(); releaseButton.disabled = true; status.textContent = 'AI 메모리를 비우는 중이에요.'; try { await releaseMemory(); status.textContent = 'AI 메모리를 비웠어요. 설치된 모델 파일은 유지돼요.'; } catch (error) { status.textContent = `AI 메모리를 비우지 못했어요: ${error.message}`; } finally { releaseButton.disabled = false; } });
  function reset() { revision++; controller?.abort(); void releaseMemory().catch(() => {}); situation.value = difficulty.value = comparison.value = ''; sport.value = 'basketball'; clearResults(); status.textContent = ''; }
  resetButton.addEventListener('click', reset);
  panel.addEventListener('toggle', () => { if (!panel.open) reset(); });
  window.addEventListener('tactics-context-end', () => { revision++; controller?.abort(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) controller?.abort(); });
})(globalThis);
