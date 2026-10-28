import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
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

// `/v2` is the redesign, served beside `/` so the two can be compared on the same data.
// Picked off the path once at boot: there is no router, and the two shells never swap
// at runtime. Lazy so the v1 route never downloads the v2 chrome or its stylesheet.
const AppV2 = lazy(() => import('./v2/AppV2.tsx'))
const isV2 = /^\/v2(\/|$)/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isV2 ? (
      <Suspense fallback={null}>
        <AppV2 />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
