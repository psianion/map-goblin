import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { createDefaultShortcuts } from '@/shortcuts/defaultShortcuts';
import type { ShortcutDefinition } from '@/shortcuts/defaultShortcuts';

interface ShortcutHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

const CATEGORY_ORDER = ['Tools', 'Edit', 'File', 'View'] as const;

/** Split a key combo like "ctrl+shift+z" into display parts ["Ctrl", "Shift", "Z"]. */
function formatKeyCombo(keys: string): string[] {
  return keys.split('+').map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'ctrl') return isMac ? '\u2318' : 'Ctrl';
    if (lower === 'shift') return 'Shift';
    if (lower === 'alt') return isMac ? '\u2325' : 'Alt';
    if (lower === 'delete') return 'Del';
    if (lower === 'backspace') return 'Backspace';
    // Single character keys — uppercase
    if (part.length === 1) return part.toUpperCase();
    // Everything else — capitalize first letter
    return part.charAt(0).toUpperCase() + part.slice(1);
  });
}

function KeyBadge({ keys }: { keys: string }) {
  const parts = formatKeyCombo(keys);
  if (parts.length === 1) {
    return <Kbd>{parts[0]}</Kbd>;
  }
  return (
    <KbdGroup>
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && (
            <span className="text-text-muted text-[10px] select-none">+</span>
          )}
          <Kbd>{part}</Kbd>
        </span>
      ))}
    </KbdGroup>
  );
}

function CategorySection({
  category,
  shortcuts,
}: {
  category: string;
  shortcuts: ShortcutDefinition[];
}) {
  return (
    <div>
      <h3 className="uppercase tracking-wide text-text-muted text-xs font-sans mb-2">
        {category}
      </h3>
      <div className="space-y-1.5">
        {shortcuts.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-4">
            <span className="text-text-secondary text-sm">{s.label}</span>
            <KeyBadge keys={s.keys} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShortcutHelpDialog({
  open,
  onOpenChange,
}: ShortcutHelpDialogProps) {
  const allShortcuts = createDefaultShortcuts();

  // Group by category
  const grouped = new Map<string, ShortcutDefinition[]>();
  for (const s of allShortcuts) {
    const list = grouped.get(s.category) ?? [];
    list.push(s);
    grouped.set(s.category, list);
  }

  // Left column: Tools + Edit, Right column: File + View
  const leftCategories = CATEGORY_ORDER.filter(
    (c) => c === 'Tools' || c === 'Edit',
  );
  const rightCategories = CATEGORY_ORDER.filter(
    (c) => c === 'File' || c === 'View',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogClose className="text-muted-foreground hover:text-foreground transition-colors">
              &#x2715;
            </DialogClose>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {/* Left column: Tools + Edit */}
            <div className="space-y-6">
              {leftCategories.map((cat) => {
                const shortcuts = grouped.get(cat);
                if (!shortcuts?.length) return null;
                return (
                  <CategorySection
                    key={cat}
                    category={cat}
                    shortcuts={shortcuts}
                  />
                );
              })}
            </div>

            {/* Right column: File + View */}
            <div className="space-y-6">
              {rightCategories.map((cat) => {
                const shortcuts = grouped.get(cat);
                if (!shortcuts?.length) return null;
                return (
                  <CategorySection
                    key={cat}
                    category={cat}
                    shortcuts={shortcuts}
                  />
                );
              })}
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
