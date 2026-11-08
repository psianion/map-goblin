/**
 * The editor's map file is `.ggvtt`; files saved before the rename are `.mapbuilder`, and
 * both open. What makes a file one is its content, not its name: the extensions only steer
 * the picker. The canvas and the table both read this, so the table never imports from
 * the canvas.
 */
export const MAP_FILE_ACCEPT = '.ggvtt,.mapbuilder';

/** The extension every new map file is written with. */
export const MAP_FILE_EXTENSION = '.ggvtt';
