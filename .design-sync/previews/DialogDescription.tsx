import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from 'map-builder';

const noop = () => {};

// Muted supporting copy under the title. Renders only inside DialogContent.
export function OneLine() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <DialogTitle>Publish to table</DialogTitle>
          <DialogDescription className="mt-2">
            Players see the map the moment you publish.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function Paragraph() {
  return (
    <Dialog open onOpenChange={noop}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-md">
          <DialogTitle>Recover unsaved work</DialogTitle>
          <DialogDescription className="mt-2">
            A newer version of this map was found in this browser. It was saved automatically after
            your last publish, so it may contain edits the table has never seen. Restoring replaces
            the current document; discarding keeps what is on the table.
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
