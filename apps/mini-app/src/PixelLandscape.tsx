import { useEffect, useRef } from 'react'
import { makeSkyBrush, makeSurface, paintCloud, paintLandscape, paintSky, paintSkyMask, WORLD } from './etch-landscape'

export function PixelLandscape() {
  const scene=useRef<HTMLDivElement>(null)
  const state=useRef({visible:true,frame:0,lastFrame:0,lastInk:0,ready:false,points:[] as {x:number;y:number}[],lastPoint:null as {x:number;y:number}|null})
  useEffect(()=>{
    const root=scene.current,host=root?.parentElement
    if(!root||!host)return
    const runtime=state.current
    runtime.ready=false;runtime.points=[];runtime.lastPoint=null;runtime.lastFrame=performance.now()
    const sky=root.querySelector<HTMLCanvasElement>('.landing-etch-sky')!
    const ground=root.querySelector<HTMLCanvasElement>('.landing-etch-ground')!
    const ink=root.querySelector<HTMLCanvasElement>('.landing-etch-ink')!
    const ctx=ink.getContext('2d')!
    const alternate=makeSurface(), skyMask=makeSurface(), mask=makeSurface()
    const maskCtx=mask.getContext('2d')!
    const brushes=[makeSkyBrush(0),makeSkyBrush(17),makeSkyBrush(39)]
    const preference=matchMedia('(prefers-reduced-motion: reduce)')
    const photo=new Image()
    const lifecycle={disposed:false}
    paintSky(sky)
    paintSky(alternate,true);paintSkyMask(skyMask)
    root.querySelectorAll<HTMLCanvasElement>('.landing-etch-cloud').forEach((canvas,i)=>paintCloud(canvas,i*47))
    const resize=()=>{
      ink.width=Math.ceil(host.clientWidth);ink.height=Math.ceil(host.clientHeight)
      mask.width=ink.width;mask.height=ink.height
      ctx.imageSmoothingEnabled=false;maskCtx.imageSmoothingEnabled=false
      runtime.points=[];runtime.lastPoint=null
    }
    const resizeObserver=new ResizeObserver(resize)
    resizeObserver.observe(host);resize()
    const clear=()=>{
      cancelAnimationFrame(runtime.frame);runtime.frame=0;runtime.points=[];runtime.lastPoint=null
      maskCtx.clearRect(0,0,mask.width,mask.height);ctx.clearRect(0,0,ink.width,ink.height)
      root.dataset.pointerActive='false'
    }
    const pause=()=>{
      root.dataset.paused=String(!runtime.visible||document.hidden||preference.matches)
      if(!runtime.visible||document.hidden||preference.matches)clear()
    }
    const observer=new IntersectionObserver(([entry])=>{runtime.visible=Boolean(entry?.isIntersecting);pause()})
    observer.observe(host)
    const render=(now:number)=>{
      runtime.frame=0
      if(lifecycle.disposed||!runtime.visible||document.hidden||preference.matches)return
      if(now-runtime.lastFrame<28){runtime.frame=requestAnimationFrame(render);return}
      const elapsed=Math.min(100,now-runtime.lastFrame)
      runtime.lastFrame=now
      maskCtx.globalCompositeOperation='destination-out'
      maskCtx.fillStyle=`rgba(0,0,0,${Math.min(.2,elapsed/650)})`
      maskCtx.fillRect(0,0,mask.width,mask.height)
      maskCtx.globalCompositeOperation='source-over'
      const diameter=ink.width<650?144:276
      for(const point of runtime.points){
        const previous=runtime.lastPoint??point
        const distance=Math.hypot(point.x-previous.x,point.y-previous.y)
        const steps=Math.min(10,Math.max(1,Math.ceil(distance/(diameter*.18))))
        for(let step=1;step<=steps;step++) {
          const x=previous.x+(point.x-previous.x)*step/steps
          const y=previous.y+(point.y-previous.y)*step/steps
          const brush=brushes[Math.abs(Math.floor(x/29+y/31))%brushes.length]!
          maskCtx.drawImage(brush,x-diameter/2,y-diameter/2,diameter,diameter)
        }
        runtime.lastPoint=point
      }
      runtime.points=[]
      const scale=Math.max(ink.width/WORLD.width,ink.height/WORLD.height)
      const offsetX=(ink.width-WORLD.width*scale)*.65,offsetY=ink.height-WORLD.height*scale
      ctx.clearRect(0,0,ink.width,ink.height)
      ctx.globalCompositeOperation='source-over';ctx.drawImage(alternate,offsetX,offsetY,WORLD.width*scale,WORLD.height*scale)
      ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0)
      // Keep the blue light entirely above the continuous mountain silhouette.
      ctx.drawImage(skyMask,offsetX,offsetY,WORLD.width*scale,WORLD.height*scale)
      ctx.globalCompositeOperation='source-over'
      if(now-runtime.lastInk<2400)runtime.frame=requestAnimationFrame(render)
      else clear()
    }
    const move=(event:PointerEvent)=>{
      if(!runtime.ready||!runtime.visible||document.hidden||preference.matches)return
      const rect=host.getBoundingClientRect()
      if(performance.now()-runtime.lastInk>180)runtime.lastPoint=null
      runtime.points.push({x:event.clientX-rect.left,y:event.clientY-rect.top})
      if(runtime.points.length>8)runtime.points.shift()
      runtime.lastInk=performance.now();root.dataset.pointerActive='true'
      if(!runtime.frame)runtime.frame=requestAnimationFrame(render)
    }
    photo.onload=()=>{
      if(lifecycle.disposed)return
      paintLandscape(ground,photo)
      runtime.ready=true;root.dataset.ready='true'
    }
    photo.onerror=()=>{if(!lifecycle.disposed)root.dataset.failed='true'}
    photo.src='/burabay-okzhetpes-photo.jpg'
    host.addEventListener('pointermove',move,{passive:true});host.addEventListener('pointerdown',move,{passive:true})
    document.addEventListener('visibilitychange',pause);preference.addEventListener('change',pause);pause()
    return()=>{
      lifecycle.disposed=true;clear();observer.disconnect();resizeObserver.disconnect()
      photo.onload=null;photo.onerror=null
      host.removeEventListener('pointermove',move);host.removeEventListener('pointerdown',move)
      document.removeEventListener('visibilitychange',pause);preference.removeEventListener('change',pause)
    }
  },[])
  return <div ref={scene} className="landing-pixel-landscape" aria-hidden="true">
    <canvas className="landing-etch-sky" width={WORLD.width} height={WORLD.height}/>
    <div className="landing-etch-clouds">{[0,1,2].map(i=><canvas key={i} className={`landing-etch-cloud landing-etch-cloud--${i}`}/>)}</div>
    <canvas className="landing-etch-ground" width={WORLD.width} height={WORLD.height}/>
    <canvas className="landing-etch-ink"/>
    <div className="landing-etch-clouds landing-etch-clouds-front">{[3,4].map(i=><canvas key={i} className={`landing-etch-cloud landing-etch-cloud--${i}`}/>)}</div>
    <img className="landing-etch-fallback" src="/burabay-okzhetpes-photo.jpg" alt="" width={1280} height={851}/>
  </div>
}
