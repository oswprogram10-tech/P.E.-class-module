# S3 로컬 구현·개발 허브 검증

검증일: 2026-11-06 (한국 시간). Linux Chromium·가상 카메라와 동일 컴퓨터의 실 HTTP loopback 서버를 사용했다. 실제 Android·서로 다른 물리 기기·LAN/HTTPS 배포 검증과 구별한다.

## 구현 범위

| 목표 | 구현·확인한 범위 | 남은 조건 |
| --- | --- | --- |
| S3.1~S3.2 | 학급/학생/수업/모둠/기기/클립/성찰 UUID, 기존 클립 미배정, PIN 암호화 문서·CAS, 기본 7일·삭제·초기화 경계 | 기존 클립 수동 이관 UI 미제공, 장기 보관 미제공 |
| S3.3 | 교사 콘솔의 학급·명단·모둠·수업(단원/종목)·기기 생성과 명시 지정 | 실제 교사 명단 운영 검토 |
| S3.4 | 자기 수업 클립 직접 선택·성찰 포함 선택, 상태·중복 방지, 관찰·학생별 이력, 교사 제출 재생 | 영속 서버 운영 미완료 |
| S3.5 | 실제 QR 생성/1회 참여, 별도 학생/교사 역할, 두 브라우저 context의 별도 PIN/DB, 기기 모드 배포 | 물리 기기·LAN/HTTPS·기기 발견/신뢰 대기 |
| S3.6 | 암호화 offline queue, 실제 HTTP 재전송/응답유실·중복·삭제 tombstone, timeout·부분 실패·CAS 거부 | 허브 RAM 비영속, 서버 중단 후 복구 저장소 없음 |
| S3.7 | 학생 칭찬/텍스트 pending, 교사 승인/숨김, 수업 내 승인 글 공개 | 음성 피드백 미구현(마이크·보관 정책 선행) |

허브는 평문 선택 자료의 RAM 개발 서버다. 로컬 PIN 초기화와 이미 받은 원격 자료 삭제는 별개이며, 실제 학급 서버 배포 완료로 판단하지 않는다. [사용·보관·운영 계약](S3-data-and-sync.md)을 따른다.

## 실행 근거

- `node --test --test-reporter=tap tests/*.test.cjs`: 실제 하위 테스트 **27개 통과**(기존 17, S3 10). 학급/학생 경계·동명/동번호·기존 미배정·중복·7일 보관, 실제 HTTP 역할/토큰/응답유실, timeout 후 다음 항목·재시도를 포함한다.
- `node tests/browser-classroom-flow.cjs`: 교사 UI의 학급→명단→모둠→수업→기기 지정, 암호화 ID, 기존 미배정 제외, QR 발행·참여, offline queued→sent, 학생 글 승인, 닫힘 후 늦은 QR 폐기. 오프라인 학급 삭제는 제출과 글의 철회 대기를 보존하며 재인증·재시도 후 실제 허브에서 두 자료 모두 삭제됨을 확인했다. 이 suite의 클립 fixture는 합성 바이트이며 실제 영상 검증은 아래 검사다.
- `node tests/browser-classroom-capture.cjs`: 서로 다른 PIN/IndexedDB의 교사·학생 context, fragment 제거, 자기 학생 ID만 수신, 표시 프로필 1회 저장, 실제 가상 카메라의 저장 UI→암호화 ID/성찰→5초 무음 WebM→offline 선택 제출→HTTP 수신 바이트 일치→교사 UI의 실제 640×360 디코딩·재생까지 통과했다. 성찰 ID도 저장/제출 간 일치하며 교사창 종료 시 재생 중인 제출 영상의 pause/src 정리도 확인한다.
- `node tests/browser-classroom-privacy.cjs`: 암호화 기록의 실명 평문 부재, PIN 재확인 복구, 교사창 닫기 때 명단 DOM 제거, 명시 잠금 때 학생 공간과 상태 제거, 허브 비밀값/PIN 구별 통과.
- `node tests/browser-classroom-reset.cjs`: 실제 IndexedDB에서 초기화 후 옛 revision 읽기/쓰기 거부, 새 vault 빈 상태, CAS 충돌 거부 통과.
- `node tests/browser-pwa.cjs`: SW v8 전체 셸, 오프라인 재실행→PIN→가상 촬영→암호화 저장·재생, 업데이트 대기/상태 보호/쿼리 일관성/자연 활성화·기존 자료 보존, 첫 설치·필수 캐시 실패 안내 통과.

**이번 실행: 단위 27개, 브라우저 스크립트 17종 모두 통과.** 브라우저는 기존 회귀 13종(`camera`, `clips`, `smoke`, `delay`, `data`, `vault-migration`, `reset`, `review`, `reflection`, `reference`, `layout`, `buffer-limits`, `pwa`)과 신규 S3 4종이다. 각 스크립트 종료 상태를 확인했고 배치 실행은 첫 실패 시 중단하도록 했다. 기존 `smoke`의 5·15·30초 출력과 무음·ffprobe 패킷, `review`의 5.25초 패킷/Chrome 탐색 RGB, `delay`의 실제 1·20·60초 지연 픽셀, 이전 DB/PIN·삭제·초기화·교사 내보내기 회귀가 통과했다.

S2의 실제 310초 측정은 촬영·지연·인코더 경로가 바뀌지 않아 재실행하지 않았으며 [S2 근거](stage-S2-validation.md)를 유지한다. 합성 300초 검사와 물리 기기 성능 보장은 다르다.

## 발견·보정과 한계

실 UI 검증에서 teacherOpen 중복 렌더가 입력을 교체하는 경합, dialog submit/close 이중 종료가 학생 쓰기를 취소하는 경합, 브라우저 fetch 호출 바인딩, 만료 문서 열기 정리·삭제 대기 재접속 경로를 발견해 보정했다. 서버가 수신한 뒤 응답만 잃은 경우도 같은 작업으로 복구했다.

localhost listen은 기본 sandbox의 EPERM 때문에 해당 로컬 서버/Chromium 검사만 최소 실행 권한으로 수행했다. 새 외부 호스팅, 계정·권한 변경, commit/push는 하지 않았다. 실제 기기·배포 대기는 S1/S2와 동일하게 유지한다.
