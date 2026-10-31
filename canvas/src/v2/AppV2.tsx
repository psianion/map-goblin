import { useCallback, useEffect, useState } from 'react';
import App from '@/App';
import { useStore } from '@/store/store';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { openNewMapRef } from '@/components/toolbar/toolConstants';
import { HomeScreen, type EnterOptions } from './HomeScreen';
import { NewMapModal } from './NewMapModal';
import { EditorShell } from './editor/EditorShell';
import { initTheme, useTheme } from './theme';
import { readDesk } from './desk';
import { initLightBrush, initLitOnLight, initMarqueePrefs, initPropPrefs, initRoomPrefs, useLitPreview } from './viewPrefs';
import './v2.css';
import './editor/v2-editor.css';

// Before the first render, so neither theme flashes on load.
initTheme();
// The room view (labels, divider, room walls, the rooms sheet) as the DM last left it.
initRoomPrefs();
// The prop view (see under overhead) as the DM last left it.
initPropPrefs();
// What the marquee picks (the status bar's chip), as the DM last left it.
initMarqueePrefs();
// The Lights dock's brush (the next light) as the DM last set it; the Torch preset at first.
initLightBrush();
// A light placed while the desk is unlit turns the lit preview on, so the light shows.
initLitOnLight();

/** The theme's desk tokens, read off <html> so the canvas and the chrome agree. */
function deskFromTokens(): EditorDesk {
  const css = getComputedStyle(document.documentElement);
  return readDesk((name) => css.getPropertyValue(name), document.documentElement.classList.contains('dark'));
}

/**
 * The /v2 route. The canvas, store and dialogs are the v1 app's; v2 swaps the chrome
 * around them for its own shell and puts a home page in front. The two routes share the
 * store and the canvas, so flipping between / and /v2 compares chrome, not data.
 */
export default function AppV2() {
  const [home, setHome] = useState(true);
  // Entered from a card's "Map settings…": the editor comes up with that dialog showing.
  const [settingsOnEnter, setSettingsOnEnter] = useState(false);
  // The editor's New map dialog (Ctrl+Shift+N). The home page has its own on the "+" card.
  const [newOpen, setNewOpen] = useState(false);
  const [theme] = useTheme();
  const lit = useLitPreview();

  // The map lies on the theme's desk here: the canvas clears to the desk colour, the grid
  // dots take the theme's dot colour, and a stock-background map is drawn on the theme's
  // paper, unlit while it is edited unless the DM turned the lit preview on.
  // Follows the theme toggle and the lit preview live.
  useEffect(() => {
    setEditorDesk({ ...deskFromTokens(), lit });
  }, [theme, lit]);
  useEffect(() => () => setEditorDesk(null), []);

  // Ctrl+Shift+N opens v2's dialog here instead of the v1 one App.tsx mounts. The home
  // page keeps keys from reaching the shortcuts, so this only fires in the editor.
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

  const renderChrome = useCallback(
    (actions: Parameters<typeof EditorShell>[0]['actions']) =>
      home ? null : <EditorShell actions={actions} onHome={goHome} openSettings={settingsOnEnter} />,
    [home, goHome, settingsOnEnter],
  );

  return (
    <>
      <App renderChrome={renderChrome} />
      {home && <HomeScreen onEnter={enter} />}
      {!home && <NewMapModal open={newOpen} onOpenChange={setNewOpen} onEnter={enter} />}
    </>
  );
}
