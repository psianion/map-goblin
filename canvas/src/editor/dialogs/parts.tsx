// The pieces every editor dialog is built from, on the Dialog primitive and the tokens:
// a head with the 13/500 title and a close button, a labelled field, a hint, an error line
// and the actions row (right aligned, primary last).

import { useId } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { DialogFooter, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/lib/utils';

/** Title left, a close button right. */
export function DialogHead({ title, onClose, closeDisabled }: { title: React.ReactNode; onClose: () => void; closeDisabled?: boolean }) {
  return (
    <div className="-mt-1 -mr-1 flex items-center justify-between gap-2">
      <DialogTitle>{title}</DialogTitle>
      <Button variant="ghost" size="icon-xs" aria-label="Close" disabled={closeDisabled} onClick={onClose}>
        <X aria-hidden strokeWidth={1.75} />
      </Button>
    </div>
  );
}

/** A label over its control, 6 between. */
export function Field({
  label,
  htmlFor,
  labelId,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  labelId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label id={labelId} htmlFor={htmlFor} className="text-[12px] text-text-2">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A label over a full-width select of plain options. */
export function SelectField({
  label,
  value,
  options,
  onValueChange,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <Field label={label} labelId={id}>
      <Select
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(next: string | null) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <SelectTrigger aria-labelledby={id} data-testid={testId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A quiet line under a field or a sentence: 11 in text-3. */
export function Hint({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('m-0 text-[11px] leading-[1.45] text-text-3', className)} {...props} />;
}

/** What went wrong, in the danger colour, read out as it appears. */
export function ErrorLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('m-0 flex items-start gap-1.5 text-[12px] leading-[1.45] text-danger', className)}>
      <AlertCircle aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The actions row: right aligned, 6 apart, primary last. */
export function Actions({ className, ...props }: React.ComponentProps<'div'>) {
  return <DialogFooter className={cn('pt-1', className)} {...props} />;
}
