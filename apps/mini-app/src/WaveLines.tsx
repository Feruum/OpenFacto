import { memo, useEffect, useMemo, useRef } from 'react'

export interface WavePoint { x: number; y: number; angle?: number }
export interface WaveLine { points: WavePoint[]; opacity: number }
export type WaveProfile = 'landscape' | 'terrain' | 'knowledge' | 'playground' | 'inbox' | 'settings'

const profiles: Record<WaveProfile, { amplitude: number; speed: number; length: number }> = {
  landscape: { amplitude: 12, speed: 0.85, length: 68 },
  terrain: { amplitude: 15, speed: 0.8, length: 92 },
  knowledge: { amplitude: 11, speed: 0.95, length: 100 },
  playground: { amplitude: 19, speed: 1.15, length: 78 },
  inbox: { amplitude: 10, speed: 0.85, length: 90 },
  settings: { amplitude: 15, speed: 0.9, length: 95 },
}

/** Travelling waves deform vertices, while the SVG and its layout stay fixed. */
export const WaveLines = memo(function WaveLines({ lines, profile, strokeWidth = 0.85 }: {
  lines: WaveLine[]; profile: WaveProfile; strokeWidth?: number
}) {
  const group = useRef<SVGGElement>(null)
  const geometry = useMemo(() => {
    const { amplitude, speed, length } = profiles[profile]
    // Spatial harmonics are computed once; each frame only updates their time phase.
    const prepared = lines.map((line, row) => {
      const depth = row / Math.max(1, lines.length - 1)
      return line.points.map(point => {
        const circular = point.angle !== undefined
        const phase = circular ? point.angle! * 3 : point.x / length
        const strength = amplitude * (circular ? 0.4 + depth * 0.6 : 1 - depth * 0.55)
        const a = phase + depth * 4.5
        const b = (circular ? point.angle! * 2 : phase * 0.57) - depth * 3.2
        const c = (circular ? point.angle! * 5 : phase * 1.83) + depth * 6
        return { ...point, nx: circular ? Math.cos(point.angle!) * 2.15 : 0,
          ny: circular ? Math.sin(point.angle!) * 0.7 : 1,
          s: [Math.sin(a) * strength, Math.sin(b) * strength * 0.42, Math.sin(c) * strength * 0.18] as const,
          c: [Math.cos(a) * strength, Math.cos(b) * strength * 0.42, Math.cos(c) * strength * 0.18] as const }
      })
    })
    const frame = (seconds: number) => {
      const t = seconds * speed
      const sin = [Math.sin(t), Math.sin(t * 0.67), Math.sin(t * 1.41)] as const
      const cos = [Math.cos(t), Math.cos(t * 0.67), Math.cos(t * 1.41)] as const
      return prepared.map(points => points.map((p, index) => {
        const wave = p.s[0] * cos[0] - p.c[0] * sin[0]
          + p.s[1] * cos[1] - p.c[1] * sin[1] + p.s[2] * cos[2] - p.c[2] * sin[2]
        return `${index ? 'L' : 'M'}${(p.x + p.nx * wave).toFixed(2)} ${(p.y + p.ny * wave).toFixed(2)}`
      }).join(' '))
    }
    return { frame, initial: frame(0) }
  }, [lines, profile])

  useEffect(() => {
    const node = group.current
    const svg = node?.ownerSVGElement
    if (!node || !svg) return
    const paths = [...node.querySelectorAll('path')]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false, elapsed = 0, previous = 0, lastDraw = 0
    let request: number | undefined
    const draw = (values: string[]) => paths.forEach((path, i) => path.setAttribute('d', values[i]!))
    const tick = (now: number) => {
      if (previous) elapsed += Math.min((now - previous) / 1000, 0.1)
      previous = now
      if (now - lastDraw >= 1000 / 30) {
        draw(geometry.frame(elapsed))
        lastDraw = now
      }
      request = requestAnimationFrame(tick)
    }
    const sync = () => {
      if (request !== undefined) cancelAnimationFrame(request)
      request = undefined
      previous = 0
      if (reduced.matches) {
        elapsed = 0
        draw(geometry.initial)
      }
      const active = visible && !document.hidden && !reduced.matches
      node.dataset.waveState = active ? 'running' : 'paused'
      if (active) request = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      sync()
    })
    observer.observe(svg)
    reduced.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      if (request !== undefined) cancelAnimationFrame(request)
      observer.disconnect()
      reduced.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [geometry])

  return <g ref={group} data-wave-profile={profile} fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
    {geometry.initial.map((d, index) => <path key={index} d={d} opacity={lines[index]!.opacity} />)}
  </g>
})
