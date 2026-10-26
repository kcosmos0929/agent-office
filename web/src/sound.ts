import type { Snapshot, Status } from '../../src/shared/types.ts';

export type SoundKind = 'urgent' | 'soft';

/** 나를 기다리는 상태(❗·❓): 둘 사이로만 바뀌면 다시 울리지 않는다 */
const URGENT = new Set<Status | undefined>(['permission', 'question']);

/** 이전 스냅샷과 비교해 새로 '승인 필요'·'질문 대기'가 된 수만큼 urgent, 새로 '끝남'이 된 수만큼 soft. 첫 스냅샷은 조용히. */
export function soundEvents(prev: Snapshot | null, next: Snapshot): SoundKind[] {
  if (!prev) return [];
  const before = new Map(prev.agents.map((a) => [a.id, a.status]));
  const out: SoundKind[] = [];
  for (const a of next.agents) {
    const was = before.get(a.id);
    if (URGENT.has(a.status) && !URGENT.has(was)) out.push('urgent');
    else if (a.status === 'done' && was !== undefined && was !== 'done') out.push('soft');
  }
  return out;
}

/** 새로 고침 직전에 소리가 켜져 있었음을 sessionStorage에 남기는 값. 정확히 '1'일 때만 복원한다 */
export function shouldRestoreSound(stored: string | null): boolean {
  return stored === '1';
}

/** 브라우저는 사용자가 한 번 눌러야 소리를 낼 수 있다 → enable()은 버튼 클릭에서 부른다 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  softEnabled = true;

  get enabled(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  async enable(): Promise<void> {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
  }

  disable(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  play(kind: SoundKind): void {
    if (!this.ctx || !this.enabled) return;
    if (kind === 'soft') {
      if (this.softEnabled) this.tone(523, 0, 0.18, 0.08);
      return;
    }
    for (let i = 0; i < 3; i++) {
      this.tone(880, i * 0.5, 0.14, 0.12);
      this.tone(660, i * 0.5 + 0.16, 0.14, 0.12);
    }
  }

  private tone(freq: number, delay: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
