# S4.1~S4.2 구현·검증 기록

이 문서는 S4.1~S4.2 개발 검증의 역사 기록이며 당시 수치·판정을 보존한다. 이후 별도 요청으로 진행한 S4.3 결과는 [S4.3 농구 동작 감지 검증 기록](stage-S4-shot-validation.md)에 있다. 이 기록의 “S4.3 이후 시작하지 않았다” 등은 기록 당시 상태를 뜻한다.

기록일: 2026-11-06 (한국 시간). Linux Chromium·가상 카메라·실제 MediaPipe CPU/WASM worker에서 개발용으로 확인했다. **개발·브라우저 확인은 완료**했으며 Android 태블릿·학교 수업 검증은 별도 대기다. S4.3 이후 범위는 시작하지 않았다.

## 판정

공식 Pose Landmarker Lite float16 v1 모델을 설치하고 모델 카드의 이용조건 근거를 확인했다. 실제 worker의 이미지 추론, 오프라인 재실행, 기본 지연 카메라와 4초 동시 실행, 선택·인코딩의 장면 일치를 확인했다. 전신 gate는 검사 이미지에서 통과하고, 빈 이미지·잘린 전신·저신뢰·화면 밖 좌표에서 설명 가능한 실패를 반환했다.

이 결과는 S4.1~S4.2의 개발용 구현·검증 범위 완료를 뒷받침한다. 학교 Android 기기의 추론 성능·발열·전체 메모리, 40분 연속 사용, 다양한 학생·조명·가림·거리에서의 정확도는 확인하지 않았다. 실기기 확인 전 지원 보장이나 체육 동작 정확도를 주장하지 않는다.

## 자산 출처와 이용조건

- 모델: [공식 Pose Landmarker Lite float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task), 5,777,746 bytes. 설치된 파일 SHA-256은 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`다. 공식 HTTPS와 상속된 proxy/TLS 설정을 사용했다. 이 해시는 로컬에서 계산한 핀이며 제공자가 독립 공개한 digest나 서명을 검증했다는 뜻은 아니다.
- 공식 [Model Card BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)는 Lite·Full·Heavy 모델을 설명하고 “LICENSED UNDER: Apache License, Version 2.0”이라고 표시한다. 카드 날짜는 2021-04-16이며 확인한 PDF의 SHA-256은 `e982460cedece5ad9a46aa8f13523328e9ab95d7d5b2b8c99b33f13f6a79ca86`다. 이 모델 카드는 Lite 모델 가족에 대한 공식 라이선스 근거다. 개별 v1 `.task` 아카이브에는 별도 라이선스 파일이 없고 카드도 아카이브 바이트 해시를 열거하지 않는다. 이 한계는 [자산 기록](pose-assets.json)에 남겼다. SDK Apache-2.0은 별도로 `vendor/pose/LICENSE`에서 확인했으며 모델 근거로 대신 사용하지 않았다.
- 모델 카드의 용도는 모바일·데스크톱·브라우저의 단일 인물 전신 자세 추정과 fitness/repetition counting 등이다. 다중 인물, 머리가 보이지 않는 입력, 약 4m 초과, metric 정확도가 필요한 깊이, 감시·신원 인식은 범위 밖이다. 얼굴 위치·크기·방향, 저조도·노이즈·움직임·얼굴 가림에 따라 품질이 떨어지고 흔들림이 커질 수 있다. 학교 연령 아동이나 농구 자세 판정 정확도를 보증하는 자료는 아니다.
- 시험 이미지는 MediaPipe 샘플 저장소의 Apache-2.0 저장소 루트 아래 파일이다. 파일별 출처 표시는 확인되지 않아 개발 테스트 fixture로만 쓴다. 실제 아동 이미지를 사용하지 않았다.

세부 URL·버전·해시·이용조건 근거와 한계는 [자산 기록](pose-assets.json)에 있다.

## 실행한 검사

- `node --test tests/*.test.cjs`: **39 통과, 0 실패, 0 건너뜀**. sandbox 기본 권한에서 loopback bind와 `zip` 프로세스가 `EPERM`으로 막혀 해당 제한을 해소한 승인 실행으로 전체를 완료했다.
- 독립 브라우저 회귀: `node tests/browser-pose-runtime.cjs`, `node tests/browser-pose-ui.cjs`, `node tests/browser-pwa.cjs`, `node tests/browser-camera.cjs`, `node tests/browser-clips.cjs`, `node tests/browser-smoke.cjs`, `node tests/browser-pose-real.cjs`가 모두 통과했다. 이는 이번에 실제 재실행한 관련 7종이다. 이전 기록의 브라우저 19종 전체를 이번에 다시 실행한 것은 아니다.
- `browser-pose-runtime.cjs`: 설치된 모델로 실제 CPU pose 추론 33개 관절을 확인했다. 합성 캐시 무결성·취소/재시도와 fake worker의 단일 요청·stale/timeout도 검사한다. offline은 이 스크립트에서 fetch 차단으로 모의한 자산 재사용이다. 실제 브라우저 offline 전환·서비스 워커 reload 뒤 모델 재추론은 `browser-pose-real.cjs`에서 별도로 확인했다. fake worker 구간은 실제 모델 결과가 아니다.
- `browser-pose-ui.cjs`: fake runtime으로 준비 실패 후 기본 카메라 사용, 선택·중단·회복·오래된 결과와 음성/자산 정리를 확인했다. 이 UI 검사는 모델 추론 검사가 아니다.
- `browser-pwa.cjs`: offline 재시작 후 PIN, 가상 카메라, 암호화 WebM 저장·재생, 업데이트 대기·상태 일관성·자료 보존 및 캐시/초기 설치 실패 경로를 통과했다.
- `browser-camera.cjs`, `browser-clips.cjs`, `browser-smoke.cjs`: 카메라 권한·중단·재시작, 장면 선택·취소·저장 재시도·실제 시작/중간/끝 장면 일치, 30초 VP8 저장을 통과했다. 이번 smoke 출력은 29.949초였다.
- `browser-pose-real.cjs`: 모델을 worker에서 실행해 fixture의 33개 관절과 전신 gate 통과를 확인했다. 빈 이미지 3회는 매번 0개 관절/missing, 잘린 전신 3회는 33개 관절을 내고도 gate가 out-of-frame으로 거부했다. 낮은 신뢰도·화면 밖 좌표도 거부됐으며 안정 조건의 회복 전이가 확인됐다. offline 설정에서 서비스 워커 reload 후 실제 모델 추론도 통과했다.

## 실제 모델과 기본 카메라 동시 측정

대표 수치는 [기계 판독 측정 기록](S4-real-model-measurement.json)의 Terra 실행이다. Chromium 155 headless, Linux x86_64, fake camera, CPU/WASM에서 기본 카메라만 4초, 실제 모델 worker와 동시에 4초를 실행했다.

| 조건 | 촬영 프레임 | 표시 지연 |
| --- | ---: | ---: |
| AI off, 4초 | 36 | 1,073 ms |
| AI on, 4초 | 36 | 1,091.5 ms |

AI on 구간에 추론 응답 11개가 나왔다. 이것은 11개가 모두 usable 자세였다는 뜻은 아니다. inference 측정 배열의 cold start는 263.6ms이며 이후 표본은 대략 101.6~131.3ms였다. 이 짧은 표본을 일반 기기 성능으로 확대 해석하지 않는다.

worker를 멈춘 뒤 선택·인코딩한 무음 VP8 파일은 5.049초, 640×360이었다. 선택 화면의 0초·2초·4.8초 프레임과 복호화 파일의 해당 프레임 간 RGB 평균 절대 오차는 각각 0.230, 0.349, 0.136이었다. 이는 테스트 장면에서 선택 프레임과 출력 파일이 일치함을 확인한 값이지 모든 장면의 화질 보증이 아니다.

Luna의 독립 재실행에서도 smoke와 실제 모델 suite가 통과했다. 해당 재실행은 4초씩 조건별 37프레임, AI off/on 표시 지연 1,070.6/1,024.6ms, AI worker 결과 11개, 무음 VP8 5.082초를 기록했다. 실행 간 소폭 차이가 있어 대표 기록과 합치지 않았다.

이 측정은 4초 baseline과 4초 동시 조건만 다룬다. 실제 Android·실제 광학 카메라, 40분 연속 사용, 전체 앱/브라우저 메모리, 발열, 배터리, 장기 열화는 미측정이다. 화면 선택·인코딩 중에는 AI가 멈춘다. 원본·관절 데이터의 외부 요청은 관찰된 브라우저 세션에서 없었으나, 이는 일반 네트워크 보안 감사 결과가 아니다.

초기 S4 기록의 HTTP 403과 허용목록 미적용은 당시 환경의 역사적 상태다. 현재 환경 상태에서는 최근 관찰이 유효하고 제한 정책이 적용됐으며 `storage.googleapis.com`이 허용됐다. Sol이 그 환경에서 모델을 설치했다. 이번 작업에서 팀은 환경설정을 바꾸거나 게시하지 않았다.

## 남은 검증과 범위

- 실제 Android 태블릿과 학교 환경에서 설치·오프라인·카메라 동시 사용·발열·메모리·장시간 동작을 확인해야 한다. 기존 40분 촬영 확인도 대기 상태로 유지한다.
- fixture 기반 추론은 모델이 한 장의 사람 이미지를 처리할 수 있음을 보일 뿐, 학생·거리·가림·조명별 인식 정확도나 농구 기술 평가를 검증하지 않는다.
- S4.3 슛 판정, 각도·민감도, 자동 캡처, 시도 로그, 성적 산출은 구현하거나 검증하지 않았다.
- 외부 배포·설정 게시·commit·push는 하지 않았다.
