import { cn } from '@/lib/utils';

type SettingRowProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  label: React.ReactNode;
  /** Id on the label, so the control can point at it with aria-labelledby. */
  labelId?: string;
  htmlFor?: string;
  children: React.ReactNode;
};

/** A panel or card row: 248 wide, 28 minimum, label left in text-2, control right. */
function SettingRow({ label, labelId, htmlFor, children, className, ...props }: SettingRowProps) {
  return (
    <div
      data-composite="setting-row"
      className={cn('grid min-h-7 w-[248px] grid-cols-[1fr_auto] items-center gap-x-2.5', className)}
      {...props}
    >
      <label id={labelId} htmlFor={htmlFor} className="min-w-0 truncate text-[12px] text-text-2">
        {label}
      </label>
      {children}
    </div>
  );
}

export { SettingRow };
