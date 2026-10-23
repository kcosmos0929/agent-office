// 설정 패널(이 맥에서 열었을 때만): 폰 연결 QR · 서버 다시 켜기/끄기
export function buildSettings(): { el: HTMLElement; toggle(): void } {
  const el = document.createElement('div');
  el.className = 'settings';
  el.hidden = true;

  const title = document.createElement('h3');
  title.textContent = '폰 · 태블릿으로 보기';
  const help = document.createElement('div');
  help.textContent = '같은 와이파이에서 카메라로 찍으세요. 이 주소는 비밀번호처럼 다뤄 주세요.';
  const qr = document.createElement('img');
  qr.alt = '폰 연결 QR 코드';
  const url = document.createElement('div');
  url.className = 'lan-url';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const admin = (action: 'restart' | 'stop', label: string, confirmText: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', async () => {
      if (!confirm(confirmText)) return;
      await fetch(`/api/admin/${action}`, { method: 'POST', headers: { 'x-so-admin': '1' } });
    });
    return b;
  };
  actions.append(
    admin('restart', '다시 켜기', '서버를 다시 켤까요? 몇 초 뒤 자동으로 다시 연결돼요.'),
    admin('stop', '끄기', '서버를 끌까요? 다시 켜려면 아이콘 앱을 누르세요.'),
  );
  el.append(title, help, qr, url, actions);

  async function load() {
    try {
      const info = (await (await fetch('/api/lan-info')).json()) as { url: string | null; qrSvg: string | null };
      if (info.url && info.qrSvg) {
        qr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`;
        url.textContent = info.url.replace(/token=.*/, 'token=…');
      } else {
        qr.removeAttribute('src');
        url.textContent = '와이파이 주소를 찾지 못했어요';
      }
    } catch {
      url.textContent = '정보를 불러오지 못했어요';
    }
  }

  return {
    el,
    toggle() {
      el.hidden = !el.hidden;
      if (!el.hidden) void load();
    },
  };
}
