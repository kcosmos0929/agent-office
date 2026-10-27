// 설정 패널(이 맥에서 열었을 때만): 폰 연결 QR · 밖에서 보기 QR · 서버 다시 켜기/끄기 · Codex 자동 승인

export const COPY_OK = '복사했어요 — 비밀번호처럼 다뤄 주세요';
export const COPY_FAIL = '복사하지 못했어요';

/** 화면에 보일 주소: 토큰 부분은 가린다 */
export function maskToken(u: string): string {
  return u.replace(/token=.*/, 'token=…');
}

type RemoteInfo = { url: string | null; qrSvg: string | null; problem?: string };
/** 「밖에서 보기」 칸의 조각들 */
export type RemoteView = { qr: HTMLImageElement; url: HTMLElement; actions: HTMLElement; copy: HTMLButtonElement };

/** /api/remote-info 결과를 칸에 그린다. 복사할 전체 주소(토큰 포함)를 돌려준다 — 꺼져 있거나 문을 못 열었으면 null(복사 버튼 숨김) */
export function showRemote(v: RemoteView, info: RemoteInfo): string | null {
  const on = Boolean(info.url && info.qrSvg);
  v.qr.hidden = !on;
  v.actions.hidden = !on;
  v.copy.hidden = !on;
  if (info.url && info.qrSvg) {
    v.qr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`;
    v.url.textContent = maskToken(info.url);
    return info.url;
  }
  v.qr.removeAttribute('src');
  v.url.textContent = info.problem === 'door-failed'
    ? '밖에서 보기 문을 열지 못했어요 — 포트(remotePort)가 쓰이고 있는지 보고 다시 켜 보세요'
    : '꺼져 있어요 — config.json의 remotePublicHost를 넣고 다시 켜세요';
  return null;
}

/** 「밖에서 보기」 칸의 상태(복사할 전체 주소): 마지막에 시작한 요청의 응답만 반영하고, 토큰을 바꾸는 동안엔 복사를 막는다 */
export function remoteState(v: RemoteView, fetchInfo: () => Promise<RemoteInfo>) {
  let full: string | null = null;
  let seq = 0;
  return {
    get full(): string | null {
      return full;
    },
    /** 정보를 다시 받아 칸을 그린다 — 더 늦게 시작한 요청이 있으면 이 응답은 버린다(옛 주소가 새 주소를 덮지 않게) */
    async load(): Promise<void> {
      const mine = ++seq;
      try {
        const info = await fetchInfo();
        if (mine !== seq) return;
        full = showRemote(v, info);
      } catch {
        if (mine !== seq) return;
        full = null;
        v.copy.hidden = true;
        v.url.textContent = '정보를 불러오지 못했어요';
      }
      v.copy.disabled = false;
    },
    /** 토큰을 바꾸기 시작: 옛 주소를 지우고 버튼을 잠근다(진행 중인 옛 요청의 응답도 버린다) */
    invalidate(): void {
      seq++;
      full = null;
      v.copy.disabled = true;
    },
  };
}

/** 전체 주소(토큰 포함)를 클립보드에 — 집 PC처럼 QR을 못 찍는 기기로 넘길 때. 화면에 띄울 짧은 결과 문구를 돌려준다 */
export async function copyRemoteUrl(full: string | null, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<string> {
  if (!full || !clipboard) return COPY_FAIL;
  try {
    await clipboard.writeText(full);
    return COPY_OK;
  } catch {
    return COPY_FAIL;
  }
}

export function buildSettings(initial: { codexAutoApprove: boolean }): { el: HTMLElement; toggle(): void } {
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

  // 밖에서 보기(VPS 터널): 와이파이가 달라도 — 보기 토큰을 담은 QR, 새었으면 '토큰 새로 받기'
  const remote = document.createElement('div');
  remote.className = 'settings-section';
  const remoteTitle = document.createElement('h3');
  remoteTitle.textContent = '밖에서 보기';
  const remoteHelp = document.createElement('div');
  remoteHelp.textContent = '와이파이가 달라도 이 QR로 볼 수 있어요(보기만). 남에게 보였으면 토큰을 새로 받으세요.';
  const remoteQr = document.createElement('img');
  remoteQr.alt = '밖에서 보기 QR 코드';
  const remoteUrl = document.createElement('div');
  remoteUrl.className = 'lan-url';
  const remoteActions = document.createElement('div');
  remoteActions.className = 'actions';
  // 주소 복사: 화면엔 토큰을 가리지만 복사는 전체 주소 — 토큰을 바꾸는 동안엔 잠그고, 새 주소를 받으면 그 주소를 복사
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '주소 복사';
  const copyStatus = document.createElement('div');
  copyStatus.className = 'copy-status';
  copyStatus.setAttribute('role', 'status');
  let clearStatus: ReturnType<typeof setTimeout> | null = null;
  const showStatus = (text: string) => {
    copyStatus.textContent = text;
    if (clearStatus) clearTimeout(clearStatus);
    clearStatus = setTimeout(() => (copyStatus.textContent = ''), 4000);
  };
  const remoteInfo = remoteState({ qr: remoteQr, url: remoteUrl, actions: remoteActions, copy }, async () => (await (await fetch('/api/remote-info')).json()) as RemoteInfo);
  copy.addEventListener('click', async () => showStatus(await copyRemoteUrl(remoteInfo.full, navigator.clipboard)));
  const rotate = document.createElement('button');
  rotate.type = 'button';
  rotate.textContent = '토큰 새로 받기';
  rotate.addEventListener('click', async () => {
    if (!confirm('밖에서 보기 토큰을 새로 받을까요? 지금 밖에서 보던 화면은 끊기고, QR을 다시 찍어야 해요.')) return;
    remoteInfo.invalidate();
    const r = await fetch('/api/admin/remote-token', { method: 'POST', headers: { 'x-so-admin': '1' } }).catch(() => null);
    await remoteInfo.load();
    if (!r?.ok) showStatus('토큰을 새로 받지 못했어요');
  });
  remoteActions.append(copy, rotate);
  remote.append(remoteTitle, remoteHelp, remoteQr, remoteUrl, remoteActions, copyStatus);

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
  // Codex 자동 승인: 승인된 순간 신호가 없어서, 켜 두면 승인 요청을 무시하고 하던 일을 그대로 보여 준다
  const codex = document.createElement('div');
  codex.className = 'settings-section';
  const codexTitle = document.createElement('h3');
  codexTitle.textContent = 'Codex';
  const row = document.createElement('label');
  row.className = 'toggle-row';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = initial.codexAutoApprove;
  row.append(check, document.createTextNode(' 자동 승인 사용'));
  const codexHelp = document.createElement('div');
  codexHelp.textContent = '켜 두면 Codex 승인 요청에 ❗를 띄우지 않고 하던 일을 그대로 보여 줘요. Codex 앱에서 직접 승인할 때는 꺼 주세요.';
  check.addEventListener('change', async () => {
    const on = check.checked;
    try {
      const r = await fetch('/api/admin/codex-auto-approve', { method: 'POST', headers: { 'x-so-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
      if (!r.ok) check.checked = !on;
    } catch {
      check.checked = !on;
    }
  });
  codex.append(codexTitle, row, codexHelp);

  el.append(title, help, qr, url, actions, remote, codex);

  async function load() {
    try {
      const info = (await (await fetch('/api/lan-info')).json()) as { url: string | null; qrSvg: string | null };
      if (info.url && info.qrSvg) {
        qr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`;
        url.textContent = maskToken(info.url);
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
      if (!el.hidden) {
        void load();
        void remoteInfo.load();
      }
    },
  };
}
