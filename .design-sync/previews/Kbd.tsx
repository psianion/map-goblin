import { Kbd } from 'map-builder';

export function Keys() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Kbd>W</Kbd>
      <Kbd>P</Kbd>
      <Kbd>Esc</Kbd>
      <Kbd>Enter</Kbd>
      <Kbd>Space</Kbd>
      <Kbd>ArrowUp</Kbd>
    </div>
  );
}

export function InProse() {
  return (
    <p className="text-sm">
      Press <Kbd>W</Kbd> for the wall tool, then <Kbd>Esc</Kbd> to drop back to select.
    </p>
  );
}
