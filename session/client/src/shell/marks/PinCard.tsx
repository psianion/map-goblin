import { useEffect, useState } from 'react';
import { Button, SwitchRow } from '@dnd/ui';
import { MapCard } from '../MapCard';
import { useTableShell } from '../tableShell';
import { deletePin, updatePin, useLocalPins, usePins, type Pin } from './pins';

function PinEditor({ pin }: { pin: Pin }) {
  const [text, setText] = useState(pin.text);
  return (
    <MapCard testId="pin-card" title="Pin" at={() => ({ x: pin.x, y: pin.y })} onClose={() => useTableShell.getState().closeCard()}>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          updatePin(pin.id, { text: text.trim() });
          useTableShell.getState().closeCard();
        }}
      >
        <textarea
          autoFocus
          value={text}
          rows={2}
          maxLength={280}
          aria-label="Pin text"
          data-testid="pin-text"
          placeholder="What is here"
          className="rounded-control border border-line bg-panel px-2 py-1 text-xs text-text"
          onChange={(e) => setText(e.target.value)}
        />
        <SwitchRow label="DM only" className="w-full" checked={pin.dmOnly} onCheckedChange={(dmOnly) => updatePin(pin.id, { dmOnly })} />
        <div className="flex justify-between gap-1">
          <Button variant="destructive" size="sm" data-testid="pin-delete" onClick={() => deletePin(pin.id)}>
            Delete
          </Button>
          <Button type="submit" variant="default" size="sm" data-testid="pin-save">
            Save
          </Button>
        </div>
      </form>
    </MapCard>
  );
}

/** The card of the pin being written on; opens itself for a pin the server just handed back. */
export function PinCard() {
  const pins = usePins();
  const card = useTableShell((s) => s.card);
  const pendingAt = useLocalPins((s) => s.pendingAt);

  useEffect(() => {
    if (!pendingAt) return;
    const fresh = [...pins].reverse().find((p) => p.x === pendingAt.x && p.y === pendingAt.y);
    if (!fresh) return;
    useLocalPins.setState({ pendingAt: null });
    useTableShell.getState().openCard(`pin:${fresh.id}`);
  }, [pins, pendingAt]);

  const pin = card?.startsWith('pin:') ? pins.find((p) => `pin:${p.id}` === card) : undefined;
  return pin ? <PinEditor key={pin.id} pin={pin} /> : null;
}
