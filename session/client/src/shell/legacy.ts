/**
 * The old rail, popovers, sidebar, drawer and status bar stay mountable while their last
 * surfaces are rebuilt: `?legacy` on the table URL, or `localStorage['gg.table.legacyShell'] = '1'`.
 * Goes with the old shell.
 */
export function legacyShellOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('legacy') || localStorage.getItem('gg.table.legacyShell') === '1';
  } catch {
    return false;
  }
}
