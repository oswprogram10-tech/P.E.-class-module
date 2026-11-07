# S4.5 농구 동작 이력 검증 기록

기록일: 2026-11-06. 검증 범위는 교사 opt-in 로컬 이력, 암호화 기존 저장소 통합, 접근·만료·삭제·연결 경계다. S4.3/4.4 근거는 각각 [동작 감지 기록](stage-S4-shot-validation.md), [피드백 기록](stage-S4-feedback-validation.md)에 분리되어 있다.

## 필수 검증

- `node --test tests/*.test.cjs`: 59 통과, 실패 0, 건너뜀 0. ShotHistory 단위검사는 allowlist·legacy optional state·binding/expiry·parent cascade·7일 cap·2,000개 bound와 clip relation을 확인했다. `tests/shot-history-storage.test.cjs` 4개는 암호화 대기 중 abort/validation false와 put 직전 검증·클립 존재/만료를 transaction double로 확인한다. 이 단위 검사와 아래 실제 IndexedDB 검사를 구분한다.
- 실행 디렉터리는 `/workspace/P.E.-class-module`이다. 기본 sandbox에서는 hub의 loopback listen과 installer의 `zip` 실행이 EPERM으로 막혔다. 같은 전체 단위 명령을 `tools.exec_command`의 `sandbox_permissions: "require_escalated"`로 실행해 59개 통과를 확인했으며, 로컬 브라우저 서버도 필요한 최소 실행 권한을 사용했다. 환경 네트워크 설정을 바꾸거나 게시한 것은 아니다.
- `node tests/browser-shot-history.cjs`: 통과. PIN을 열지 않은 초기 설정은 꺼져 있고, 유효 binding 없이 활성화할 수 없다. 실제 UI로 만든 학급·학생·수업·기기에 연결한 합성 event를 저장하고 기존 classroom encrypted record에서 decrypt해 확인했다. event payload에 넣은 rawFrame·landmarks·studentName·PIN 문자열은 저장 레코드와 암호문 JSON에 남지 않았고 outbox는 비어 있었다. timestamp·ID는 보존됐다.
- 위 브라우저 검사는 stale timestamp·side/evidence 불일치·event=false의 기록도 거부했다. teacher PIN 화면에서 조회하고, 같은 학생·수업·기기 metadata가 암호화된 로컬 클립을 목록에서 직접 선택해 연결했다. 연결 후 outbox 변화는 없었다. 기록을 삭제하면 local shotAttempts 목록에서 사라졌다. 합성 이벤트를 controller에 직접 전달했으며 실제 농구 동작을 수행한 것은 아니다.
- 모델 schema unit은 최대 7일 retention·parent expiry와 삭제 cascade·2,000개 한도·오래된 항목 정리를 확인했다. `browser-shot-history.cjs`는 만료 metadata의 list 제외를 검사했다. 브라우저 suite에서 실제 시간 경과 7일을 기다리지는 않았다.
- `node tests/browser-shot-history-failures.cjs`: 최종 수정 후 Sol 실행과 Luna 독립 재실행 모두 통과. 합성 전신 관절을 실제 PoseUI.receive→Detector→앱 callback으로 처리해 자동 생성된 event.evidence 1건을 암호화 IDB에 저장했다. 별도 근거를 주입한 실패 검사에서는 repository 쓰기에 QuotaExceededError를 유도한 뒤 실제 fake-camera 프레임이 계속 증가했다. 실제 IDB 트랜잭션의 put 직전 validate에서 같은 signal을 abort해 쓰기가 취소되고 기존 1건이 보존됐다. LocalVault 암호화 완료를 지연한 뒤 기록을 끄고 해제했을 때도 새 쓰기가 없었다. 여기서 발견한 이중 tx.abort 예외는 안전하게 처리하도록 고치고 pageerror 없이 재검증했다. 합성 관절과 fake runtime을 사용했으며 실제 스포츠 동작 검사는 아니다.
- Sol의 추가 UI 확인에서도 같은 범위의 암호화 클립을 실제 목록에서 선택해 연결하고, 클립 삭제 후 이력 다시 읽기로 연결 기록이 정리되는 것을 확인했다.
- 기존 회귀 15개 파일도 모두 통과: `browser-vault-migration.cjs`, `browser-reset.cjs`, `browser-data.cjs`, `browser-layout.cjs`, `browser-classroom-flow.cjs`, `browser-classroom-privacy.cjs`, `browser-classroom-reset.cjs`, `browser-classroom-capture.cjs`, `browser-camera.cjs`, `browser-clips.cjs`, `browser-smoke.cjs`, `browser-pwa.cjs`, `browser-shot-ui.cjs`, `browser-pose-capture.cjs`, `browser-feedback-real.cjs`. 모두 `node tests/<파일>`로 실행했다. 신규 이력 2개와 합쳐 서로 다른 브라우저 실행 파일 17개이며 반복 실행 횟수를 더한 수가 아니다.
- `browser-feedback-real.cjs`의 실제 모델 온라인/오프라인 연결도 이번에 통과했다. 실제 worker와 정지 사진의 33관절·캡처 입력 시각 일치를 확인하되 피드백 이벤트는 stub이었다. S4.5 이력의 합성 이벤트·IDB 검사와 구분하며 실제 슛 인식 정확도의 근거로 삼지 않는다.

Android 실기기·학교 환경·발열·40분 연속 사용·스포츠 정확도는 별도 조건으로 남긴다. 이력은 성적이나 골 성공 판정이 아니다. 저장 공간 오류는 주입한 예외이며 실제 디스크를 가득 채우지는 않았다. 실제 동시 다기기/다탭 사용의 모든 경합을 열거해 검증한 것은 아니다. 문법·문서 링크·공백 검사도 통과했다.
