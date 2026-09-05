import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

const EditorPage = lazy(() => import('./pages/EditorPage.jsx'))
const AutomatePage = lazy(() => import('./pages/AutomatePage.jsx'))

function ShellNav() {
  return (
    <nav className="flex items-center gap-1 rounded-md border border-line bg-inset p-0.5">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            isActive ? 'bg-panel2 text-paper' : 'text-dim hover:text-paper'
          }`
        }
      >
        Editor
      </NavLink>
      <NavLink
        to="/automate"
        className={({ isActive }) =>
          `rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            isActive ? 'bg-panel2 text-paper' : 'text-dim hover:text-paper'
          }`
        }
      >
        Automate
      </NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-xs text-dim">Loading…</div>
        }
      >
        <Routes>
          <Route path="/" element={<EditorPage Nav={ShellNav} />} />
          <Route path="/automate" element={<AutomatePage Nav={ShellNav} />} />
        </Routes>
      </Suspense>
    </div>
  )
}
