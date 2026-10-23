import type { Snapshot } from '../../src/shared/types.ts';

/** /ws에 붙어 스냅샷을 받는다. 끊기면 1초부터 두 배씩, 최대 10초 간격으로 다시 붙는다 */
export function connect(onSnapshot: (s: Snapshot) => void, onStatus: (up: boolean) => void): () => void {
  let delay = 1000;
  let closed = false;
  let ws: WebSocket | null = null;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 1000;
      onStatus(true);
    };
    ws.onmessage = (m) => {
      const data = JSON.parse(String(m.data)) as { type: string } & Snapshot;
      if (data.type !== 'snapshot') return;
      onSnapshot({ agents: data.agents, usage: data.usage, now: data.now });
    };
    ws.onclose = () => {
      onStatus(false);
      if (closed) return;
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
