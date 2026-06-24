import { useState, useMemo, useRef } from 'react'
import type { DailyStats } from '@shared/types'

// GrowthChart — SVG line chart lớn với 3 metrics (followers/following/posts),
// axis X (ngày), grid nhẹ, hover tooltip hiển thị giá trị tại điểm gần nhất.

interface GrowthChartProps {
  series: DailyStats[]
  height?: number
}

const COLORS = {
  followers: 'var(--accent)',
  following: 'var(--success)',
  posts: 'var(--warn)'
}

const LABELS = {
  followers: 'Followers',
  following: 'Following',
  posts: 'Bài viết'
}

export default function GrowthChart({ series, height = 200 }: GrowthChartProps): JSX.Element {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const width = 560
  const padL = 50
  const padR = 16
  const padT = 12
  const padB = 28
  const chartW = width - padL - padR
  const chartH = height - padT - padB

  const { metrics, xStep, days } = useMemo(() => {
    if (series.length === 0) {
      return { metrics: null, xStep: 0, days: [] as number[] }
    }
    const days = series.map((s) => s.day)
    const xStep = chartW / Math.max(1, days.length - 1)

    const followers = series.map((s) => s.followers)
    const following = series.map((s) => s.following)
    const posts = series.map((s) => s.statusesCount)

    // Tìm max toàn cục cho scale Y (dùng thang log nếu chênh lệch lớn).
    const allVals = [...followers, ...following, ...posts].filter((v): v is number => v !== null)
    const maxVal = allVals.length > 0 ? Math.max(...allVals) : 1

    return {
      metrics: { followers, following, posts, maxVal },
      xStep,
      days
    }
  }, [series, chartW])

  if (!metrics || series.length < 2) {
    return (
      <div className="growth-chart-empty" style={{ height }}>
        <span className="muted small">Chưa đủ dữ liệu để vẽ biểu đồ (cần ít nhất 2 ngày)</span>
      </div>
    )
  }

  const { followers, following, posts, maxVal } = metrics

  // Tính path cho mỗi metric.
  function makePath(values: (number | null)[]): string {
    const points = values.map((v, i) => {
      if (v === null) return null
      const x = padL + i * xStep
      const y = padT + (1 - v / maxVal) * chartH
      return { x, y }
    }).filter((p): p is { x: number; y: number } => p !== null)
    if (points.length === 0) return ''
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }

  const paths = {
    followers: makePath(followers),
    following: makePath(following),
    posts: makePath(posts)
  }

  // Hover: tìm index gần nhất với vị trí chuột.
  function handleMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * width - padL
    const idx = Math.round(x / xStep)
    setHoverIdx(Math.max(0, Math.min(series.length - 1, idx)))
  }

  // Format ngày cho axis (5 mốc đều nhau).
  const axisCount = 5
  const axisIndices = Array.from({ length: axisCount }, (_, i) =>
    Math.round((i * (series.length - 1)) / (axisCount - 1))
  )

  const hoverX = hoverIdx !== null ? padL + hoverIdx * xStep : 0
  const hoverPoint = hoverIdx !== null ? series[hoverIdx] : null

  function fmtNum(n: number | null): string {
    if (n === null) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  function fmtDay(ts: number): string {
    return new Date(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  }

  return (
    <div className="growth-chart-wrapper">
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="growth-chart"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid lines ngang */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + t * chartH
          const val = Math.round(maxVal * (1 - t))
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} className="chart-grid-line" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="chart-axis-text">
                {fmtNum(val)}
              </text>
            </g>
          )
        })}

        {/* Axis X — ngày */}
        {axisIndices.map((i) => {
          const x = padL + i * xStep
          const day = series[i]?.day
          if (!day) return null
          return (
            <text key={i} x={x} y={height - 8} textAnchor="middle" className="chart-axis-text">
              {fmtDay(day)}
            </text>
          )
        })}

        {/* Lines */}
        <path d={paths.followers} fill="none" stroke={COLORS.followers} strokeWidth="2" className="chart-line" />
        <path d={paths.following} fill="none" stroke={COLORS.following} strokeWidth="2" className="chart-line" />
        <path d={paths.posts} fill="none" stroke={COLORS.posts} strokeWidth="2" className="chart-line" />

        {/* Hover indicator */}
        {hoverIdx !== null && (
          <>
            <line x1={hoverX} y1={padT} x2={hoverX} y2={padT + chartH} className="chart-hover-line" />
            {hoverPoint && (
              <>
                {hoverPoint.followers !== null && (
                  <circle cx={hoverX} cy={padT + (1 - hoverPoint.followers / maxVal) * chartH} r="3.5" fill={COLORS.followers} />
                )}
                {hoverPoint.following !== null && (
                  <circle cx={hoverX} cy={padT + (1 - hoverPoint.following / maxVal) * chartH} r="3.5" fill={COLORS.following} />
                )}
                {hoverPoint.statusesCount !== null && (
                  <circle cx={hoverX} cy={padT + (1 - hoverPoint.statusesCount / maxVal) * chartH} r="3.5" fill={COLORS.posts} />
                )}
              </>
            )}
          </>
        )}
      </svg>

      {/* Legend + tooltip */}
      <div className="chart-legend">
        <span className="chart-legend-item" style={{ color: COLORS.followers }}>
          <span className="chart-legend-dot" style={{ background: COLORS.followers }} />
          Followers
        </span>
        <span className="chart-legend-item" style={{ color: COLORS.following }}>
          <span className="chart-legend-dot" style={{ background: COLORS.following }} />
          Following
        </span>
        <span className="chart-legend-item" style={{ color: COLORS.posts }}>
          <span className="chart-legend-dot" style={{ background: COLORS.posts }} />
          Bài viết
        </span>
      </div>

      {hoverPoint && (
        <div className="chart-tooltip">
          <span className="chart-tooltip-date">{fmtDay(hoverPoint.day)}</span>
          <span style={{ color: COLORS.followers }}>{LABELS.followers}: {fmtNum(hoverPoint.followers)}</span>
          <span style={{ color: COLORS.following }}>{LABELS.following}: {fmtNum(hoverPoint.following)}</span>
          <span style={{ color: COLORS.posts }}>{LABELS.posts}: {fmtNum(hoverPoint.statusesCount)}</span>
        </div>
      )}
    </div>
  )
}
