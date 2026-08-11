// Reports real load milestones to the first-paint loader rig (see the inline
// script in index.html, which owns the weights and the pen). A no-op once the
// loader has exited and deleted its hook, and on the server.
declare global {
  interface Window {
    __ggMark?: (name: string) => void;
  }
}

export function markLoad(name: 'react' | 'scene-code' | 'scene' | 'frame') {
  if (typeof window !== 'undefined') window.__ggMark?.(name);
}
