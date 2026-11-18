(function (root) {
  'use strict';
  const S = root.TacticsSharing, T = root.TacticsBoard, M = root.ClassroomModel;
  const el = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { textContent: text || '', ...attrs });
  const SOCCER_TACTIC_GROUPS = [
    { title: '플레이 모델·별칭', items: [
      { name: '토털 풋볼 (Total Football)', detail: 'Ajax의 Rinus Michels·Johan Cruyff 시대를 대표하는 팀 모델이다. 공과 동료의 움직임에 따라 선수들이 역할을 교환하고, 서로 빈자리를 메우며 전진 압박과 공격을 이어갔다. 모든 선수가 아무렇게나 위치를 바꾸는 자유 전술은 아니다.', sources: [['UEFA: Ajax 1971–73', 'https://www.uefa.com/uefachampionsleague/news/0253-0d7ff54908f6-5927d0a16600-1000--the-greatest-teams-of-all-time-ajax-1971-73/']] },
      { name: '사키이즘 (Sacchi’s Milan)', detail: 'Arrigo Sacchi의 AC Milan은 4-4-2, 지역 방어, 높은 수비선, 오프사이드 트랩과 팀 단위 압박을 결합했다. “높은 수비 블록” 하나만을 뜻하지 않으며, 간격과 동시 움직임을 훈련한 역사적 팀 모델이다.', sources: [['UEFA: Sacchi 전술과 AC Milan', 'https://www.uefa.com/uefachampionsleague/news/0253-0d81cb410c87-4115a0f26160-1000--in-profile-arrigo-sacchi/']] },
      { name: '티키타카 (Tiki-taka)', detail: '2008–12년 Barcelona와 스페인의 짧고 빠른 패스·점유·위치 교환을 가리키는 대중적 이름이다. 공을 오래 갖는 것 자체가 목적은 아니며, 전진 패스와 공을 잃은 뒤의 압박도 함께 봐야 한다.', sources: [['UEFA: Barcelona 2008–12', 'https://www.uefa.com/uefachampionsleague/news/0253-0d7ff5460779-90f1672a7e36-1000--the-greatest-teams-of-all-time-barcelona-2008-12/']] },
      { name: '포지션 플레이 (Juego de posición)', detail: '공을 가진 선수 주변에서 폭·깊이·선수 간 거리를 조정해 패스길, 수적 우위, 자유 선수를 만들고 상대선을 통과하는 공격 원리다. 고정된 칸에 서 있기만 하는 형태가 아니며, 공을 잃었을 때의 후방 균형도 설계한다.', sources: [['Coaches’ Voice: positional play', 'https://learning.coachesvoice.com/cv/positional-play-football-tactics-explained-guardiola-cruyff-manchester-city/']] },
      { name: '벵거볼 (Wengerball)', detail: 'Arsène Wenger의 전술 매뉴얼에 있는 고정 체계명이 아니라 팬·언론이 붙인 별칭이다. 전성기 Arsenal의 빠른 패스, 기술적 조합, 침투와 즉흥적 연계를 묘사하지만 Wenger의 여러 시기·포메이션을 하나로 묶지는 않는다.', sources: [['The Guardian: Wengerball 별칭의 의미', 'https://www.theguardian.com/football/2018/apr/20/arsene-wenger-arsenal-miracle-worker-lost-his-touch'], ['Premier League: Invincibles의 빠른 패스와 팀 모델', 'https://www.premierleague.com/en/news/2738718']] },
      { name: '점유율 축구 (Possession football)', detail: '공을 유지해 상대의 압박을 움직이고, 공격을 전개하거나 수비 전환의 위험을 관리하려는 접근이다. 점유율 수치가 높다고 공격 기회나 경기 통제가 자동으로 좋아지는 것은 아니며, 전진 의도와 공을 잃었을 때의 대비를 같이 비교한다.', sources: [['The FA: 스페인·Barcelona의 점유와 전환 패스', 'https://www.thefa.com/bootroom/resources/coaching/how-spain-and-barcelona-play'], ['FIFA: 경기 국면과 전술 행동', 'https://www.fifatrainingcentre.com/en/game/game-analysis/landing-page-core-principles.php']] },
      { name: '릴레이셔니즘 (Relationism)', detail: '고정된 구역 점유보다 공 주변 선수들의 관계·상호작용과 순간적인 움직임을 중시하는 신흥 전술 담론이다. 포지션 플레이의 단순한 반대말로 합의된 정의가 있는 것은 아니며, 실제 경기별 분류도 논쟁 중이므로 앱은 별도의 검증된 경기 태그를 만들지 않는다.', sources: [['Journal of Sports Sciences: 관계적 움직임과 전술 구조 논의', 'https://doi.org/10.1080/02640414.2023.2288979']] },
      { name: '조나 미스타 (Zona Mista)', detail: '1970–80년대 이탈리아에서 발전한 혼합 수비·역할 모델이다. Bearzot의 이탈리아는 수비에서 대인마크와 리베로를 활용하면서 중원부터는 지역 점유와 더 자유로운 연계를 섞었다. 단순히 낮은 블록을 뜻하지 않는다.', sources: [['Treccani: Bearzot와 zona mista', 'https://www.treccani.it/enciclopedia/calcio-la-storia-del-calcio_%28Enciclopedia-dello-Sport%29/']] },
    ] },
    { title: '공격 전개 패턴', items: [
      { name: '라볼피아나 (La Salida Lavolpiana)', detail: '후방 전개 때 수비형 미드필더가 센터백 사이로 내려와 임시 3인 첫 줄을 만들고, 센터백이 넓어지며 풀백은 더 높은 위치를 잡는 패턴이다. 첫 압박선에서 수적 우위를 노리는 빌드업 방식이며, 모든 후방 3인 전개가 라볼피아나인 것은 아니다.', sources: [['World Class Coaching: La Volpe build-up pattern', 'https://wcctrainingcenter.com/build-up-from-the-back-tactical-analysis-part-three/'], ['Mediotiempo: Ricardo La Volpe의 모델', 'https://www.mediotiempo.com/futbol/que-es-el-lavolpismo-como-juegan-equipos-de-ricardo-la-volpe']] },
      { name: '3-2 빌드업 (3-2 build-up)', detail: '공격 전개 때 첫 줄에 세 명, 그 앞에 두 명을 두는 구조를 설명한다. 압박을 넘길 패스 선택과 공을 잃었을 때의 후방 균형을 동시에 만들 수 있지만 상대의 압박 배치에 따라 구조를 바꿔야 한다. 포메이션이나 수비 블록의 이름은 아니다.', sources: [['UEFA: Dortmund·Manchester City의 3-2-2-3 전개', 'https://www.uefa.com/uefachampionsleague/news/028c-1ab88d1dbff7-a3a7970115ff-1000--insights-in-game-management/']] },
      { name: '롱볼·직접 전개 / Kick-and-rush / “뻥축구”', detail: '롱볼은 먼 거리 패스로 압박을 건너뛰거나 전방 공간·타깃을 노리는 전개 방식이다. 세컨드볼을 누가 회수하는지까지 포함되며, 목적 있는 직접 패스와 통제되지 않은 걷어내기는 구분해야 한다. “뻥축구”는 보통 비판적 표현이다.', sources: [['Premier League·Opta: 2025/26 롱볼 전술 분석', 'https://www.premierleague.com/en/news/4449990/analysis-why-long-balls-are-proving-so-effective-against-liverpool'], ['직접 공격 전술의 경기 자료 연구', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11491368/']] },
    ] },
    { title: '수비 체계·행동', items: [
      { name: '게겐프레싱 (Gegenpressing / counter-press)', detail: '공을 잃은 직후 가까운 선수들이 공과 가까운 패스 선택지를 압박하고, 동료들이 주변 공간을 좁혀 공을 되찾거나 상대의 역습을 늦추려는 수비 전환 행동이다. 압박에 실패하면 재정렬·후퇴가 필요하며, 항상 높은 블록을 유지한다는 뜻은 아니다.', sources: [['FIFA Training Centre: 공을 잃은 직후의 역압박', 'https://www.fifatrainingcentre.com/en/game/game-analysis/transition-to-defending/the-reaction-to-losing-the-ball.php']] },
      { name: '카테나치오 (Catenaccio)', detail: '특히 Helenio Herrera의 Inter와 연결되는 역사적 수비 체계다. 리베로가 최종 수비를 보완하고 대인마크와 깊은 수비를 바탕으로 공을 되찾은 뒤 빠른 역습을 노렸다. “낮은 블록”이나 “버스 세우기”와 같은 말로 바꿔 쓸 수 없다.', sources: [['UEFA: Inter 1962–67과 카테나치오', 'https://www.uefa.com/uefachampionsleague/news/0253-0d7ff54821f7-e2055930d1e0-1000--the-greatest-teams-of-all-time-inter-1962-67/']] },
      { name: '버스 세우기 (Park the bus)', detail: '수비수를 깊고 촘촘하게 배치하는 극단적 저블록을 가리키는 구어적 표현이다. 중앙·박스 공간을 막고 공을 빼앗은 뒤 역습 출구를 찾을 수 있다. 모든 저블록이 극단적이거나 소극적인 것은 아니다.', sources: [['Minnesota United: 저블록과 park the bus', 'https://www.mnufc.com/news/understanding-game-parking-bus']] },
      { name: '두 줄 수비 (Two banks)', detail: '미드필더선과 수비선처럼 두 개의 조직된 선이 간격을 맞춰 이동하는 일반적 수비 모양이다. 흔한 4-4-2 외에도 여러 인원 배치가 가능하고, 중블록이나 저블록에서 모두 볼 수 있다.', sources: [['UEFA: Villarreal의 4-4-2 두 줄 수비', 'https://www.uefa.com/uefachampionsleague/news/0274-1506d5bc16a6-e6eeb2f56e31-1000--in-the-zone-liverpool-2-0-villarreal-performance-analysis/']] },
    ] },
    { title: '전술 체계가 아닌 속어·행위 평가', items: [
      { name: '늪 축구', detail: '한국 언론이 경기 양상을 비유할 때 쓰는 비공식 표현이다. 상대의 경기력을 끌어내리거나 양 팀 경기가 답답하게 흐르는 모습을 두루 가리켜 뜻이 일정하지 않으므로, 분석에서는 실제 저블록·압박·공격 전개를 따로 기술한다.', sources: [['StarNews: 한국형 늪 축구 용례', 'https://www.starnewskorea.com/sports/2015/01/21/2015012117364854008']] },
      { name: '침대 축구', detail: '선수가 시간을 끌기 위해 과장된 부상 호소나 재개 지연을 한다고 비판할 때 쓰는 속어다. 부상 치료·정당한 경기 운영과 구분해야 하고, 전술 구조가 아니다. IFAB 규칙은 지연 행위와 경기 중단 시간을 별도로 다룬다.', sources: [['IFAB: 2026/27 경기 규칙 개정', 'https://www.theifab.com/law-changes/latest/'], ['IFAB Laws of the Game documents', 'https://www.theifab.com/documents/']] },
      { name: '할리우드 액션 (Simulation)', detail: '접촉이나 파울을 당한 것처럼 심판을 속이려는 시뮬레이션을 가리킨다. 전술이 아니라 경기 규칙상 제재 대상인 비신사적 행위다.', sources: [['IFAB Law 12: Fouls and Misconduct', 'https://www.theifab.com/laws/latest/fouls-and-misconduct/']] },
      { name: '안티 풋볼 (Anti-football)', detail: '경기를 지루하고 지나치게 수비적이라고 평가하는 주관적·비판적 말이다. 공식 전술 분류가 아니며, 구체적으로 설명할 때는 저블록·시간 지연·역습·파울 같은 관찰 가능한 행동을 나눠 적는다.', sources: [['The Guardian: Chelsea–Barcelona 전술 논쟁 사례', 'https://www.theguardian.com/football/blog/2012/apr/25/plan-b-barcelona-chelsea']] },
    ] },
  ];
  function appendSoccerTacticGuide(parent) {
    const details = el('details', '', { id: 'soccerTacticsGuide' });
    details.append(el('summary', '사진 속 축구 용어 19개: 분류와 자세한 설명'));
    details.append(el('p', '사진의 높은·낮은 수비 블록 구분은 정확한 분류가 아닙니다. 공격·빌드업 아이디어, 수비 행동, 역사적 팀 모델, 구어적 평가가 한 목록에 섞여 있고, 한 팀도 공 소유·수비 국면에 따라 서로 다른 형태를 씁니다.'));
    for (const groupData of SOCCER_TACTIC_GROUPS) {
      const group = el('section', '', { className: 'classroom-item' });
      group.append(el('h5', groupData.title));
      for (const tactic of groupData.items) {
        const item = el('article', '', { className: 'classroom-item' });
        item.append(el('h6', tactic.name), el('p', tactic.detail));
        const refs = el('p', '출처: ');
        tactic.sources.forEach(([label, href], index) => {
          if (index) refs.append(' · ');
          refs.append(el('a', label, { href, target: '_blank', rel: 'noopener noreferrer' }));
        });
        item.append(refs); group.append(item);
      }
      details.append(group);
    }
    const research = el('a', '조사 기준·용어별 추가 참고자료', { href: './docs/soccer-tactics-reference.md', target: '_blank', rel: 'noopener noreferrer' });
    details.append(el('p', '실제 경기 사례 검색은 기사나 경기 분석에 확인되는 사례만 씁니다. 역사적 용어나 속어만으로 구체적 장면을 만들어 추천하지 않습니다.'), research);
    parent.append(details);
  }
  function field(parent, title, id, type = 'text', value = '') { const label = el('label', title), node = el('input', '', { id, type, value, maxLength: 4096 }); label.append(node); parent.append(label); return node; }
  function choice(parent, title, id, values) { const label = el('label', title), node = el('select', '', { id }); for (const [value, text] of values) node.append(el('option', text, { value })); label.append(node); parent.append(label); return node; }
  function consent(parent, title, id) { const node = field(parent, title, id, 'checkbox'); node.checked = false; return node; }
  function render(ui, parent, item, classId) {
    const box = el('section', '', { className: 'classroom-item', id: 'tacticsConnectedTools' }); parent.append(box);
    box.append(el('h4', '전술판 기기 간 공유 · 경기 사례 찾기'), el('p', '공유에는 익명 도형 배치만 포함하고 판 이름·회고·스냅샷·학생 정보는 제외합니다. 서버에는 암호화한 배치를 24시간 보관합니다. 초대를 받은 사람은 해당 권한으로 접근할 수 있어요. 로컬 학급 삭제와 서버 공유 종료는 별도입니다.'));
    const defaultServer = location.hostname === 'appassets.androidplatform.net'
      ? '' : (location.protocol === 'https:' ? location.origin : 'http://127.0.0.1:8788');
    const server = field(box, '전술판 공유 서버 주소', 'tacticsServer', 'url', item.share?.server || ui.tacticsServerOrigin || defaultServer);
    const admin = field(box, '서버 관리자 비밀값 (새 공유·사례 비교자료 관리, PIN과 별개)', 'tacticsAdmin', 'password', ui.tacticsAdminToken || '');
    admin.autocomplete = 'off'; admin.addEventListener('input', () => { ui.tacticsAdminToken = admin.value; }); server.addEventListener('input', () => { ui.tacticsServerOrigin = server.value; });
    const status = el('p', '', { id: 'tacticsNetworkStatus', role: 'status' }); box.append(status);
    const validAccess = () => ui.access().unlocked && !document.hidden && parent.isConnected && ui.classId === classId;
    function button(host, title, id, action) {
      const b = el('button', title, { id, type: 'button', className: 'secondary-button' });
      b.addEventListener('click', async () => {
        if (!validAccess() || b.disabled) return;
        if (ui.busy) { status.textContent = '로컬 배치를 저장하는 중이에요. 저장이 끝난 뒤 다시 눌러 주세요.'; return; }
        b.disabled = true; status.textContent = '처리 중…';
        const access = ui.access(), epoch = ui.epoch, controller = new AbortController();
        ui.tacticsRequest?.abort(); ui.tacticsRequest = controller; void refreshDeviceStatus();
        const valid = () => validAccess() && ui.access().key === access.key && ui.epoch === epoch && !controller.signal.aborted;
        const guard = () => { if (!valid()) throw new Error('교사 잠금 또는 화면 변경으로 작업을 중단했어요.'); };
        try { await action({ signal: controller.signal, guard, valid }); }
        catch (error) { if (valid()) status.textContent = error.message; }
        finally { if (b.isConnected) b.disabled = false; if (ui.tacticsRequest === controller) ui.tacticsRequest = null; if (controller.signal.aborted && validAccess() && b.isConnected && (id === 'tacticsDeviceInstall' || id === 'tacticsAiSuggest')) progress.textContent = '작업을 취소하고 정리를 마쳤어요.'; if (b.isConnected) void refreshDeviceStatus(); }
      }); host.append(b); return b;
    }
    const credentials = () => { const token = admin.value || item.share?.writeToken; if (!token) throw new Error('관리자 비밀값 또는 공유 편집 권한이 필요해요.'); return token; };
    const origin = () => S.serverUrl(item.share?.server || server.value);
    const invitationOutput = el('div', '', { id: 'tacticsInviteOutput' }); box.append(invitationOutput);
    function showInvite(role) {
      const code = S.invitation(item.share, role); invitationOutput.replaceChildren();
      const label = el('label', `${role === 'edit' ? '편집' : '읽기 전용'} 초대 (신뢰하는 수업 참여자에게만 전달)`), text = el('textarea', '', { readOnly: true, value: code, id: 'tacticsInviteCode' }); label.append(text); invitationOutput.append(label);
      if (root.qrcode) { const qr = root.qrcode(0, 'L'); qr.addData(code); qr.make(); invitationOutput.append(el('img', '', { alt: '전술판 공유 권한 QR', className: 'tactics-share-qr', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ scalable: true }))}` })); }
    }
    if (!item.share) button(box, '현재 배치로 암호화 공유 만들기', 'tacticsShareCreate', async ({ signal, guard, valid }) => {
      const shared = await S.create(server.value, admin.value, item.board, signal); guard();
      await ui.write(s => { const current = s.tacticsBoards.find(row => row.id === item.id && row.classId === classId); if (!current) throw new Error('전술판이 삭제됐어요.'); current.share = shared; }, { signal, validate: valid });
      ui.tacticsServerOrigin = server.value; await ui.renderTeacher(); ui.notice('공유를 만들었어요. 읽기 또는 편집 초대를 선택해 전달해 주세요.');
    });
    else {
      box.append(el('p', `공유 버전 ${item.share.version} · ${item.share.writeToken ? '편집 가능' : '읽기 전용'} · ${new Date(item.share.expiresAt).toLocaleString('ko-KR')} 만료`));
      button(box, '읽기 전용 초대 보기', 'tacticsShareReadInvite', async () => { showInvite('read'); status.textContent = '초대에는 접근 권한과 복호화 키가 들어 있어요.'; }).disabled = !item.share.readToken;
      button(box, '편집 초대 보기', 'tacticsShareEditInvite', async () => { showInvite('edit'); status.textContent = '편집 초대를 받은 참여자는 수정·공유 종료도 할 수 있어요.'; }).disabled = !item.share.writeToken;
      button(box, '내 배치 변경을 공유 서버에 올리기', 'tacticsSharePublish', async ({ signal, guard, valid }) => {
        const result = await S.publish(item.share, item.board, signal); guard();
        await ui.write(s => { const current = s.tacticsBoards.find(row => row.id === item.id && row.classId === classId); if (!current?.share || current.share.id !== item.share.id) throw new Error('공유 상태가 바뀌었어요.'); current.share.version = result.version; }, { signal, validate: valid });
        await ui.renderTeacher(); ui.notice(result.recovered
          ? `서버에서 같은 배치를 확인했어요. 공유 버전 ${result.version}에 연결했어요.`
          : `공유 버전 ${result.version}으로 저장했어요.`);
      }).disabled = !item.share.writeToken;
      button(box, '최신 공유 배치를 새 전술판으로 불러오기', 'tacticsSharePull', async ({ signal, guard, valid }) => {
        const result = await S.read(item.share, signal); guard(); await importBoard(result.board, { ...item.share, version: result.version, expiresAt: result.expiresAt }, signal, valid);
      });
      button(box, '이 전술판 서버 공유 종료', 'tacticsShareRevoke', async ({ signal, guard, valid }) => {
        if (!confirm('초대를 가진 모든 기기의 공유 접근을 종료할까요? 각 기기에 이미 받은 사본은 유지됩니다.')) return;
        await S.revoke(item.share, signal); guard();
        await ui.write(s => { const current = s.tacticsBoards.find(row => row.id === item.id && row.classId === classId); if (current) delete current.share; }, { signal, validate: valid });
        await ui.renderTeacher(); ui.notice('서버의 공유 배치를 삭제했어요. 이 기기의 배치는 유지됩니다.');
      }).disabled = !item.share.writeToken;
      button(box, '이 로컬 사본의 공유 연결만 해제', 'tacticsShareDetach', async ({ signal, valid }) => {
        if (!confirm('이 기기의 공유 연결만 해제할까요? 서버의 배치와 다른 기기의 접근은 만료 또는 공유 종료 전까지 유지됩니다.')) return;
        await ui.write(s => { const current = s.tacticsBoards.find(row => row.id === item.id && row.classId === classId); if (current) delete current.share; }, { signal, validate: valid });
        await ui.renderTeacher(); ui.notice('로컬 연결을 해제했어요. 배치를 보존했으며 새 공유를 만들 수 있어요.');
      });
    }
    async function importBoard(board, share, signal, valid) {
      let id;
      await ui.write(s => { id = crypto.randomUUID(); s.tacticsBoards.push({ id, classId, title: `공유 전술판 ${share.version}`, board: T.anonymousLayout(board), share, createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }); }, { signal, validate: valid });
      ui.tacticsBoardId = id; await ui.renderTeacher(); ui.notice('공유 배치를 새 로컬 전술판으로 저장했어요. 이전 배치는 그대로 남아 있어요.');
    }
    const invite = field(box, '다른 기기에서 받은 전술판 초대 내용', 'tacticsJoinCode');
    button(box, '초대 배치를 새 전술판으로 가져오기', 'tacticsShareJoin', async ({ signal, guard, valid }) => { const result = await S.join(invite.value.trim(), signal); guard(); await importBoard(result.board, result.share, signal, valid); });
    box.append(el('h4', '경기 사례 찾기 · AI 전술 제안 정식 지원 미구현'), el('p', '팀의 요청과 비슷한 실제 경기 사례를 출처와 함께 보여줍니다. 사례는 팀이 전술 대안을 토론하는 데 사용합니다. 자료 검색은 모델 설치 없이 이용할 수 있고, 선택한 경우 기기 모델이 등록된 후보 중 비교할 사례를 고릅니다. 관련 출처가 없으면 찾지 못했다고 표시합니다. AI 기능과 기본 사례 자료는 시범 검토용입니다. 학교 공유 서버는 전술판 공유를 처리합니다.'));
    const mode = choice(box, '사례 비교 방식', 'tacticsAiMode', [['device', '이 기기에서 실행 (기본)'], ['server', '지정한 로컬 서버에서 실행']]);
    const devicePanel = el('section', '', { className: 'classroom-item', id: 'tacticsDevicePanel' }); box.append(devicePanel);
    devicePanel.append(el('p', '처음 설치할 때 모델 약 2GB를 다운로드합니다. 여유 저장 공간과 충분한 메모리가 필요하며 기기에 따라 생성에 매우 오래 걸리거나 지원되지 않을 수 있습니다. 설치 후 질문과 학생 이름은 외부로 보내지 않습니다.'), el('p', '이 모델은 비상업적 연구·평가 용도이며 상업적 사용에는 별도 허가가 필요합니다. '));
    devicePanel.lastChild.append(el('a', '모델 라이선스 확인', { href: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct', target: '_blank', rel: 'noopener noreferrer', id: 'tacticsDeviceLicense' }));
    const deviceStatus = el('p', '기기 지원 및 설치 상태 확인 중…', { id: 'tacticsDeviceStatus', role: 'status' }); devicePanel.append(deviceStatus);
    const progress = el('p', '', { id: 'tacticsDeviceProgress', role: 'status' }); devicePanel.append(progress);
    const advisor = () => { if (!root.TacticsLocalAdvisor) throw new Error('기기 내 실행 도구를 불러오지 못했어요. 앱을 다시 열어 주세요.'); return root.TacticsLocalAdvisor; };
    async function refreshDeviceStatus() {
      try {
        const state = await advisor().status();
        if (!devicePanel.isConnected) return;
        deviceStatus.textContent = !state.supported ? `이 기기에서 사용할 수 없어요: ${state.reason || '브라우저 또는 저장 공간을 확인해 주세요.'}` : state.installed ? `모델이 설치되어 있어요. 기기에서 사례를 비교할 수 있습니다.${state.warm ? ' AI 메모리가 준비되어 있어 잠시 재사용할 수 있어요.' : ''}` : '모델이 설치되지 않았어요. 설치를 눌러 다운로드해 주세요.';
        if (state.model?.licenseUrl) devicePanel.querySelector('#tacticsDeviceLicense').href = state.model.licenseUrl;
        install.disabled = Boolean(ui.tacticsRequest) || !state.supported || state.installed; remove.disabled = Boolean(ui.tacticsRequest) || !state.installed;
      } catch (error) { if (devicePanel.isConnected) deviceStatus.textContent = `상태를 확인하지 못했어요: ${error.message}`; }
    }
    const showProgress = info => { if (!devicePanel.isConnected) return; const amount = info.phase === 'download' && info.total ? ` (다운로드 ${Math.round(info.received / info.total * 100)}%)` : ''; progress.textContent = (info.message || '처리 중…') + amount; };
    const install = button(devicePanel, '기기에 모델 설치', 'tacticsDeviceInstall', async ({ signal, guard }) => {
      try { await advisor().install({ signal, onProgress: showProgress }); guard(); progress.textContent = '설치를 마쳤어요.'; } finally { await refreshDeviceStatus(); }
    });
    const remove = button(devicePanel, '기기에서 모델 삭제', 'tacticsDeviceRemove', async ({ guard }) => {
      if (!confirm('이 기기에 설치된 모델을 삭제할까요? 다시 사용하려면 다운로드해야 합니다.')) return;
      await advisor().remove(); guard(); progress.textContent = '기기에 설치된 모델을 삭제했어요.'; await refreshDeviceStatus();
    });
    devicePanel.append(el('p', 'AI 메모리를 비워도 설치된 모델 파일은 삭제되지 않습니다. 다시 사용할 때 준비 시간이 필요할 수 있습니다.'));
    const release = el('button', 'AI 메모리 비우기', { id: 'tacticsDeviceRelease', type: 'button', className: 'secondary-button' }); devicePanel.append(release);
    release.addEventListener('click', async () => { ui.tacticsRequest?.abort(); release.disabled = true; progress.textContent = 'AI 메모리를 비우는 중이에요.'; try { await advisor().release(); progress.textContent = 'AI 메모리를 비웠어요. 설치된 모델 파일은 유지됩니다.'; await refreshDeviceStatus(); } catch (error) { progress.textContent = `AI 메모리를 비우지 못했어요: ${error.message}`; } finally { release.disabled = false; } });
    const cancel = el('button', '설치 또는 생성 취소', { id: 'tacticsDeviceCancel', type: 'button', className: 'secondary-button' }); devicePanel.append(cancel);
    cancel.addEventListener('click', () => { ui.tacticsRequest?.abort(); progress.textContent = '취소 요청 중이에요. 모델 정리가 끝날 때까지 기다려 주세요.'; void refreshDeviceStatus(); });
    mode.addEventListener('change', () => { ui.tacticsRequest?.abort(); if (mode.value !== 'device') void Promise.resolve().then(() => root.TacticsLocalAdvisor?.release?.()).catch(() => {}); devicePanel.hidden = mode.value !== 'device'; });
    const observer = new MutationObserver(() => { if (!parent.isConnected || !box.isConnected) { ui.tacticsRequest?.abort(); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); } });
    const onVisibility = () => { if (document.hidden) ui.tacticsRequest?.abort(); };
    observer.observe(document.documentElement, { childList: true, subtree: true }); document.addEventListener('visibilitychange', onVisibility);
    void refreshDeviceStatus();
    const sport = choice(box, '종목', 'tacticsAiSport', [['basketball', '농구'], ['volleyball', '배구'], ['soccer', '축구'], ['teeball', '티볼'], ['dodgeball', '피구']]);
    const sportInfo = el('div', '', { id: 'tacticsAiSportInfo', className: 'classroom-item' });
    const sportDescriptions = {
      basketball: ['농구는 FIBA·NBA 경기 분석을 바탕으로 한 사례 자료가 있습니다. 모든 항목은 교사·코치 검토 전 초안입니다.'],
      volleyball: ['배구는 VNL·국가대표·프로리그 경기 분석을 바탕으로 한 사례 자료가 있습니다. 모든 항목은 교사·코치 검토 전 초안입니다.'],
      soccer: ['축구는 FIFA·UEFA의 실제 경기 분석 사례 30개와 사진 속 용어 19개의 분류·출처 설명을 제공합니다. 사례와 요약은 교사·코치 검토 전 초안입니다.'],
      teeball: ['티볼은 일본 지역·리틀리그 팀의 실제 경기 기록 4개를 팀 사례로 제공합니다. 외야 위치 조정, 태그업 송구와 득점 흐름을 다루며, 대회·연령별 규칙이 달라 학교 규칙과 먼저 비교해야 합니다. 모든 항목은 팀·현장 기록을 바탕으로 한 교사·코치 검토 전 초안입니다.'],
      dodgeball: ['피구는 스웨덴 혼성팀, 미국·캐나다 대표팀, 대학·클럽팀의 실제 경기 사례 6개를 제공합니다. 빠른 전환, 팀 투구, 공 통제, 수적 열세에서의 선택을 서로 다른 대회 기록에서 비교합니다. WDBF·NCDA·지역 클럽의 공 종류와 규칙은 학교 피구와 다를 수 있으며, 모든 항목은 검토 전 초안입니다.'],
    };
    const source = (label, href) => { const link = el('a', label, { href, target: '_blank', rel: 'noopener noreferrer' }); sportInfo.append(' '); sportInfo.append(link); };
    function updateSportInfo() {
      sportInfo.replaceChildren(el('p', sportDescriptions[sport.value][0]));
      if (sport.value === 'soccer') appendSoccerTacticGuide(sportInfo);
      else if (sport.value === 'teeball') {
        source('팀별 경기 사례·출처 카탈로그', './docs/tactics-ai-research-catalog.md#티볼-팀별-실제-경기-사례-초안-4개');
        source('대한티볼협회 경기 영상', 'https://www.koreateeball.or.kr/community/video-list.php');
        source('공식 규칙 자료', 'https://www.koreateeball.or.kr/resources/rules.php');
      } else if (sport.value === 'dodgeball') {
        source('팀별 경기 사례·출처 카탈로그', './docs/tactics-ai-research-catalog.md#피구-팀별-실제-경기-사례-초안-6개');
        source('WDBF 선수 전술 프레임워크', 'https://learn.worlddodgeballfederation.com/wp-content/uploads/2024/12/WDBF-Player-Development-Framework.pdf');
        source('WDBF 규칙 안내', 'https://worlddodgeballfederation.com/rules/');
      }
    }
    updateSportInfo();
    sport.addEventListener('change', () => {
      updateSportInfo();
    });
    box.append(sportInfo);
    const goal = choice(box, '사례를 비교할 관점 (선택)', 'tacticsAiGoal', [['overall', '팀 설명 전체'], ['spacing', '간격·공간'], ['passing', '패스 경로'], ['defense', '수비 위치']]);
    const requestLabel = el('label', '팀에서 찾고 싶은 경기 상황을 설명해 주세요. (1,000자 이내)');
    const request = el('textarea', '', { id: 'tacticsAiRequest', maxLength: 1000, rows: 4, placeholder: '예: 우리 팀이 공을 잃은 직후 상대 역습을 자주 허용합니다. 공을 되찾은 팀이 어떤 간격으로 반응했는지 실제 경기 사례를 비교하고 싶어요.' }); requestLabel.append(request); box.append(requestLabel);
    box.append(el('p', '학생 이름·번호, 연락처, 학교·팀 식별정보 없이 전술 상황만 적어 주세요. 현재 학급 학생 이름과 식별번호 형식, 연락처는 보내기 전에 확인합니다.'));
    const permitted = consent(box, '익명 도형 배치·종목·비교 관점·팀 요청 문장만 지정한 로컬 LLM 서버로 보내 실제 경기 사례를 찾습니다.', 'tacticsAiConsent');
    permitted.parentElement.hidden = true;
    mode.addEventListener('change', () => { permitted.parentElement.hidden = mode.value !== 'server'; });
    const output = el('div', '', { id: 'tacticsAiOutput' }); box.append(output);
    mode.addEventListener('change', () => { output.replaceChildren(); progress.textContent = ''; status.textContent = ''; });
    for (const node of [sport, goal, request]) node.addEventListener('input', () => { ui.tacticsRequest?.abort(); output.replaceChildren(); status.textContent = '입력이 바뀌었어요. 자료를 다시 찾아 주세요.'; });
    const runComparison = async (useModel, { signal, guard, valid }) => {
      if (mode.value === 'server' && !permitted.checked) throw new Error('로컬 LLM 전송 범위를 먼저 확인해 주세요.');
      const teamRequest = request.value.trim();
      if (!teamRequest) throw new Error('팀에서 찾고 싶은 경기 상황을 설명해 주세요.');
      const knownNames = (ui.state.students || []).filter(student => student.classId === classId).map(student => student.name?.trim()).filter(name => name && name.length >= 2);
      if (knownNames.some(name => teamRequest.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) throw new Error('요청 문장에 현재 학급 학생 이름이 있어요. 익명 토큰을 기준으로 상황만 적어 주세요.');
      const input = { sport: sport.value, goal: goal.value, request: teamRequest, ...(mode.value === 'server' ? { board: T.anonymousLayout(item.board), ...(item.share ? { shareId: item.share.id } : {}) } : {}) };
      const serverMode = mode.value === 'server', serverOrigin = serverMode ? origin() : null, token = serverMode ? credentials() : null;
      if (!serverMode && useModel) { await runComparison(false, { signal, guard, valid }); guard(); }
      const result = serverMode ? await S.request(serverOrigin, '/suggestions', { token, body: input, signal }) : useModel ? await advisor().suggest(input, { signal, onProgress: showProgress }) : await advisor().search(input); guard();
      const latest = ui.state.tacticsBoards.find(row => row.id === item.id && row.classId === classId);
      if (!latest || (serverMode && JSON.stringify(T.anonymousLayout(latest.board)) !== JSON.stringify(input.board))) throw new Error('배치가 바뀌어 이전 배치의 사례를 표시하지 않았어요. 다시 요청해 주세요.');
      const modelNotice = () => {
        const lines = [result.cases.length ? '기기 AI가 실행되어 비교할 사례를 선택했어요.' : '기기 AI가 실행되었지만 사례를 선택하지 않았어요. 기존 자료 검색 결과는 그대로 남아 있어요.'];
        if (result.modelCoverage) lines.push(`AI 검토 범위: 검색된 ${result.modelCoverage.retrieved}개 중 ${result.modelCoverage.shown}개를 모델에 보여 주었어요. 모든 검색 결과를 검토한 것은 아닐 수 있어요.`);
        if (result.comparisonLimit) lines.push(`AI 비교 한계: ${result.comparisonLimit}`);
        for (const line of lines) output.append(el('p', line));
      };
      if (!serverMode && useModel && !result.cases.length) {
        if (result.modelAttempted || result.modelUsed) { modelNotice(); status.textContent = 'AI가 사례를 선택하지 않았어요. 기존 자료 검색 결과는 그대로 남아 있어요.'; }
        else status.textContent = '일치하는 자료가 없어 AI를 호출하지 않았어요.';
        return;
      }
      output.replaceChildren(el('p', serverMode ? `서버 모델 비교 초안 (미검토): ${result.model || ''}` : result.modelUsed ? `기기 AI가 자료에서 비교할 사례를 선택했어요: ${result.model}` : '자료에서 찾은 경기 사례'));
      if (!serverMode && result.modelUsed) modelNotice();
      if (serverMode) { const draft = el('details'); draft.append(el('summary', '모델 비교 초안 (미검토) 보기'), el('p', result.summary), el('p', `비교 한계: ${result.comparisonLimit}`)); output.append(draft); } else output.append(el('p', result.summary));
      if (!result.cases.length) {
        output.append(el('p', '등록된 참고자료에서 비교할 경기 사례를 찾지 못했습니다.'));
        if (['teeball', 'dodgeball'].includes(input.sport)) output.append(el('p', input.sport === 'teeball' ? '현재 요청과 어휘상 가까운 티볼 경기 사례를 찾지 못했습니다. 팀 기록은 참고 자료이며 대회별 규칙과 연령 차이를 확인하세요.' : '현재 요청과 어휘상 가까운 피구 경기 사례를 찾지 못했습니다. 대회 형식과 학교 규칙의 차이를 확인하세요.'));
      }
      if (result.cases.length) output.append(el('p', '검색된 카드는 출처 사실 대조를 마친 후보입니다. 교사·코치 검토와 앱 이용 권리는 아직 확인되지 않았으므로 참고 자료로만 살펴보세요.'));
      for (const gameCase of result.cases) {
        const row = el('section', '', { className: 'classroom-item' }); row.dataset.caseId = gameCase.id;
        const gradeLabel = gameCase.candidateGrade === 'A' ? '특정 장면 후보' : '경기 흐름 요약';
        row.append(el('h4', `경기 사례: ${gameCase.title}`), el('p', gameCase.pilotMaterialReviewStatus === 'accepted' ? `자료 상태: 사용자 시범 수용 · 기사 기재 내용 대조 · 부분 관련 · 교사·전문가 검토 대기${gameCase.sourceSport === 'baseball' ? ' · 야구 원본과 티볼 공통 기술 비교' : ''}` : `자료 상태: 출처 대조 완료 · ${gradeLabel} · 교사·코치 검토 전 초안`), el('p', `자료에 기록된 경기 내용: ${gameCase.observed}`), el('p', `조건·맥락: ${gameCase.context}`));
        if (serverMode && gameCase.similarity) { const draft = el('details'); draft.append(el('summary', '모델 비교 초안 (미검토)'), el('p', gameCase.similarity)); row.append(draft); }
        else if (gameCase.similarity) row.append(el('p', gameCase.similarity));
        if (gameCase.relevance) {
          const labels = {relay:'중계',throw:'송구·투구',pass:'패스',receive:'받기',backup:'백업',movement:'이동',position:'위치',spacing:'간격',direction:'방향',communication:'의사소통',defense:'수비',attack:'공격',rebound:'리바운드',transition:'전환',shot:'슛',screen:'스크린',buildup:'빌드업',evade:'회피',catch:'캐치',regroup:'재정비',collision:'충돌',save:'공 살리기',corner:'코너킥',freekick:'프리킥',header:'헤더',advantage:'점수 동점·역전',set:'세트',serve:'서브',hit:'타격',running:'주루',possession:'점유', player_advantage:'수적 우위', player_disadvantage:'수적 열세', timeout:'타임아웃', overtime:'연장전', late_stage:'종료 직전', role_assignment:'역할 조정', lineup_selection:'선수 구성·기용', ball_loss:'공 소유 상실', uncertainty:'혼선', ball_recovery:'공 되찾기', third_man:'제3자 연결', run_into_space:'공간 침투', drop_back:'내려오기', corner_area:'코트 가장자리', position_hold:'위치 유지', full_court_press:'전면·풀코트 압박', high_press:'전방 압박', between_lines:'라인 사이', serve_disrupt:'서브에 의한 리시브 흔들림', backcourt_dig:'후위 수비 받기', outfield_reposition:'외야 위치 변경', force_choice:'포스아웃 선택', base_choice:'송구할 베이스 선택', recovery_return:'회수 후 복귀', game_start:'경기 시작', prior_hitter_adjustment:'앞선 타구에 따른 다음 타석 조정'};
          const show = values => values?.map(value => labels[value] || value).join(' · ') || '없음';
          row.append(el('p', `관련성: ${gameCase.relevance === 'direct' ? '직접 관련' : '부분 관련'} · ${gameCase.relevanceExplanation}`), el('p', `겹친 조건: ${show(gameCase.matchedConditions)} · 성공·실패 등 조건 차이: ${show(gameCase.differingConditions)} · 확인되지 않은 요청 조건: ${show(gameCase.unmatchedConditions)}`), el('p', `규칙 확인: ${gameCase.ruleExplanation}`));
        }
        if (gameCase.scopes?.length) {
          if (gameCase.videoReviewStatus === 'not-viewed') row.append(el('p', '영상은 확인하지 않았습니다. 경기 날짜는 별도로 확인되지 않았을 수 있습니다.'));
          if (gameCase.evidenceLocator) row.append(el('p', `근거 위치: ${gameCase.evidenceLocator}`));
          const details = el('details'); details.append(el('summary', '부분 관련 조건과 관찰 한계 보기'));
          const seenScopes = new Set();
          for (const scope of gameCase.scopes) {
            const key = JSON.stringify([scope.purpose, scope.supported, scope.missing, scope.ruleScope]);
            if (seenScopes.has(key)) continue; seenScopes.add(key);
            details.append(el('p', `${scope.purpose === 'scene-comparison' ? '부분 비교 범위' : '관찰 범위 한계'}: ${scope.supported} · 확인되지 않은 조건: ${scope.missing} · 규칙 범위: ${scope.ruleScope}`));
          }
          row.append(details);
          for (const limit of gameCase.limitations || []) row.append(el('p', `자료 한계: ${limit}`));
        }
        if (gameCase.tacticTags?.length) row.append(el('p', `관찰 분류어: ${gameCase.tacticTags.join(' · ')}`));
        const source = el('a', gameCase.sourceTitle, { href: gameCase.sourceUrl, target: '_blank', rel: 'noopener noreferrer' });
        const sourceLine = el('p', `출처 (${gameCase.reviewStatus === 'teacher-reviewed' ? '교사 검토' : '교사·코치 검토 전 초안'}): `); sourceLine.append(source); row.append(sourceLine);
        output.append(row);
      }
      if (!result.cases.length) { if (!serverMode) output.append(el('p', `비교 한계: ${result.comparisonLimit}`)); status.textContent = '등록된 참고자료에서 관련 경기 사례를 찾지 못했어요.'; return; }
      if (!serverMode) output.append(el('p', `맥락 차이·비교 한계: ${result.comparisonLimit}`));
      output.append(el('p', '여러 사례를 비교 자료로만 활용하세요. 사례의 성패는 해당 경기 조건의 결과이며 정답이나 실행 지시가 아닙니다.'));
      if (serverMode) {
      const reviewed = consent(output, '교사가 출처·경기 기록·요청과의 관련성·비교 한계를 검토했으며 익명 사례 비교 예제로 로컬 서버에 30일 저장합니다.', 'tacticsAiReviewed');
      button(output, '검토한 사례 비교 예제 저장', 'tacticsAiSaveExample', async ({ signal, guard }) => {
        if (!reviewed.checked) throw new Error('출처·경기 기록·맥락을 확인한 사례만 비교 예제로 저장해 주세요.');
        await S.request(serverOrigin, '/training-examples', { token, body: { ...input, advice: result, reviewed: true }, signal }); guard(); status.textContent = '검토한 사례 비교 예제를 저장했어요. 저장만으로 모델이 학습되지는 않습니다.';
      });
      }
      status.textContent = '사례를 정답이나 실행 지시로 보지 말고, 요청 팀과의 공통점·차이를 비교해 주세요.';
    };
    button(box, '모둠 요청 가져오기', 'tacticsTeamImport', async args => {
      const pending = root.TacticsTeamRequest?.consume();
      if (!pending) throw new Error('이 탭에 준비된 모둠 요청이 없어요.');
      mode.value = 'device'; devicePanel.hidden = false; permitted.parentElement.hidden = true; aiSelect.hidden = false; searchCases.textContent = '자료에서 사례 찾기'; output.replaceChildren(); progress.textContent = ''; sport.value = pending.sport; sport.dispatchEvent(new Event('change'));
      goal.value = 'overall'; request.value = pending.request;
      await runComparison(false, args); args.guard();
      const present = new Set([...output.querySelectorAll('[data-case-id]')].map(node => node.dataset.caseId));
      const found = pending.caseIds.filter(id => present.has(id)), missing = pending.caseIds.filter(id => !present.has(id));
      for (const row of output.querySelectorAll('[data-case-id]')) if (found.includes(row.dataset.caseId)) row.prepend(el('p', '모둠이 비교 대상으로 선택한 사례'));
      status.textContent = `모둠 요청을 한 번 가져왔어요. ${pending.caseIds.length ? `선택 사례 ${found.length}개를 현재 자료에서 확인했습니다.${missing.length ? ` ${missing.length}개는 현재 검색 범위에서 확인되지 않아 복원하지 않았어요.` : ''}` : '선택 사례 없이 질문을 가져왔어요.'} 전술판 배치는 바뀌지 않았어요.`;
    });
    const searchCases = button(box, '자료에서 사례 찾기', 'tacticsAiSuggest', args => runComparison(false, args));
    mode.addEventListener('change', () => { searchCases.textContent = mode.value === 'server' ? '서버 모델 비교 초안 요청' : '자료에서 사례 찾기'; });
    const aiSelect = button(box, 'AI로 비교 사례 고르기', 'tacticsAiSelect', args => runComparison(true, args));
    mode.addEventListener('change', () => { aiSelect.hidden = mode.value === 'server'; });
    button(box, '검토한 사례 비교 예제 JSONL 내보내기', 'tacticsAiExportExamples', async ({ signal, guard }) => {
      if (!admin.value) throw new Error('사례 비교 예제 관리에는 서버 관리자 비밀값이 필요해요.');
      const result = await S.request(server.value, '/training-examples', { token: admin.value, signal }); guard();
      const url = URL.createObjectURL(new Blob([result.jsonl], { type: 'application/x-ndjson' })); const link = el('a', '', { href: url, download: 'pe-loop-reviewed-case-comparisons.jsonl' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '검토한 사례 비교 예제를 내보냈어요. 파일을 내려받는 것이 모델 추가 학습을 실행하지는 않습니다.';
    });
    button(box, '로컬 서버 사례 비교 예제 전체 삭제', 'tacticsAiDeleteExamples', async ({ signal, guard }) => {
      if (!admin.value) throw new Error('서버 관리자 비밀값이 필요해요.');
      if (!confirm('로컬 서버의 사례 비교 예제를 모두 삭제할까요? 이미 다운로드한 파일은 별도로 삭제해야 합니다.')) return;
      await S.request(server.value, '/training-examples', { token: admin.value, method: 'DELETE', signal }); guard(); status.textContent = '로컬 사례 비교 예제를 삭제했어요.';
    });
  }
  root.TacticsToolsUI = Object.freeze({ render });
})(globalThis);
