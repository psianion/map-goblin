import { Kbd, KbdGroup } from 'map-builder';

export function Chords() {
  return (
    <div className="flex flex-col items-start gap-3">
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>Z</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>N</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>Alt</Kbd>
        <Kbd>Click</Kbd>
      </KbdGroup>
    </div>
  );
}

export function ShortcutRows() {
  const rows: Array<[string, string[]]> = [
    ['Undo', ['Ctrl', 'Z']],
    ['Redo', ['Ctrl', 'Y']],
    ['Fit to content', ['Ctrl', '0']],
    ['Toggle maps panel', ['Ctrl', 'Shift', 'M']],
  ];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {rows.map(([label, keys]) => (
        <div key={label} className="flex items-center justify-between gap-6">
          <span>{label}</span>
          <KbdGroup>
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        </div>
      ))}
    </div>
  );
}
