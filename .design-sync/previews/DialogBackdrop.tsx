import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from 'map-builder';

const noop = () => {};

// The scrim behind the panel. It has no content of its own, so the only
// meaningful render is in place — the dimmed field around DialogContent.
export function Default() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Backdrop in place</DialogTitle>
          <DialogDescription className="mt-2">
            The scrim dims the canvas behind the panel and closes the dialog on click.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
