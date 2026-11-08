import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  InputRow,
  PrimaryButton,
} from '@dnd/ui';

/** A name changed in place: a level's, a layer's. Enter saves, Escape leaves it as it was. */
export function RenameDialog({
  open,
  title,
  label,
  value,
  onClose,
  onRename,
}: {
  open: boolean;
  title: string;
  label: string;
  value: string;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Keyed on the name it opens with, so each opening starts from the current name. */}
      {open && <RenameBody key={value} title={title} label={label} value={value} onClose={onClose} onRename={onRename} />}
    </Dialog>
  );
}

function RenameBody({ title, label, value, onClose, onRename }: { title: string; label: string; value: string; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(value);
  const save = () => {
    const next = name.trim();
    if (next && next !== value) onRename(next);
    onClose();
  };
  return (
    <DialogContent data-testid="shell-rename">
      <DialogTitle>{title}</DialogTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <InputRow label={label} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <PrimaryButton type="submit">Rename</PrimaryButton>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
