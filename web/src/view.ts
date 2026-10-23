export type ViewName = 'office' | 'list';

/** ?view=list|office 가 있으면 그걸, 없으면 화면 크기로 고른다 */
export function chooseView(w: number, h: number, override: string | null): ViewName {
  if (override === 'office' || override === 'list') return override;
  return w >= 900 && h >= 600 ? 'office' : 'list';
}
