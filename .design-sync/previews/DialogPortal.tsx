import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from 'map-builder';

const noop = () => {};

// Structural: it moves the backdrop and panel out to the document root so they
// escape the canvas stacking context. Nothing of it is visible on its own, so
// the story is the composition it enables.
export function Default() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Rendered through the portal</DialogTitle>
          <DialogDescription className="mt-2">
            Everything inside DialogPortal mounts at the document root, above the map canvas.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
