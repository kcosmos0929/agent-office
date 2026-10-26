// 서울 해에 맞춘 낮밤: 일출·일몰 계산(NOAA 근사식) → 밝기 6단계 → 조명 세기. 렌더와 무관한 순수 계산이라 시간대(머신)에 안 흔들린다.
import * as THREE from 'three';

export const SEOUL = { lat: 37.57, lon: 126.98 };
/** 밤 조명 세기(시안 값 — 낮은 하늘 2.4·해 0.9). 바꿔 보기 쉽게 이름을 붙여 둠 */
export const NIGHT = { hemi: 0.9, sun: 0.08 };
const DAY = { hemi: 2.4, sun: 0.9 };

const MIN = 60_000;
const KST = 9 * 60 * MIN; // 한국 표준시 UTC+9, 서머타임 없음
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** t가 속한 한국 날짜의 [연, 월(0~), 일] */
function kstDate(t: number): [number, number, number] {
  const d = new Date(t + KST);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/** t가 속한 한국 날짜의 해 뜨는·지는 시각(epoch ms). NOAA 근사식, 태양 고도 −0.833° */
export function sunTimes(t: number, lat = SEOUL.lat, lon = SEOUL.lon): { rise: number; set: number } {
  const [y, m, d] = kstDate(t);
  const midnightUtc = Date.UTC(y, m, d);
  const jd = (midnightUtc + 12 * 60 * MIN - KST) / 86_400_000 + 2440587.5; // 그날 한국 정오
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const yy = Math.tan(rad(eps) / 2) ** 2;
  const eqTime = 4 * deg(yy * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yy * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * yy * yy * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  const ha = deg(Math.acos(Math.min(1, Math.max(-1, cosH)))); // 극지방에서 NaN이 안 나게
  const noon = 720 - 4 * lon - eqTime; // 분(UTC 자정 기준)
  return { rise: midnightUtc + (noon - 4 * ha) * MIN, set: midnightUtc + (noon + 4 * ha) * MIN };
}

/** 밝기 단계(0, 0.2 … 1): 일출 30분 전→일출에 0→1, 일몰→일몰 30분 뒤에 1→0, 그 사이 낮 1·밤 0 */
export function lightLevel(t: number): number {
  const { rise, set } = sunTimes(t);
  const ramp = 30 * MIN;
  let raw = 0;
  if (t >= rise && t <= set) raw = 1;
  else if (t < rise) raw = Math.max(0, (t - (rise - ramp)) / ramp);
  else raw = Math.max(0, 1 - (t - set) / ramp);
  const level = Math.round(raw * 5) / 5;
  return Number.isFinite(level) ? level : 1;
}

/** `?clock=HH:MM`(00~23:00~59)이면 now가 속한 한국 날짜의 그 시각(epoch ms), 아니면 null — 미리 보기용 */
export function clockOverride(search: string, now: number): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(new URLSearchParams(search).get('clock') ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const [y, mo, d] = kstDate(now);
  return Date.UTC(y, mo, d, h, mi) - KST;
}

/** 하늘 빛(Hemisphere)·해 빛(Directional)을 level(0~1)로 밤↔낮 선형. 사무실 등(PointLight)은 그대로 */
export function applyDaylight(lights: THREE.Object3D[], level: number): void {
  const k = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
  for (const l of lights) {
    if ((l as THREE.HemisphereLight).isHemisphereLight) (l as THREE.HemisphereLight).intensity = NIGHT.hemi + (DAY.hemi - NIGHT.hemi) * k;
    else if ((l as THREE.DirectionalLight).isDirectionalLight) (l as THREE.DirectionalLight).intensity = NIGHT.sun + (DAY.sun - NIGHT.sun) * k;
  }
}
