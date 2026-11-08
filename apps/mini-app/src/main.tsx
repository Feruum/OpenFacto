import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconContext } from '@phosphor-icons/react/dist/lib/context'
import '@fontsource-variable/montserrat'
import './index.css'
import PageRoot from './PageRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: 'regular', 'aria-hidden': true, focusable: false }}>
      <PageRoot />
    </IconContext.Provider>
  </StrictMode>,
)
