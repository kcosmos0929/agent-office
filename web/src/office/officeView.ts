// 3D 오피스 화면: 렌더러·카메라(아이소메트릭 고정, 확대·축소 + 확대했을 때 끌어서 옮기기)·장면·TV·렌더 속도 조절. 사무실은 굵은 점, 사람은 가는 점(pixelPass).
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Snapshot } from '../../../src/shared/types.ts';
import type { OfficeHost } from '../main.ts';
import { targetFps } from './fps.ts';
import { seatedPreview } from './sprites/seated.ts';
import type { Pose } from './pose.ts';
import { showCard } from './card.ts';
import { deferredCard } from '../list/floatingList.ts';
import { Cast } from './cast.ts';
import { applyDaylight, clockOverride, lightLevel } from './daylight.ts';
import { PALETTE, officeLights } from './backdrop.ts';
import { FIT, FLOOR_X, FLOOR_Z, VIEW_DIR as VIEW } from './layout.ts';
import { buildOffice, type OfficeScene } from './scene.ts';
import { GLASS_LAYER, PixelPass, splitTransparent } from './pixelPass.ts';
import { FIGURE_LAYER } from './sprites/figure.ts';
import { createTv } from './tv.ts';
import { clampPan, PressOwner, snapPan, type Pan } from './pan.ts';

/** 이만큼(ms) 넘게 화면이 멈췄다 돌아오면 걸어서 따라잡지 않고 자리에 바로 세운다 */
const HIDDEN_SETTLE_MS = 5000;
const TARGET = new THREE.Vector3(FLOOR_X / 2, 0.7, FLOOR_Z / 2);
const VIEW_DIR = new THREE.Vector3(...VIEW).normalize();

export class OfficeView implements OfficeHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  readonly office: OfficeScene;
  readonly container: HTMLElement;
  frames = 0;
  protected poses: Pose[] = [];
  private readonly tv = createTv();
  private readonly resizeObserver: ResizeObserver;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private disposed = false;
  private zoom = 1;
  /** 확대했을 때 끌어서 옮긴 만큼(1배 화면 안으로 묶음) */
  private pan: Pan = { x: 0, y: 0 };
  /** 누르기(먼저 누른 포인터 하나가 주인) — 4px 넘게 움직이면 끌기(확대 중이면 옮기기), 아니면 손을 뗄 때 카드 */
  private readonly press = new PressOwner();
  /** 지금 화면에서 CSS 1px = 세계 몇 단위(끌기 환산용) */
  private worldPerPx = 1;
  private cast: Cast;
  private lastT = 0;
  /** 탭이 숨은 때(performance.now) — 숨지 않았으면 null */
  private hiddenAt: number | null = null;
  private snap: Snapshot | null = null;
  /** 스냅샷을 받은 때(브라우저 시각) — 서버 시각을 이어 세려고 */
  private receivedAt = 0;
  private closeCard: (() => void) | null = null;
  /** 작은 목록에서 고른 카드 — 스냅샷이 아직 없으면(다시 연결 직후) 맡아 두었다가 다음 스냅샷 때 연다 */
  private readonly cardRequest = deferredCard<{ agentId: string; at: { x: number; y: number } }>(({ agentId, at }) => {
    if (!this.snap) return false;
    const agent = this.snap.agents.find((a) => a.id === agentId);
    this.closeCard?.();
    this.closeCard = agent ? showCard(this.container, agent, this.snap.now, at) : null;
    return true;
  });
  private readonly pass = new PixelPass(PALETTE.bg);
  private readonly px: number;
  private dprQuery: MediaQueryList | null = null;
  private readonly lights: THREE.Object3D[];
  /** 지금 낮밤 단계(바뀔 때만 다시 그림) */
  private daylight = -1;
  private daylightTimer: ReturnType<typeof setInterval> | null = null;
  /** TV 시계·리셋 남은 시간을 초마다 다시 재는 타이머 */
  private tvTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    // 사무실 굵은 점 크기: CSS 점 px개 = 1칸(?px=1~4). 화면 자체는 기기 해상도로 그려 사람은 가는 점
    this.px = Math.max(1, Number(new URLSearchParams(location.search).get('px') ?? 1) || 1);
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setClearColor(PALETTE.bg);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // pixelPass가 사무실 그릴 때만 갱신
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    const lights = officeLights();
    for (const l of lights) l.layers.enable(GLASS_LAYER); // 유리 패스도 조명을 받게
    this.scene.add(...lights);
    this.lights = lights;

    this.office = buildOffice();
    splitTransparent(this.office.group); // 유리·칸막이는 사람 뒤에 한 번 더 합성(pixelPass)
    this.scene.add(this.office.group, this.tv.group);
    // 동작 줄이기 설정이면 폴짝을 끈다(한 번만 읽음)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cast = new Cast(this.scene, this.office, () => this.invalidate(), () => this.now(), reduced, seatedPreview(location.search));

    // 서울 해에 맞춘 낮밤: 지금 한 번, 그 뒤 1분마다 확인(단계가 바뀔 때만 다시 그림)
    this.checkDaylight();
    this.daylightTimer = setInterval(() => this.checkDaylight(), 60_000);
    this.tickTv();

    this.camera.position.copy(TARGET).addScaledVector(VIEW_DIR, 30);
    this.camera.lookAt(TARGET);
    this.camera.layers.enable(FIGURE_LAYER);

    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(2.5, Math.max(0.6, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      this.fit();
      this.invalidate();
    }, { passive: false });

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none'; // 끌기를 브라우저 스크롤·확대에 뺏기지 않게
    canvas.addEventListener('pointerdown', (e) => {
      if (this.press.down(e.pointerId, e.clientX, e.clientY, { ...this.pan })) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const next = this.press.move(e.pointerId, e.clientX, e.clientY, this.zoom, this.worldPerPx);
      if (!next) return;
      this.closeCard?.(); // 끌기 시작하면 열린 카드는 닫는다
      this.closeCard = null;
      this.pan = next;
      this.fit();
      this.invalidate();
    });
    canvas.addEventListener('pointerup', (e) => {
      const click = this.press.up(e.pointerId);
      if (click === null) return; // 주인 포인터가 아님
      if (click) this.onPointer(e); // 거의 안 움직였을 때만 누르기 = 캐릭터 카드(1배 이하에서 끈 것도 아님)
      this.updateCursor();
    });
    canvas.addEventListener('pointercancel', (e) => {
      this.press.cancel(e.pointerId);
      this.updateCursor();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
      this.invalidate();
    });
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchDpr();
    this.fit();
    (globalThis as { __soView?: OfficeView }).__soView = this; // 화면 확인용 손잡이
    this.invalidate();
  }

  update(s: Snapshot): void {
    this.snap = s;
    this.receivedAt = Date.now();
    this.tv.update(s.usage, s.now, s.tvFoot);
    this.cast.sync(s);
    this.poses = this.cast.poses();
    this.invalidate();
    this.cardRequest.flush();
  }

  /** 서버 시각을 이어 센 지금(스냅샷 전엔 브라우저 시각) */
  private now(): number {
    return this.snap ? this.snap.now + (Date.now() - this.receivedAt) : Date.now();
  }

  /** TV를 초마다 다시 재서 글줄이 바뀌었을 때만(시계 초, 리셋 남은 분, 리셋이 지나 시계로) 한 번 그린다. 다음 초 경계에 맞춰 깬다 */
  private tickTv = (): void => {
    if (this.disposed) return;
    const now = this.now();
    if (this.tv.update(this.snap?.usage ?? null, now, this.snap?.tvFoot)) this.invalidate();
    this.tvTimer = setTimeout(this.tickTv, 1000 - (now % 1000) + 20);
  };

  /** 다시 연결된 뒤 첫 스냅샷은 효과 없이 기준만 */
  rebase(): void {
    this.cast.rebase();
  }

  /** 낮밤 단계를 다시 재서 바뀌었으면 조명·창밖 풍경을 바꾸고 한 번 그린다(`?clock=HH:MM`이면 그 시각으로 미리 보기) */
  private checkDaylight(): void {
    const now = Date.now();
    const level = lightLevel(clockOverride(location.search, now) ?? now);
    if (level === this.daylight) return;
    this.daylight = level;
    applyDaylight(this.lights, level);
    this.office.backdrop.setDaylight(level);
    this.invalidate();
  }

  /** 작은 목록(floatingList)에서 고른 세션의 카드 — 캐릭터를 누른 것과 같은 카드. at은 이 화면 기준 좌표 */
  openCard(agentId: string, at: { x: number; y: number }): void {
    this.cardRequest.request({ agentId, at });
  }

  private onPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.layers.enable(FIGURE_LAYER);
    ray.setFromCamera(ndc, this.camera);
    const agent = this.cast.pick(ray);
    this.closeCard?.();
    this.closeCard = agent && this.snap ? showCard(this.container, agent, this.snap.now, { x: e.clientX - rect.left, y: e.clientY - rect.top }) : null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    if (this.daylightTimer) clearInterval(this.daylightTimer);
    if (this.tvTimer) clearTimeout(this.tvTimer);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.cast.dispose();
    this.pass.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  /** 매 프레임 움직임(하위 클래스·캐릭터가 씀) */
  protected animate(t: number): void {
    if (this.lastT && t - this.lastT > HIDDEN_SETTLE_MS) this.cast.settle(false); // 프레임이 오래 끊겼다 이어짐 — 이 프레임이 곧 그리니 다시 그리기를 예약하지 않는다(예약하면 반복이 두 줄로 늘어남)
    const dt = this.lastT ? Math.min(0.25, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    this.cast.animate(t, dt);
    this.poses = this.cast.poses();
  }

  /** 지금 바로 한 번 그리고, 그 뒤 속도 조절 루프를 다시 잡는다 */
  protected invalidate(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    if (this.disposed) return;
    this.animate(t);
    this.pass.render(this.renderer, this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.frames++;
    const fps = targetFps(this.poses, document.hidden, this.cast.bursting(t));
    if (fps === 0) return;
    // requestAnimationFrame이 다음 화면 갱신까지 더 기다리니 그만큼 일찍 깨운다(16장/초를 지키려고)
    this.timer = setTimeout(() => {
      this.raf = requestAnimationFrame((tt) => this.frame(tt));
    }, Math.max(0, 1000 / fps - 10));
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      return;
    }
    // 오래 숨어 있었다면 밀린 걸음을 걷지 않고 지금 계획의 자리에 바로 선다
    if (this.hiddenAt !== null && performance.now() - this.hiddenAt > HIDDEN_SETTLE_MS) this.cast.settle();
    this.hiddenAt = null;
    this.invalidate();
  };

  /** 창을 레티나 ↔ 일반 모니터로 옮기면 기기 해상도가 바뀐다 */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDpr);
  }

  private onDpr = () => {
    this.renderer.setPixelRatio(devicePixelRatio);
    this.watchDpr();
    this.fit();
    this.invalidate();
  };

  private fit(): void {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.pass.setSize(w / this.px, h / this.px, w * devicePixelRatio, h * devicePixelRatio);
    this.labels.setSize(w, h);
    const aspect = w / h;
    const fitHalfH = Math.max(FIT.h / 2, FIT.w / aspect / 2);
    const halfH = fitHalfH / this.zoom;
    this.worldPerPx = (2 * halfH) / h;
    // 끌어서 옮긴 만큼 보는 창을 민다(1배 화면 밖으로는 못 나감, 1배 이하면 가운데). 도트가 흔들리지 않게 굵은 점 단위로
    this.pan = clampPan(this.pan, fitHalfH * aspect, fitHalfH, this.zoom);
    const { x, y } = snapPan(this.pan, this.worldPerPx * this.px);
    Object.assign(this.camera, { left: -halfH * aspect + x, right: halfH * aspect + x, top: halfH + y, bottom: -halfH + y });
    this.camera.updateProjectionMatrix();
    this.updateCursor();
  }

  /** 확대했을 때만 끌 수 있다는 표시(손), 끄는 중엔 쥔 손 */
  private updateCursor(): void {
    this.renderer.domElement.style.cursor = this.press.dragging(this.zoom) ? 'grabbing' : this.zoom > 1 ? 'grab' : '';
  }
}
