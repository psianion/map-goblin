import { Kbd } from '../primitives/kbd';
import { cn } from '../lib/utils';

type KeyHintProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** One key, or the keys of a chord in order. */
  keys: string | string[];
  children: React.ReactNode;
};

/** A keycap and its short label, for the status bar and how-to lines: Enter close. */
function KeyHint({ keys, children, className, ...props }: KeyHintProps) {
  return (
    <span data-composite="key-hint" className={cn('inline-flex items-center gap-1.5', className)} {...props}>
      {(Array.isArray(keys) ? keys : [keys]).map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {children}
    </span>
  );
}

export { KeyHint };
