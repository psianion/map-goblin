import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useStore } from './store/store'

// Expose store for E2E tests (dev only)
if (import.meta.env.DEV) {
  (window as Window & { __store?: typeof useStore }).__store = useStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
