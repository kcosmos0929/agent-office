// renderList 테스트용 아주 작은 가짜 DOM (의존성 추가 없이)

export class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  className = '';
  private text = '';

  constructor(tag: string) {
    this.tagName = tag.toLowerCase();
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
  getAttribute(k: string) {
    return this.attributes.get(k) ?? null;
  }
  appendChild(c: FakeElement) {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeElement[]) {
    for (const c of cs) this.children.push(c);
  }
  replaceChildren(...cs: FakeElement[]) {
    this.text = '';
    this.children = [...cs];
  }
  /** 자손 전체(깊이 우선) */
  all(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  byClass(cls: string): FakeElement[] {
    return this.all().filter((e) => e.className.split(/\s+/).includes(cls));
  }
}

export const fakeDocument = {
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
};
