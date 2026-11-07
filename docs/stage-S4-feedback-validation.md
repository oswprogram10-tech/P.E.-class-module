# S4.4 피드백 검증 기록

기록일: 2026-11-06. 이 문서는 S4.4의 개발 환경 검증을 기록한다. S4.3의 상태 감지와 한계는 [별도 기록](stage-S4-shot-validation.md)에 보존한다. Android·학교 현장 검증이나 실제 스포츠 정확도 판정은 아니다.

## 검증 항목

- `node --test tests/*.test.cjs`: 49 통과, 실패 0, 건너뜀 0.
- 이번에 통과한 기존 브라우저 10종: `browser-vault-migration.cjs`, `browser-reset.cjs`, `browser-data.cjs`, `browser-layout.cjs`, `browser-camera.cjs`, `browser-clips.cjs`, `browser-smoke.cjs`, `browser-shot-ui.cjs`, `browser-pwa.cjs`, `browser-pose-ui.cjs`. 이와 별도로 아래 신규 3종을 통과했다. 과거 브라우저 suite 전체를 재실행한 기록은 아니다.
- `node tests/browser-shot-feedback.cjs`: 통과. 기본 세 토글 꺼짐·저장되지 않는 세션 옵션, 입력 timestamp/팔/각도의 고정 metadata, 다른 색의 입력 bitmap 픽셀, 같은 timestamp 중복 거부를 확인했다. 캡처 교체·맥락 변경·clear 때 실제 `URL.createObjectURL`/`revokeObjectURL` 호출을 관찰했다. encode 지연 중 맥락만 바꾸거나, 별도로 clear 세대를 바꾼 뒤 완료된 blob은 폐기됐다. AudioContext resume 실패 뒤 fake camera의 stream과 frameHistory가 계속 진행했다.
- `node tests/browser-pose-capture.cjs`: 통과. 서로 다른 화면 프레임 사이에서도 source bitmap 픽셀 `[230,20,40]`와 입력 timestamp를 보존했다. 맥락/설정 reset·불일치·callback 오류·clone 실패·250ms timeout과 늦은 복제 정리를 확인했다. 동시 복제는 최대 1개이며 clone timeout 동안 원본 AI 추론은 계속되고, 늦게 끝난 복제 bitmap은 닫힌다. 이는 fake runtime lifecycle 검사이며 실제 모델 추론은 아니다.
- `node tests/browser-feedback-real.cjs`: clone deadline 변경 뒤 독립 재실행에서도 online/offline 통과. 서비스 워커 reload 뒤 실제 MediaPipe worker를 `PoseUI.sample`에서 실행해 각 320×213 입력에서 33개 관절과 full-body gate 통과를 3회 확인했다. 테스트에서 detector event 하나를 명시적으로 stub한 뒤 앱 캡처를 연결했고 제출·worker·이미지·표시 timestamp가 같았으며 JPEG RGB 평균 절대 오차는 4.0701이었다. pending 결과는 0이었고 이미지 표시 중 active predicate도 true였다. 오프라인 worker 재초기화와 기본 꺼짐 뒤 옵션 켜기도 확인했다. 브라우저 세션에서 외부 요청·POST는 0건이었다.
- 실제 모델 fixture 연결과 offline reload는 PoseUI 입력→worker→앱 피드백 이미지의 같은 프레임 연결 근거다. 정지 fixture에 event를 stub했으므로 실제 운동 인식, SHOT 감지, 실제 슛 이벤트 정확도의 근거는 아니다. 합성 component/fake-runtime 경계 검사와 real-worker bridge 검사는 구별한다.

총수는 위의 서로 다른 브라우저 실행 파일 13개를 뜻하며, 같은 파일의 반복 실행 횟수를 더한 수가 아니다. 문법·문서 상대 링크·공백 검사도 통과했다.

## 미확인 범위

브라우저 합성 프레임과 fixture 검사는 Android 카메라의 정확성·지연·발열·장시간 안정성을 대신하지 않는다. Android 실기기, 학교 환경, 발열, 40분 연속 사용과 스포츠 동작 정확도는 대기 중이다. 자동 영속 저장·업로드·시도/관절 로그는 이 범위에 포함하지 않는다.
