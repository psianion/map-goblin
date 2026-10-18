import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'map-builder';

const noop = () => {};

// Dismisses the dialog without wiring an onOpenChange handler at the call site.
// Only renders inside DialogContent.
export function Default() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription className="mt-2">
            The close control dismisses the dialog on its own.
          </DialogDescription>
          <div className="mt-6 flex justify-end">
            <DialogClose className="rounded bg-surface-2 px-3 py-1.5 text-sm">
              Keep editing
            </DialogClose>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
