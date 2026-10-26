// 서버가 새 빌드로 바뀌면 열린 화면이 스스로 한 번만 새로 고친다.

/**
 * loaded: 이 화면을 받을 때의 빌드, seen: 방금 스냅샷이 알려 준 서버의 빌드,
 * done: 이 탭이 이미 새로 고침을 마친 빌드(sessionStorage). 새 빌드이고 아직 안 했을 때만 true.
 */
export function shouldReload(loaded: string | null, seen: string | null, done: string | null): boolean {
  if (loaded === null || seen === null) return false;
  return seen !== loaded && seen !== done;
}

const KEY = 'so-reloaded-for';

/** 새 빌드를 보면 한 번 새로 고침. sessionStorage가 막혀 있으면 무한 반복을 피하려고 하지 않는다 */
export function reloadOnce(loaded: string | null, seen: string | null): void {
  let done: string | null;
  try {
    done = sessionStorage.getItem(KEY);
  } catch {
    return;
  }
  if (!shouldReload(loaded, seen, done) || seen === null) return;
  try {
    sessionStorage.setItem(KEY, seen);
  } catch {
    return;
  }
  location.reload();
}
