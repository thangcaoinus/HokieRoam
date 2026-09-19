export default function MatrixView({ m, translationCol = true }: { m: number[]; translationCol?: boolean }) {
  const cells = []
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const v = m[c * 4 + r]
      const z = Math.abs(v) < 1e-9
      const cls = translationCol && c === 3 && r < 3 && !z ? 't' : z ? 'z' : 'nz'
      cells.push(<span key={`${r}${c}`} className={cls}>{(z ? 0 : v).toFixed(4)}</span>)
    }
  return <div className="matrix">{cells}</div>
}
