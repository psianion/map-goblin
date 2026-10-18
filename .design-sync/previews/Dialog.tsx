import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Button,
} from 'map-builder';

const noop = () => {};

// The canonical composition, copied from ConfirmDialog: Dialog > DialogPortal >
// DialogBackdrop + DialogContent > Title / Description / actions.
export function Confirm() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Delete “Warren Clearing”?</DialogTitle>
          <DialogDescription className="mt-2">
            This removes the map and every layer on it. Sessions already run from it keep their
            history.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">Delete map</Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function WithForm() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-md">
          <DialogTitle>New map</DialogTitle>
          <DialogDescription className="mt-2">
            Give it a name. You can rename it later from the maps panel.
          </DialogDescription>
          <input
            readOnly
            value="Goblin Warren — lower level"
            className="mt-4 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost">Cancel</Button>
            <Button>Create map</Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
