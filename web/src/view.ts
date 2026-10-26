export type ViewName = 'office' | 'list';

/** ?view=list|office 가 있으면 그걸, 없으면 화면 크기로 고른다 */
export function chooseView(w: number, h: number, override: string | null): ViewName {
  if (override === 'office' || override === 'list') return override;
  return w >= 900 && h >= 600 ? 'office' : 'list';
}

/** 처음 고른 화면: ?view= 가 있으면 그것, 없으면 이 탭에서 눌러 둔 값(새로 고침해도 유지), 올바른 값이 아니면 null */
export function initialOverride(param: string | null, stored: string | null): ViewName | null {
  for (const v of [param, stored]) if (v === 'office' || v === 'list') return v;
  return null;
}
