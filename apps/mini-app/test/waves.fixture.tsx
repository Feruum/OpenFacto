import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GenerativeArt, type ArtKind } from '../src/GenerativeArt'
import { Landscape } from '../src/ui'
import '../src/index.css'
import '../src/App.css'

const kinds: ArtKind[] = ['terrain','knowledge','playground','inbox','settings']
createRoot(document.getElementById('root')!).render(<StrictMode>
  <main style={{padding:24,maxWidth:1440}}>
    <section className="event-banner" style={{height:250, marginBottom:24}}>
      <Landscape /><div className="banner-content"><h2 style={{fontSize:64}}>Alatau Summit</h2><p>Живой рельеф</p></div>
    </section>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:20}}>
      {kinds.map(kind => <section key={kind} style={{height:280,background:'var(--ink)',borderRadius:12,overflow:'hidden',position:'relative'}}>
        <span style={{position:'absolute',top:12,left:16,color:'var(--glacier)',fontSize:12}}>{kind}</span>
        <GenerativeArt kind={kind} />
      </section>)}
    </div>
    <div style={{height:1200}} aria-hidden="true" />
  </main>
</StrictMode>)
