# 전술 모델 독립 엔진 속도 실험 (2026-11-17)

Chromium 155, CPU quota 2 및 affinity 0–1, 검증된 Qwen 3B 모델(2,104,932,768 bytes, SHA-256 `626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d`)의 독립 Wllama 엔진 실험이다. 앱 전체 응답이나 Android 실기기 수치가 아니다. 서버는 로컬 모델/WASM 공급을 위해 실행 중이었고 외부 요청은 차단했다. 별도의 앱 오프라인 실험이 필요하다.

이전 candidate 기록의 `multiple` 요청(티볼 주자가 송구를 보고 되돌아가는 사례)의 실제 prompt와 grammar 및 후보 프로파일을 그대로 사용했다. 두 실행 모두 context 1024, threads 2, vendor 기본 n_parallel 4, 출력 최대 96, temperature 0.2, seed 42, cache_prompt false다. seed는 비교 실험에만 적용했다. 측정 순서는 baseline 다음 tuned이고 각 1회다.

| 설정 | 모델 load | completion 시작~첫 토큰 | 첫 토큰~완료 | 입력 / 캐시 토큰 | 출력 토큰 |
| --- | ---: | ---: | ---: | ---: | ---: |
| batch 128 / ubatch 64 | 29.07초 | 427.92초 | 18.90초 | 488 / 0 | 19 |
| batch 512 / ubatch 256 | 25.71초 | 413.35초 | 18.38초 | 488 / 0 | 19 |

입력 prompt, grammar, 후보 ID 및 생성 결과는 동일했다(`teeball_case_01`, `TBX-18`). 첫 토큰 시간 차이는 약 14.6초(3.4%)이나, 단일 고정 순서 측정이어서 재현성이나 일반적인 개선으로 단정할 수 없다. 모델 복사와 토큰화는 이 표에 포함하지 않는다. 본 실험만으로 배치 설정을 바꿀 근거는 약하다.

원시 로그는 `tactics-speed-2026-11-17-baseline-retry.json`과 `tactics-speed-2026-11-17-tuned.json`이다. 최초 시도 `tactics-speed-2026-11-17-baseline.json`은 모델 로드 전 fetch 오류로 종료되었으며 보존했다. 재시도는 빈 페이지와 OPFS 스트리밍을 사용했다. 실험 프로필은 종료 후 삭제했다.
