// 사무실 TV가 시계일 때 아랫줄에 5분마다 바뀌어 뜨는 한 줄. 새로 지은 문장(남의 명언을 옮기지 않음) — 사용자 검토 2026-10-28.
// TV 한 줄(Galmuri11 12px, 160칸) 안에 들어가야 한다 — 새 줄은 화면에서 폭을 재 보고 넣기. 이모지는 픽셀 글꼴에 없어 쓰지 않는다.
export const QUOTES: readonly string[] = [
  // 연구·논문
  '리뷰어 2는 늘 있다', '삽질은 내일의 방법론', '초안은 원래 못생겼다', '참고문헌은 보강재일 뿐', 'p값보다 효과 크기', '전처리는 적어 두기',
  '그림 하나가 표 열 개', '마감은 생각보다 가깝다', '한 문단씩, 한 문장씩', '논문은 쓰는 만큼 는다', '회의는 짧게, 메모는 길게', '모형은 단순, 해석은 깊게',
  // 코드
  '커밋은 일찍, 자주', '버그도 데이터다', '초록 불이면 반은 성공', '리뷰는 선물이다', '고친 줄보다 지운 줄', '로그에 다 써 있다', '되면 끝? 테스트까지', '저장은 습관이다',
  // AI 동료
  '생각 중엔 물 한 잔', 'Codex 돌 땐 스트레칭', '승인 대기는 짧게', '토큰은 소중하니까', '사람 하나, AI 둘', 'Claude도 쉬어 간다',
  // 쉬기
  '눈 감고 20초', '물 마셨어요?', '어깨 펴고 숨 한 번', '점심은 연구의 연료', '커피는 두 잔까지', '산책도 분석이다', '퇴근도 실력이다', '잘 자는 것도 연구다',
  // 응원
  '어제보다 한 줄 더', '느려도 앞으로', '완벽보다 완료', '막히면 한 단계 작게', '오늘도 잘하고 있어요', '작게 시작, 자주 확인', '모르면 물어보기', '오늘 할 일은 세 개만',
];

export const QUOTE_MS = 5 * 60_000;

/** 고정 씨앗으로 섞은 순서(mulberry32 + 피셔-예이츠) — 주제별로 이어 나오지 않게, 줄 수만큼 바뀌는 동안 모든 줄이 한 번씩 */
function shuffled(n: number, seed: number): number[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
const ORDER = shuffled(QUOTES.length, 0x5eed);

/** 지금 5분 칸의 문구 — 시각(epoch)으로만 정해 모든 화면(폰·밖에서 보기)에 같은 때 같은 줄 */
export function quoteAt(now: number): string {
  const n = ORDER.length;
  const slot = Math.floor(now / QUOTE_MS);
  return QUOTES[ORDER[((slot % n) + n) % n]];
}
