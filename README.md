# Synthetic Office

내 맥에서 도는 작은 서버가 Claude Code 세션들의 작업 신호를 모아, 보조 모니터엔 **3D 블록 오피스**로, 작은 창·폰·태블릿엔 **목록형 상황판**으로 실시간 보여준다.

- 설계서: `docs/specs/2026-10-22-synthetic-office-설계.md`
- 1단계 계획: `docs/plans/2026-10-22-1단계-구현계획.md`

## 글꼴
오피스 화면의 픽셀 글꼴은 [갈무리(Galmuri)](https://github.com/quiple/galmuri) — SIL Open Font License 1.1 (`web/src/fonts/OFL.txt`).

## 설정
`~/.synthetic-office/config.json`에서 바꾼다(없는 키는 기본값).

| 키 | 기본 | 뜻 |
|---|---|---|
| `restMinutes` | 10 | 차례가 끝난(✅) 뒤 이만큼 지나면 😴 쉬는 중 |
| `leaveMinutes` | 120 | 차례가 끝난 뒤 이만큼 지나면 👋 자동 퇴근, 그 10분 뒤(`goneMinutes`) 화면에서 숨김(지우지 않아 다시 일하면 돌아옴) |

예전 `idleMinutes`는 더 읽지 않는다.
