import { useEffect, useRef, useState } from 'react';
import { Check, Ellipsis, Redo2, Undo2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';
import type { EditorChromeActions } from '@/App';
import { cn } from '@/lib/utils';
import { useTheme } from '../theme';
import { FOCUS_MODES, setLitPreview, useLitPreview, type FocusMode } from '../viewPrefs';

type MenuItem =
  | { kind: 'action'; label: string; keys?: string; onSelect: () => void }
  /** A row with a check mark: a checkbox, or one option of a radio group when `radio`. */
  | { kind: 'check'; label: string; keys?: string; checked: boolean; radio?: boolean; onSelect: () => void }
  /** A quiet heading over the rows that follow it. */
  | { kind: 'caption'; label: string; keys?: string }
  | 'divider';

const FOCUS_LABEL: Record<FocusMode, string> = { auto: 'Auto', manual: 'Manual', fullscreen: 'Fullscreen' };

interface TopActionsProps {
  actions: EditorChromeActions;
  /** "Map settings…". The dialog is the shell's, so it can show in any focus mode. */
  onOpenSettings: () => void;
}

/** Top-right: history, everything else behind "…", and the one primary action. */
export function TopActions({ actions, onOpenSettings }: TopActionsProps) {
  const canUndo = useStore((s) => s.ui.canUndo);
  const canRedo = useStore((s) => s.ui.canRedo);
  const focusMode = useStore((s) => s.ui.focusMode);
  const lit = useLitPreview();
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  const items: MenuItem[] = [
    { kind: 'action', label: 'Map settings…', onSelect: onOpenSettings },
    'divider',
    { kind: 'action', label: 'Export…', keys: 'Ctrl E', onSelect: actions.openExport },
    { kind: 'action', label: 'Import image…', keys: 'Ctrl I', onSelect: actions.importImage },
    'divider',
    { kind: 'action', label: 'Fit to content', keys: 'Ctrl 0', onSelect: () => zoomToFitRef.current?.() },
    'divider',
    { kind: 'caption', label: 'View' },
    { kind: 'check', label: 'Lit preview', keys: 'I', checked: lit, onSelect: () => setLitPreview(!lit) },
    { kind: 'caption', label: 'Focus', keys: '`' },
    ...FOCUS_MODES.map(
      (mode): MenuItem => ({
        kind: 'check',
        radio: true,
        label: FOCUS_LABEL[mode],
        checked: focusMode === mode,
        onSelect: () => useStore.getState().setFocusMode(mode),
      }),
    ),
    'divider',
    { kind: 'action', label: theme === 'dark' ? 'Light mode' : 'Dark mode', onSelect: toggleTheme },
  ];

  return (
    <div className="v2-float v2-bar-card v2-top-actions" data-keys="canvas" data-chrome ref={wrapRef}>
      <button
        type="button"
        className="v2-ib"
        aria-label="Undo (Ctrl Z)"
        data-tip="Undo"
        data-tip-key="Ctrl Z"
        data-tip-side="bottom"
        disabled={!canUndo}
        onClick={() => handleShortcut('ctrl+z')}
      >
        <Undo2 size={15} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="v2-ib"
        aria-label="Redo (Ctrl Y)"
        data-tip="Redo"
        data-tip-key="Ctrl Y"
        data-tip-side="bottom"
        disabled={!canRedo}
        onClick={() => handleShortcut('ctrl+y')}
      >
        <Redo2 size={15} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={cn('v2-ib', menuOpen && 'v2-ib--on')}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="v2-more"
        data-tip="More"
        data-tip-side="bottom"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Ellipsis size={15} strokeWidth={1.75} />
      </button>
      <span className="v2-vr" role="presentation" />
      <button type="button" className="v2-primary" data-testid="v2-publish" onClick={actions.openPublish}>
        Publish to Table
      </button>

      {menuOpen && (
        <div className="v2-menu v2-float" role="menu">
          {items.map((item, i) => {
            if (item === 'divider') return <div key={`d${i}`} className="v2-menu__sep" role="separator" />;
            if (item.kind === 'caption') {
              return (
                <div key={`c${i}`} className="v2-menu__caption" role="presentation">
                  <span>{item.label}</span>
                  {item.keys && <kbd>{item.keys}</kbd>}
                </div>
              );
            }
            const check = item.kind === 'check';
            return (
              <button
                key={item.label}
                type="button"
                role={check ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
                aria-checked={check ? item.checked : undefined}
                className={cn('v2-menu__item', check && 'v2-menu__item--check')}
                onClick={() => {
                  setMenuOpen(false);
                  item.onSelect();
                }}
              >
                {check && (
                  <span className="v2-menu__mark" aria-hidden>
                    {item.checked && <Check size={14} strokeWidth={2} />}
                  </span>
                )}
                <span className="v2-menu__label">{item.label}</span>
                {item.keys && <kbd>{item.keys}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
