import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';

export type SegOption = { value: string; label: React.ReactNode; testId?: string; disabled?: boolean };

type SegProps = {
  options: SegOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

/** Segmented control: one hairline box 24 tall, cells 22 with 10 aside, the chosen cell panel-3. */
function Seg({ options, value, onValueChange, ...props }: SegProps) {
  return (
    <ToggleGroup
      data-composite="seg"
      value={[value]}
      // One cell is always chosen: pressing the chosen cell again keeps it.
      onValueChange={(next: string[]) => {
        if (next[0] !== undefined) onValueChange(next[0]);
      }}
      {...props}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} data-testid={o.testId} disabled={o.disabled}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export { Seg };
