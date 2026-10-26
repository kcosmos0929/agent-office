// 몸짓 효과: 폴짝(도트 단위)과 쉬는 중 Zzz 요소 (three.js는 모름)

/** 승인·질문 대기의 폴짝: 1초마다 앞 0.25초 동안 2도트 위로 (동작 줄이기면 0) */
export function hopDots(t: number, reduced: boolean): number {
  if (reduced) return 0;
  return t % 1000 < 250 ? 2 : 0;
}

/** 머리 위에 떠오르는 Z 셋(움직임은 CSS) */
export function makeZzz(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.className = 'zzz';
  for (let i = 0; i < 3; i++) {
    const s = doc.createElement('span');
    s.textContent = 'Z';
    el.appendChild(s);
  }
  return el;
}
