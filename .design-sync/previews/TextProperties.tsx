import { TextProperties } from 'map-builder';

const noop = () => {};

// Valid TextChild objects composed from the real interface — map text is
// almost always a room label or a smaller keyed annotation.
const roomLabel = {
  id: 'preview-text-1',
  name: 'Room label',
  childType: 'text' as const,
  visible: true,
  text: 'Warren Clearing',
  position: { x: 260, y: 180 },
  rotation: 0,
  scale: 1,
  fontSize: 24,
  color: '#eae8e9',
  width: 220,
  height: 32,
};

const keyedNote = {
  ...roomLabel,
  id: 'preview-text-2',
  name: 'Keyed note',
  text: '3. Collapsed tunnel',
  fontSize: 14,
  color: '#c8a45c',
};

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TextProperties label={roomLabel} onDeselect={noop} />
    </div>
  );
}

export function KeyedNote() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TextProperties label={keyedNote} onDeselect={noop} />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TextProperties
        label={roomLabel}
        onDeselect={noop}
        openSections={new Set()}
        onToggleSection={noop}
      />
    </div>
  );
}
