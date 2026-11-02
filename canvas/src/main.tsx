import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './v2/AppV2.tsx'
import { useStore } from './store/store'
import { initRecentAssets } from './io/recentAssets'
import { initFavouriteAssets } from './io/favouriteAssets'
import { initSnapPref } from './io/snapPref'

// Expose store for E2E tests (dev only)
if (import.meta.env.DEV) {
  (window as Window & { __store?: typeof useStore }).__store = useStore
}

initRecentAssets()
initFavouriteAssets()
initSnapPref()

// The editor used to live at `/v2` beside the old one at `/`. Old links and bookmarks land
// on `/`, keeping the query (`?e2e=1`) and hash.
if (/^\/v2(\/|$)/.test(window.location.pathname)) {
  window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
