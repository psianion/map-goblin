import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { Role } from '@dnd/core/src/shared/protocol';
import { FloatBox, IconKeyButton } from '@dnd/ui';
import { BookOpen, ScrollText, Swords, UserRound, Users, type LucideIcon } from '@dnd/ui/icons';
import { useModuleState, useRole, useSessionStore } from '../../session/store';
import { useUnreadCount } from '../logFeed';
import { sheetDef, toggleSheet, useSheet } from './registry';

interface SheetTab {
  sheet: string;
  title: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Only while an encounter runs on this scene. */
  combatOnly?: boolean;
}

/** The slim column's tabs, top to bottom. A tab shows once its sheet is registered. */
const TABS: readonly SheetTab[] = [
  { sheet: 'party', title: 'Party', icon: Users, roles: ['dm'] },
  { sheet: 'character', title: 'Character', icon: UserRound, roles: ['player'] },
  { sheet: 'journal', title: 'Journal', icon: BookOpen, roles: ['player'] },
  { sheet: 'encounter', title: 'Encounter', icon: Swords, roles: ['player'], combatOnly: true },
  { sheet: 'log', title: 'Log', icon: ScrollText, roles: ['dm', 'player'] },
];

/** Right edge: the sheets a seat keeps at hand, Log with its unread count. */
export function TabColumn() {
  const role = useRole();
  const open = useSheet();
  const unread = useUnreadCount();
  const combat = useModuleState<InitiativeState>('initiative');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  if (!role) return null;
  const fighting = combat?.status === 'running' && combat.sceneId === sceneId;
  const tabs = TABS.filter((t) => t.roles.includes(role) && (!t.combatOnly || fighting) && sheetDef(t.sheet));
  return (
    <FloatBox className="absolute top-16 right-3 z-20 flex w-11 flex-col items-center gap-1 px-0 py-1.5" data-testid="sheet-tabs" data-chrome>
      {tabs.map((t) => (
        <span key={t.sheet} className="relative">
          <IconKeyButton
            size={36}
            icon={t.icon}
            label={t.title}
            active={open?.id === t.sheet}
            data-testid={`sheet-tab-${t.sheet}`}
            onClick={() => toggleSheet(t.sheet)}
          />
          {t.sheet === 'log' && unread > 0 && open?.id !== 'log' && (
            <span
              data-testid="log-unread"
              className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-ink px-1 font-mono text-xs leading-none text-on-ink"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      ))}
    </FloatBox>
  );
}
