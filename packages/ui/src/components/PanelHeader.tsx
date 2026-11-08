import { cn } from '../lib/utils';

type PanelHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** The crumbs before the title, at 11 in text-3: ["Design"] reads "Design / Floor". */
  path?: string[];
  title: string;
  /** The right end: the switcher row of 26 IconKeyButtons, or a chip. */
  children?: React.ReactNode;
};

/** 40 tall, 12 left and 8 right, the breadcrumb at 11/12, the right end, a hairline below. */
function PanelHeader({ path = [], title, children, className, ...props }: PanelHeaderProps) {
  return (
    <div
      data-composite="panel-header"
      className={cn('flex h-10 w-full items-center gap-2 border-b border-line pr-2 pl-3', className)}
      {...props}
    >
      <span className="min-w-0 truncate text-[11px] text-text-3">
        {path.map((p) => `${p} / `)}
        <b className="text-[12px] font-medium text-text">{title}</b>
      </span>
      {children ? <div className="ml-auto flex shrink-0 items-center gap-[2px]">{children}</div> : null}
    </div>
  );
}

export { PanelHeader };
