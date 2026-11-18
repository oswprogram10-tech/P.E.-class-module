'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../server/tactics-relevance');
const row = (sport, observed, title = '경기') => ({ sport, observed, title });

test('specific scene conditions cannot be supplied by generic movement or a title', () => {
  for (const [sport, request, observed, key] of [
    ['basketball','상대가 코트 전체에서 압박할 때 양 팀이 어떻게 움직이며 공을 전진시키나', '공격과 수비가 이동했다.', 'full_court_press'],
    ['soccer','수비 두 줄 사이에서 패스를 받아 돌아선다', '선수가 패스를 받아 이동했다.', 'between_lines'],
    ['teeball','앞 타석 타구를 보고 다음 타석에 외야 수비 배치를 바꾼 경기', '외야수가 타구를 잡았다.', 'outfield_reposition'],
    ['basketball','전면 압박에 대응해 선수들이 이동한다','수비수가 이동했다. 공격수가 전진했다.','full_court_press'],
    ['soccer','라인 사이에서 패스하며 수비를 벗어난다','선수가 패스했다. 수비수가 이동했다.','between_lines'],
    ['volleyball','서브로 상대 리시브를 흔든 장면','리시브와 공격을 했다.','serve_disrupt'],
    ['volleyball','후위 선수가 공격을 받아낸 수비','선수들이 공격하고 리시브했다.','backcourt_dig'],
    ['teeball','외야수가 위치를 바꿔 타구에 대응한다','외야수가 타구를 잡았다.','outfield_reposition'],
    ['teeball','포스아웃을 위해 어느 베이스로 던질지 선택한다','수비수가 송구했다.','force_choice'],
    ['dodgeball','공을 회수한 뒤 수비 위치로 복귀한다','선수가 공을 던지고 수비 위치로 이동했다.','recovery_return'],
    ['dodgeball','경기 시작 때 공을 던진다','선수가 공을 던졌다.','game_start'],
  ]) {
    assert.equal(classify(request, row(sport, observed, request)), null, key);
  }
});

test('supported specific conditions are comparable and unknown statements do not establish them', () => {
  const request = '전방 압박을 피해 패스하며 이동했다';
  const found = classify(request, row('soccer','전방 압박을 상대하며 패스했다. 선수들이 이동했다.'));
  assert.ok(found.matchedConditions.includes('high_press'));
  assert.equal(classify(request, row('soccer','전방 압박 여부는 기록되지 않았다. 패스하며 이동했다.')), null);
  const partial = classify('전방 압박과 라인 사이 패스', row('soccer','전방 압박을 받으며 패스했다. 라인 사이는 확인되지 않았다.'));
  assert.ok(partial.unmatchedConditions.includes('between_lines'));
  assert.equal(partial.relevance, 'partial');
});

test('screen and spacing are supported by paraphrases and defense is not negated by its object', () => {
  const screen = classify('픽앤팝 뒤 수비가 공격을 막았다', row('basketball','픽앤팝을 사용했다. 수비가 공격을 막았다.'));
  assert.ok(screen.matchedConditions.includes('screen'));
  assert.ok(screen.matchedConditions.includes('defense'));
  assert.ok(!screen.differingConditions.includes('defense'));
  const narrow = classify('좁은 수비 블록과 패스', row('soccer','좁은 블록이 움직였다. 선수가 패스했다.'));
  assert.ok(narrow.matchedConditions.includes('spacing'));
  const opposite = classify('전방 압박을 받으며 패스했다', row('soccer','전방 압박이 없었다. 패스했다.'));
  assert.ok(opposite.differingConditions.includes('high_press'));
  assert.ok(opposite.matchedConditions.includes('pass'));
});

test('serve absence and a stopped attack are distinct from absent defense', () => {
  const serve = classify('서브하지 않고 리시브했다', row('volleyball','선수가 서브하고 리시브했다.'));
  assert.ok(serve.differingConditions.includes('serve'));
  const stopped = classify('스크린 뒤 공격했다', row('basketball','스크린 뒤 수비가 공격을 막았다.'));
  assert.ok(stopped.differingConditions.includes('attack'));
});

test('prior hit and later adjustment require their own recorded condition', () => {
  const request = '앞 타석 타구를 보고 다음 타석에 외야 수비 배치를 바꿨다';
  const generic = classify(request, row('teeball','외야 수비 위치를 타자에 따라 바꿨다.'));
  assert.ok(generic); assert.equal(generic.relevance, 'partial');
  assert.ok(generic.matchedConditions.includes('outfield_reposition'));
  assert.ok(generic.unmatchedConditions.includes('prior_hitter_adjustment'));
  const specific = classify(request, row('teeball','앞 타석 타구를 보고 다음 타석에 외야 수비 배치를 바꿨다.'));
  assert.ok(specific.matchedConditions.includes('prior_hitter_adjustment'));
  const unknown = classify(request, row('teeball','외야 수비 위치를 바꿨다. 앞 타석 타구와 다음 타석의 관계는 기록되지 않았다.'));
  assert.ok(unknown.unmatchedConditions.includes('prior_hitter_adjustment'));
  const separate = classify(request, row('teeball','앞 타석 타구가 멀리 갔다. 다음 타석에 외야 수비 배치를 바꿨다.'));
  assert.ok(separate.unmatchedConditions.includes('prior_hitter_adjustment'));
});

test('negative press, force play and opening remain distinct', () => {
  const absent = classify('전면 압박을 받으며 이동하고 패스했다', row('basketball','전면 압박은 쓰지 않았다. 핸들러가 이동한 뒤 패스했다.'));
  assert.ok(absent.differingConditions.includes('full_court_press'));
  const choice = classify('어느 베이스에 던져 포스 아웃을 만들지 판단하는 수비', row('teeball','뜬공을 잡고 태그업하는 주자를 막기 위해 송구할 베이스를 선택했다.'));
  assert.ok(choice); assert.ok(choice.unmatchedConditions.includes('force_choice')); assert.ok(!choice.matchedConditions.includes('force_choice'));
  const early = classify('경기 시작에 공을 확보하고 먼저 던져 공격한다', row('dodgeball','경기 초반에 공을 확보해 공격하다가 상대에게 던졌다.'));
  assert.equal(early, null);
  const chase = classify('외야 수비 배치를 바꿔 타구에 대응한다', row('teeball','외야수는 타구를 쫓으며 위치를 바꿔 앞으로 달려가 포구했다.'));
  assert.equal(chase, null);
});

test('uncertainty stated in the request is never promoted into a match', () => {
  const match = classify('전면 압박이 확인되지 않았다. 패스하고 이동했다', row('basketball', '전면 압박을 쓰며 패스하고 이동했다.'));
  assert.ok(match); assert.equal(match.relevance, 'partial');
  assert.ok(match.unmatchedConditions.includes('full_court_press'));
  assert.ok(!match.matchedConditions.includes('full_court_press'));
});

test('failed press is a difference from an executed press', () => {
  const match = classify('전면 압박을 하지 못했다. 패스했다', row('basketball','전면 압박을 했고 패스했다.'));
  assert.ok(match.differingConditions.includes('full_court_press'));
  assert.equal(match.relevance, 'partial');
});

test('composite conditions retain sentence boundaries, ordering and failure', () => {
  const serve = classify('서브로 리시브를 흔든 장면', row('volleyball','선수가 서브했다. 세터 교체 뒤 리시브가 흔들렸다.'));
  assert.equal(serve, null);
  const request = '앞선 타구를 보고 다음 타석에 외야 배치를 바꾸는 장면';
  const separate = classify(request, row('teeball','외야수는 지난 타석에 배치를 바꿨다. 다음 타석 타구를 따라 달려 포구했다.'));
  if (separate) assert.ok(separate.unmatchedConditions.includes('prior_hitter_adjustment'));
  const failed = classify('서브로 리시브를 흔들어 상대 공격을 막은 장면', row('volleyball','강한 서브로 리시브를 흔들지는 못했다. 이후 공격했다.'));
  assert.ok(failed.differingConditions.includes('serve_disrupt')); assert.equal(failed.relevance,'partial');
  assert.equal(classify('서브로 상대 리시브와 다음 공격을 흔드는 상황', row('volleyball','리시브와 공격 통계를 기록했다.')), null);
  assert.equal(classify('상대 미드필드와 수비 사이에서 공을 받는 상황', row('soccer','수비가 이동했고 공을 받았다.')), null);
});

test('explicit positioning before the hit survives later pursuit', () => {
  const match = classify('타자에 맞춰 외야 수비 배치를 바꿔 타구를 처리한 장면', row('teeball','타자가 들어오기 전에 외야 수비 배치를 깊게 바꿨고 이어 날아온 타구를 쫓아 포구했다.'));
  assert.ok(match); assert.ok(match.matchedConditions.includes('outfield_reposition'));
});

test('known phase does not recover an unknown condition in its prefix', () => {
  const match = classify('전면 압박하며 패스하고 이동했다', row('basketball','전면 압박 여부는 확인되지 않았으나 연장전에서 선수들이 패스하고 이동했다.'));
  assert.equal(match, null);
});
