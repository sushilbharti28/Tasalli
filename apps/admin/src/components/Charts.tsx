/**
 * Small server-rendered SVG charts for the metrics page: one series each, so no
 * legend (the card title names the series). Hover shows a native tooltip per point;
 * every chart has a table view underneath.
 */

export interface Point {
  label: string;
  value: number | null; // 0..1 rate, null = no data
  detail: string; // tooltip / table text, e.g. "41 of 50"
}

const W = 960;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function yTicks(max: number): number[] {
  const steps = max === 1 ? 4 : 5;
  return Array.from({ length: steps + 1 }, (_, i) => (max * i) / steps);
}

function niceMax(values: number[], target?: number): number {
  const m = Math.max(0, ...values, target ?? 0);
  if (m <= 0.05) return 0.05;
  if (m <= 0.1) return 0.1;
  if (m <= 0.25) return 0.25;
  if (m <= 0.5) return 0.5;
  return 1;
}

function Frame({ max, target, children, xLabels }: { max: number; target?: number; children: React.ReactNode; xLabels: { x: number; text: string }[] }) {
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);
  return (
    <>
      {yTicks(max).map((t) => (
        <g key={t}>
          <line className="gridline" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">{pct(t)}</text>
        </g>
      ))}
      {target !== undefined && target <= max && (
        <g>
          <line className="target" x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} />
          <text className="axis" x={W - PAD.right} y={y(target) - 4} textAnchor="end">target {pct(target)}</text>
        </g>
      )}
      {children}
      {xLabels.map((l) => (
        <text key={l.x + l.text} className="axis" x={l.x} y={H - 8} textAnchor="middle">{l.text}</text>
      ))}
    </>
  );
}

function TableView({ points, valueHeader }: { points: Point[]; valueHeader: string }) {
  return (
    <details>
      <summary>Table view</summary>
      <table>
        <thead><tr><th>Period</th><th className="num">{valueHeader}</th><th className="num">Count</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}><td>{p.label}</td><td className="num">{p.value === null ? '–' : `${(p.value * 100).toFixed(1)}%`}</td><td className="num">{p.detail}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function RateLineChart({ title, points, target }: { title: string; points: Point[]; target?: number }) {
  const max = niceMax(points.map((p) => p.value ?? 0), target);
  const innerW = W - PAD.left - PAD.right;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);

  // Break the line where a day has no data.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else current.push(`${current.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));

  const every = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points
    .map((p, i) => ({ i, p }))
    .filter(({ i }) => i % every === 0 || i === points.length - 1)
    .map(({ i, p }) => ({ x: x(i), text: p.label.slice(5) }));
  const slot = innerW / Math.max(points.length, 1);

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <Frame max={max} target={target} xLabels={xLabels}>
          {segments.map((d) => <path key={d} className="line" d={d} />)}
          {points.map((p, i) =>
            p.value === null ? null : (
              <g key={p.label}>
                <rect className="hit" x={x(i) - slot / 2} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom}>
                  <title>{`${p.label}: ${pct(p.value)} (${p.detail})`}</title>
                </rect>
                {points.length <= 31 && <circle className="dot" cx={x(i)} cy={y(p.value)} r={4} pointerEvents="none" />}
              </g>
            ),
          )}
        </Frame>
      </svg>
      <TableView points={points} valueHeader="Rate" />
    </figure>
  );
}

export function RateBarChart({ title, points, target }: { title: string; points: Point[]; target?: number }) {
  const max = niceMax(points.map((p) => p.value ?? 0), target);
  const innerW = W - PAD.left - PAD.right;
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(48, slot - 2 - slot * 0.3);
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / max);
  const base = y(0);
  const xLabels = points.map((p, i) => ({ x: PAD.left + slot * i + slot / 2, text: p.label }));
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <Frame max={max} target={target} xLabels={xLabels}>
          {points.map((p, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const v = p.value ?? 0;
            const top = y(v);
            const h = Math.max(base - top, 0);
            const r = Math.min(4, h, barW / 2);
            // Rounded top, square base anchored to the axis.
            const d = h <= 0 ? '' : `M${cx - barW / 2},${base} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${base} Z`;
            return (
              <g key={p.label}>
                <rect className="hit" x={cx - slot / 2} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom}>
                  <title>{`${p.label}: ${p.value === null ? 'no data' : pct(p.value)} (${p.detail})`}</title>
                </rect>
                {d && <path className="bar" d={d} pointerEvents="none" />}
              </g>
            );
          })}
        </Frame>
      </svg>
      <TableView points={points} valueHeader="Rate" />
    </figure>
  );
}
