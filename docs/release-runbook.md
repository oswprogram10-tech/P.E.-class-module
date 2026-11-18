# PE Loop 학교 1차 출시 및 복귀

첫 출시 범위는 **교사 기기에 정보 저장 · 학교 서버 운영**이다. 학급·명단·교사 관찰·측정·원본 클립은 이 기기의 교사 PIN 암호화 저장소에서 관리한다. 학교 서버는 명시적으로 선택한 대표 클립·성찰·수업 피드백 및 동기화 기록을 암호화 보관한다. 선택 제출물은 최대 7일, 전술판의 암호화된 익명 도형 배치는 24시간 보관한다.

배포본에는 PWA, 학급 제출 서버, 전술판 공유 서버, Caddy 설정과 파일별 SHA-256 목록이 들어 있다. Node.js 24와 Caddy 2가 필요하다. 학교 HTTPS 프록시는 학급 서버 경로와 전술판 공유 경로만 제공한다.

| 후속 항목 | 1차 출시 상태 |
| --- | --- |
| 웨어러블 정식 연동 | 미구현 · Apple 빌드·서명 및 실기기 설치·연결 확인 필요 |
| PAPS·나이스 공식 연동 | 미구현 · BMI 세부 배점, 종합점수·등급, 공식 백분위 및 나이스 양식 확인 필요 |
| 동작 분석·운동 콘텐츠 실사용 버전 | 미구현 · 실제 영상 정확도, 전문가 검토와 사용권 확인 필요 |
| AI 전술 제안 정식 지원 | 미구현 · 실제 기기의 응답 속도와 사례 적합성 확인 필요 |

기존 로컬 수업 도구와 시범 화면에는 개발 범위가 표시된다. 실제 40분 사용·발열·학교 환경 결과는 교사의 기기에서 점검한다.

## 준비와 첫 배포

1. 배포 호스트에 `/srv/pe-loop/releases/`를 준비하고 배포본을 푼다. 각 버전은 수정하지 않고 보관한다. Caddy 서비스는 상위 디렉터리를 통과하고 활성 버전의 `web/`을 읽을 수 있어야 한다. Caddy의 공개 루트는 `/srv/pe-loop/current/web`이다.
2. DB, 암호화 키, 학급별 교사 비밀 파일, 전술 관리자 비밀은 배포본 밖의 관리 경로에 둔다. Node 서버는 같은 SQLite 파일과 키를 재시작 후에도 사용한다. 호스트 예시 `pe.school.example`을 학교에서 사용할 이름으로 바꾼다.
3. 새 배포본을 확인한 뒤 `current` 링크를 바꾼다. 아래 명령은 압축을 풀어 만든 해당 디렉터리에서 실행한다.

```sh
node scripts/activate-release.cjs check .
node scripts/activate-release.cjs activate . /srv/pe-loop/current
```

`check`는 파일 목록·크기·해시와 서비스워커 캐시 ID를 검사한다. `activate`는 확인을 다시 실행하고 같은 파일시스템의 임시 링크를 원자적으로 교체한다. `current`가 실제 디렉터리면 중단한다. `.current.activated/`에는 이미 사용한 릴리스 ID가 남으므로 운영 주소를 유지하는 동안 함께 보존한다.

4. 두 Node 서비스를 서로 다른 프로세스로 실행한다. 운영 환경변수는 아래 표를 기준으로 서비스 비밀 관리나 전용 환경 파일에서 제공한다. 각 서비스는 loopback에만 연결한다.

```sh
node /srv/pe-loop/current/server/classroom-hub.js
node /srv/pe-loop/current/server/tactics-hub.js
```

| 변수 | 값 |
| --- | --- |
| `PE_HUB_MODE` | `production` |
| `PE_HUB_ORIGIN`, `PE_TACTICS_PUBLIC_ORIGIN` | 같은 학교 HTTPS origin. 예: `https://pe.school.example` |
| `PE_HUB_DB`, `PE_TACTICS_DB` | 배포본 밖의 서로 다른 영속 SQLite 절대 경로 |
| `PE_HUB_DATA_KEY` | 암호화 전용 키. 처음 생성한 32바이트 키를 64자리 16진수로 보관 |
| `PE_HUB_TEACHER_SECRETS_FILE` | 운영자에게 제출한 학급 ID와 고유 교사 비밀값을 매핑하는 JSON 파일 절대 경로 |
| `PE_TACTICS_ADMIN_TOKEN` | 전술판 공유 서버용 32자 이상 비밀값 |
| `PE_HUB_PORT`, `PE_TACTICS_PORT` | 기본 8787과 8788. Caddy와 일치하도록 설정 |
| `PE_TACTICS_ALLOWED_ORIGINS` | Android APK를 연결할 때 `https://appassets.androidplatform.net`을 추가. 같은 주소의 PWA는 기본 허용 |

5. Caddy에 배포본의 `examples/classroom-hub.Caddyfile`을 적용한다. Caddy 환경에 `PE_HUB_HOST=pe.school.example`과 `PE_WEB_ROOT=/srv/pe-loop/current/web`을 주고, Node 포트가 기본값과 다르면 Caddy에도 전달한다. `/classroom-api/`와 `/tactics/v1/boards`가 같은 HTTPS 주소로 제공된다. AI 제안·학습 예제 경로는 404를 반환한다. 실제 브라우저와 기기가 그 인증서를 신뢰하는지 확인한다.
6. 테스트 학급에서 PWA 설치·오프라인 재실행, 교사 인증과 제출, 전술판 읽기·편집 초대를 확인한다. 학급·학생 실자료는 운영 검증이 끝난 뒤 사용한다.

## 업데이트와 복귀

운영자는 배포 전에 이전 앱 창에서도 새 서버 API가 동작하는지와 두 DB의 호환성을 확인한다. 호환성이 확인된 버전은 수업 외 시간에 두 Node 서비스를 중지하고 위 활성화 명령으로 링크를 바꾼 뒤, 같은 DB 경로와 키로 다시 시작한다. 프록시 설정이 같으면 Caddy는 기존 주소에서 새 링크의 정적 파일 제공을 이어간다. 서버 세션은 새로 인증한다.

기존 PWA 창은 사용 중인 캐시를 유지한다. 새 워커는 묶음에 있는 파일을 설치하며 각 파일이 기대한 해시와 다르면 설치를 거부한다. 모든 기존 앱 창을 닫고 다시 열면 준비된 새 버전이 적용된다. 정상 동작과 오프라인 재실행을 확인한 뒤 이전 배포본을 보존한다.

이전 코드로 돌아갈 때는 그 소스에서 **한 번도 활성화하지 않은 새 릴리스 ID**로 다시 묶는다. 예를 들어 프로젝트의 배포 도구로 다음 명령을 실행한다.

```sh
node scripts/build-release.cjs 2026-11-17-r3-rollback /srv/pe-loop/releases/2026-11-17-r3-rollback /srv/snapshots/prior-compatible-source
```

복귀도 파일 검증 → 링크 전환 → 두 서버 재시작 → 앱 창 종료·재실행 순서다. **앱 코드만 이전 동작으로 되돌리고 운영 DB와 암호화 키는 최신 상태를 유지한다.** 옛 DB 스냅샷에서 복원하면 그 뒤 철회한 자료가 다시 보일 수 있다. 이전 서버 코드가 현재 DB와 호환되는지 확인되지 않았다면 먼저 호환되는 복귀 빌드를 준비한다. 활성화가 중단된 경우 실행 중인 프로세스와 현재 링크를 확인하고, 이미 기록된 ID는 새 릴리스 ID로 교체한다.
