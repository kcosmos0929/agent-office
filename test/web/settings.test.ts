import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_FAIL, COPY_OK, copyRemoteUrl, maskToken, remoteState, showRemote, type RemoteView } from '../../web/src/settings.ts';
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

test('토큰을 바꾸는 동안엔 옛 주소를 복사하지 못하고 버튼이 잠김, 새 주소를 받으면 다시 풀림', async () => {
  const v = view();
  const replies = [deferred<{ url: string; qrSvg: string }>(), deferred<{ url: string; qrSvg: string }>()];
  let n = 0;
  const s = remoteState(v, () => replies[n++].promise);
  const first = s.load();
  replies[0].resolve(info(OLD));
  await first;
  assert.equal(s.full, OLD);
  assert.equal(v.copy.disabled, false);

  s.invalidate(); // '토큰 새로 받기'를 누름
  assert.equal(s.full, null);
  assert.equal(v.copy.disabled, true);
  let written: string | null = null;
  assert.equal(await copyRemoteUrl(s.full, { writeText: async (t: string) => { written = t; } }), COPY_FAIL);
  assert.equal(written, null);

  const second = s.load();
  replies[1].resolve(info(NEW));
  await second;
  assert.equal(s.full, NEW);
  assert.equal(v.copy.disabled, false);
});

test('먼저 시작한 요청이 늦게 끝나도 새 주소를 옛 주소로 덮어쓰지 않음', async () => {
  const v = view();
  const replies = [deferred<{ url: string; qrSvg: string }>(), deferred<{ url: string; qrSvg: string }>()];
  let n = 0;
  const s = remoteState(v, () => replies[n++].promise);
  const a = s.load(); // 토큰을 바꾸기 전 요청
  const b = s.load(); // 바꾼 뒤 요청
  replies[1].resolve(info(NEW));
  await b;
  replies[0].resolve(info(OLD));
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
