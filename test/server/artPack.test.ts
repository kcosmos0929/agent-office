// 그림 묶음 갈아 끼우기: 설정 charactersDir 판정(resolvePack)과 서버의 /characters/ 응답
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { resolvePack } from '../../src/server/artPack.ts';
import { loadConfig } from '../../src/server/config.ts';
import { startServer } from '../../src/server/http.ts';
import { OfficeState } from '../../src/server/state.ts';
import { M } from '../helpers.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'so-pack-'));
function makePack(dir: string, meta: string | null = '{"format": 1, "name": "t"}') {
  fs.mkdirSync(dir, { recursive: true });
  if (meta !== null) fs.writeFileSync(path.join(dir, 'pack.json'), meta);
  return dir;
}

test('resolvePack: 설정 없음 → none', () => {
  assert.deepEqual(resolvePack(null), { kind: 'none' });
  assert.deepEqual(resolvePack(undefined), { kind: 'none' });
});

test('resolvePack: 문자열 아님·빈 문자열·상대 경로 → invalid', () => {
  for (const v of [42, '', 'pack', './pack']) {
    const r = resolvePack(v, tmp());
    assert.equal(r.kind, 'invalid', String(v));
  }
});

test('resolvePack: ~/… 는 홈으로 펴고 끝 / 는 떼어 ok', () => {
  const home = tmp();
  makePack(path.join(home, 'p'));
  assert.deepEqual(resolvePack('~/p', home), { kind: 'ok', dir: path.join(home, 'p') });
  assert.deepEqual(resolvePack('~/p/', home), { kind: 'ok', dir: path.join(home, 'p') });
  assert.deepEqual(resolvePack(path.join(home, 'p') + '/', home), { kind: 'ok', dir: path.join(home, 'p') });
});

test('resolvePack: 폴더 없음·pack.json 없음·깨짐·format 2 → 각각 invalid(이유 있음)', () => {
  const home = tmp();
  const cases = [
    path.join(home, 'none'),
    makePack(path.join(home, 'nometa'), null),
    makePack(path.join(home, 'broken'), '{'),
    makePack(path.join(home, 'v2'), '{"format": 2}'),
  ];
  const reasons = cases.map((dir) => {
    const r = resolvePack(dir, home);
    assert.equal(r.kind, 'invalid', dir);
    return r.kind === 'invalid' ? r.reason : '';
  });
  assert.equal(new Set(reasons).size, 4);
  for (const r of reasons) assert.ok(r.length > 0);
});

test('loadConfig: charactersDir 기본 null, 문자열이 아닌 값은 그대로 두어 resolvePack이 무효로 판정(조용히 "설정 없음"이 되지 않게)', () => {
  const home = tmp();
  assert.equal(loadConfig(home).charactersDir, null);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ charactersDir: 3 }));
  assert.equal(loadConfig(home).charactersDir, 3);
  assert.equal(resolvePack(loadConfig(home).charactersDir).kind, 'invalid');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ charactersDir: '~/art/characters' }));
  assert.equal(loadConfig(home).charactersDir, '~/art/characters');
});

// --- 서버 ---
const root = tmp();
const staticDir = path.join(root, 'static');
fs.mkdirSync(path.join(staticDir, 'characters', 'parts'), { recursive: true });
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>office</title>');
fs.writeFileSync(path.join(staticDir, 'characters', 'parts', 'a.png'), 'STATIC-A');
fs.writeFileSync(path.join(staticDir, 'characters', 'parts', 'only-static.png'), 'STATIC-ONLY');
const pack = makePack(path.join(root, 'pack', 'characters'));
fs.mkdirSync(path.join(pack, 'parts'));
fs.writeFileSync(path.join(pack, 'parts', 'a.png'), 'PACK-B');
fs.writeFileSync(path.join(root, 'pack', 'secret.txt'), 'SECRET');
fs.writeFileSync(path.join(root, 'secret.txt'), 'SECRET');

const closers: Array<() => Promise<void>> = [];
after(async () => { for (const c of closers) await c(); });

async function boot(charactersDir: string | null) {
  const home = tmp();
  const config = loadConfig(home);
  const state = new OfficeState({ restMs: 30 * M, leaveMs: 120 * M, goneMs: 10 * M, stalledMs: 15 * M, forgetMs: 12 * 60 * M, resolveProject: () => 'x', startedAt: 0, registryWaitRule: false });
  const srv = await startServer({ config, token: 'b'.repeat(64), state, staticDir, listenPort: 0, host: '127.0.0.1', charactersDir });
  closers.push(srv.close);
  return srv.port;
}

/** 경로를 고치지 않고 그대로 보낸다(fetch는 %2e%2e를 미리 접어 버림) */
function rawGet(port: number, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

test('서버: charactersDir 없으면 /characters/ 는 빌드된 대체 그림', async () => {
  const port = await boot(null);
  assert.deepEqual(await rawGet(port, '/characters/parts/a.png'), { status: 200, body: 'STATIC-A' });
});

test('서버: charactersDir 있으면 그 묶음에서, 묶음에 없는 파일은 대체 그림으로 섞지 않고 404', async () => {
  const port = await boot(pack);
  assert.deepEqual(await rawGet(port, '/characters/parts/a.png'), { status: 200, body: 'PACK-B' });
  assert.equal((await rawGet(port, '/characters/parts/only-static.png')).status, 404);
  assert.equal((await rawGet(port, '/index.html')).body, '<!doctype html><title>office</title>');
});

test('서버: 묶음 폴더 밖으로 나가는 경로는 404, 바깥 파일을 읽지 않는다', async () => {
  const port = await boot(pack);
  for (const p of ['/characters/..%2fsecret.txt', '/characters/..%2f..%2f..%2fsecret.txt', '/characters/%2e%2e/%2e%2e/secret.txt', '/characters/%2e%2e%2fsecret.txt']) {
    const r = await rawGet(port, p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes('SECRET'), p);
  }
});

test('서버: 묶음 안 심볼릭 링크가 밖을 가리키면(파일·폴더) 404, 바깥 파일을 읽지 않는다', async () => {
  const r2 = tmp();
  const p2 = makePack(path.join(r2, 'pack'));
  fs.writeFileSync(path.join(r2, 'secret.txt'), 'SECRET');
  fs.mkdirSync(path.join(r2, 'outside')); fs.writeFileSync(path.join(r2, 'outside', 'x.png'), 'SECRET');
  fs.symlinkSync(path.join(r2, 'secret.txt'), path.join(p2, 'leak.png'));
  fs.symlinkSync(path.join(r2, 'outside'), path.join(p2, 'parts'));
  const port = await boot(p2);
  for (const p of ['/characters/leak.png', '/characters/parts/x.png']) {
    const r = await rawGet(port, p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes('SECRET'), p);
  }
});

test('서버: 묶음 폴더 자체가 심볼릭 링크여도(실제 폴더 안 파일) 보낸다', async () => {
  const r3 = tmp();
  const real = makePack(path.join(r3, 'real'));
  fs.mkdirSync(path.join(real, 'parts')); fs.writeFileSync(path.join(real, 'parts', 'a.png'), 'REAL-A');
  fs.symlinkSync(real, path.join(r3, 'link'));
  const port = await boot(path.join(r3, 'link'));
  assert.deepEqual(await rawGet(port, '/characters/parts/a.png'), { status: 200, body: 'REAL-A' });
});
