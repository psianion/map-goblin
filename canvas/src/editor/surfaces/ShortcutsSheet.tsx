import { useMemo } from 'react';
import { Caption, SettingRow } from '@/editor/components';
import { Kbd } from '@/ui/kbd';
import { shortcutTable } from '@/shortcuts/registryShortcuts';
import { useRegistry } from '@/editor/shell/registryContext';
import { shellShortcuts } from '@/editor/shell/shellKeys';
import { SheetFrame } from './SheetFrame';

/**
 * Every key in one list: the rail and families, each family's tools and the keys each tool
 * answers in hand, Select's, then the hand-written chords by group. Both parts come from
 * one table, so a key added to the registry shows here without anyone writing it in.
 */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const { registry } = useRegistry();
  const sections = useMemo(() => shortcutTable(registry, shellShortcuts(registry)), [registry]);
  return (
    <SheetFrame title="Keyboard shortcuts" onClose={onClose} testId="shell-shortcuts">
      <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3">
        {sections.map((sec) => (
          <section key={sec.title} className="flex flex-col gap-px" data-section={sec.title}>
            <Caption className="mb-1.5">{sec.title}</Caption>
            {sec.rows.map((row) => (
              <SettingRow key={row.id} label={row.label} data-key-row={row.id}>
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
