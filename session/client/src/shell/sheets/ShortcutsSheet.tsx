import { Caption, Kbd, SettingRow } from '@dnd/ui';
import { useRole } from '../../session/store';
import { shortcutTable } from '../shortcutTable';
import { closeSheet } from './registry';
import { SheetFrame } from './SheetFrame';

/** Every key in one list (board 9), from the registries, so a key added there shows here. */
export function ShortcutsSheet() {
  const role = useRole();
  if (!role) return null;
  return (
    <SheetFrame title="Keyboard shortcuts" onClose={closeSheet} testId="shortcuts-sheet">
      <div className="flex flex-col gap-3 px-3 pt-2.5 pb-3">
        {shortcutTable(role).map((sec) => (
          <section key={sec.title} className="flex flex-col gap-px" data-section={sec.title}>
            <Caption className="mb-1.5">{sec.title}</Caption>
            {sec.rows.map((row) => (
              <SettingRow key={row.id} label={row.label} data-key-row={row.id} className="w-full">
                <span className="flex flex-wrap justify-end gap-1">
                  {row.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </SettingRow>
            ))}
          </section>
        ))}
      </div>
    </SheetFrame>
  );
}
