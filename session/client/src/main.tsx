import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useSessionStore } from './session/store'
import { installTestProbe } from './testProbe'

// One of the two e2e handles onto what a tab actually holds — the map store (`__STORE__`,
// exposed by @dnd/core the same way) is the other. Unguarded, because the §2.6 memory-dump
// row runs against a production build and asks exactly what this player's memory contains:
// a handle that disappears in the build under test cannot answer that. Nothing reachable
// through it is anything a script already running on this page could not read anyway.
const debug = window as Window & { __sessionStore?: typeof useSessionStore }
debug.__sessionStore = useSessionStore
installTestProbe()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
