# S4.6 합성 평가·자원 계측 검증 기록

기록일: 2026-11-06. 로컬 준비 완료이며 S4.6의 실제 정확도·기기 검증은 대기다. 실행 디렉터리 `/workspace/P.E.-class-module`, HEAD `f1ba4c2`, hostname `eb97ffefba06`, Node `v24.22.1`, Linux x64 커널 `6.18.57`이다. [평가 절차](S4-evaluation-protocol.md)와 [기계 판독 결과](S4-shot-evaluation.json)를 함께 확인한다.

## 구현·재현

- `node tests/shot-evaluation.test.cjs`: 최종 5개 테스트 통과. inclusive 경계·중복/구간 밖 출력·FN·null·잘못된 reference·그룹별 micro 합계·겹치는 구간의 최대 매칭을 검사한다.
- `node scripts/shot-evaluation.cjs docs/S4-shot-evaluation.json`: 통과. 생성 fixture와 감지기/전신 gate/실행 코드 hash, 사건별 출력·매칭·FP/FN 인덱스·그룹 집계·환경·자원 결과를 기록한다. hash가 같으면 합성 사건 결과를 재현할 수 있으며 시간/메모리는 실행마다 변한다. 파일 경로 인자를 생략하면 stdout으로 출력한다.
- `node --test tests/*.test.cjs`: 통합 전체 단위 64개 통과, 실패/건너뜀 0. 기본 sandbox 첫 실행은 16개 파일 중 14개 통과하고 기존 hub의 loopback `listen EPERM`, installer의 `spawnSync zip EPERM` 두 파일이 실패했다. 두 실패를 직접 실행해 원인을 확인하고 같은 전체 명령을 승인된 `sandbox_permissions: require_escalated`로 실행한 결과가 64개 통과다. 최종 benchmark 계측 필드 보강 후 해당 5개 집중 테스트도 통과했다.
- Luna의 독립 read-only oracle에서 0~3 시각의 사건 3개와 가능한 reference 구간 2개 조합 6,400건의 TP가 exhaustive 최대 일대일 매칭과 일치했다. 실제 fixture 라벨의 타당성이나 농구 정확도를 입증하는 검사는 아니다.

production 앱·셸·모델 자산 변경 없이 standalone 개발 도구와 문서를 추가했다. 기존 S4.3/4.4/4.5 브라우저 검사와 real-model 측정은 재실행하지 않았다. 기존 [S4.5 검증](stage-S4-history-validation.md)과 [실제 모델 측정](S4-real-model-measurement.json)을 현재 측정으로 덮어쓰지 않았다.

## 합성 결과

7개 구간·27개 landmark 입력의 사건 합계 TP 3·FP 1·FN 2, precision 0.75·recall 0.60이다. 분모가 0이면 null이며 TN 기반 accuracy는 정의하지 않는다.

| 합성 방향 라벨 | TP | FP | FN | precision | recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| front-label | 2 | 1 | 0 | 0.6667 | 1 |
| oblique-label | 1 | 0 | 1 | 1 | 0.5 |
| side-label | 0 | 0 | 1 | null | 0 |

| 정의된 조건 | TP | FP | FN |
| --- | ---: | ---: | ---: |
| clear (좌우) | 2 | 0 | 0 |
| scaled-translated | 1 | 0 | 0 |
| non-shot-arm-raise | 0 | 1 | 0 |
| occluded | 0 | 0 | 1 |
| tracking-gap | 0 | 0 | 1 |
| idle | 0 | 0 | 0 |

non-shot은 공 없는 팔 올리기를 같은 기하로 정의해 규칙이 구별하지 못하는 FP를 드러낸다. 가림/긴 간격은 reference가 있으나 감지가 중단되어 FN이 된다. 좌표는 규칙 단위 검사의 기하에서 구성했으므로 검증 자료와 규칙이 독립적인 현장 benchmark가 아니다. 방향은 라벨일 뿐 실제 카메라 각도를 바꾼 영상이 아니다. 관측 시각 범위 합계 5,900ms, reference 없는 두 구간 1,300ms도 희소 입력의 시각 범위이며 실제 연속 촬영 시간이나 신뢰할 FP/분 추정이 아니다.

## 로컬 자원 결과와 범위

동일 replay 경로로 warm-up 후 1,000회·27,000개 입력을 처리했다. 규칙 모듈만의 wall time 42.306ms, Node process CPU user 58.106ms/system 0.654ms다. 런타임의 여러 스레드 때문에 CPU 합계가 wall time을 넘을 수 있다. RSS 40,181,760→42,659,840 bytes (차이 +2,478,080), heapUsed 6,286,776→5,789,912 bytes (차이 -496,864), 프로세스 생애 최대 RSS 43,732KiB다. GC로 heap이 감소할 수 있고 프로세스 최대에는 준비/warm-up이 포함된다. snapshot 차이를 누수나 최대 증가량으로 해석하지 않는다. 성능 통과 임계값은 만들지 않았다.

모델·카메라·worker·브라우저·GPU·전력·발열 비용은 이 수치에 포함되지 않는다. 기존 약 4초 real-model 동시 측정과 새 Node 결과를 합산하거나 Android 추론 시간으로 사용하지 않는다.

## 남은 조건과 보존

동의된 실제 학생/농구 자료·교사 사건 라벨/검토·실제 촬영 방향별 정확도·Android 실기기·학교 환경·전체 앱 메모리·배터리·발열·40분 연속 실행은 미실행이다. 배구/커스텀 모델 확장이나 S5 구현에도 이번에 착수하지 않았다. S4.3 안내의 당시 미착수 문구는 역사적 기록이며 S4.4~S4.5 최신 상태는 각각 해당 검증 문서를 따른다.

시작 시 다수의 tracked 수정 및 untracked 구현/문서가 있는 dirty 작업공간이었다. 기존 변경을 되돌리거나 재적용하지 않았다. 게시·배포·commit·push·환경 설정 변경을 하지 않았다.
