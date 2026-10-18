import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from 'map-builder';

const noop = () => {};

// The dialog's heading. Only renders inside DialogContent, so the stories show
// it in place at two lengths.
export function Short() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>New map</DialogTitle>
          <DialogDescription className="mt-2">A short, verb-led title.</DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function Wrapping() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Remove “Timber Palisade” and everything drawn with it?</DialogTitle>
          <DialogDescription className="mt-2">
            A longer title wraps to two lines and keeps its spacing above the description.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
