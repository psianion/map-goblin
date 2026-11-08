import { cn } from '@dnd/ui';

export type GalleryTheme = 'light' | 'dark';

// Hover and focus can't be held still for a screenshot, so the gallery shows them with the
// classes the states paint.
export const HOVER = 'bg-panel-3 text-text';
export const FOCUS = 'outline outline-2 outline-offset-1 outline-focus';

type SectionProps = {
  id: string;
  title: string;
  /** The grey aside after the title, as the page has it. */
  small?: string;
  theme: GalleryTheme;
  /** The page's "Rules." line under the specimen box. */
  rules?: string;
  children: React.ReactNode;
};

/** One design-system section: the title, the specimen box for the current theme, its rules. */
function Section({ id, title, small, theme, rules, children }: SectionProps) {
  return (
    <section id={id} data-gallery-section={id} className="mt-12 border-t border-line pt-[18px]">
      <h2 className="mb-1 text-[16px] font-semibold text-text">
        {title}
        {small ? <small className="ml-2.5 font-mono text-[11px] font-normal text-text-3">{small}</small> : null}
      </h2>
      <div className="mt-3 rounded-[10px] border border-line bg-bg p-[18px] text-[12px] text-text">
        <div className="mb-3 font-mono text-[10px] tracking-[0.04em] text-text-3 uppercase">{theme}</div>
        {children}
      </div>
      {rules ? (
        <p className="mt-2.5 max-w-[76ch] font-mono text-[11px] leading-[1.7] text-text-2">
          <b className="font-medium text-text">Rules.</b> {rules}
        </p>
      ) : null}
    </section>
  );
}

/** A wrapping row of specimens, 20 apart down and 28 across. */
function Specimens({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-start gap-x-7 gap-y-5', className)} {...props} />;
}

/** One specimen with the page's caption under it. */
function Item({ cap, children }: { cap: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <div className="font-mono text-[10px] leading-[1.5] whitespace-pre text-text-3">{cap}</div>
    </div>
  );
}

export { Item, Section, Specimens };
