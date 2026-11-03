// 등장인물 관리: 스냅샷의 에이전트·하위 에이전트를 도트 캐릭터로 만들고, 걷기·방향·표정·말풍선·링·책상 화면을 맞춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WAIT_COLOR } from '../../../src/shared/labels.ts';
import type { Agent, Snapshot, Status } from '../../../src/shared/types.ts';
import { makeBubble, nameplateText } from './bubbles.ts';
import { DOOR, backwardFrom, pathTo, routeBetween, segmentAt, simplifyPath, type Point } from './layout.ts';
import { BURST_MS, burstElapsed, eventsFor, type FxEvent, hopDots, makeSparkle, makeZzz, ringBurst } from './effects.ts';
import { direct, hashId, type Plan } from './director.ts';
import { paintRacks, rackStates } from './rack.ts';
import { ScreenPainter, screenFrame } from './screens.ts';
import type { Pose } from './pose.ts';
import type { OfficeScene } from './scene.ts';
import { Figure } from './sprites/figure.ts';
import { dirFor, faceFor, headTop, lookFor, PACE_FPS, STEP, WALK_FRAMES, type Dir, type Pace } from './sprites/look.ts';
import { SEATED_CYCLE_MS, seatedFrame, type SeatedPreview } from './sprites/seated.ts';

const SUB_SCALE = 0.8; // 도우미는 매니저와 같은 옷, 조금 작게

type Actor = {
  group: THREE.Group;
  figure: Figure;
  label: CSS2DObject | null;
  plate: CSS2DObject | null;
  bubble: ReturnType<typeof makeBubble> | null;
  ring: THREE.Mesh | null;
  /** 승인 뒤 퍼지는 바닥 링(평소엔 숨김) */
  burstRing: THREE.Mesh | null;
  /** 링 퍼짐 시작 시각(performance.now 기준, null=없음) */
  burstAt: number | null;
  /** 이전 동기화의 상태(없으면 이번이 기준) */
  prev: Status | undefined;
  /** 떠 있는 ✅ 반짝 */
  sparkles: Map<CSS2DObject, ReturnType<typeof setTimeout>>;
  /** 쉬는 중 머리 위 Z 셋 */
  zzz: CSS2DObject | null;
  /** 머무를 때의 몸짓 효과(계획) */
  effects: Plan['effects'];
  /** 지금 걷는 길 전체(출발 자리 → 목적지, 되짚은 구간 포함) — 걷는 중 목적지가 바뀌면 여기서 되짚는다 */
  route: Point[];
  /** 가려는 곳(계획의 자리와 좌표로 견줌) */
  target: Point;
  /** 남은 길(path[0] = 지금 위치) */
  path: Point[];
  /** 지금 서 있는(걷는) 자리. 앉으면 판 묶음만 의자로 옮기고 이 자리는 그대로(길찾기는 여기서) */
  at: Point;
  /** 자리에 닿으면 앉는 의자(계획) */
  sit: Plan['sit'];
  pace: Pace;
  /** 걷기 시계: 흐른 시간으로 넘길 장수를 정하고, 넘긴 장수만큼만 움직인다(발과 이동이 같은 시계) */
  clock: number;
  steps: number;
  phase: number;
  dir: Dir;
  /** 머무는 곳에서 보는 방향 */
  rest: Dir;
  leaving: boolean;
  agent: Agent | null;
  /** 지금 그림의 모자 번호(모습) */
  hat: number;
  isSub: boolean;
  pose: Pose;
  /** 머무를 때의 자세(계획) */
  restPose: Pose;
};

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class Cast {
  private readonly actors = new Map<string, Actor>();
  private first = true;
  /** 다시 연결한 뒤 첫 동기화는 기준만 기록(효과 없음) */
  private baseline = false;
  private agents: Agent[] | null = null;
  /** 이미 경고한 계획(좌표가 숫자가 아닐 때 매 프레임 경고·길찾기하지 않게) */
  private readonly warned = new Set<string>();
  private readonly scene: THREE.Scene;
  private readonly office: OfficeScene;
  private readonly onChange: () => void;
  /** 서버 시각(ms) — 쉼 자리가 몇 분마다 바뀌는 때를 화면끼리 맞추려고 */
  private readonly clock: () => number;
  /** 동작 줄이기 설정이면 폴짝을 끈다 */
  private readonly reduced: boolean;
  /** 모니터 판마다 작은 캔버스(사무실 책상 16×9, 개발실 32×16)와 자리별 상태 */
  private readonly deskPainters: ScreenPainter[];
  private readonly devPainters: ScreenPainter[];
  private deskStatus: (Status | null)[] = [];
  private devStatus: (Status | null)[] = [];
  /** 마지막으로 그린 시각 — sync가 animate 사이에 칠할 때 쓴다 */
  private screenT = 0;
  /** 앉기(seatedPreview — 앱은 기본 켜짐, `?seated=off`면 끔, still = 첫 칸에 멈춤). 여기 기본값 off는 테스트용 */
  private readonly seated: SeatedPreview;

  constructor(scene: THREE.Scene, office: OfficeScene, onChange: () => void, clock: () => number = Date.now, reduced = false, seated: SeatedPreview = 'off') {
    this.reduced = reduced;
    this.seated = seated;
    this.scene = scene;
    this.office = office;
    this.onChange = onChange;
    this.clock = clock;
    this.deskPainters = office.deskScreens.map((m) => new ScreenPainter(m, 16, 9));
    this.devPainters = office.devScreens.map((m) => new ScreenPainter(m, 32, 16));
  }

  sync(s: Snapshot): void {
    const agents = s.agents;
    this.agents = agents;
    const plans = this.planAll(agents);
    this.follow(plans);
    for (const a of agents) {
      const actor = this.actors.get(a.id);
      if (!actor) continue;
      actor.agent = a;
      actor.figure.setFace(faceFor(a.status));
      actor.bubble?.set(a);
      if (!actor.isSub) {
        if (!this.baseline) for (const ev of eventsFor(actor.prev, a.status)) this.fire(actor, ev);
        actor.prev = a.status;
      }
      if (actor.plate && actor.plate.element.textContent !== nameplateText(a)) actor.plate.element.textContent = nameplateText(a);
    }
    this.paintScreens(agents);
    this.first = false;
    this.baseline = false;
  }

  /** 연결이 다시 올라온 뒤: 이전 상태를 믿지 않고 다음 동기화를 기준으로만 쓴다 */
  rebase(): void {
    this.baseline = true;
    for (const actor of this.actors.values()) actor.prev = undefined;
  }

  /** 오래 안 보이다 돌아왔을 때: 계획을 다시 보고 모두를 지금 가야 할 자리에 바로 세운다(밀린 걸음을 되풀이하지 않게). 퇴근자는 다음 프레임에 사라진다. 그리는 프레임 안에서 부르면 notify=false(다시 그리기를 또 예약하면 프레임 반복이 두 줄이 된다) */
  settle(notify = true): void {
    if (!this.agents) return;
    this.follow(this.planAll(this.agents));
    for (const actor of this.actors.values()) {
      actor.route = [actor.target];
      actor.path = [actor.target];
      this.place(actor, actor.target);
      this.resetClock(actor);
    }
    if (notify) this.onChange();
  }

  /** 링 퍼짐이 진행 중인가(렌더 속도를 올리려고) */
  bursting(t: number): boolean {
    for (const a of this.actors.values()) if (a.burstAt !== null && burstElapsed(t, a.burstAt) < BURST_MS) return true;
    return false;
  }

  /** 화면을 그만 쓸 때: 떠 있는 반짝과 그 타이머를 정리 */
  dispose(): void {
    for (const actor of this.actors.values()) for (const o of [...actor.sparkles.keys()]) this.dropSparkle(actor, o);
  }

  private fire(actor: Actor, ev: FxEvent): void {
    if (ev === 'burst') {
      actor.burstAt = performance.now(); // 숨은 탭이면 프레임이 멈춰 있다가 돌아올 때 600ms를 넘어 있어 버려진다
      return;
    }
    const obj = new CSS2DObject(makeSparkle(document));
    obj.position.set(0, headTop() + 0.12, 0);
    actor.group.add(obj);
    actor.sparkles.set(obj, setTimeout(() => this.dropSparkle(actor, obj), this.reduced ? 800 : 1000));
  }

  private dropSparkle(actor: Actor, obj: CSS2DObject): void {
    clearTimeout(actor.sparkles.get(obj));
    actor.sparkles.delete(obj);
    actor.group.remove(obj);
    obj.element.remove();
  }

  /** 계획을 따른다: 없는 배우는 만들고, 가려는 곳이 바뀌었으면 길을 다시 잡고, 계획에서 빠진 배우는 퇴근시킨다 */
  private follow(plans: Map<string, Plan>): void {
    for (const [id, plan] of plans) {
      if (!Number.isFinite(plan.spot.x) || !Number.isFinite(plan.spot.y)) {
        if (!this.warned.has(id)) console.warn('[synthetic-office] 길을 못 구함', id, plan.spot);
        this.warned.add(id);
        continue; // 자리가 숫자가 아니면 있는 곳에 그대로 둔다
      }
      let actor = this.actors.get(id);
      if (!actor) {
        if (plan.leave) continue;
        actor = this.create(id, plan);
      } else if (lookFor(actor.hat) !== lookFor(plan.hat)) this.reshape(actor, plan);
      actor.leaving = plan.leave;
      actor.rest = plan.facing;
      actor.restPose = plan.pose;
      actor.sit = plan.sit;
      actor.effects = plan.effects;
      if (actor.ring) actor.ring.visible = !plan.leave && plan.effects.includes('ring');
      if (actor.target.x !== plan.spot.x || actor.target.y !== plan.spot.y) this.redirect(actor, plan.spot, plan.pace);
    }
    for (const [id, actor] of this.actors) {
      if (plans.has(id)) continue;
      actor.leaving = true;
      if (actor.ring) actor.ring.visible = false;
      actor.effects = [];
      if (actor.target.x !== DOOR.x || actor.target.y !== DOOR.y) this.redirect(actor, DOOR, 'free');
    }
  }

  /** 남아 있던 배우가 다른 모습을 받음(숨겼다 돌아온 세션은 빈 모습 중 무작위로 다시 받는데, 나가던 배우가 아직 남아 있으면 그대로 쓰인다) — 그림만 새 모습으로 바꿔 끼운다. 자세는 다음 프레임이 다시 맞춘다 */
  private reshape(actor: Actor, plan: Plan): void {
    const figure = new Figure(lookFor(plan.hat), plan.agent ? faceFor(plan.agent.status) : 'focused', actor.isSub ? SUB_SCALE : 1, this.onChange);
    actor.group.remove(actor.figure.root);
    actor.figure.dispose();
    actor.group.add(figure.root);
    actor.figure = figure;
    actor.hat = plan.hat;
  }

  /** 가려는 곳을 바꿈: 멈춰 있으면 거기서 새 길, 걷는 중이면 출발 자리로 되짚어 새 길로 이음(격자 방향 유지) */
  private redirect(actor: Actor, spot: Point, pace: Pace): void {
    const here = this.pos(actor);
    let path: Point[];
    if (actor.path.length > 1) {
      const k = segmentAt(actor.route, here);
      path = simplifyPath([...backwardFrom(actor.route, here), ...routeBetween(actor.route[0], spot).slice(1)]);
      actor.route = [...actor.route.slice(0, k + 1), ...path];
    } else {
      path = routeBetween(here, spot);
      actor.route = path.slice();
    }
    actor.target = spot;
    if (!path.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) {
      console.warn('[synthetic-office] 길을 못 구함', here, spot);
      path = [spot];
      actor.route = [spot];
      this.place(actor, spot);
    }
    this.walk(actor, path.slice(), pace);
  }

  /** dt 초만큼 걷고, 방향·그림을 맞춘다 */
  animate(t: number, dt: number): void {
    paintRacks(this.office.racks, rackStates(this.agents ?? []), t); // 랙 불빛(Codex 실행 중이면 빠르게)
    this.drawScreens(t); // 모니터도 같은 t로 — 실행 중 책상의 막대와 짝 랙이 같은 박자에 움직인다
    // 쉼 자리가 바뀌는 때를 곧바로 따라잡으려고 걷기 전에 계획을 다시 본다
    if (this.agents) this.follow(this.planAll(this.agents));
    const now = this.clock();
    for (const [id, actor] of this.actors) {
      if (actor.path.length > 1) {
        actor.clock += dt;
        const n = Math.floor(actor.clock * PACE_FPS[actor.pace]) - actor.steps;
        actor.steps += n;
        let budget = n * STEP;
        while (actor.path.length > 1 && budget > 1e-9) {
          const here = this.pos(actor);
          const next = actor.path[1];
          const d = dist(here, next);
          actor.dir = dirFor(next.x - here.x, next.y - here.y);
          if (d <= budget) {
            actor.path.shift();
            actor.path[0] = next;
            this.place(actor, next);
            budget -= d;
          } else {
            const k = budget / d;
            const p = { x: here.x + (next.x - here.x) * k, y: here.y + (next.y - here.y) * k };
            actor.path[0] = p;
            this.place(actor, p);
            budget = 0;
          }
        }
      }
      const walking = actor.path.length > 1;
      if (!walking && actor.leaving) {
        this.remove(id, actor);
        continue;
      }
      if (!walking) this.resetClock(actor);
      actor.pose = walking ? (actor.pace === 'free' ? 'stroll' : 'walk') : actor.restPose;
      // 업무 자세 그림이 없는 상태는 머무를 땐 서기 그림
      if (walking) actor.figure.show(actor.dir, (actor.phase + actor.steps) % WALK_FRAMES);
      else actor.figure.show(actor.rest, 'idle');
      // 책상에 닿았고 앉는 상태면 의자 가운데로 옮겨 앉는다(사람마다 위상을 달리한 같은 시계). 앉은 그림을 불러오는 동안은 서 있는 자리에 선다
      const seat = walking ? null : actor.sit;
      const sitting = seat !== null && actor.figure.sit(seat.dir, seatedFrame(seat.mode, this.seated === 'still' ? 0 : now + (hashId(id) % SEATED_CYCLE_MS)));
      const stage = sitting ? seat.at : actor.at;
      actor.group.position.set(stage.x, 0.04, stage.y);
      // 승인·질문 대기는 폴짝(손 흔드는 그림이 오기 전까지), 쉬는 중엔 Z
      actor.figure.lift(!walking && actor.effects.includes('wave') ? hopDots(t, this.reduced) : 0);
      if (actor.zzz) actor.zzz.visible = !walking && actor.effects.includes('zzz');
      if (actor.burstRing) this.drawBurst(actor, t);
      if (actor.ring?.visible) (actor.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.abs(Math.sin((t / 1400) * Math.PI));
    }
  }

  private drawBurst(actor: Actor, t: number): void {
    const ring = actor.burstRing!;
    const b = actor.burstAt === null ? null : ringBurst(burstElapsed(t, actor.burstAt));
    if (!b) {
      actor.burstAt = null;
      ring.visible = false;
      return;
    }
    ring.visible = !actor.leaving;
    ring.scale.setScalar(this.reduced ? 1 : b.scale); // 동작 줄이기: 퍼지지 않고 흐려지기만
    (ring.material as THREE.MeshBasicMaterial).opacity = b.opacity;
  }

  poses(): Pose[] {
    return [...this.actors.values()].map((a) => (a.path.length > 1 ? (a.pace === 'free' ? 'stroll' : 'walk') : a.pose));
  }

  /** 클릭한 캐릭터의 에이전트(하위 에이전트면 null) */
  pick(raycaster: THREE.Raycaster): Agent | null {
    const mains = [...this.actors.values()].filter((a) => !a.isSub);
    const hit = raycaster.intersectObjects(mains.flatMap((a) => a.figure.pickables()), false)[0];
    return hit ? (mains.find((a) => a.figure.pickables().includes(hit.object as THREE.Mesh))?.agent ?? null) : null;
  }

  private create(id: string, plan: Plan): Actor {
    const { hat, isSub } = plan;
    const dest = plan.spot;
    const scale = isSub ? SUB_SCALE : 1;
    const figure = new Figure(lookFor(hat), isSub ? 'focused' : 'neutral', scale, this.onChange);
    const group = new THREE.Group();
    group.add(figure.root);
    this.scene.add(group);
    let label: CSS2DObject | null = null;
    let plate: CSS2DObject | null = null;
    let bubble: ReturnType<typeof makeBubble> | null = null;
    let ring: THREE.Mesh | null = null;
    let burstRing: THREE.Mesh | null = null;
    let zzz: CSS2DObject | null = null;
    if (!isSub) {
      bubble = makeBubble(document);
      label = new CSS2DObject(bubble.el);
      label.position.set(0, headTop() + 0.12, 0);
      group.add(label);
      const plateEl = document.createElement('div');
      plateEl.className = 'nameplate';
      zzz = new CSS2DObject(makeZzz(document));
      zzz.position.set(0, headTop() + 0.12, 0); // 말풍선 옆(가로 비킴은 CSS margin)
      zzz.visible = false;
      group.add(zzz);
      plate = new CSS2DObject(plateEl);
      plate.position.set(0, 0, 0);
      group.add(plate);
      ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 40), new THREE.MeshBasicMaterial({ color: WAIT_COLOR, transparent: true, opacity: 1, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.visible = false;
      group.add(ring);
      // 퍼지는 링: 의자·책상에 가리지 않게 깊이 검사를 끄고 나중에 그림, 바닥 링과 겹쳐 깜빡이지 않게 살짝 위
      burstRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), new THREE.MeshBasicMaterial({ color: WAIT_COLOR, transparent: true, opacity: 1, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      burstRing.rotation.x = -Math.PI / 2;
      burstRing.position.y = 0.06;
      burstRing.renderOrder = 10;
      burstRing.visible = false;
      group.add(burstRing);
    }
    const route = this.first ? [dest] : pathTo(dest);
    const actor: Actor = {
      group, figure, label, plate, bubble, ring, burstRing, burstAt: null, prev: undefined, sparkles: new Map(), zzz, effects: plan.effects, route, target: dest, path: [route[0]], at: route[0], sit: plan.sit, pace: plan.pace,
      clock: 0, steps: 0, phase: 0, dir: 'SE', rest: plan.facing, leaving: false, agent: null, hat, isSub, pose: 'stand', restPose: plan.pose,
    };
    this.actors.set(id, actor);
    this.place(actor, route[0]);
    this.walk(actor, route.slice(), plan.pace); // 일을 받아 오는 길 = 2배 걸음, 쉬러 오는 길 = 그림 그대로
    return actor;
  }

  private walk(actor: Actor, path: Point[], pace: Pace): void {
    this.resetClock(actor);
    actor.path = path;
    actor.pace = pace;
    if (path.length > 1) actor.dir = dirFor(path[1].x - path[0].x, path[1].y - path[0].y);
  }

  private resetClock(actor: Actor): void {
    actor.phase = (actor.phase + actor.steps) % WALK_FRAMES;
    actor.clock = 0;
    actor.steps = 0;
  }

  private remove(id: string, actor: Actor): void {
    if (actor.label) actor.label.element.remove();
    if (actor.plate) actor.plate.element.remove();
    if (actor.zzz) actor.zzz.element.remove();
    if (actor.ring) {
      actor.ring.geometry.dispose();
      (actor.ring.material as THREE.Material).dispose();
    }
    if (actor.burstRing) {
      actor.burstRing.geometry.dispose();
      (actor.burstRing.material as THREE.Material).dispose();
    }
    for (const o of [...actor.sparkles.keys()]) this.dropSparkle(actor, o);
    actor.figure.dispose();
    this.scene.remove(actor.group);
    this.actors.delete(id);
  }

  private pos(actor: Actor): Point {
    return { ...actor.at };
  }

  private place(actor: Actor, p: Point): void {
    actor.at = { ...p };
    actor.group.position.set(p.x, 0.04, p.y);
  }

  private planAll(agents: Agent[]): Map<string, Plan> {
    return direct(agents, this.clock(), this.seated !== 'off');
  }

  /** 자리별 상태를 적어 두고(자리가 비면 null) 곧바로 한 번 칠한다 — 움직임은 animate가 프레임마다 이어 그린다 */
  private paintScreens(agents: Agent[]): void {
    const seats = (n: number, kind: 'claude' | 'codex') => {
      const st: (Status | null)[] = new Array<Status | null>(n).fill(null);
      for (const a of agents) if ((a.kind === 'codex' ? 'codex' : 'claude') === kind && a.seat >= 0 && a.seat < n) st[a.seat] = a.status;
      return st;
    };
    this.deskStatus = seats(this.deskPainters.length, 'claude'); // 사무실 책상
    this.devStatus = seats(this.devPainters.length, 'codex'); // 개발실 큰 모니터(자리 0~2)
    this.drawScreens(this.screenT);
  }

  /** 모니터 장면을 시각 t로 그린다 — 장면이 안 바뀐 화면은 ScreenPainter가 다시 그리지 않는다 */
  private drawScreens(t: number): void {
    this.screenT = t;
    this.deskPainters.forEach((p, i) => p.draw(screenFrame(this.deskStatus[i] ?? null, t)));
    this.devPainters.forEach((p, i) => p.draw(screenFrame(this.devStatus[i] ?? null, t)));
  }
}
