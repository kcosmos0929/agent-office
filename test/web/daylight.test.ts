import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyDaylight, clockOverride, lightLevel, NIGHT, sunTimes } from '../../web/src/office/daylight.ts';

const MIN = 60_000;
/** 한국 시각(KST) → epoch ms (머신 시간대와 무관) */
const kst = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

// 기준값: 서울의 일출·일몰(KST).
// 한국천문연구원(https://astro.kasi.re.kr/life/pageView/9)은 값이 브라우저 안 스크립트로만 계산돼 이 환경에서 읽지 못했고
// timeanddate.com은 403이라, sunrise-sunset.org API(https://api.sunrise-sunset.org/json?lat=37.5665&lng=126.9780&formatted=0)의
// 서울 값을 KST로 바꿔 적는다(천문 역서 기반, 초 단위). KASI 값으로 바꿔도 허용 오차(±3분) 안.
const REF: Array<{ day: [number, number, number]; rise: [number, number]; set: [number, number] }> = [
  { day: [2026, 3, 20], rise: [6, 36], set: [18, 43] },
  { day: [2026, 6, 21], rise: [5, 11], set: [19, 57] },
  { day: [2026, 9, 23], rise: [6, 20], set: [18, 29] },
  { day: [2026, 12, 22], rise: [7, 43], set: [17, 18] },
];

test('sunTimes: 네 날짜의 서울 일출·일몰이 기준값 ±3분', () => {
  for (const { day: [y, m, d], rise, set } of REF) {
    const s = sunTimes(kst(y, m, d, 12));
    assert.ok(Math.abs(s.rise - kst(y, m, d, ...rise)) <= 3 * MIN, `${y}-${m}-${d} 일출 ${new Date(s.rise + 9 * 3600_000).toISOString()}`);
    assert.ok(Math.abs(s.set - kst(y, m, d, ...set)) <= 3 * MIN, `${y}-${m}-${d} 일몰 ${new Date(s.set + 9 * 3600_000).toISOString()}`);
  }
});

test('sunTimes: 한국 날짜 경계(00:00·23:59)에서도 같은 날 값', () => {
  const a = sunTimes(kst(2026, 6, 21, 0, 0));
  const b = sunTimes(kst(2026, 6, 21, 23, 59));
  assert.deepEqual(a, b);
});

test('lightLevel: 일출 전 30분 → 일출에 0→1, 일몰 → 일몰 30분 뒤에 1→0, 6단계', () => {
  const { rise, set } = sunTimes(kst(2026, 10, 26, 12));
  assert.equal(lightLevel(rise - 31 * MIN), 0);
  assert.equal(lightLevel(rise - 15 * MIN), 0.6); // 원값 0.5 → Math.round(2.5) / 5
  assert.equal(lightLevel(rise), 1);
  assert.equal(lightLevel(set), 1);
  assert.equal(lightLevel(set + 30 * MIN), 0);
  assert.equal(lightLevel(set + 15 * MIN), 0.6);
  assert.equal(lightLevel(kst(2026, 10, 26, 12)), 1);
  assert.equal(lightLevel(kst(2026, 10, 26, 0)), 0);
  const seen = new Set<number>();
  for (let t = rise - 40 * MIN; t < rise + 5 * MIN; t += MIN) seen.add(lightLevel(t));
  assert.deepEqual([...seen].sort(), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('clockOverride: ?clock=HH:MM 은 그날(KST) 그 시각, 이상한 값은 null', () => {
  const now = kst(2026, 10, 26, 8, 15);
  assert.equal(clockOverride('?clock=21:00', now), kst(2026, 10, 26, 21, 0));
  assert.equal(clockOverride('?px=2&clock=00:05', now), kst(2026, 10, 26, 0, 5));
  assert.equal(clockOverride('?clock=25:00', now), null);
  assert.equal(clockOverride('?clock=12:60', now), null);
  assert.equal(clockOverride('?clock=ab', now), null);
  assert.equal(clockOverride('', now), null);
});

test('clockOverride: 날짜는 한국 날짜 기준(UTC로는 전날인 새벽)', () => {
  const now = kst(2026, 10, 26, 3, 0); // UTC로는 10-25 18:00
  assert.equal(clockOverride('?clock=21:00', now), kst(2026, 10, 26, 21, 0));
});

test('applyDaylight: 낮 2.4·0.9 → 밤 NIGHT까지 선형, 사무실 등은 그대로', () => {
  const hemi = new THREE.HemisphereLight('#DCE3EE', '#45454C', 2.4);
  const sun = new THREE.DirectionalLight('#F4F7FF', 0.9);
  const lamp = new THREE.PointLight('#FFE2B8', 3, 8, 1.6);
  const all = [hemi, sun, sun.target, lamp];
  applyDaylight(all, 0);
  assert.equal(hemi.intensity, NIGHT.hemi);
  assert.equal(sun.intensity, NIGHT.sun);
  assert.equal(lamp.intensity, 3);
  applyDaylight(all, 1);
  assert.equal(hemi.intensity, 2.4);
  assert.equal(sun.intensity, 0.9);
  applyDaylight(all, 0.5);
  assert.ok(Math.abs(hemi.intensity - (NIGHT.hemi + 2.4) / 2) < 1e-9);
  assert.ok(Math.abs(sun.intensity - (NIGHT.sun + 0.9) / 2) < 1e-9);
  assert.equal(lamp.intensity, 3);
});
