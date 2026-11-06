import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

type FoldProps = {
  title: string;
  /** One mono line that stands in for the rows while the fold is shut. */
  summary?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
};

/** Shut it is one line, a chevron, its title and a mono summary; open it shows its rows. */
function Fold({ title, summary, defaultOpen = false, open, onOpenChange, children, className }: FoldProps) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <div data-composite="fold" data-open={isOpen ? '' : undefined} className={cn('flex w-[248px] flex-col', className)}>
      <Button
        variant="ghost"
        aria-expanded={isOpen}
        onClick={() => {
          setOwn(!isOpen);
          onOpenChange?.(!isOpen);
        }}
        className="h-auto min-h-7 w-full justify-start gap-2 rounded-control border-0 px-0 text-[12px] leading-normal text-text-2 hover:bg-transparent hover:text-text aria-expanded:bg-transparent aria-expanded:text-text-2"
      >
        <Chevron aria-hidden strokeWidth={1.75} className="size-3.5" />
        {title}
        {!isOpen && summary ? (
          <small className="min-w-0 truncate font-mono text-[10px] text-text-3">{summary}</small>
        ) : null}
      </Button>
      {isOpen ? <div className="flex flex-col">{children}</div> : null}
    </div>
  );
}

export { Fold };
