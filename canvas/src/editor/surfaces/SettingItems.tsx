// A setting bound to its value: tool settings read and write the store through the
// registry's parse boundary; card fields read the picked object and write through the def.

import { useStore } from '@/store/store';
import type { CardFieldDef, SettingDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useSettingGetter, useSettingValue } from './hooks';
import { DockControl, FieldControl } from './SettingControl';
import { sharedValue } from './model';

function useVisible(def: SettingDef): boolean {
  const get = useSettingGetter();
  return def.visibleWhen ? def.visibleWhen(get) : true;
}

export function ToolSetting({ def, compact = false }: { def: SettingDef; compact?: boolean }) {
  const { settings } = useRegistry();
  const value = useSettingValue(def);
  const visible = useVisible(def);
  if (!visible) return null;
  const onChange = (v: unknown) => settings.setSetting(def.id, v);
  const Control = compact ? DockControl : FieldControl;
  return (
    <div data-setting={def.id} className={compact ? 'flex items-center' : undefined}>
      <Control meta={def} value={value} onChange={onChange} />
    </div>
  );
}

/**
 * One field of a card. With `objects` (a card that edits several, `CardDef.multi`) it shows the
 * value they share or "Mixed", and a mixed field with its own mixed control (`field.mixed`)
 * draws and writes through that.
 */
export function CardField({ field, object, ids, objects }: { field: CardFieldDef; object: unknown; ids: readonly string[]; objects?: readonly unknown[] }) {
  const visible = field.visibleWhen as ((o: unknown) => boolean) | undefined;
  if (visible && !(objects ?? [object]).every((o) => visible(o))) return null;
  const { value, mixed } = objects && objects.length > 1 ? sharedValue(field, objects) : { value: (field.read as (o: unknown) => unknown)(object), mixed: false };
  const own = mixed ? field.mixed : undefined;
  const onChange = (v: unknown) => {
    // A mixed control hands its own kind of value (a turn, not an angle): its write checks it.
    if (own) {
      own.write(useStore, ids, v);
      return;
    }
    const parsed = field.schema.safeParse(v);
    if (parsed.success) field.write(useStore, ids, parsed.data);
  };
  const Mixed = own?.render;
  return (
    <div data-setting={field.id} data-mixed={mixed ? '' : undefined}>
      {Mixed ? <Mixed def={field} value={value} onChange={onChange} mixed /> : <FieldControl meta={field} value={value} onChange={onChange} mixed={mixed} />}
    </div>
  );
}
