// Charts: progress ring, category donut (d3-shape arcs) and projection chart (d3-scale, d3-shape area/line).
import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import { arc, area, curveMonotoneX, line, pie, scaleLinear, type PieArcDatum } from 'd3';
import { projection } from '../../shared/calc';
import { formatCompact, formatVND } from '../../shared/format';
import type { Locale } from '../../shared/types';
import { t } from '../../shared/i18n';
import { useElementWidth, useMounted } from '../lib/hooks';

// ---------- ring ----------

export function Ring({
  value,
  size = 200,
  stroke = 14,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mounted = useMounted();
  const p = Math.max(0, Math.min(1, value));
  const gradId = `ring-grad-${size}`;
  return (
    <div className="ring" style={{ width: size, height: size }} data-testid="fi-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={mounted ? c * (1 - p) : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

// ---------- donut ----------

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  size = 150,
  thickness = 22,
  center,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}) {
  const r = size / 2;
  const data = slices.filter((s) => s.value > 0);
  const arcs = useMemo(() => pie<DonutSlice>().value((d) => d.value).sort(null)(data), [data]);
  const arcGen = useMemo(
    () => arc<PieArcDatum<DonutSlice>>().innerRadius(r - thickness).outerRadius(r - 2).cornerRadius(4).padAngle(0.025),
    [r, thickness],
  );
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`translate(${r} ${r})`}>
          {data.length === 0 && (
            <circle r={r - thickness / 2} fill="none" className="donut-empty" strokeWidth={thickness} />
          )}
          {arcs.map((a) => (
            <path key={a.data.key} d={arcGen(a) ?? ''} fill={a.data.color} className="donut-arc" />
          ))}
        </g>
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

// ---------- projection ----------

interface ProjectionProps {
  fiAssets: number;
  monthlySaving: number;
  expectedReturn: number;
  target: number;
  yearsToGoal: number | null;
  /** Calendar year of the FI date, for the crossing label. */
  fiYear: number | null;
  startYear: number;
  locale: Locale;
  years?: number;
}

const H = 240;
const M = { top: 18, right: 18, bottom: 30, left: 62 };

export function ProjectionChart({
  fiAssets,
  monthlySaving,
  expectedReturn,
  target,
  yearsToGoal,
  fiYear,
  startYear,
  locale,
  years = 20,
}: ProjectionProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const mounted = useMounted();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(280, measured || 320);

  const series = useMemo(
    () => [{ year: 0, value: fiAssets }, ...projection(fiAssets, monthlySaving, expectedReturn, years)],
    [fiAssets, monthlySaving, expectedReturn, years],
  );

  const maxValue = Math.max(target, ...series.map((p) => p.value), 1) * 1.08;
  const x = scaleLinear().domain([0, years]).range([M.left, w - M.right]);
  const y = scaleLinear().domain([0, maxValue]).range([H - M.bottom, M.top]);

  const areaPath = area<{ year: number; value: number }>()
    .x((d) => x(d.year))
    .y0(y(0))
    .y1((d) => y(d.value))
    .curve(curveMonotoneX)(series) ?? '';
  const linePath = line<{ year: number; value: number }>()
    .x((d) => x(d.year))
    .y((d) => y(d.value))
    .curve(curveMonotoneX)(series) ?? '';

  const crossing = yearsToGoal !== null && yearsToGoal <= years ? yearsToGoal : null;
  const yTicks = y.ticks(4);
  const xTicks = [0, 5, 10, 15, 20].filter((v) => v <= years);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + M.left;
    const year = Math.round(x.invert(px));
    setHover(Math.max(0, Math.min(years, year)));
  };

  const hoverPoint = hover !== null ? series[hover] : null;

  return (
    <div className="projection" ref={ref} data-testid="projection">
      <svg width={w} height={H} role="img" aria-label={t(locale, 'projection')} className="projection-svg">
        {yTicks.map((tick) => (
          <g key={tick} transform={`translate(0 ${y(tick)})`}>
            <line x1={M.left} x2={w - M.right} className="grid-line" />
            <text x={M.left - 8} dy="0.32em" textAnchor="end" className="axis-label">
              {formatCompact(tick, locale)}
            </text>
          </g>
        ))}
        {xTicks.map((yr) => (
          <text key={yr} x={x(yr)} y={H - 8} textAnchor="middle" className="axis-label">
            {startYear + yr}
          </text>
        ))}

        <line
          x1={M.left}
          x2={w - M.right}
          y1={y(target)}
          y2={y(target)}
          className="target-line"
        />
        <text x={M.left + 6} y={y(target) - 6} textAnchor="start" className="target-label">
          {t(locale, 'targetLine')}
        </text>

        <g
          className={`draw ${mounted ? 'is-drawn' : ''}`}
          style={{ transformOrigin: `${M.left}px 0px` }}
        >
          <path d={areaPath} className="proj-area" />
          <path d={linePath} className="proj-line" vectorEffect="non-scaling-stroke" />
        </g>

        {crossing !== null && (
          <g className="crossing" transform={`translate(${x(crossing)} ${y(target)})`}>
            <circle r={6} className="crossing-dot" />
            <text y={-14} textAnchor={crossing > years * 0.8 ? 'end' : 'middle'} className="crossing-label">
              {t(locale, 'fiCrossing', { year: fiYear ?? startYear + Math.ceil(crossing) })}
            </text>
          </g>
        )}

        {hoverPoint && (
          <g className="hover-marker" transform={`translate(${x(hoverPoint.year)} ${y(hoverPoint.value)})`}>
            <line y1={0} y2={H - M.bottom - y(hoverPoint.value)} x1={0} x2={0} className="hover-line" />
            <circle r={4.5} className="hover-dot" />
          </g>
        )}

        <rect
          x={M.left}
          y={0}
          width={w - M.left - M.right}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          data-testid="projection-hit"
        />
      </svg>
      {hoverPoint && (
        <div
          className="tooltip"
          style={{ left: Math.min(Math.max(x(hoverPoint.year), 70), w - 70), top: Math.max(0, y(hoverPoint.value) - 56) }}
        >
          <strong>{startYear + hoverPoint.year}</strong>
          <span title={formatVND(hoverPoint.value, locale)}>{formatCompact(hoverPoint.value, locale)}</span>
        </div>
      )}
    </div>
  );
}
