import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

const EditorPage = lazy(() => import('./pages/EditorPage.jsx'))
const AutomatePage = lazy(() => import('./pages/AutomatePage.jsx'))

function ShellNav() {
  const link =
    'flex-1 text-center rounded px-3 py-2 font-display text-sm font-bold uppercase tracking-wide transition-colors'
  return (
    <nav className="flex gap-0 rounded border border-line bg-inset p-0.5">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${link} ${isActive ? 'bg-blaze text-white' : 'text-dim hover:text-paper'}`
        }
      >
        Editor
      </NavLink>
      <NavLink
        to="/automate"
        className={({ isActive }) =>
          `${link} ${isActive ? 'bg-blaze text-white' : 'text-dim hover:text-paper'}`
        }
      >
        Automate
      </NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center font-display text-sm uppercase tracking-widest text-dim">
            Loading…
          </div>
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
