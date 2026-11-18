'use strict';
// These concepts describe comparison conditions, not facts inferred from a board.
const CONCEPTS = {
  full_court_press: /전면\s*압박|코트\s*전체.{0,12}압박|풀\s*코트\s*(?:프레스|압박)|full.?court\s*press/iu,
  high_press: /전방\s*압박|높은\s*위치.{0,10}압박|high\s*press/iu,
  between_lines: /라인\s*사이|수비.{0,8}(?:두\s*)?(?:줄|라인)\s*사이|(?:미드필드|미드필더|중원).{0,12}(?:수비|수비진).{0,5}사이|between\s*(?:the\s*)?lines/iu,
  serve_disrupt: /(?:서브|서브권).{0,35}(?:흔들|흔든|흔드|흔들린|불안|어렵|무너|방해|리시브\s*실패)|(?:흔들|불안|어렵).{0,25}서브/iu,
  backcourt_dig: /(?:후위|뒤쪽\s*수비|백코트).{0,35}(?:디그|받아|받는|받았|수비|리시브)|(?:디그).{0,20}(?:후위|백코트)/iu,
  prior_hitter_adjustment: /(?:^|(?<=[.;；\n]))\s*(?=[^.;；\n]*(?:앞(?:선|서|\s*타석)|이전\s*(?:타석|타구)|지난\s*(?:타석|타구)|첫\s*타석)[^.;；\n]*(?:다음\s*타석|다시\s*타석|같은\s*타자|그\s*타자))(?=[^.;；\n]*(?:보고|따라|때문|근거|반영|고려))(?=[^.;；\n]*(?:외야|수비))(?=[^.;；\n]*(?:위치|배치|자리))(?=[^.;；\n]*(?:바꾸|바꿔|바뀌|바꾼|바꿨|조정|변경|옮기))[^.;；\n]+/iu,
  outfield_reposition: /(?:외야|외야수).{0,40}(?:위치|자리|배치).{0,20}(?:바꾸|바꿔|바뀌|바꾼|바꿨|조정|변경|이동|옮기)|(?:위치|배치).{0,15}(?:바꾸|바꿔|변경|조정).{0,20}외야/iu,
  force_choice: /포스\s*(?:아웃|플레이)/iu,
  base_choice: /(?:어느|어떤|어디|선택|판단).{0,25}(?:베이스|루)|(?:베이스|루).{0,25}(?:선택|판단)/iu,
  recovery_return: /(?:회수|주워|되찾|줍).{0,35}(?:복귀|돌아|되돌아|수비\s*위치)|(?:복귀|돌아).{0,35}(?:회수|주워)/iu,
  game_start: /경기\s*(?:시작|개시)|시작\s*(?:직후|때|하자마자)|오프닝|opening/iu,
  relay: /중계|이어\s*던|relay/iu, throw: /송구|던지|투척|던진|투구|throws?|throwing/iu,
  pass: /패스|전진\s*패스|앞\s*패스|pass(?:ing)?/iu, receive: /받기|받은|받아|수신|리시브|포구|받는|receive/iu,
  backup: /백업|뒤쪽|뒷받침|커버|지원|cover|backup/iu, movement: /이동|움직|달려|달리|전진|move|run/iu,
  position: /위치|자리|배치|position/iu, spacing: /간격|공간|거리|폭|좁(?:은|게|힌)|spacing|space/iu,
  direction: /방향|회전|돌아|시야|방향|angle/iu, communication: /(?<![가-힣])콜(?![가-힣])|콜(?:을|이|로|의|은|과|도|에|해서|하며|했다|한다|하|할)|정보\s*전달|외침|소통|대화|목소리|음성|communication/iu,
  defense: /수비|방어|압박|차단|block|defen[cs]e|press/iu, attack: /공격|침투|돌파|attack/iu,
  rebound: /리바운드|rebound/iu, transition: /속공|역습|전환|fast.?break|counter/iu,
  shot: /슛|슈팅|마무리|shoot|shot/iu, screen: /스크린|픽앤롤|픽앤팝|볼스크린|screen|pick.?and.?(?:roll|pop)/iu,
  evade: /회피|피하|피한|피해|피했|dodg/iu, catch: /캐치|잡(?:아|기|은|으|는)|받아내|catch/iu,
  regroup: /재정비|다시\s*모|모여|재집결|regroup/iu, collision: /충돌|부딪|겹쳐|겹친|colli/iu,
  save: /살리|살려|걷어내|막아내|save/iu, corner: /코너킥|코너 킥|corner/iu, freekick: /프리킥|프리 킥|free.?kick/iu, header: /헤더|머리로|헤딩|head(?:er|ed)/iu,
  player_advantage: /수적\s*우위|선수\s*(?:수|인원).{0,8}(?:우위|많|앞서|우세)|(?:선수|인원).{0,8}(?:상대보다\s*많)/iu,
  player_disadvantage: /수적\s*열세|열세\s*인원|선수\s*(?:수|인원).{0,8}(?:열세|적|밀리|뒤진)|(?:선수|인원).{0,8}상대보다\s*적|한\s*명만\s*남|선수.{0,5}적을\s*때/iu,
  timeout: /타임\s*아웃|작전\s*시간|timeout/iu, overtime: /연장전|연장\s*경기|overtime/iu,
  late_stage: /종료.{0,5}직전|마지막\s*(?:몇\s*)?초|남은\s*(?:시간이?\s*)?(?:짧|얼마\s*없|\d{1,2}초)|종료가\s*가까울/iu,
  role_assignment: /역할.{0,6}(?:정|나누|나눠|나눴|분담|조정|합의)/iu,
  lineup_selection: /기용|선발|선수\s*구성/iu,
  uncertainty: /애매|혼선|서로\s*겹|우왕좌왕/iu,
  ball_recovery: /공(?:을|이)\s*(?:빼앗(?!기|겨|겼|긴)|되찾|탈취|가로채)|공\s*(?:탈취|회수)/iu,
  ball_loss: /공(?:을|이)\s*(?:빼앗(?:기|겨|겼|긴)|잃|놓치)/iu,
  third_man: /서드\s*맨|제\s*3\s*(?:의\s*)?(?:선수|사람)|제삼자|third.?man/iu,
  run_into_space: /(?:공간|뒷공간).{0,10}(?:뛰|침투|달리)|(?:뛰|침투).{0,10}(?:공간|뒤)/iu,
  drop_back: /내려오|내려와|내려간|뒤로\s*빠지|뒤로\s*내려/iu,
  corner_area: /코트.{0,5}(?:가장자리|구석)|(?:구석|코너)(?!킥)/iu,
  position_hold: /(?:위치|자리).{0,8}(?:유지|지키|지킨)/iu,
  advantage: /동점|역전/iu,
  buildup: /빌드업|후방.*전개|build.?up/iu,
  set: /세트|토스|set(?:ting)?/iu, serve: /서브|서브권|serve/iu, hit: /타격|타구|뜬공|안타|hit/iu,
  running: /주루|주자|베이스|base.?run/iu, possession: /점유|볼 소유|소유권|possession/iu,
};
const CORE = new Set(['full_court_press','high_press','between_lines','serve_disrupt','backcourt_dig','outfield_reposition','force_choice','base_choice','recovery_return','game_start']);
const CORE_SPORTS = { full_court_press:['basketball'], high_press:['soccer'], between_lines:['soccer'], serve_disrupt:['volleyball'], backcourt_dig:['volleyball'], outfield_reposition:['teeball','baseball'], force_choice:['teeball','baseball'], base_choice:['teeball','baseball'], recovery_return:['dodgeball'], game_start:['dodgeball'] };
const RULES = /태그\s*업|도루|아웃|득점|투구|규칙|판정|반칙|파울|라인|시간제한/iu;
const ACTION = new Set(['relay','throw','pass','receive','backup','movement','direction','communication','defense','attack','rebound','transition','shot','screen','buildup','player_advantage','player_disadvantage','timeout','overtime','late_stage','role_assignment','lineup_selection','uncertainty','ball_recovery','ball_loss','third_man','run_into_space','drop_back','corner_area','position_hold','evade','catch','regroup','collision','save','corner','freekick','header','set','serve','hit','running']);
function concepts(value) { return new Set(Object.entries(CONCEPTS).filter(([key, pattern]) => {
  if (key === 'outfield_reposition') return (value || '').split(/[.;；\n]/u).some(clause => pattern.test(clause) && (!/(?:타구|공).{0,15}(?:쫓|따라가|추격)/u.test(clause) || /(?:전에|앞서|미리|사전에)[^.;；\n]{0,40}(?:배치|위치|자리)[^.;；\n]{0,20}(?:바꾸|바꿔|바뀌|바꾼|바꿨|조정|변경|옮기)/u.test(clause)));
  return pattern.test(value || '');
}).map(([key]) => key)); }
// Exclude any clause that describes an absent, unknown or unobserved condition.
function positiveText(value) { return (value || '').split(/[.;；\n]/u).filter(s => !/불명|미확인|미기록|미관찰|장면.{0,5}아니|장면.{0,5}아님|사건.{0,5}아니|확인되지|기록되지|기록.{0,8}없|명시.{0,8}없|알 수 없|not (?:known|recorded|observed)/iu.test(s)).join('\n'); }
function overlap(a, b) { return [...a].filter(key => b.has(key)); }
function negativeCondition(value, key) {
  const words = { communication: '콜|정보\\s*전달|소통|외침|음성', spacing: '간격|공간|거리', direction: '방향|시야', receive: '받|수신|리시브|포구', throw: '송구|던지|투척|투구', pass: '패스|연결', movement: '이동|움직', defense: '수비|방어', attack: '공격|침투', transition: '전환|속공|역습', rebound: '리바운드', screen: '스크린|픽앤롤', buildup: '빌드업|전개', player_advantage: '수적\\s*우위|선수\\s*(?:수|인원)', player_disadvantage: '수적\\s*열세|선수\\s*(?:수|인원)|한\\s*명만', timeout: '타임\\s*아웃|작전\\s*시간', overtime: '연장전|연장\\s*경기', late_stage: '종료|마지막|남은\\s*시간', role_assignment: '역할', lineup_selection: '기용|선발|선수\\s*구성', uncertainty: '애매|혼선', ball_recovery: '공(?:을|이)\\s*(?:빼앗|되찾|탈취|가로채)', ball_loss: '공(?:을|이)\\s*(?:빼앗|잃|놓치)', third_man: '서드\\s*맨|제\\s*3\\s*(?:의\\s*)?(?:선수|사람)|제삼자', run_into_space: '공간|뒷공간', drop_back: '내려오|내려와|내려간', corner_area: '코트|구석|코너', position_hold: '위치|자리' };
  if (key === 'communication' && /(?:콜|정보\s*전달|소통)[^.;；\n]{0,8}동료(?:가|는|이)?\s*없/iu.test(value)) return true;
  if (key === 'serve_disrupt' && /(?:흔들|흔드)(?:지|지는|리지|리지는)\s*(?:못|않)/iu.test(value)) return true;
  if (CORE.has(key)) return new RegExp(`(?:${CONCEPTS[key].source})(?:이|가|은|는|을|를|\\s)*(?:없|아니|않|못|실패|쓰지\\s*않|사용하지\\s*않|하지\\s*(?:않|못))`, 'iu').test(value);
  if (key === 'attack' && /(?:수비|방어)(?:가|는)?[^.;；\n]{0,12}공격(?:을|이|이\s*)?\s*(?:막|차단)/iu.test(value)) return true;
  if (key === 'serve') return /서브(?:를|는|가|를\s*)?\s*(?:하지\s*(?:않|못)|없|실패)/iu.test(value);
  if (!words[key]) return false;
  return new RegExp(`(?:${words[key]})(?:이|가|은|는|을|를|할|하기|하지|하지는|\\s)*(?:없|않|못|실패|아니)|(?:${words[key]})[^.;；\\n]{0,8}(?:하지\\s*못|하지\\s*않|할\\s*수\\s*없|실패)|(?:없|아니)[^.;；\\n]{0,5}(?:${words[key]})`, 'iu').test(value);
}
function sufficient(shared) { return shared.some(k => CORE.has(k)) || shared.some(k => ACTION.has(k) && !['movement', 'defense', 'attack', 'running'].includes(k)) || shared.filter(k => ACTION.has(k)).length >= 2; }
function unknownCondition(value, key) {
  return (value || '').split(/[.;；\n]/u).some(clause => CONCEPTS[key].test(clause) && /불명|미확인|미기록|미관찰|확인되지|기록되지|알 수 없|not (?:known|recorded|observed)/iu.test(clause));
}
function compatible(request, evidence, wanted) {
  const positive = concepts(positiveText(evidence));
  // A known phase can precede an explicitly unknown detail in the same sentence.
  for (const clause of (evidence || '').split(/[.;；\n]/u)) {
    const phase = clause.match(/^(.*?(?:연장전|연장\s*경기|타임\s*아웃|작전\s*시간))(?:에서|에|\s)/iu);
    if (phase) for (const key of concepts(phase[1])) if (key === 'timeout' || key === 'overtime') positive.add(key);
  }
  return overlap(wanted, positive).filter(key => !unknownCondition(request, key));
}
function classify(request, row) {
  const wanted = concepts(request); const sport = row.targetSport || row.sport || row.sourceSport;
  if (sport && !['teeball','baseball'].includes(sport)) wanted.delete('prior_hitter_adjustment');
  for (const key of CORE) if (sport && !CORE_SPORTS[key].includes(sport)) wanted.delete(key);
  const requestedCore = [...wanted].filter(k => CORE.has(k) && !unknownCondition(request, k));
  const ruleRequested = RULES.test(request);
  // Rules alone do not establish a comparable scene, especially across sports.
  const requestedActions = [...wanted].filter(k => ACTION.has(k));
  if (!requestedActions.length || (wanted.size < 2 && !['relay', 'screen', 'buildup', 'rebound', 'transition', 'timeout', 'overtime', 'player_advantage', 'player_disadvantage'].some(k => wanted.has(k)))) return null;
  if (/규칙|판정|반칙|파울|시간제한/iu.test(request) && requestedActions.every(k => ['timeout', 'overtime', 'late_stage'].includes(k))) return null;
  if (row.sourceSport === 'baseball' && ![...wanted].some(k => ['relay', 'throw', 'pass', 'receive', 'backup', 'movement', 'direction', 'communication', 'defense', 'position', 'spacing', 'hit'].includes(k)) ) return null;
  if (row.sourceSport === 'baseball' && ruleRequested && !/중계|송구|백업|커버|포구|패스|연결|소통|콜/u.test(request)) return null;
  if (row.pilotMaterialReviewStatus === 'accepted') {
    const seen = new Set(); const matched = [];
    for (const scope of row.sceneScopes || []) {
      const shared = compatible(request, scope.supported, wanted);
      if (!sufficient(shared) || (requestedCore.length && !shared.some(k => CORE.has(k)))) continue;
      const key = JSON.stringify([scope.purpose, scope.supported, scope.missing, scope.ruleScope]);
      if (!seen.has(key)) { seen.add(key); { const differingConditions = shared.filter(k => negativeCondition(request, k) !== negativeCondition(scope.supported, k)); matched.push({ ...scope, matchedConditions: shared.filter(k => !differingConditions.includes(k)), differingConditions }); } }
    }
    if (!matched.length) return null;
    const differingConditions = [...new Set(matched.flatMap(s => s.differingConditions))];
    const matchedConditions = [...new Set(matched.flatMap(s => s.matchedConditions))].filter(k => !differingConditions.includes(k));
    return { relevance: 'partial', relevanceExplanation: '요청의 일부 행동만 자료의 장면 비교 범위와 겹칩니다.', matchedConditions, differingConditions, unmatchedConditions: [...wanted].filter(k => !matchedConditions.includes(k) && !differingConditions.includes(k)), ruleStatus: ruleRequested || row.sourceSport === 'baseball' ? 'unconfirmed' : 'not-compared', ruleExplanation: ruleRequested || row.sourceSport === 'baseball' ? '요청의 규칙 적용과 판정은 확인되지 않았습니다.' : '학교 규칙과의 일치는 확인하지 않았습니다.', scopes: matched, sceneScopes: matched };
  }
  const shared = compatible(request, row.observed, wanted);
  if (!sufficient(shared) || (requestedCore.length && !shared.some(k => CORE.has(k)))) return null;
  const differingConditions = shared.filter(k => negativeCondition(request, k) !== negativeCondition(row.observed, k));
  const matchedConditions = shared.filter(k => !differingConditions.includes(k));
  const direct = !differingConditions.length && !ruleRequested && requestedActions.length >= 2 && [...wanted].every(k => matchedConditions.includes(k));
  return { relevance: direct ? 'direct' : 'partial', relevanceExplanation: direct ? '기록된 행동 조건이 요청의 주요 행동과 겹칩니다. 맥락 차이는 별도 확인이 필요합니다.' : '기록된 행동 중 일부만 요청과 겹칩니다.', matchedConditions, differingConditions, unmatchedConditions: [...wanted].filter(k => !matchedConditions.includes(k) && !differingConditions.includes(k)), ruleStatus: ruleRequested ? 'unconfirmed' : 'not-compared', ruleExplanation: ruleRequested ? '요청의 규칙 적용과 판정은 확인되지 않았습니다.' : '학교 규칙과의 일치는 확인하지 않았습니다.' };
}
module.exports = { classify, concepts, positiveText };
