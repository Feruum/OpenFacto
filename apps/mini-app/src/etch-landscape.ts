// Plot the actual Burabay photograph as a point field, rather than enlarging pixel art.
export const WORLD = { width: 1440, height: 780 }
const random = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}
function field(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const top = random(ix, iy) * (1 - sx) + random(ix + 1, iy) * sx
  const bottom = random(ix, iy + 1) * (1 - sx) + random(ix + 1, iy + 1) * sx
  return top * (1 - sy) + bottom * sy
}
const skyline = [[0,462],[80,439],[130,438],[225,403],[300,344],[380,347],[430,355],[510,337],[590,323],[642,331],[710,326],[744,337],[776,290],[816,289],[843,325],[895,261],[950,230],[990,220],[1030,207],[1070,192],[1110,184],[1150,167],[1174,159],[1204,175],[1240,197],[1280,222]]
function horizon(x: number) {
  const i = Math.max(1,skyline.findIndex(point=>point[0]!>=x))
  const [x0,y0] = skyline[i-1]!, [x1,y1] = skyline[i]!
  return y0!+(y1!-y0!)*(x-x0!)/(x1!-x0!)
}
export function makeSurface(width = WORLD.width, height = WORLD.height) {
  const canvas = document.createElement('canvas')
  canvas.width=width; canvas.height=height
  return canvas
}
export function paintSky(canvas: HTMLCanvasElement, blue = false) {
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle=blue?'#178fcb':'#c4d0e2'; ctx.fillRect(0,0,WORLD.width,WORLD.height)
  for(let y=0;y<WORLD.height;y+=3.2) for(let x=0;x<WORLD.width;x+=3.2) {
    const n=random(x,y), wave=Math.sin(x*.031+Math.sin(y*.024)*2)*Math.cos(y*.048)
    if(blue) {
      const cloud=field(x*.009,y*.017+Math.sin(x*.005))
      ctx.fillStyle=cloud>.58?'#fff7e4':cloud<.26?'#324e9d':n>.55?'#61c3e7':'#178fcb'
      ctx.fillRect(x,y,n>.82?3.8:2.5,n>.65?3.5:2.6)
    } else {
      const weave=field(x*.012,y*.016)*.32+wave*.12
      ctx.fillStyle=`rgba(255,253,244,${.18+n*.43+weave})`
      ctx.fillRect(x+n*.5,y+random(y,x)*.5,n>.7?2.1:1.1,n>.48?2.8:1.4)
    }
  }
}
// A stippled, irregular brush exposes a second sky; no blurred glow over the hero.
export function makeSkyBrush(seed: number) {
  const brush=makeSurface(256,256), ctx=brush.getContext('2d')!
  for(let y=0;y<256;y+=3.2) for(let x=0;x<256;x+=3.2) {
    const dx=(x-128)/128,dy=(y-128)/128
    const distance=Math.hypot(dx,dy)
    const edge=.68+field(x*.024+seed,y*.024)*.38
    const coverage=Math.max(0,Math.min(1,(edge-distance)*4))
    if(random(x+seed,y)>coverage)continue
    ctx.fillStyle=`rgba(255,255,255,${.75+random(y,x)*.25})`
    ctx.fillRect(x,y,3.5,3.5)
  }
  return brush
}
export function paintSkyMask(canvas: HTMLCanvasElement) {
  const ctx=canvas.getContext('2d')!
  ctx.clearRect(0,0,WORLD.width,WORLD.height)
  ctx.beginPath();ctx.moveTo(0,0)
  for(let x=0;x<=WORLD.width;x+=4)ctx.lineTo(x,300+horizon(x/WORLD.width*1280)*.56)
  ctx.lineTo(WORLD.width,0);ctx.closePath();ctx.fillStyle='#fff';ctx.fill()
}
export function paintLandscape(canvas: HTMLCanvasElement, photo: HTMLImageElement) {
  const ctx=canvas.getContext('2d')!, sample=makeSurface(1280,851), read=sample.getContext('2d',{willReadFrequently:true})!
  read.drawImage(photo,0,0,1280,851)
  const pixels=read.getImageData(0,0,1280,851).data
  const palette=['#160b26','#33204d','#9c78c5','#d6c3ec','#fff6df']
  ctx.clearRect(0,0,WORLD.width,WORLD.height)
  for(let y=355;y<WORLD.height;y+=4.5) for(let x=0;x<WORLD.width;x+=4.5) {
    const sx=Math.min(1279,Math.floor(x/WORLD.width*1280)), sy=Math.min(850,Math.max(0,Math.floor((y-300)/.56)))
    if(sy<horizon(sx)+(random(x,y)-.5)*5) continue
    const at=(sy*1280+sx)*4, n=random(x,y), r=pixels[at]!,g=pixels[at+1]!,b=pixels[at+2]!
    const luminance=(r*.24+g*.58+b*.18)/255
    const granite=r>g*1.06&&r>b*1.2?.10:0
    const brightness=Math.max(0,Math.min(1,(luminance-.15)*1.65+granite+(n-.5)*.10))
    if(n<.015) continue
    const shade=Math.min(4,Math.floor(brightness*5))
    ctx.fillStyle=palette[shade]!
    const px=x+(random(y,x)-.5)*.7, py=y+(n-.5)*.7, radius=shade<2?2.12+n*.3:1.7+n*.4
    if(n>.93) {ctx.fillRect(px-radius,py-.7,radius*2,1.4);ctx.fillRect(px-.7,py-radius,1.4,radius*2)}
    else if(n>.8) ctx.fillRect(px-radius*.85,py-radius*.85,radius*1.7,radius*1.7)
    else {ctx.beginPath();ctx.arc(px,py,radius,0,Math.PI*2);ctx.fill()}
  }
}
export function paintCloud(canvas: HTMLCanvasElement, seed: number) {
  canvas.width=1000;canvas.height=360
  const ctx=canvas.getContext('2d')!
  for(let y=0;y<360;y+=3.2) for(let x=0;x<1000;x+=3.2) {
    const xx=x/1000,yy=y/360
    // Turbulence changes the silhouette itself, rather than blurring three circles.
    const billow=field(x*.007+seed,y*.010)
    const curl=field(x*.023+seed+11,y*.026)
    const edge=field(x*.073,y*.065+seed)
    const envelope=Math.exp(-((xx-.50)**2/.14+(yy-.63)**2/.070))
    const density=envelope*1.55+(billow-.5)*.85+(curl-.5)*.33
    const n=random(x+seed,y)
    if(density<.43+edge*.16 || n<.035)continue
    ctx.fillStyle=density>.85?'#fffbe6':density>.59?'#fffef0':n>.35?'#edf0ee':'#dbe2eb'
    const size=density>.65?3.4:n>.4?3.2:2.0
    ctx.fillRect(x,y,size,size)
    if(n>.92){ctx.fillRect(x-1,y+1,5,1);ctx.fillRect(x+1,y-1,1,5)}
  }
}
