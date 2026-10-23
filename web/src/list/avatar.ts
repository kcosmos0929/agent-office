// 목록형 아바타: 3D 블록 캐릭터를 정면에서 본 얼굴 (몸 = 종류 색, 모자 = 세션 색)
const NS = 'http://www.w3.org/2000/svg';

export function avatar(doc: Document, bodyColor: string, hatColor: string, size = 30): SVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 30 30');
  svg.setAttribute('class', 'avatar');
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const el = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  };
  add('rect', { x: 5, y: 19, width: 20, height: 11, rx: 3, fill: bodyColor });
  add('rect', { x: 7, y: 5, width: 16, height: 15, rx: 3, fill: '#F3E2D2', stroke: '#E2CDB9' });
  add('rect', { x: 6, y: 2, width: 18, height: 5, rx: 2, fill: hatColor });
  add('circle', { cx: 12, cy: 12.5, r: 1.6, fill: '#2A2A2A' });
  add('circle', { cx: 18, cy: 12.5, r: 1.6, fill: '#2A2A2A' });
  return svg;
}
