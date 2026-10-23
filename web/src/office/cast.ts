// 등장인물 관리: 스냅샷의 에이전트·하위 에이전트를 캐릭터로 만들고, 걷기·자세·말풍선·링·책상 화면을 맞춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HAT_COLORS, KIND_COLOR, WAIT_COLOR, groupOf } from '../../../src/shared/labels.ts';
import type { Agent, Snapshot } from '../../../src/shared/types.ts';
import { makeBubble, nameplateText } from './bubbles.ts';
import { createCharacter, setPose } from './character.ts';
import { DOOR, meetingSpot, pathTo, seatPosition, type Point } from './layout.ts';
import { poseFor, type Pose } from './pose.ts';
import type { OfficeScene } from './scene.ts';

const SPEED = 2.2; // 격자 단위/초
const SCREEN = { off: '#3A404C', work: '#FFD9C7', wait: '#FFE7B3', done: '#D7F0DF' };

type Actor = {
  group: THREE.Group;
  label: CSS2DObject | null;
  plate: CSS2DObject | null;
  bubble: ReturnType<typeof makeBubble> | null;
  ring: THREE.Mesh | null;
  path: Point[];
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

  constructor(scene: THREE.Scene, office: OfficeScene) {
    this.scene = scene;
    this.office = office;
  }

  sync(s: Snapshot): void {
    const seen = new Set<string>();
    let subIndex = 0;
    for (const a of s.agents) {
      seen.add(a.id);
      const dest = seatPosition(a.seat);
      let actor = this.actors.get(a.id);
      if (!actor) {
        if (a.status === 'gone') continue;
        actor = this.create(a.id, KIND_COLOR[a.kind], HAT_COLORS[a.hat % HAT_COLORS.length], false);
        actor.path = this.first ? [dest] : pathTo(dest);
        this.place(actor, actor.path[0]);
      } else if (a.status === 'gone' && !actor.leaving) {
        this.leave(actor);
      } else if (a.status !== 'gone' && actor.leaving) {
        actor.leaving = false;
        actor.path = [this.pos(actor), dest];
      }
      actor.agent = a;
      actor.bubble?.set(a);
      if (actor.plate && actor.plate.element.textContent !== nameplateText(a)) actor.plate.element.textContent = nameplateText(a);
      if (actor.ring) actor.ring.visible = a.status === 'permission';

      for (const sub of a.subagents) {
        const sid = `${a.id}/${sub.id}`;
        seen.add(sid);
        if (!this.actors.has(sid)) {
          const sa = this.create(sid, KIND_COLOR[a.kind], HAT_COLORS[a.hat % HAT_COLORS.length], true);
          sa.path = this.first ? [meetingSpot(subIndex)] : pathTo(meetingSpot(subIndex));
          this.place(sa, sa.path[0]);
        }
        subIndex++;
      }
    }
    for (const [id, actor] of this.actors) {
      if (!seen.has(id) && !actor.leaving) this.leave(actor);
    }
    this.paintScreens(s.agents);
    this.first = false;
  }

  /** dt 초만큼 걷고, 자세를 맞춘다 */
  animate(t: number, dt: number): void {
    for (const [id, actor] of this.actors) {
      let step = SPEED * dt;
      while (actor.path.length > 1 && step > 0) {
        const here = this.pos(actor);
        const next = actor.path[1];
        const d = dist(here, next);
        if (d <= step) {
          actor.path.shift();
          actor.path[0] = next;
          this.place(actor, next);
          step -= d;
        } else {
          const k = step / d;
          const p = { x: here.x + (next.x - here.x) * k, y: here.y + (next.y - here.y) * k };
          actor.path[0] = p;
          this.place(actor, p);
          actor.group.rotation.y = Math.atan2(next.x - here.x, next.y - here.y);
          step = 0;
        }
      }
      const walking = actor.path.length > 1;
      if (!walking && actor.leaving) {
        this.remove(id, actor);
        continue;
      }
      if (!walking) actor.group.rotation.y = 0;
      actor.pose = walking ? 'walk' : actor.isSub ? 'type-fast' : actor.agent ? poseFor(actor.agent.status) : 'stand';
      setPose(actor.group, actor.pose, t);
      if (actor.ring?.visible) (actor.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.abs(Math.sin((t / 1400) * Math.PI));
    }
  }

  poses(): Pose[] {
    return [...this.actors.values()].map((a) => (a.path.length > 1 ? 'walk' : a.pose));
  }

  /** 클릭한 캐릭터의 에이전트(하위 에이전트면 null) */
  pick(raycaster: THREE.Raycaster): Agent | null {
    const groups = [...this.actors.values()].filter((a) => !a.isSub).map((a) => a.group);
    const hit = raycaster.intersectObjects(groups, true)[0];
    if (!hit) return null;
    for (const actor of this.actors.values()) {
      if (actor.isSub) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o === actor.group) return actor.agent;
        o = o.parent;
      }
    }
    return null;
  }

  private create(id: string, body: string, hat: string, isSub: boolean): Actor {
    const group = createCharacter(body, hat, isSub ? 0.7 : 1);
    group.position.set(DOOR.x, 0.04, DOOR.y);
    this.scene.add(group);
    let label: CSS2DObject | null = null;
    let plate: CSS2DObject | null = null;
    let bubble: ReturnType<typeof makeBubble> | null = null;
    let ring: THREE.Mesh | null = null;
    if (!isSub) {
      bubble = makeBubble(document);
      label = new CSS2DObject(bubble.el);
      label.position.set(0, 1.3, 0);
      group.add(label);
      const plateEl = document.createElement('div');
      plateEl.className = 'nameplate';
      plate = new CSS2DObject(plateEl);
      plate.position.set(0, 0, 0.3);
      group.add(plate);
      ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 40), new THREE.MeshBasicMaterial({ color: WAIT_COLOR, transparent: true, opacity: 1, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.visible = false;
      group.add(ring);
    }
    const actor: Actor = { group, label, plate, bubble, ring, path: [{ x: DOOR.x, y: DOOR.y }], leaving: false, agent: null, isSub, pose: 'stand' };
    this.actors.set(id, actor);
    return actor;
  }

  private leave(actor: Actor): void {
    actor.leaving = true;
    const here = this.pos(actor);
    const back = pathTo(here).reverse();
    actor.path = [here, ...back.slice(1)];
    if (actor.ring) actor.ring.visible = false;
  }

  private remove(id: string, actor: Actor): void {
    if (actor.label) actor.label.element.remove();
    if (actor.plate) actor.plate.element.remove();
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
