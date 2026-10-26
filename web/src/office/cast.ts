// 등장인물 관리: 스냅샷의 에이전트·하위 에이전트를 도트 캐릭터로 만들고, 걷기·방향·표정·말풍선·링·책상 화면을 맞춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WAIT_COLOR, groupOf } from '../../../src/shared/labels.ts';
import type { Agent, Snapshot } from '../../../src/shared/types.ts';
import { makeBubble, nameplateText } from './bubbles.ts';
import { backwardFrom, facingAt, forwardFrom, meetingSpot, pathTo, seatPosition, waitingSpot, type Point } from './layout.ts';
import { poseFor, type Pose } from './pose.ts';
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
  /** 입구 → 머무는 곳 */
  route: Point[];
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
};

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class Cast {
  private readonly actors = new Map<string, Actor>();
  private first = true;
  private readonly scene: THREE.Scene;
  private readonly office: OfficeScene;
  private readonly onChange: () => void;

  constructor(scene: THREE.Scene, office: OfficeScene, onChange: () => void) {
    this.scene = scene;
    this.office = office;
    this.onChange = onChange;
  }

  sync(s: Snapshot): void {
    const seen = new Set<string>();
    let subIndex = 0;
    let waitIndex = 0;
    for (const a of s.agents) {
      seen.add(a.id);
      const dest = a.seat >= 0 ? seatPosition(a.seat) : waitingSpot(waitIndex++);
      let actor = this.actors.get(a.id);
      if (!actor) {
        if (a.status === 'gone') continue;
        actor = this.create(a.id, a.hat, false, dest);
      } else if (a.status === 'gone' && !actor.leaving) {
        this.leave(actor);
      } else if (a.status !== 'gone' && actor.leaving) {
        actor.leaving = false;
        this.walk(actor, forwardFrom(actor.route, this.pos(actor)), 'work');
      }
      actor.agent = a;
      actor.figure.setFace(faceFor(a.status));
      actor.bubble?.set(a);
      if (actor.plate && actor.plate.element.textContent !== nameplateText(a)) actor.plate.element.textContent = nameplateText(a);
      if (actor.ring) actor.ring.visible = a.status === 'permission';

      for (const sub of a.subagents) {
        const sid = `${a.id}/${sub.id}`;
        seen.add(sid);
        if (!this.actors.has(sid)) this.create(sid, a.hat, true, meetingSpot(subIndex));
        subIndex++;
      }
    }
    for (const [id, actor] of this.actors) {
      if (!seen.has(id) && !actor.leaving) this.leave(actor);
    }
    this.paintScreens(s.agents);
    this.first = false;
  }

  /** dt 초만큼 걷고, 방향·그림을 맞춘다 */
  animate(t: number, dt: number): void {
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
      actor.pose = walking ? 'walk' : actor.isSub ? 'type-fast' : actor.agent ? poseFor(actor.agent.status) : 'stand';
      // 업무 자세 그림이 오기 전까지 머무를 땐 서기 그림
      if (walking) actor.figure.show(actor.dir, (actor.phase + actor.steps) % WALK_FRAMES);
      else actor.figure.show(actor.rest, 'idle');
      if (actor.ring?.visible) (actor.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.abs(Math.sin((t / 1400) * Math.PI));
    }
  }

  poses(): Pose[] {
    return [...this.actors.values()].map((a) => (a.path.length > 1 ? 'walk' : a.pose));
  }

  /** 클릭한 캐릭터의 에이전트(하위 에이전트면 null) */
  pick(raycaster: THREE.Raycaster): Agent | null {
    const mains = [...this.actors.values()].filter((a) => !a.isSub);
    const hit = raycaster.intersectObjects(mains.map((a) => a.figure.mesh), false)[0];
    return hit ? (mains.find((a) => a.figure.mesh === hit.object)?.agent ?? null) : null;
  }

  private create(id: string, hat: number, isSub: boolean, dest: Point): Actor {
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
    const f = facingAt(dest);
    const route = this.first ? [dest] : pathTo(dest);
    const actor: Actor = {
      group, figure, label, plate, bubble, ring, route, path: [route[0]], pace: 'work',
      clock: 0, steps: 0, phase: 0, dir: 'SE', rest: dirFor(f.x, f.y), leaving: false, agent: null, isSub, pose: 'stand',
    };
    this.actors.set(id, actor);
    this.place(actor, route[0]);
    this.walk(actor, route.slice(), 'work'); // 일을 받아 오는 길 = 2배 걸음
    return actor;
  }

  /** 일이 끝나 나가는 길 = 그림 그대로 걸음 */
  private leave(actor: Actor): void {
    actor.leaving = true;
    if (actor.route.length < 2) actor.route = pathTo(actor.route[0]);
    this.walk(actor, backwardFrom(actor.route, this.pos(actor)), 'free');
    if (actor.ring) actor.ring.visible = false;
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
    const colors = this.office.deskScreens.map(() => SCREEN.off);
    for (const a of agents) {
      if (a.seat < 0 || a.seat >= colors.length) continue;
      const g = groupOf(a.status);
      colors[a.seat] = g === 'urgent' ? SCREEN.wait : g === 'waiting' ? SCREEN.done : g === 'working' && a.status !== 'stalled' ? SCREEN.work : SCREEN.off;
    }
    this.office.deskScreens.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.set(colors[i]));
  }
}
