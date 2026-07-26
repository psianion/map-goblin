import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useSessionStore } from './session/store'

// Expose store for E2E tests (dev only)
if (import.meta.env.DEV) {
  (window as Window & { __sessionStore?: typeof useSessionStore }).__sessionStore = useSessionStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
