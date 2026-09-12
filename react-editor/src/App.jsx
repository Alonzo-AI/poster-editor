import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const EditorPage = lazy(() => import('./pages/EditorPage.jsx'))
const AutomatePage = lazy(() => import('./pages/AutomatePage.jsx'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx'))
const ProjectEditPage = lazy(() => import('./pages/ProjectEditPage.jsx'))
const AutomateSavesPage = lazy(() => import('./pages/AutomateSavesPage.jsx'))
const AutomateSaveEditPage = lazy(() => import('./pages/AutomateSaveEditPage.jsx'))

function ShellNav() {
  return (
    <nav className="flex items-center gap-0.5 rounded-full border border-line bg-inset p-0.5">
      <NavLink
        to="/home"
        className={({ isActive }) =>
          `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            isActive ? 'bg-panel text-paper shadow-sm' : 'text-dim hover:text-paper'
          }`
        }
      >
        Home
      </NavLink>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            isActive ? 'bg-panel text-paper shadow-sm' : 'text-dim hover:text-paper'
          }`
        }
      >
        Editor
      </NavLink>
      <NavLink
        to="/automate"
        className={({ isActive }) =>
          `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            isActive ? 'bg-panel text-paper shadow-sm' : 'text-dim hover:text-paper'
          }`
        }
      >
        Automate
      </NavLink>
      <NavLink
        to="/projects"
        end={false}
        className={({ isActive }) =>
          `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            isActive ? 'bg-panel text-paper shadow-sm' : 'text-dim hover:text-paper'
          }`
        }
      >
        Projects
      </NavLink>
      <NavLink
        to="/automate-saves"
        end={false}
        className={({ isActive }) =>
          `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            isActive ? 'bg-panel text-paper shadow-sm' : 'text-dim hover:text-paper'
          }`
        }
      >
        Saves
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
          <Route path="/home" element={<HomePage Nav={ShellNav} />} />
          <Route path="/" element={<EditorPage Nav={ShellNav} />} />
          <Route path="/automate" element={<AutomatePage Nav={ShellNav} />} />
          <Route path="/projects" element={<ProjectsPage Nav={ShellNav} />} />
          <Route path="/projects/batch/:batchDate" element={<ProjectsPage Nav={ShellNav} />} />
          <Route
            path="/projects/batch/:batchDate/team/:teamKey"
            element={<ProjectsPage Nav={ShellNav} />}
          />
          <Route path="/projects/team/:teamKey" element={<ProjectsPage Nav={ShellNav} />} />
          <Route path="/projects/:id" element={<ProjectEditPage Nav={ShellNav} />} />
          <Route path="/automate-saves" element={<AutomateSavesPage Nav={ShellNav} />} />
          <Route path="/automate-saves/:id" element={<AutomateSaveEditPage Nav={ShellNav} />} />
        </Routes>
      </Suspense>
    </div>
  )
}
