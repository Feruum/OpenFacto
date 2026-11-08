import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { WaveLines, type WaveLine } from './WaveLines'
import { X, FileText, MessageSquareText } from './icons'
import { Badge } from './components/arc/badge/badge'
import { Button } from './components/arc/button/button'
import type { Source } from './workspace'
import type { Translate } from './i18n'
export function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 68 66" fill="currentColor">
      <path d="M36 1h3A30 30 0 0 1 67 32H36a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1ZM27 15a27 27 0 0 0-24 39q.4.7 1 .2L27 38q.5-.4.5-1V16q0-1-.5-1ZM18 64a23 24 0 0 1 46 0q0 1-1 1H19q-1 0-1-1Z" />
    </svg>
  )
}
export function Landscape() {
  // A wireframe ridge drawn in perspective. Crest lines cluster toward the horizon.
  const ridges = useMemo<WaveLine[]>(() => Array.from({ length: 54 }, (_, i) => {
    const depth = i / 53
    const points = Array.from({ length: 156 }, (_, j) => {
      const x = j * 5 - 40
      const px = x + depth * 84
      const peak = (center: number, width: number, height: number) =>
        height * Math.exp(-((px - center) ** 2) / (2 * width ** 2))
      const height = peak(220, 88, 88) + peak(385, 61, 150) + peak(520, 66, 126) + peak(675, 55, 172)
      const folds =
        14 * Math.sin(px / 26 + depth * 3.6) +
        6 * Math.sin(px / 12 - depth * 2.8) +
        8 * Math.cos(px / 49 + depth * 7)
      const y = 211 + depth * 83 - (height + folds) * (1 - 0.68 * depth) + depth * depth * 8
      return { x, y }
    })
    return { points, opacity: 0.74 - depth * 0.27 }
  }), [])
  return (
    <svg className="landscape" viewBox="0 0 700 280" preserveAspectRatio="none" aria-hidden="true">
      <WaveLines lines={ridges} profile="landscape" strokeWidth={1.12} />
    </svg>
  )
}
export function Modal({
  title,
  close,
  children,
  t,
}: {
  title: string
  close: () => void
  children: ReactNode
  t: Translate
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId()
  useEffect(() => {
    const node = ref.current!
    node.showModal()
    return () => node.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label={t('close')}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function SourceList({
  rows,
  t,
  select,
}: {
  rows: Source[]
  t: Translate
  select: (s: Source) => void
}) {
  return (
    <div className="source-list">
      {rows.map((s) => (
        <button key={s.id} className="source-row" onClick={() => select(s)}>
          <span className={'source-icon ' + s.kind}>
            {s.kind === 'faq' ? <MessageSquareText size={20} /> : <FileText size={20} />}
          </span>
          <span className="source-name">
            <strong>{s.title}</strong>
            <small>
              {s.kind === 'faq' ? 'FAQ' : t('document')} <span>·</span> {s.language.toUpperCase()}
            </small>
          </span>
          <Badge className="source-status" size="sm" dot tone={s.publishedVersionId ? 'info' : 'neutral'}>
            {t(s.publishedVersionId ? 'published' : 'draft')}
          </Badge>
        </button>
      ))}
    </div>
  )
}
export function ErrorNotice({ message, retry, t }: { message: string; retry?: () => void; t: Translate }) {
  return (
    <div role="alert" className="notice">
      {message}
      {retry && (
        <Button type="button" size="sm" variant="secondary" onClick={retry}>
          {t('retry')}
        </Button>
      )}
    </div>
  )
}
