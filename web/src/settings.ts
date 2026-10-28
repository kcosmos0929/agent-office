// 설정 패널(이 맥에서 열었을 때만): 폰 연결 QR · 밖에서 보기 QR · 서버 다시 켜기/끄기 · 사무실 TV 아랫줄 · Codex 자동 승인
import type { TvFoot } from '../../src/shared/types.ts';

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

/**
 * 「밖에서 보기」 칸의 상태(복사할 전체 주소): 마지막에 시작한 요청의 응답만 반영하고,
 * 토큰을 바꾸는 동안엔(요청 순서와 따로 센다) 어떤 재조회도 옛 주소로 복사를 풀지 못한다
 */
export function remoteState(v: RemoteView, fetchInfo: () => Promise<RemoteInfo>) {
  let full: string | null = null;
  let seq = 0;
  let rotating = 0;
  async function load(): Promise<void> {
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
    if (rotating > 0) full = null; // 갱신 중 받은 주소는 곧 무효일 수 있다 — 그리기만 하고 복사는 잠근 채
    v.copy.disabled = rotating > 0;
  }
  return {
    get full(): string | null {
      return full;
    },
    /** 정보를 다시 받아 칸을 그린다 — 더 늦게 시작한 요청이 있으면 이 응답은 버린다(옛 주소가 새 주소를 덮지 않게) */
    load,
    /** 토큰 바꾸기: 옛 주소를 지우고 버튼을 잠근 채 post(새 토큰 요청)를 기다린 뒤, 새 정보를 받아 그리고 푼다. post 성공 여부를 돌려준다 */
    async rotate(post: () => Promise<boolean>): Promise<boolean> {
      rotating++;
      seq++;
      full = null;
      v.copy.disabled = true;
      let ok = false;
      try {
        ok = await post();
      } catch {
        ok = false;
      } finally {
        rotating--;
      }
      await load();
      return ok;
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

/** 사무실 TV 아랫줄 고르기(값, 설정 창 글) */
export const TV_FOOT_CHOICES: readonly (readonly [TvFoot, string])[] = [
  ['quote', '문구 — 5분마다 바뀌는 한 줄'],
  ['sun', '해 막대 — 해 뜸부터 해 짐까지'],
  ['none', '비움 — 시계와 날짜만'],
];

/**
 * TV 아랫줄 고르기 상태: 서버 값(스냅샷·저장 성공)이 기준이다. 저장은 한 번에 하나씩 보내고(서버가 역순으로 처리하지 않게),
 * 그사이 고른 것은 마지막 것만 이어서 보낸다. 저장이 다 끝나면 서버 값을 다시 읽어(read) 라디오를 맞춘다 — 늦게 온 저장 응답이
 * 그사이 다른 창이 바꾼 더 새 값을 덮지 않게, 저장이 실패했으면 서버 값으로 되돌리게.
 * 다른 창에서 바꾼 값은 스냅샷으로 오는데, 저장 중이면 고르는 중인 라디오를 덮지 않고 서버 값만 기억한다 (Codex 리뷰 P2 세 건)
 */
export function tvFootControl(initial: TvFoot, post: (foot: TvFoot) => Promise<boolean>, show: (foot: TvFoot) => void, read: () => Promise<TvFoot | null>) {
  let server = initial;
  let want: TvFoot | null = null;
  let busy = false;
  async function flush(): Promise<void> {
    if (busy) return;
    busy = true;
    for (;;) {
      while (want !== null) {
        const foot = want;
        want = null;
        try {
          if (await post(foot)) server = foot;
        } catch {
          // 못 보냄 — 아래에서 서버 값을 다시 읽어 맞춘다
        }
      }
      const fresh = await read().catch(() => null);
      if (fresh) server = fresh;
      if (want === null) break; // 다시 읽는 사이 또 골랐으면 이어서 보낸다
    }
    busy = false;
    show(server);
  }
  return {
    get server(): TvFoot {
      return server;
    },
    /** 라디오에서 고름 */
    choose(foot: TvFoot): void {
      want = foot;
      void flush();
    },
    /** 스냅샷의 서버 값(다른 창에서 바꾼 것 포함) */
    sync(foot: TvFoot): void {
      server = foot;
      if (!busy && want === null) show(foot);
    },
  };
}

export function buildSettings(initial: { codexAutoApprove: boolean; tvFoot: TvFoot }): { el: HTMLElement; toggle(): void; syncTvFoot(foot: TvFoot): void } {
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
    const ok = await remoteInfo.rotate(async () => (await fetch('/api/admin/remote-token', { method: 'POST', headers: { 'x-so-admin': '1' } }).catch(() => null))?.ok === true);
    if (!ok) showStatus('토큰을 새로 받지 못했어요');
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

  // 사무실 TV 아랫줄: 서버 config에 저장돼 모든 화면(폰·밖에서 보기 포함)이 다음 스냅샷으로 같이 바뀐다(라디오도 스냅샷으로 맞춤)
  const tv = document.createElement('div');
  tv.className = 'settings-section';
  const tvTitle = document.createElement('h3');
  tvTitle.textContent = '사무실 TV';
  const tvHelp = document.createElement('div');
  tvHelp.textContent = '사용량이 안 잡혀 시계가 뜰 때 아랫줄에 보여 줄 것이에요. 폰 · 밖에서 보기 화면도 같이 바뀌어요.';
  const tvRows = TV_FOOT_CHOICES.map(([value, label]) => {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'so-tv-foot';
    input.value = value;
    input.checked = value === initial.tvFoot;
    row.append(input, document.createTextNode(` ${label}`));
    return { row, input, value };
  });
  const tvFoot = tvFootControl(
    initial.tvFoot,
    async (foot) => (await fetch('/api/admin/tv-foot', { method: 'POST', headers: { 'x-so-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ foot }) })).ok,
    (foot) => { for (const r of tvRows) r.input.checked = r.value === foot; },
    async () => {
      const r = await fetch('/api/client-config');
      const foot = r.ok ? ((await r.json()) as { tvFoot?: unknown }).tvFoot : null;
      return TV_FOOT_CHOICES.some(([v]) => v === foot) ? (foot as TvFoot) : null;
    },
  );
  for (const { input, value } of tvRows) input.addEventListener('change', () => { if (input.checked) tvFoot.choose(value); });
  tv.append(tvTitle, tvHelp, ...tvRows.map((r) => r.row));

  el.append(title, help, qr, url, actions, remote, tv, codex);

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
    /** 스냅샷마다: 다른 창에서 바꾼 TV 아랫줄도 라디오에 맞춘다 */
    syncTvFoot(foot: TvFoot) {
      tvFoot.sync(foot);
    },
  };
}
