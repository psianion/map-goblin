import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useShell } from '@/editor/shell/shellStore';
import { useStore } from '@/store/store';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { openNewMapRef } from '@/editor/toolConstants';
import { HomeScreen, type EnterOptions } from '@/home/HomeScreen';
import { LazyNewMapModal as NewMapModal } from '@/editor/dialogs/LazyNewMapModal';
import { initTheme, useTheme } from '@dnd/ui';
import { readDesk } from '@/theme/desk';
import { refreshPublishTokens } from '@/io/publish';
import { saveThenLeave } from '@/io/leaveMap';
import { initLightBrush, initLitOnLight, initMarqueePrefs, initPropPrefs, initRoomPrefs, previewTime, usePreview } from '@/editor/viewPrefs';

// The editor and its engine load as their own chunk, so the home page paints without them.
const EditorHost = lazy(() => import('@/editor/EditorHost').then((m) => ({ default: m.EditorHost })));

// The shell's view state, for the end-to-end specs (the store is already on window in dev).
if (import.meta.env.DEV) (window as Window & { __shell?: typeof useShell }).__shell = useShell;

// Before the first render, so neither theme flashes on load.
initTheme();
// The room view (labels, divider, room walls, the rooms sheet) as the DM last left it.
initRoomPrefs();
// The prop view (see under overhead) as the DM last left it.
initPropPrefs();
// What the marquee picks (the status bar's chip), as the DM last left it.
initMarqueePrefs();
// The light brush (the next light) as the DM last set it; the Torch preset at first.
initLightBrush();
// A light placed while the desk is unlit lights the preview, so the light shows.
initLitOnLight();

/** The theme's desk tokens, read off <html> so the canvas and the chrome agree. */
function deskFromTokens(): EditorDesk {
  const css = getComputedStyle(document.documentElement);
  return readDesk((name) => css.getPropertyValue(name), document.documentElement.classList.contains('dark'));
}

/** The app: the editor with its home page in front of it. */
export default function App() {
  const [home, setHome] = useState(true);
  // Entered from a card's "Map settings…": the editor comes up with that dialog showing.
  const [settingsOnEnter, setSettingsOnEnter] = useState(false);
  // The editor's New map dialog (Ctrl+Shift+N). The home page has its own on the "+" card.
  const [newOpen, setNewOpen] = useState(false);
  const [theme] = useTheme();
  const preview = usePreview();

  // The map lies on the theme's desk: the canvas clears to the desk colour, the grid dots
  // take the theme's dot colour, and a stock-background map is drawn on the theme's paper,
  // unlit while it is edited unless the DM picked a time to preview it at. Follows the theme
  // toggle and Preview as live. The store draws the sky at the picked time, and gets it back
  // after a reset (a new map) puts its own default in.
  useEffect(() => {
    setEditorDesk({ ...deskFromTokens(), lit: preview !== 'unlit' });
    const time = previewTime();
    const push = () => {
      if (useStore.getState().ui.previewTime !== time) useStore.getState().setPreviewTime(time);
    };
    push();
    // A reset is told apart as viewPrefs does: it replaces the layers and tools together.
    return useStore.subscribe((s, prev) => {
      if (s.layers !== prev.layers && s.tools !== prev.tools) push();
    });
  }, [theme, preview]);
  useEffect(() => () => setEditorDesk(null), []);

  // DM tokens close to running out are swapped for fresh ones, so publishing keeps working
  // without the admin pass for as long as the DM keeps using the canvas.
  useEffect(() => {
    void refreshPublishTokens();
  }, []);

  // Ctrl+Shift+N opens the New map dialog here. The home page keeps keys from reaching
  // the shortcuts, so this only fires in the editor.
  useEffect(() => {
    openNewMapRef.current = () => setNewOpen(true);
    return () => {
      openNewMapRef.current = null;
    };
  }, []);

  const enter = useCallback((options?: EnterOptions) => {
    setSettingsOnEnter(options?.settings === true);
    setHome(false);
  }, []);

  const goHome = useCallback(() => {
    // Save on the way out, and finish it before the home page shows: the card shows the map
    // as it was just left, and a reload straight after keeps it.
    void saveThenLeave(() => useStore.getState().saveCurrentMap(), () => setHome(true));
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <EditorHost home={home} onHome={goHome} openSettings={settingsOnEnter} />
      </Suspense>
      {home && <HomeScreen onEnter={enter} />}
      {!home && <NewMapModal open={newOpen} onOpenChange={setNewOpen} onEnter={enter} />}
    </>
  );
}
