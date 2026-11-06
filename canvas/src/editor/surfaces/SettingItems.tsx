// A setting bound to its value: tool settings read and write the store through the
// registry's parse boundary; card fields read the picked object and write through the def.

import { useStore } from '@/store/store';
import type { CardFieldDef, SettingDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useSettingGetter, useSettingValue } from './hooks';
import { DockControl, FieldControl } from './SettingControl';

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

export function CardField({ field, object, ids }: { field: CardFieldDef; object: unknown; ids: readonly string[] }) {
  const read = field.read as (o: unknown) => unknown;
  if (field.visibleWhen && !(field.visibleWhen as (o: unknown) => boolean)(object)) return null;
  const onChange = (v: unknown) => {
    const parsed = field.schema.safeParse(v);
    if (parsed.success) field.write(useStore, ids, parsed.data);
  };
  return (
    <div data-setting={field.id}>
      <FieldControl meta={field} value={read(object)} onChange={onChange} />
    </div>
  );
}
