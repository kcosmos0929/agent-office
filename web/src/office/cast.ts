// 등장인물 관리: 스냅샷의 에이전트·하위 에이전트를 도트 캐릭터로 만들고, 걷기·방향·표정·말풍선·링·책상 화면을 맞춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WAIT_COLOR, groupOf } from '../../../src/shared/labels.ts';
import type { Agent, Snapshot } from '../../../src/shared/types.ts';
import { makeBubble, nameplateText } from './bubbles.ts';
import { DOOR, backwardFrom, pathTo, routeBetween, segmentAt, simplifyPath, type Point } from './layout.ts';
import { direct, type Plan } from './director.ts';
import { paintRacks, rackStates } from './rack.ts';
import type { Pose } from './pose.ts';
import type { OfficeScene } from './scene.ts';
import { Figure } from './sprites/figure.ts';
import { dirFor, faceFor, headTop, lookFor, PACE_FPS, STEP, WALK_FRAMES, type Dir, type Pace } from './sprites/look.ts';

const SUB_SCALE = 0.8; // 도우미는 매니저와 같은 옷, 조금 작게
const SCREEN = { off: '#3A404C', work: '#FFD9C7', wait: '#FFE7B3', done: '#D7F0DF' };

type Actor = {
  group: THREE.Group;
  figure: Figure;
  label: CSS2DObject | null;
  plate: CSS2DObject | null;
  bubble: ReturnType<typeof makeBubble> | null;
  ring: THREE.Mesh | null;
  /** 지금 걷는 길 전체(출발 자리 → 목적지, 되짚은 구간 포함) — 걷는 중 목적지가 바뀌면 여기서 되짚는다 */
  route: Point[];
  /** 가려는 곳(계획의 자리와 좌표로 견줌) */
  target: Point;
  /** 남은 길(path[0] = 지금 위치) */
  path: Point[];
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
  private agents: Agent[] | null = null;
  /** 이미 경고한 계획(좌표가 숫자가 아닐 때 매 프레임 경고·길찾기하지 않게) */
  private readonly warned = new Set<string>();
  private readonly scene: THREE.Scene;
  private readonly office: OfficeScene;
  private readonly onChange: () => void;
  /** 서버 시각(ms) — 쉼 자리가 몇 분마다 바뀌는 때를 화면끼리 맞추려고 */
  private readonly clock: () => number;

  constructor(scene: THREE.Scene, office: OfficeScene, onChange: () => void, clock: () => number = Date.now) {
    this.scene = scene;
    this.office = office;
    this.onChange = onChange;
    this.clock = clock;
  }

  sync(s: Snapshot): void {
    const agents = s.agents;
    this.agents = agents;
    const plans = direct(agents, this.clock());
    this.follow(plans);
    for (const a of agents) {
      const actor = this.actors.get(a.id);
      if (!actor) continue;
      actor.agent = a;
      actor.figure.setFace(faceFor(a.status));
      actor.bubble?.set(a);
      if (actor.plate && actor.plate.element.textContent !== nameplateText(a)) actor.plate.element.textContent = nameplateText(a);
    }
    this.paintScreens(agents);
    this.first = false;
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
      }
      actor.leaving = plan.leave;
      actor.rest = plan.facing;
      actor.restPose = plan.pose;
      if (actor.ring) actor.ring.visible = !plan.leave && plan.effects.includes('ring');
      if (actor.target.x !== plan.spot.x || actor.target.y !== plan.spot.y) this.redirect(actor, plan.spot, plan.pace);
    }
    for (const [id, actor] of this.actors) {
      if (plans.has(id)) continue;
      actor.leaving = true;
      if (actor.ring) actor.ring.visible = false;
      if (actor.target.x !== DOOR.x || actor.target.y !== DOOR.y) this.redirect(actor, DOOR, 'free');
    }
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
    // 쉼 자리가 바뀌는 때를 곧바로 따라잡으려고 걷기 전에 계획을 다시 본다
    if (this.agents) this.follow(direct(this.agents, this.clock()));
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
      // 업무 자세 그림이 오기 전까지 머무를 땐 서기 그림
      if (walking) actor.figure.show(actor.dir, (actor.phase + actor.steps) % WALK_FRAMES);
      else actor.figure.show(actor.rest, 'idle');
      if (actor.ring?.visible) (actor.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.abs(Math.sin((t / 1400) * Math.PI));
    }
  }

  poses(): Pose[] {
    return [...this.actors.values()].map((a) => (a.path.length > 1 ? (a.pace === 'free' ? 'stroll' : 'walk') : a.pose));
  }

  /** 클릭한 캐릭터의 에이전트(하위 에이전트면 null) */
  pick(raycaster: THREE.Raycaster): Agent | null {
    const mains = [...this.actors.values()].filter((a) => !a.isSub);
    const hit = raycaster.intersectObjects(mains.map((a) => a.figure.mesh), false)[0];
    return hit ? (mains.find((a) => a.figure.mesh === hit.object)?.agent ?? null) : null;
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
    if (!isSub) {
      bubble = makeBubble(document);
      label = new CSS2DObject(bubble.el);
      label.position.set(0, headTop() + 0.12, 0);
      group.add(label);
      const plateEl = document.createElement('div');
      plateEl.className = 'nameplate';
      plate = new CSS2DObject(plateEl);
      plate.position.set(0, 0, 0);
      group.add(plate);
      ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 40), new THREE.MeshBasicMaterial({ color: WAIT_COLOR, transparent: true, opacity: 1, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.visible = false;
      group.add(ring);
    }
    const route = this.first ? [dest] : pathTo(dest);
    const actor: Actor = {
      group, figure, label, plate, bubble, ring, route, target: dest, path: [route[0]], pace: plan.pace,
      clock: 0, steps: 0, phase: 0, dir: 'SE', rest: plan.facing, leaving: false, agent: null, isSub, pose: 'stand', restPose: plan.pose,
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
    if (actor.ring) {
      actor.ring.geometry.dispose();
      (actor.ring.material as THREE.Material).dispose();
    }
    actor.figure.dispose();
    this.scene.remove(actor.group);
    this.actors.delete(id);
  }

  private pos(actor: Actor): Point {
    return { x: actor.group.position.x, y: actor.group.position.z };
  }

  private place(actor: Actor, p: Point): void {
    actor.group.position.set(p.x, 0.04, p.y);
  }

  private paintScreens(agents: Agent[]): void {
    const paint = (screens: THREE.Mesh[], kind: 'claude' | 'codex') => {
      const colors = screens.map(() => SCREEN.off);
      for (const a of agents) {
        if ((a.kind === 'codex' ? 'codex' : 'claude') !== kind || a.seat < 0 || a.seat >= colors.length) continue;
        const g = groupOf(a.status);
        colors[a.seat] = g === 'urgent' ? SCREEN.wait : g === 'waiting' ? SCREEN.done : g === 'working' && a.status !== 'stalled' ? SCREEN.work : SCREEN.off;
      }
      screens.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.set(colors[i]));
    };
    paint(this.office.deskScreens, 'claude'); // 사무실 책상
    paint(this.office.devScreens, 'codex'); // 개발실 큰 모니터(자리 0~2)
  }
}
