import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_FAIL, COPY_OK, copyRemoteUrl, maskToken, remoteState, showRemote, tvFootControl, type RemoteView } from '../../web/src/settings.ts';
import type { TvFoot } from '../../src/shared/types.ts';
import { fakeDocument } from './fakeDom.ts';

const URL_ON = 'https://152-67-1-2.sslip.io:8443/?token=v1ewT0ken_abc';

function view(): RemoteView {
  const el = (tag: string) => fakeDocument.createElement(tag) as unknown;
  return { qr: el('img'), url: el('div'), actions: el('div'), copy: el('button') } as RemoteView;
}

test('밖에서 보기가 켜져 있으면 복사할 값은 url 그대로, 화면 주소는 토큰을 가림, 복사 버튼 보임', () => {
  const v = view();
  const full = showRemote(v, { url: URL_ON, qrSvg: '<svg/>' });
  assert.equal(full, URL_ON);
  assert.equal(v.url.textContent, 'https://152-67-1-2.sslip.io:8443/?token=…');
  assert.ok(!v.url.textContent.includes('v1ewT0ken_abc'));
  assert.equal(v.actions.hidden, false);
  assert.equal(v.copy.hidden, false);
});

test('url이 null이면(꺼짐·문 못 엶) 복사할 값이 없고 복사 버튼이 숨음', () => {
  for (const info of [{ url: null, qrSvg: null }, { url: null, qrSvg: null, problem: 'door-failed' }]) {
    const v = view();
    assert.equal(showRemote(v, info), null);
    assert.equal(v.copy.hidden, true);
    assert.equal(v.actions.hidden, true);
  }
});

test('토큰을 새로 받은 뒤 다시 그리면 복사할 값도 새 주소', () => {
  const v = view();
  showRemote(v, { url: URL_ON, qrSvg: '<svg/>' });
  const next = 'https://152-67-1-2.sslip.io:8443/?token=n3w';
  assert.equal(showRemote(v, { url: next, qrSvg: '<svg/>' }), next);
  assert.equal(v.url.textContent, 'https://152-67-1-2.sslip.io:8443/?token=…');
});

test('주소 복사: 클립보드에 url을 그대로 쓰고 성공 문구', async () => {
  let written: string | null = null;
  const msg = await copyRemoteUrl(URL_ON, { writeText: async (t: string) => { written = t; } });
  assert.equal(written, URL_ON);
  assert.equal(msg, COPY_OK);
  assert.equal(COPY_OK, '복사했어요 — 비밀번호처럼 다뤄 주세요');
});

test('주소 복사 실패: 클립보드가 거절·없음·주소 없음이면 실패 문구', async () => {
  assert.equal(await copyRemoteUrl(URL_ON, { writeText: async () => { throw new Error('denied'); } }), COPY_FAIL);
  assert.equal(await copyRemoteUrl(URL_ON, undefined), COPY_FAIL);
  let called = false;
  assert.equal(await copyRemoteUrl(null, { writeText: async () => { called = true; } }), COPY_FAIL);
  assert.equal(called, false);
  assert.equal(COPY_FAIL, '복사하지 못했어요');
});

/** 손으로 끝내는 응답(지연·역순 시험용) */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const info = (url: string) => ({ url, qrSvg: '<svg/>' });
const OLD = 'https://door.example:8443/?token=old';
const NEW = 'https://door.example:8443/?token=new';

/** 부를 때마다 차례로 손으로 끝내는 응답을 내주는 가짜 /api/remote-info */
function infoQueue() {
  const replies: ReturnType<typeof deferred<{ url: string; qrSvg: string }>>[] = [];
  return {
    fetchInfo: () => {
      const d = deferred<{ url: string; qrSvg: string }>();
      replies.push(d);
      return d.promise;
    },
    reply: (k: number, url: string) => replies[k].resolve(info(url)),
  };
}

test('토큰을 바꾸는 동안엔 옛 주소를 복사하지 못하고 버튼이 잠김, 새 주소를 받으면 다시 풀림', async () => {
  const v = view();
  const q = infoQueue();
  const s = remoteState(v, q.fetchInfo);
  const first = s.load();
  q.reply(0, OLD);
  await first;
  assert.equal(s.full, OLD);
  assert.equal(v.copy.disabled, false);

  const post = deferred<boolean>();
  const rotating = s.rotate(() => post.promise); // '토큰 새로 받기'를 누름
  assert.equal(s.full, null);
  assert.equal(v.copy.disabled, true);
  let written: string | null = null;
  assert.equal(await copyRemoteUrl(s.full, { writeText: async (t: string) => { written = t; } }), COPY_FAIL);
  assert.equal(written, null);

  post.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  q.reply(1, NEW);
  assert.equal(await rotating, true);
  assert.equal(s.full, NEW);
  assert.equal(v.copy.disabled, false);
});

test('토큰을 바꾸는 중에 설정을 다시 열어도(재조회) 옛 주소로 잠금이 풀리지 않음', async () => {
  const v = view();
  const q = infoQueue();
  const s = remoteState(v, q.fetchInfo);
  const first = s.load();
  q.reply(0, OLD);
  await first;

  const post = deferred<boolean>();
  const rotating = s.rotate(() => post.promise);
  const reopen = s.load(); // 갱신 POST가 끝나기 전에 설정을 닫았다 다시 엶
  q.reply(1, OLD); // 서버는 아직 옛 토큰
  await reopen;
  assert.equal(s.full, null);
  assert.equal(v.copy.disabled, true);

  post.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  q.reply(2, NEW);
  await rotating;
  assert.equal(s.full, NEW);
  assert.equal(v.copy.disabled, false);
});

test('토큰을 새로 받지 못하면 다시 받아 그린 지금 주소로 복사가 풀리고 실패를 알려 줌', async () => {
  const v = view();
  const q = infoQueue();
  const s = remoteState(v, q.fetchInfo);
  const first = s.load();
  q.reply(0, OLD);
  await first;
  const rotating = s.rotate(async () => false);
  await Promise.resolve();
  await Promise.resolve();
  q.reply(1, OLD);
  assert.equal(await rotating, false);
  assert.equal(s.full, OLD);
  assert.equal(v.copy.disabled, false);
});

test('먼저 시작한 요청이 늦게 끝나도 새 주소를 옛 주소로 덮어쓰지 않음', async () => {
  const v = view();
  const q = infoQueue();
  const s = remoteState(v, q.fetchInfo);
  const a = s.load(); // 토큰을 바꾸기 전 요청
  const b = s.load(); // 바꾼 뒤 요청
  q.reply(1, NEW);
  await b;
  q.reply(0, OLD);
  await a;
  assert.equal(s.full, NEW);
  assert.equal(v.url.textContent, 'https://door.example:8443/?token=…');
});

test('정보를 못 받으면 복사할 주소를 비우고 안내', async () => {
  const v = view();
  const s = remoteState(v, async () => { throw new Error('down'); });
  await s.load();
  assert.equal(s.full, null);
  assert.equal(v.url.textContent, '정보를 불러오지 못했어요');
});

test('maskToken: token= 뒤를 가림, 토큰 없는 주소는 그대로', () => {
  assert.equal(maskToken('http://192.168.0.5:4310/?token=abc'), 'http://192.168.0.5:4310/?token=…');
  assert.equal(maskToken('http://127.0.0.1:4310/'), 'http://127.0.0.1:4310/');
});

// 사무실 TV 아랫줄 고르기: 서버는 켤 때마다 새 이름(inst), 그 안에서 바뀔 때마다 판(rev)+1. 화면은 같은 이름 안에서 더 큰 판만 믿고,
// 이름이 바뀌면 지금 연결의 스냅샷을 따른다. 저장은 한 번에 하나씩, 그사이 고른 것은 마지막 것만 이어서
// (Codex 리뷰 P2 두 건 + 재검토 P2 세 건 — 늦은 응답·스냅샷이 더 새 값을 덮던 문제, 시계가 뒤로 간 뒤 다시 켠 서버를 무시하던 문제)
type Ver = { rev: number; inst: string } | null;
function tvHarness(initial: TvFoot = 'quote', rev = 10, inst = 'A') {
  const posts: Array<{ foot: TvFoot; resolve: (v: Ver) => void; reject: () => void }> = [];
  const shown: TvFoot[] = [];
  const ctl = tvFootControl(
    { foot: initial, rev, inst },
    (foot) => new Promise<Ver>((resolve, reject) => posts.push({ foot, resolve, reject: () => reject(new Error('끊김')) })),
    (f) => shown.push(f),
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { ctl, posts, shown, tick };
}
const A = (rev: number) => ({ rev, inst: 'A' });

test('TV 아랫줄: 빠르게 sun → none → quote를 고르면 저장은 하나씩, 그사이 고른 것은 마지막 것만 이어서 보낸다', async () => {
  const { ctl, posts, shown, tick } = tvHarness();
  ctl.choose('sun');
  ctl.choose('none');
  ctl.choose('quote');
  await tick();
  assert.deepEqual(posts.map((p) => p.foot), ['sun']); // 첫 저장이 끝나기 전엔 다음을 보내지 않음(서버가 역순으로 처리하지 않게)
  posts[0].resolve(A(11));
  await tick();
  assert.deepEqual(posts.map((p) => p.foot), ['sun', 'quote']);
  posts[1].resolve(A(12));
  await tick();
  assert.equal(ctl.server, 'quote');
  assert.deepEqual(shown, ['quote']);
});

test('TV 아랫줄: 앞 저장은 됐는데 마지막 저장이 실패하면 라디오는 처음 값이 아니라 서버가 가진 값(앞 저장)으로', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote');
  ctl.choose('sun');
  ctl.choose('none');
  await tick();
  posts[0].resolve(A(11));
  await tick();
  posts[1].resolve(null);
  await tick();
  assert.equal(ctl.server, 'sun');
  assert.deepEqual(shown, ['sun']);
});

test('TV 아랫줄: 다른 창에서 바꾼 값(스냅샷)은 저장 중이 아니면 바로 라디오에, 저장 중이면 끝난 뒤 그 값으로', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote');
  ctl.sync('sun', A(11));
  assert.deepEqual(shown, ['sun']);
  ctl.choose('none');
  await tick();
  ctl.sync('quote', A(12)); // 저장 중에 온 스냅샷(다른 창이 quote로) — 고르는 중인 라디오를 덮지 않음
  assert.deepEqual(shown, ['sun']);
  posts[0].reject(); // 응답이 끊김
  await tick();
  assert.equal(ctl.server, 'quote');
  assert.deepEqual(shown, ['sun', 'quote']);
  ctl.choose('quote'); // 이미 그 값이어도 고르면 보낸다(지금 서버 값과 같아도 해가 없음)
  await tick();
  assert.equal(posts.at(-1)!.foot, 'quote');
});

test('TV 아랫줄: 다른 창의 더 새 값(큰 판)이 먼저 오고 이 창의 옛 저장 성공(작은 판)이 늦게 와도 새 값을 지킨다', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote', 10);
  ctl.choose('sun');
  await tick();
  ctl.sync('none', A(12)); // B창이 뒤에 none으로 저장(판 12) — 스냅샷이 이 창의 sun 응답보다 먼저 옴
  posts[0].resolve(A(11)); // 늦게 온 sun 성공(판 11)
  await tick();
  assert.equal(ctl.server, 'none');
  assert.deepEqual(shown, ['none']);
});

test('TV 아랫줄: 낡은 스냅샷(작은 판)이 이 창의 저장 성공 뒤에 늦게 와도 무시', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote', 10);
  ctl.choose('sun');
  await tick();
  posts[0].resolve(A(11));
  await tick();
  ctl.sync('quote', A(10));
  assert.equal(ctl.server, 'sun');
  assert.deepEqual(shown, ['sun']);
  ctl.sync('none', A(13)); // 그 뒤 더 새 값은 바로
  assert.deepEqual(shown, ['sun', 'none']);
});

test('TV 아랫줄: 서버를 다시 켜면(새 이름, 판 0부터) 지금 연결의 스냅샷을 따르고, 옛 서버의 늦은 응답은 버린다', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote', 10001, 'A');
  ctl.sync('quote', { rev: 0, inst: 'B' }); // 다시 켠 서버(시계가 뒤로 갔어도 판 크기와 상관없이)
  ctl.choose('sun');
  await tick();
  posts[0].resolve({ rev: 1, inst: 'B' });
  await tick();
  assert.equal(ctl.server, 'sun');
  assert.equal(shown.at(-1), 'sun');
  ctl.choose('none');
  await tick();
  posts[1].resolve({ rev: 99999, inst: 'A' }); // 옛 서버에서 늦게 온 응답 — 판이 커도 이름이 달라 버림
  await tick();
  assert.equal(ctl.server, 'sun');
  ctl.sync('none', { rev: 2, inst: 'B' });
  assert.equal(ctl.server, 'none');
});

test('TV 아랫줄: 다시 켠 서버가 저장했다고 답했는데 그 서버의 스냅샷이 아직 안 왔으면, 라디오를 옛 값으로 되돌리지 않고 기다린다 (Codex 재검토 P2)', async () => {
  const { ctl, posts, shown, tick } = tvHarness('quote', 5, 'A');
  ctl.choose('sun'); // 서버를 다시 켜느라 연결이 끊긴 사이에 고름 — 저장은 새 서버(B)가 받음
  await tick();
  posts[0].resolve({ rev: 1, inst: 'B' });
  await tick();
  assert.deepEqual(shown, []); // 옛 값(quote)으로 되돌리지 않음 — 라디오는 고른 sun 그대로
  ctl.sync('quote', { rev: 5, inst: 'A' }); // 옛 서버 이름의 스냅샷이 더 와도 그대로
  assert.deepEqual(shown, []);
  ctl.sync('sun', { rev: 1, inst: 'B' }); // 새 서버의 스냅샷이 오면 확정
  assert.equal(ctl.server, 'sun');
  assert.deepEqual(shown, ['sun']);
});
