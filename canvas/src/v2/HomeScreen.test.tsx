import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { Toaster, toast } from 'sonner';
import { useStore } from '@/store/store';
import type { MapMeta } from '@/store/types';
import { HomeScreen } from './HomeScreen';

const { notify, openMap, restoreLastDeletedMap } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn() },
  openMap: vi.fn(async (_id: string) => true),
  restoreLastDeletedMap: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ notify }));
vi.mock('./openMap', () => ({ openMap }));
vi.mock('@dnd/core/src/store/slices/maps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd/core/src/store/slices/maps')>()),
  restoreLastDeletedMap,
}));

function meta(id: string, name: string, updatedAt: number): MapMeta {
  return { id, name, createdAt: 1, updatedAt, gridSize: { width: 0, height: 0 }, layerCount: 2 };
}

const card = (name: string) => screen.getByRole('button', { name: `Open ${name}` });

describe('HomeScreen cards', () => {
  let renameMap: ReturnType<typeof vi.fn>;
  let duplicateMap: ReturnType<typeof vi.fn>;
  let deleteMap: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    renameMap = vi.fn(async (id: string, name: string) => {
      useStore.setState((s) => {
        const entry = s.mapIndex.find((m) => m.id === id);
        if (entry) entry.name = name;
      });
    });
    duplicateMap = vi.fn(async (id: string) => {
      const source = useStore.getState().mapIndex.find((m) => m.id === id)!;
      useStore.setState((s) => {
        s.mapIndex.unshift(meta('copy', `Copy of ${source.name}`, 99));
      });
      return 'copy';
    });
    deleteMap = vi.fn(async () => {});
    useStore.setState({
      activeMapId: 'm1',
      mapIndex: [meta('m1', 'Sunken Chapel', 2), meta('m2', 'Guard Barracks', 1)],
      renameMap,
      duplicateMap,
      deleteMap,
    } as never);
  });

  describe('rename in place', () => {
    it('double-clicking the name edits it; Enter keeps the new name', async () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.doubleClick(within(card('Sunken Chapel')).getByText('Sunken Chapel'));

      const input = screen.getByTestId('v2-card-rename') as HTMLInputElement;
      expect(input.value).toBe('Sunken Chapel');
      fireEvent.change(input, { target: { value: '  Drowned Nave ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(renameMap).toHaveBeenCalledWith('m1', 'Drowned Nave'));
      expect(notify.success).toHaveBeenCalledWith('Renamed');
      expect(screen.queryByTestId('v2-card-rename')).toBeNull();
      // Enter in the field is the field's, not the card's: nothing opened.
      expect(openMap).not.toHaveBeenCalled();
    });

    it('Escape puts the old name back', () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.doubleClick(within(card('Sunken Chapel')).getByText('Sunken Chapel'));
      const input = screen.getByTestId('v2-card-rename');
      fireEvent.change(input, { target: { value: 'Something else' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByTestId('v2-card-rename')).toBeNull();
      expect(renameMap).not.toHaveBeenCalled();
      expect(screen.getByText('Sunken Chapel')).toBeTruthy();
    });

    it.each([
      ['empty', '   '],
      ['unchanged', 'Sunken Chapel'],
    ])('an %s name is a no-op', (_label, value) => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.doubleClick(within(card('Sunken Chapel')).getByText('Sunken Chapel'));
      const input = screen.getByTestId('v2-card-rename');
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);

      expect(renameMap).not.toHaveBeenCalled();
      expect(notify.success).not.toHaveBeenCalled();
    });

    it('a click into the field does not open the map', async () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.doubleClick(within(card('Sunken Chapel')).getByText('Sunken Chapel'));
      fireEvent.click(screen.getByTestId('v2-card-rename'));
      fireEvent.keyDown(screen.getByTestId('v2-card-rename'), { key: ' ' });
      await new Promise((r) => setTimeout(r, 300));
      expect(openMap).not.toHaveBeenCalled();
    });
  });

  describe('new map modal', () => {
    it('Escape closes it with focus on the dialog or in its name field, past the key shield', async () => {
      const heard = vi.fn();
      document.addEventListener('keydown', heard);
      try {
        render(<HomeScreen onEnter={() => {}} />);
        fireEvent.click(screen.getByTestId('v2-new-map-card'));
        // Focus on the dialog itself sits outside the home page, where the shield stops keys.
        fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('v2-new-map-modal')).toBeNull());

        fireEvent.click(screen.getByTestId('v2-new-map-card'));
        fireEvent.keyDown(await screen.findByLabelText('Name'), { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('v2-new-map-modal')).toBeNull());
        expect(heard).not.toHaveBeenCalled();

        // The shield still keeps a stray key away from the canvas once the modal is gone.
        fireEvent.keyDown(document.body, { key: 'v' });
        expect(heard).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', heard);
      }
    });
  });

  describe('card menu', () => {
    it('right-click lists Open, Rename, Duplicate, Map settings… and Delete', () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.contextMenu(card('Guard Barracks'), { clientX: 40, clientY: 50 });

      const menu = screen.getByRole('menu');
      expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
        'Open',
        'Rename',
        'Duplicate',
        'Map settings…',
        'Delete',
      ]);
    });

    it('opens from the "…" button too, and Escape closes it', async () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'More for Guard Barracks' }));
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(openMap).not.toHaveBeenCalled();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });

    it('Duplicate adds the copy without opening it', async () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.contextMenu(card('Guard Barracks'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

      await waitFor(() => expect(duplicateMap).toHaveBeenCalledWith('m2'));
      expect(notify.success).toHaveBeenCalledWith('Duplicated as Copy of Guard Barracks');
      expect(card('Copy of Guard Barracks')).toBeTruthy();
      expect(openMap).not.toHaveBeenCalled();
    });

    it('Rename from the menu puts the field in place of the name', () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.contextMenu(card('Guard Barracks'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

      expect((screen.getByTestId('v2-card-rename') as HTMLInputElement).value).toBe('Guard Barracks');
    });

    it('Map settings… goes into the editor for that map, asking for the dialog there', async () => {
      const onEnter = vi.fn();
      render(<HomeScreen onEnter={onEnter} />);
      fireEvent.contextMenu(card('Guard Barracks'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Map settings…' }));

      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ settings: true }));
      expect(openMap).toHaveBeenCalledWith('m2');
      // The editor's dialog, not one of the home page's own over the cards.
      expect(screen.queryByTestId('v2-map-settings-modal')).toBeNull();
    });

    it('Map settings… stays home when the map cannot be opened', async () => {
      openMap.mockResolvedValueOnce(false);
      const onEnter = vi.fn();
      render(<HomeScreen onEnter={onEnter} />);
      fireEvent.contextMenu(card('Guard Barracks'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Map settings…' }));

      await waitFor(() => expect(openMap).toHaveBeenCalledWith('m2'));
      expect(onEnter).not.toHaveBeenCalled();
      expect(screen.queryByTestId('v2-map-settings-modal')).toBeNull();
    });

    it('Delete goes through the confirm, then offers Undo on the toast', async () => {
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.contextMenu(card('Guard Barracks'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(deleteMap).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m2'));
      expect(notify.action).toHaveBeenCalledWith(
        'Map deleted',
        expect.objectContaining({ label: 'Undo', onClick: expect.any(Function) }),
      );
    });

    it('Undo flushes the open map, then puts the deleted card back', async () => {
      const order: string[] = [];
      useStore.setState({
        saveCurrentMap: vi.fn(async () => void order.push('save')),
      } as never);
      restoreLastDeletedMap.mockImplementation(async () => {
        order.push('restore');
        return { meta: meta('m2', 'Guard Barracks', 1), removedBlankId: null };
      });
      deleteMap.mockImplementation(async (id: string) => {
        useStore.setState((s) => {
          s.mapIndex = s.mapIndex.filter((m) => m.id !== id);
        });
      });
      render(<HomeScreen onEnter={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete Guard Barracks' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(notify.action).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Open Guard Barracks' })).toBeNull();

      notify.action.mock.calls[0][1].onClick();

      await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Map restored'));
      expect(order).toEqual(['save', 'restore']);
      expect(card('Guard Barracks')).toBeTruthy();
      // It was not the open map, so nothing is switched.
      expect(openMap).not.toHaveBeenCalled();
    });

    // The rest of this file stubs notify. This one runs the real helper into a real
    // toaster, so the Undo the DM sees is the one that restores the map.
    it('the delete toast shows an Undo button that restores the map', async () => {
      const real = await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast');
      notify.action.mockImplementation(real.notify.action);
      notify.success.mockImplementation(real.notify.success);
      useStore.setState({ saveCurrentMap: vi.fn(async () => {}) } as never);
      restoreLastDeletedMap.mockResolvedValue({ meta: meta('m2', 'Guard Barracks', 1), removedBlankId: null });
      deleteMap.mockImplementation(async (id: string) => {
        useStore.setState((s) => {
          s.mapIndex = s.mapIndex.filter((m) => m.id !== id);
        });
      });

      render(
        <>
          <HomeScreen onEnter={() => {}} />
          <Toaster />
        </>,
      );
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Delete Guard Barracks' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        expect(await screen.findByText('Map deleted')).toBeTruthy();
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

        await waitFor(() => expect(restoreLastDeletedMap).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Map restored')).toBeTruthy();
        expect(card('Guard Barracks')).toBeTruthy();
      } finally {
        act(() => {
          toast.dismiss();
        });
        notify.action.mockReset();
        notify.success.mockReset();
      }
    });
  });
});
