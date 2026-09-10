import { Suspense, lazy, useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Library from './pages/Library'
import { useData } from './store/data'

// heavy routes (pdf.js, CodeMirror, KaTeX) load on demand
const Workspace = lazy(() => import('./pages/Workspace'))
const Review = lazy(() => import('./pages/Review'))
const Settings = lazy(() => import('./pages/Settings'))
const Radar = lazy(() => import('./pages/Radar'))
const Roadmap = lazy(() => import('./pages/Roadmap'))

function Fallback() {
  return <div className="flex h-full items-center justify-center text-sm text-neutral-500">loading…</div>
}

export default function App() {
  const init = useData((s) => s.init)
  const ready = useData((s) => s.ready)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        loading…
      </div>
    )
  }

  return (
    <HashRouter>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="library" element={<Library />} />
            <Route path="library/:collectionId" element={<Library />} />
            <Route path="paper/:id" element={<Workspace />} />
            <Route path="review" element={<Review />} />
            <Route path="radar" element={<Radar />} />
            <Route path="roadmap" element={<Roadmap />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
