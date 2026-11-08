import { useCallback, useEffect, useState } from 'react';
import { EditorHost } from '@/editor/EditorHost';
import { useShell } from '@/editor/shell/shellStore';
import { useStore } from '@/store/store';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { openNewMapRef } from '@/editor/toolConstants';
import { HomeScreen, type EnterOptions } from '@/home/HomeScreen';
import { NewMapModal } from '@/editor/dialogs/NewMapModal';
import { initTheme, useTheme } from '@dnd/ui';
import { readDesk } from '@/theme/desk';
import { initLightBrush, initLitOnLight, initMarqueePrefs, initPropPrefs, initRoomPrefs, useLitPreview } from '@/editor/viewPrefs';

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
// A light placed while the desk is unlit turns the lit preview on, so the light shows.
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
  const lit = useLitPreview();

  // The map lies on the theme's desk: the canvas clears to the desk colour, the grid dots
  // take the theme's dot colour, and a stock-background map is drawn on the theme's paper,
  // unlit while it is edited unless the DM turned the lit preview on. Follows the theme
  // toggle and the lit preview live.
  useEffect(() => {
    setEditorDesk({ ...deskFromTokens(), lit });
  }, [theme, lit]);
  useEffect(() => () => setEditorDesk(null), []);

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
    // Save on the way out so the card shows the map as it was just left.
    void useStore.getState().saveCurrentMap();
    setHome(true);
  }, []);

  return (
    <>
      <EditorHost home={home} onHome={goHome} openSettings={settingsOnEnter} />
      {home && <HomeScreen onEnter={enter} />}
      {!home && <NewMapModal open={newOpen} onOpenChange={setNewOpen} onEnter={enter} />}
    </>
  );
}
