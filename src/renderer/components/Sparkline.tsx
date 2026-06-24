import { useMemo } from 'react'

// Sparkline — mini SVG line chart, không axis, không tooltip.
// Dùng trong card analytics để xem nhanh xu hướng 30 ngày.
// Truyền vào mảng số (followers theo ngày), vẽ 1 line + gradient fill.

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  fillId?: string
}

export default function Sparkline({
  data,
  width = 120,
  height = 36,
  color = 'var(--accent)',
  fillId = 'sparkline-fill'
}: SparklineProps): JSX.Element {
  const { pathD, fillD, areaPath } = useMemo(() => {
    if (data.length < 2) return { pathD: '', fillD: '', areaPath: '' }
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const stepX = width / (data.length - 1)
    const padY = 4

    const points = data.map((v, i) => {
      const x = i * stepX
      const y = padY + (1 - (v - min) / range) * (height - padY * 2)
      return { x, y }
    })

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const fillD = `${pathD} L ${width} ${height} L 0 ${height} Z`
    return { pathD, fillD, areaPath: fillD }
  }, [data, width, height])

  if (data.length < 2) {
    return (
      <div className="sparkline-empty" style={{ width, height }}>
        <span className="muted small">chưa đủ dữ liệu</span>
      </div>
    )
  }

  return (
    <svg width={width} height={height} className="sparkline" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
