import { useRef, useState } from 'react'

export default function Compare({ before, after }: { before: string; after: string | null }) {
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  return (
    <div
      ref={ref}
      className="compare"
      style={{ ['--pos' as string]: `${after ? pos : 100}%` }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); move(e.clientX) }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
    >
      <img src={before} alt="Original" />
      {after && <img className="after" src={after} alt="Redesign" />}
      {after && <div className="handle" />}
      <span className="tag l">Source</span>
      {after && <span className="tag r">AI concept</span>}
    </div>
  )
}
