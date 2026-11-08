import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  applyTheme,
  readThemeChoice,
  useTheme,
  type ThemeChoice,
} from '@dnd/ui';
import { Eye } from '@dnd/ui/icons';
import { useStore } from '@dnd/core/src/store/store';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { useTableShell } from '../tableShell';
import { previewAs, previewCandidates, usePreviewing } from './previewAs';
import { UI_SCALES, applyUiScale, useUiScale, type UiScale } from '../uiScale';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** The View menu, top right: theme (light by default, dark one click away), UI scale, grid, diagnostics. */
export function ViewMenu() {
  // Subscribes, so the radio follows a change made anywhere.
  useTheme();
  const choice = readThemeChoice();
  const scale = useUiScale();
  const grid = useStore((s) => s.grid.visible);
  const diagnostics = useTableShell((s) => s.diagnostics);
  const dm = useSessionStore((s) => s.you?.role === 'dm');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const candidates = previewCandidates(useModuleState<TokensState>('tokens'), sceneId);
  const previewing = usePreviewing();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" data-testid="view-menu">
            <Eye aria-hidden strokeWidth={1.75} className="size-4" />
            View
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {dm && (
          <>
            <DropdownMenuCheckboxItem
              checked={previewing !== null}
              disabled={candidates.length === 0}
              data-testid="view-player"
              onCheckedChange={(on) => previewAs(on ? (candidates[0]?.id ?? null) : null)}
            >
              Player view
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={candidates.length === 0} data-testid="view-preview-as">
                Preview as
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={previewing ?? ''} onValueChange={(v) => previewAs(v || null)}>
                  <DropdownMenuRadioItem value="">Nobody (DM view)</DropdownMenuRadioItem>
                  {candidates.map((t) => (
                    <DropdownMenuRadioItem key={t.id} value={t.id} data-testid={`preview-as-${t.id}`}>
                      {t.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={choice} onValueChange={(v) => applyTheme(v as ThemeChoice)}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value} data-testid={`theme-${t.value}`}>
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>UI scale</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(scale)} onValueChange={(v) => applyUiScale(Number(v) as UiScale)}>
            {UI_SCALES.map((s) => (
              <DropdownMenuRadioItem key={s} value={String(s)} data-testid={`ui-scale-${s}`}>
                {s}%
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={grid}
          data-testid="view-grid"
          onCheckedChange={(v) => useStore.getState().setGridVisible(v)}
        >
          Grid
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={diagnostics}
          data-testid="view-diagnostics"
          onCheckedChange={() => useTableShell.getState().toggleDiagnostics()}
        >
          Diagnostics<DropdownMenuShortcut>Shift+D</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
