// 대화 게이지 갱신: 훅이 올 때 부르되, 세션마다 minGapMs에 한 번만 읽는다(막힌 부름은 간격이 차면 한 번 읽음).
import type { ContextReading } from './collectors/contextUsage.ts';
import type { OfficeState } from './state.ts';

type Slot = { last: number; timer: NodeJS.Timeout | null; running: boolean; again: boolean };

export function makeContextRefresher(o: {
  state: OfficeState;
  read: (file: string) => Promise<ContextReading>;
  onChange: () => void;
  now?: () => number;
  minGapMs?: number;
}): (sessionId: string, force?: boolean) => void {
  const now = o.now ?? Date.now;
  const gap = o.minGapMs ?? 5_000;
  const slots = new Map<string, Slot>();

  const run = async (sessionId: string, slot: Slot) => {
    const file = o.state.transcriptPathOf(sessionId);
    if (!file) return;
    if (slot.running) {
      slot.again = true;
      return;
    }
    slot.running = true;
    slot.last = now();
    const r = await o.read(file).catch(() => undefined);
    slot.running = false;
    if (r !== undefined && o.state.setContext(sessionId, r)) o.onChange();
    if (slot.again) {
      slot.again = false;
      void run(sessionId, slot);
    }
  };

  return (sessionId, force = false) => {
    if (!o.state.transcriptPathOf(sessionId)) return;
    let slot = slots.get(sessionId);
    if (!slot) {
      slot = { last: -Infinity, timer: null, running: false, again: false };
      slots.set(sessionId, slot);
    }
    const wait = gap - (now() - slot.last);
    if (force || wait <= 0) {
      if (slot.timer) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      void run(sessionId, slot);
    } else if (!slot.timer) {
      const s = slot;
      s.timer = setTimeout(() => {
        s.timer = null;
        void run(sessionId, s);
      }, wait);
    }
  };
}
