import { ToggleSwitch, PropertyField } from 'map-builder';

// `label` is aria-label ONLY — it never renders visible text. The app always
// pairs the switch with its own copy (a PropertyField label, or a sibling
// span in a flex row), so the previews compose it the same way.
const noop = () => {};

export function States() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <ToggleSwitch checked onChange={noop} label="Visible on table" />
        <span>On</span>
      </div>
      <div className="flex items-center gap-2">
        <ToggleSwitch checked={false} onChange={noop} label="Locked" />
        <span className="text-muted-foreground">Off</span>
      </div>
    </div>
  );
}

export function InPropertyField() {
  return (
    <div className="flex w-[260px] flex-col gap-2">
      <PropertyField label="Secret door">
        <ToggleSwitch checked onChange={noop} label="Secret door" />
      </PropertyField>
      <PropertyField label="Locked">
        <ToggleSwitch checked={false} onChange={noop} label="Locked" />
      </PropertyField>
    </div>
  );
}

export function SettingsList() {
  const rows: Array<[string, boolean]> = [
    ['Snap to grid', true],
    ['Show fog of war', true],
    ['Reveal DM notes', false],
    ['Dynamic lighting', false],
  ];
  return (
    <div className="flex w-[260px] flex-col gap-3 text-sm">
      {rows.map(([label, checked]) => (
        <div key={label} className="flex items-center justify-between gap-4">
          <span className={checked ? undefined : 'text-muted-foreground'}>{label}</span>
          <ToggleSwitch checked={checked} onChange={noop} label={label} />
        </div>
      ))}
    </div>
  );
}
