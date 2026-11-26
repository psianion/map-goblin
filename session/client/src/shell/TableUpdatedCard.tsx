import { createPortal } from 'react-dom';
import { FloatBox, PrimaryButton } from '@dnd/ui';
import { RefreshCw } from '@dnd/ui/icons';
import { useSessionStore } from '../session/store';

/**
 * Finishing pass 12.2: the server speaks a newer protocol than this page, so the socket has
 * stopped for good. One card over whatever page holds the seat, with the one way on: a reload,
 * which fetches the new client and takes the seat back. Mounted once, at the app's root.
 */
export function TableUpdatedCard() {
  const updated = useSessionStore((s) => s.tableUpdated);
  if (!updated) return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483002] grid place-items-center bg-[color:var(--backdrop)] p-4" data-above-pause data-testid="table-updated">
      <FloatBox
        className="flex w-[min(100%,360px)] flex-col gap-4 p-5"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="table-updated-title"
        aria-describedby="table-updated-body"
      >
        <div className="flex flex-col gap-1">
          <h2 id="table-updated-title" className="text-base font-medium text-text">
            The table was updated.
          </h2>
          <p id="table-updated-body" className="text-sm text-text-2">
            Reload to carry on.
          </p>
        </div>
        <PrimaryButton autoFocus className="gap-1.5 self-start" data-testid="table-updated-reload" onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden strokeWidth={1.75} className="size-3.5" />
          Reload
        </PrimaryButton>
      </FloatBox>
    </div>,
    document.body,
  );
}
