import { Suspense, lazy } from 'react'

const App = lazy(() => import('./App.tsx'))
const Landing = lazy(() => import('./Landing.tsx'))

export default function PageRoot() {
  const isLanding = location.pathname.replace(/\/$/, '') === '/welcome'
  return <Suspense fallback={<p role="status" style={{ padding: 32 }}>Openfacto…</p>}>
    {isLanding ? <Landing /> : <App />}
  </Suspense>
}
