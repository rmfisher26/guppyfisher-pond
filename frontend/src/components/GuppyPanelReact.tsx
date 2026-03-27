// src/components/GuppyPanelReact.tsx
// React version of GuppyPanel — used when program switches client-side.
// Mirrors the visual design of GuppyPanel.astro exactly.

import { highlightGuppy } from '../utils/highlight';

interface Props {
  code: string;
  name: string;
  description: string;
  isActive?: boolean;
}

export default function GuppyPanelReact({ code, name, description, isActive }: Props) {
  const highlighted = highlightGuppy(code);

  return (
    <div className={`pv-panel ${isActive ? 'pv-panel--active pv-panel--green' : ''}`}>
      <div className="panel-header">
        <span className="badge badge-green">⬡ Guppy</span>
        <span className="panel-name">{name}</span>
        <span className="panel-desc">{description}</span>
      </div>
      <div style={{ padding: 0 }}>
        <pre
          className="guppy-code-pre"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>

      <style>{`
        .guppy-code-pre {
          background: #050608;
          margin: 0;
          padding: 16px;
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.75;
          color: #c0c8d8;
          overflow-x: auto;
          white-space: pre;
          border: none;
        }
        .panel-desc {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted);
          margin-left: auto;
        }
      `}</style>
    </div>
  );
}
