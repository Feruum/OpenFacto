import { memo, useMemo } from 'react'
import { WaveLines, type WaveLine } from './WaveLines'
import './GenerativeArt.css'

export type ArtKind = 'terrain' | 'knowledge' | 'playground' | 'inbox' | 'settings'

// Stable base geometry; WaveLines propagates waves through its vertices.
export const GenerativeArt = memo(function GenerativeArt({ kind, relief = 55, className = '', stretch = false }: {
  kind: ArtKind
  relief?: number
  className?: string
  stretch?: boolean
}) {
  const lines = useMemo<WaveLine[]>(() => Array.from({ length: 38 }, (_, row) => {
    const d = row / 37
    const points = Array.from({ length: 121 }, (_, col) => {
      const x = col * 8
      let y: number
      if (kind === 'terrain') {
        const peak = (center: number, spread: number, height: number) =>
          height * Math.exp(-((x + d * 75 - center) ** 2) / (2 * spread ** 2))
        y = 250 + d * 120 - (peak(260, 110, 150) + peak(540, 90, 185) + peak(820, 115, 170)) * (0.55 + relief / 150) * (1 - d * 0.72)
          + Math.sin(x / 38 + d * 5) * 12 * (1 - d)
      } else if (kind === 'knowledge') {
        y = 80 + row * 5.7 + Math.sin(x / 155) * 28
          - 100 * Math.exp(-((x - 490 - d * 140) ** 2) / 16000) * Math.sin(d * Math.PI)
      } else if (kind === 'playground') {
        y = 180 + (d - 0.5) * 170 * Math.cos(x / 165)
          + Math.sin(x / 72 + d * 4) * (20 + 35 * Math.sin(x / 300))
      } else if (kind === 'settings') {
        y = 95 + d * 170 + Math.sin(x / 105 + d * 3) * 45
          + Math.cos(x / 210 - d * 5) * 25
      } else {
        const angle = col / 120 * Math.PI * 2
        const radius = 45 + row * 3.5
        return { x: 480 + Math.cos(angle) * radius * 2.15,
          y: 180 + Math.sin(angle) * radius * 0.7 + Math.cos(angle * 2 + d * 3) * 18, angle }
      }
      return { x, y }
    })
    return { points, opacity: 0.35 + (1 - d) * 0.55 }
  }), [kind, relief])
  return <svg className={`generative-art ${className}`} viewBox="0 0 960 380" preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'} fill="none" aria-hidden="true" focusable="false">
    <WaveLines lines={lines} profile={kind} />
    {kind === 'knowledge' && <path d="M705 65h66v53h-66z M719 80h38 M719 92h25" stroke="currentColor" strokeWidth="1.5" />}
  </svg>
})

export function SectionArt({ kind }: { kind: Exclude<ArtKind, 'terrain'> }) {
  return <div className={`section-art section-art--${kind}`} aria-hidden="true"><GenerativeArt kind={kind} stretch /></div>
}
