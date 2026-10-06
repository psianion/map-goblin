import { Dialog, DialogTrigger, Button } from 'map-builder';

const noop = () => {};

// Opens the dialog it is nested in. Its render is the CLOSED state — the
// trigger itself — because a static card cannot perform the click that opens
// the panel. Rendering the closed state is what is honestly true here.
export function Closed() {
  return (
    <Dialog open={false} onOpenChange={noop}>
      <DialogTrigger>
        <Button variant="outline">Export map…</Button>
      </DialogTrigger>
    </Dialog>
  );
}
