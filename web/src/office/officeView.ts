// 3D 오피스 화면: 렌더러·카메라(아이소메트릭 고정, 확대·축소 + 확대했을 때 끌어서 옮기기)·장면·TV·렌더 속도 조절. 사무실은 굵은 점, 사람은 가는 점(pixelPass).
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Snapshot } from '../../../src/shared/types.ts';
import type { OfficeHost } from '../main.ts';
import { targetFps } from './fps.ts';
import type { Pose } from './pose.ts';
import { showCard } from './card.ts';
import { Cast } from './cast.ts';
import { PALETTE, officeLights } from './backdrop.ts';
import { FIT, FLOOR_X, FLOOR_Z, VIEW_DIR as VIEW } from './layout.ts';
import { buildOffice, type OfficeScene } from './scene.ts';
import { GLASS_LAYER, PixelPass, splitTransparent } from './pixelPass.ts';
import { FIGURE_LAYER } from './sprites/figure.ts';
import { createTv } from './tv.ts';
import { clampPan, PressOwner, snapPan, type Pan } from './pan.ts';

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
  private snap: Snapshot | null = null;
  /** 스냅샷을 받은 때(브라우저 시각) — 서버 시각을 이어 세려고 */
  private receivedAt = 0;
  private closeCard: (() => void) | null = null;
  private readonly pass = new PixelPass(PALETTE.bg);
  private readonly px: number;
  private dprQuery: MediaQueryList | null = null;

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

    this.office = buildOffice();
    splitTransparent(this.office.group); // 유리·칸막이는 사람 뒤에 한 번 더 합성(pixelPass)
    this.scene.add(this.office.group, this.tv.group);
    // 동작 줄이기 설정이면 폴짝을 끈다(한 번만 읽음)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cast = new Cast(this.scene, this.office, () => this.invalidate(), () => (this.snap ? this.snap.now + (Date.now() - this.receivedAt) : Date.now()), reduced);

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
    this.tv.update(s.usage, s.now);
    this.cast.sync(s);
    this.poses = this.cast.poses();
    this.invalidate();
  }

  /** 다시 연결된 뒤 첫 스냅샷은 효과 없이 기준만 */
  rebase(): void {
    this.cast.rebase();
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
    if (!document.hidden) this.invalidate();
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
