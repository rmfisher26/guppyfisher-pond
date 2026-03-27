// src/components/TKETPanel.tsx
import { useState } from 'react';
import type { Program } from '../data/programs';

type TKETData = Program['tket'];

interface Props {
  data: TKETData;
  isActive?: boolean;
}

const GATE_STYLES: Record<string, { fill: string; label: string }> = {
  H:       { fill: '#1a6b4a', label: 'H'   },
  CX:      { fill: '#4a80c8', label: '⊕'   },
  ZZMax:   { fill: '#c84040', label: 'ZZ'  },
  Rz:      { fill: '#c8a040', label: 'Rz'  },
  Measure: { fill: '#a040c8', label: 'M'   },
};

function CircuitSVG({ data, optimised }: { data: TKETData; optimised: boolean }) {
  const gates  = optimised ? data.optimised.gates : data.gates;
  const nQ     = data.qubits.length;
  const ROW = 44, COL = 62, PAD_L = 52, PAD_T = 20;
  const maxCol = Math.max(...gates.map(g => g.col));
  const W = PAD_L + (maxCol + 1) * COL + 32;
  const H = PAD_T + nQ * ROW + 28;

  const qy = (i: number) => PAD_T + i * ROW + ROW / 2;
  const gx = (c: number) => PAD_L + c * COL + COL / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 200 }}>
      {/* Wires */}
      {data.qubits.map((q, i) => (
        <g key={i}>
          <line x1={PAD_L - 6} y1={qy(i)} x2={W - 12} y2={qy(i)}
            stroke="#2a3040" strokeWidth="1.5" />
          <text x={PAD_L - 8} y={qy(i)} textAnchor="end" dominantBaseline="middle"
            fill="#5a6a8a" fontSize="10" fontFamily="'Fira Code',monospace">{q}</text>
        </g>
      ))}

      {/* Gates */}
      {gates.map((g, gi) => {
        const style = GATE_STYLES[g.type] || { fill: '#666', label: g.type };
        const x = gx(g.col);

        // Two-qubit gates
        if (g.type === 'CX' || g.type === 'ZZMax') {
          const y0 = qy(g.qubits[0]), y1 = qy(g.qubits[1]);
          return (
            <g key={gi}>
              <line x1={x} y1={y0} x2={x} y2={y1}
                stroke={g.native ? '#c84040' : '#4a80c8'} strokeWidth="1.5" />
              {g.type === 'CX' ? (
                <>
                  <circle cx={x} cy={y0} r={6} fill="#4a80c8" />
                  <circle cx={x} cy={y1} r={13} fill="none"
                    stroke="#4a80c8" strokeWidth="1.5" />
                  <line x1={x-10} y1={y1} x2={x+10} y2={y1}
                    stroke="#4a80c8" strokeWidth="1.5"/>
                  <line x1={x} y1={y1-10} x2={x} y2={y1+10}
                    stroke="#4a80c8" strokeWidth="1.5"/>
                </>
              ) : (
                <>
                  {[y0, y1].map((yy, ii) => (
                    <g key={ii}>
                      <rect x={x-14} y={yy-10} width={28} height={20} rx="4"
                        fill="#c8404028" stroke="#c84040" strokeWidth="1.5"/>
                      <text x={x} y={yy} textAnchor="middle" dominantBaseline="middle"
                        fill="#c84040" fontSize="8" fontWeight="700"
                        fontFamily="'Fira Code',monospace">ZZMax</text>
                    </g>
                  ))}
                </>
              )}
            </g>
          );
        }

        // Single-qubit gates
        const y = qy(g.qubits[0]);
        const isMeasure = g.type === 'Measure';
        return (
          <g key={gi}>
            <rect x={x-13} y={y-11} width={26} height={22} rx="4"
              fill={style.fill + '28'} stroke={style.fill} strokeWidth="1.5" />
            {isMeasure ? (
              <>
                <path d={`M ${x-7} ${y+3} Q ${x} ${y-6} ${x+7} ${y+3}`}
                  fill="none" stroke="#a040c8" strokeWidth="1.5"/>
                <line x1={x} y1={y+3} x2={x+6} y2={y-4}
                  stroke="#a040c8" strokeWidth="1.5"/>
              </>
            ) : (
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                fill={style.fill} fontSize="10" fontWeight="700"
                fontFamily="'Fira Code',monospace">{style.label}</text>
            )}
            {g.native && (
              <circle cx={x+12} cy={y-10} r={3} fill="#c84040" />
            )}
          </g>
        );
      })}

      {/* Time markers */}
      {Array.from({ length: maxCol + 1 }, (_, c) => (
        <text key={c} x={gx(c)} y={H - 6} textAnchor="middle"
          fill="#3a4050" fontSize="8" fontFamily="'Fira Code',monospace">
          t{c}
        </text>
      ))}
    </svg>
  );
}

export default function TKETPanel({ data, isActive }: Props) {
  const [optimised, setOptimised] = useState(false);
  const stats = optimised ? data.optimised.stats : data.stats;

  return (
    <div className={`pv-panel ${isActive ? 'pv-panel--active pv-panel--red' : ''}`}>
      <div className="panel-header">
        <span className="badge badge-red">◻ TKET</span>
        <span className="panel-name">pytket Circuit</span>
        <label className={`opt-toggle ${optimised ? 'opt-toggle--on' : ''}`}>
          <input type="checkbox" checked={optimised}
            onChange={e => setOptimised(e.target.checked)} />
          H2-native optimisation
        </label>
      </div>

      <div className="panel-body">
        <CircuitSVG data={data} optimised={optimised} />

        <div className="tket-stats">
          <span>Gates: <b>{stats.gates}</b></span>
          <span>Depth: <b>{stats.depth}</b></span>
          <span>2Q: <b>{stats.twoQ}</b></span>
          {stats.note && <span className="stat-note">{stats.note}</span>}
          {optimised && (
            <span className="native-key">
              <span className="native-dot" /> = native gate
            </span>
          )}
        </div>
      </div>

      <style>{`
        .opt-toggle {
          display: flex; align-items: center; gap: 7px;
          font-family: var(--font-mono); font-size: 11px;
          color: var(--muted); cursor: pointer;
          margin-left: auto;
        }
        .opt-toggle input { accent-color: var(--red); cursor: pointer; }
        .opt-toggle--on { color: var(--red); }

        .tket-stats {
          display: flex; gap: 14px; flex-wrap: wrap;
          padding: 8px 16px;
          font-family: var(--font-mono); font-size: 11px;
          color: var(--muted);
          border-top: 1px solid var(--border);
        }
        .tket-stats b { color: var(--text); }
        .stat-note { color: var(--red); }
        .native-key { display: flex; align-items: center; gap: 5px; color: var(--red); }
        .native-dot {
          width: 6px; height: 6px; border-radius: 50%; background: var(--red);
        }
      `}</style>
    </div>
  );
}
