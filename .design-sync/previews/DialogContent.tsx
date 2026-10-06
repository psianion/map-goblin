import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from 'map-builder';

const noop = () => {};

// DialogContent is the panel itself. It only renders inside Dialog > DialogPortal,
// so every story is the full composition with the width varied — that is the
// prop teams actually reach for.
export function Small() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription className="mt-2">
            Publish before leaving, or your last three edits stay local.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function Wide() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-2xl">
          <DialogTitle>Export map</DialogTitle>
          <DialogDescription className="mt-2">
            A wider panel for content that needs room — export options, pack browsers, anything
            with columns.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
