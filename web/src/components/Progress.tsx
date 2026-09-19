import { Check } from 'lucide-react'

export default function Progress({ title, steps, current }: { title: string; steps: string[]; current: number }) {
  return (
    <div className="progress-overlay">
      <div className="progress-box">
        <div className="eyebrow">{title}</div>
        <ul className="plist">
          {steps.map((s, i) => (
            <li key={s} className={i < current ? 'done' : i === current ? 'on' : ''}>
              {i < current ? <Check size={14} /> : i === current ? <span className="spinner" /> : <span style={{ width: 14 }} />}
              {s}
            </li>
          ))}
        </ul>
        <div className="bar"><i style={{ width: `${((current + 0.5) / steps.length) * 100}%` }} /></div>
      </div>
    </div>
  )
}
