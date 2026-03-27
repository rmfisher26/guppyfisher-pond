// src/components/HUGRPanel.tsx
import { useState } from 'react';
import type { HUGRNode, HUGREdge } from '../data/programs';
import { highlightJson } from '../utils/highlight';

interface Props {
  nodes: HUGRNode[];
  edges: HUGREdge[];
  json: string;
  isActive?: boolean;
}

const EDGE_COLORS: Record<string, string> = {
  hierarchy: '#3a4a5a',
  quantum:   '#1a6b4a',
  classical: '#a040c8',
  dataflow:  '#4a5a7a',
};

function HUGRGraph({ nodes, edges, hovNode, setHovNode }: {
  nodes: HUGRNode[];
  edges: HUGREdge[];
  hovNode: number | null;
  setHovNode: (id: number | null) => void;
}) {
  const W = 320, H = 320;
  const px = (p: number) => (p / 100) * W;
  const py = (p: number) => (p / 100) * H;
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 300 }}>
      <defs>
        {Object.entries(EDGE_COLORS).map(([k, c]) => (
          <marker key={k} id={`arr-${k}`} markerWidth="6" markerHeight="6"
            refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={c} opacity="0.7" />
          </marker>
        ))}
      </defs>

      {edges.map((e, i) => {
        const fn = nodeMap[e.from], tn = nodeMap[e.to];
        if (!fn || !tn) return null;
        const x1 = px(fn.x), y1 = py(fn.y);
        const x2 = px(tn.x), y2 = py(tn.y);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 4;
        const col = EDGE_COLORS[e.type] || '#4a5a7a';
        const active = hovNode === e.from || hovNode === e.to;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={col}
              strokeWidth={active ? 2 : 1}
              strokeOpacity={active ? 1 : 0.35}
              markerEnd={`url(#arr-${e.type})`}
            />
            {e.label && active && (
              <text x={mx} y={my} textAnchor="middle"
                fill={col} fontSize="8" fontFamily="'Fira Code',monospace">
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map(n => {
        const x = px(n.x), y = py(n.y);
        const hov = hovNode === n.id;
        const lines = n.label.split('\n');
        return (
          <g key={n.id} style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHovNode(n.id)}
            onMouseLeave={() => setHovNode(null)}>
            <rect
              x={x - 28} y={y - 11}
              width={56} height={lines.length > 1 ? 22 : 18}
              rx="5"
              fill={hov ? n.color + '38' : n.color + '18'}
              stroke={hov ? n.color : n.color + '70'}
              strokeWidth={hov ? 1.5 : 1}
              style={{ transition: 'all 0.15s' }}
            />
            {lines.map((l, li) => (
              <text key={li}
                x={x} y={y + (lines.length > 1 ? -3 + li * 9 : 0)}
                textAnchor="middle" dominantBaseline="middle"
                fill={hov ? n.color : n.color + 'cc'}
                fontSize={lines.length > 1 ? '7.5' : '9'}
                fontWeight="600"
                fontFamily="'Fira Code',monospace">
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export default function HUGRPanel({ nodes, edges, json, isActive }: Props) {
  const [view, setView]     = useState<'graph' | 'json'>('graph');
  const [hovNode, setHovNode] = useState<number | null>(null);

  return (
    <div className={`pv-panel ${isActive ? 'pv-panel--active pv-panel--blue' : ''}`}>
      <div className="panel-header">
        <span className="badge badge-blue">◈ HUGR IR</span>
        <span className="panel-name">module.compile()</span>
        <div className="panel-actions">
          <button
            className={`action-btn ${view === 'graph' ? 'action-btn--on' : ''}`}
            onClick={() => setView('graph')}>
            graph
          </button>
          <button
            className={`action-btn ${view === 'json' ? 'action-btn--on' : ''}`}
            onClick={() => setView('json')}>
            json
          </button>
        </div>
      </div>

      {view === 'graph' ? (
        <>
          <div style={{ padding: '8px', minHeight: 240 }}>
            <HUGRGraph nodes={nodes} edges={edges}
              hovNode={hovNode} setHovNode={setHovNode} />
          </div>
          <div className="hugr-legend">
            {Object.entries(EDGE_COLORS).map(([k, c]) => (
              <div key={k} className="legend-item">
                <div className="legend-line" style={{ background: c }} />
                <span>{k}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <pre className="json-pre"
          dangerouslySetInnerHTML={{ __html: highlightJson(json) }} />
      )}

      <style>{`
        .hugr-legend {
          display: flex; gap: 12px; flex-wrap: wrap;
          padding: 8px 14px; border-top: 1px solid var(--border);
        }
        .legend-item {
          display: flex; align-items: center; gap: 5px;
          font-family: var(--font-mono); font-size: 10px; color: var(--muted);
        }
        .legend-line { width: 16px; height: 2px; border-radius: 1px; }
        .json-pre {
          background: #050608;
          margin: 0; padding: 14px 16px;
          font-family: var(--font-mono); font-size: 11px; line-height: 1.7;
          color: #c0c8d8; overflow: auto; max-height: 310px; white-space: pre;
        }
      `}</style>
    </div>
  );
}
