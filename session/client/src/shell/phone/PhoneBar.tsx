import { Button } from '@dnd/ui';
import { LocateFixed, Map as MapIcon, ScrollText, UserRound, type LucideIcon } from '@dnd/ui/icons';
import { useRole } from '../../session/store';
import { findMyToken } from '../findMyToken';
import { closeSheet, sheetDef, toggleSheet, useSheet } from '../sheets/registry';

function Tab({ icon: Icon, label, active, onClick, testId }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void; testId: string }) {
  return (
    <Button
      variant="ghost"
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className="h-11 min-w-11 flex-1 flex-col gap-0.5 rounded-control text-xs aria-pressed:text-text aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-ink"
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-5" />
      {label}
    </Button>
  );
}

/**
 * Board 8 (players, 640 px and under): the bottom tab bar, Map, Character and Log, with Find
 * my token beside them. Every target is 44 px.
 */
export function PhoneBar() {
  const role = useRole();
  const open = useSheet();
  if (role !== 'player') return null;
  return (
    <nav
      aria-label="Phone tabs"
      data-testid="phone-bar"
      data-chrome
      className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 border-t border-line bg-panel px-2 py-1 sm:hidden"
    >
      <Tab icon={MapIcon} label="Map" testId="phone-tab-map" active={!open} onClick={closeSheet} />
      {sheetDef('character') && (
        <Tab icon={UserRound} label="Character" testId="phone-tab-character" active={open?.id === 'character'} onClick={() => toggleSheet('character')} />
      )}
      <Tab icon={ScrollText} label="Log" testId="phone-tab-log" active={open?.id === 'log'} onClick={() => toggleSheet('log')} />
      <Tab icon={LocateFixed} label="Find me" testId="phone-find-token" active={false} onClick={() => void findMyToken()} />
    </nav>
  );
}
