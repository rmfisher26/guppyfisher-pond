// src/components/SelenePanel.tsx
import type { Program } from '../data/programs';

type SeleneData = Program['selene'];
type TKETData   = Program['tket'];

interface Props {
  data:      SeleneData;
  tket:      TKETData;
  stateStep: number;
  running:   boolean;
  done:      boolean;
  isActive?: boolean;
}

function StateEvolution({ data, tket, step }: {
  data: SeleneData; tket: TKETData; step: number;
}) {
  const timeline = data.timeline;
  const current  = timeline[Math.min(step, timeline.length - 1)] || timeline[0];
  const nQ       = tket.qubits.length;

  return (
    <div className="state-evo">
      <div className="se-step-label">{current.label}</div>

      <div className="se-qubits">
        {Array.from({ length: nQ }, (_, i) => {
          const amp   = current.state[i] ?? 0;
          const isSup = Boolean(current.sup) && i === 0;
          const isEnt = Boolean(current.entangled);
          const isCls = Boolean(current.classical);
          const cls   = [
            'se-bloch',
            isSup ? 'se-bloch--sup' : '',
            isEnt ? 'se-bloch--ent' : '',
            isCls ? 'se-bloch--cls' : '',
          ].filter(Boolean).join(' ');

          return (
            <div key={i} className="se-qubit">
              <div className="se-qubit-label">{tket.qubits[i]}</div>
              <div className={cls}>
                {isCls
                  ? (amp > 0.5 ? '1' : '0')
                  : isSup && i === 0 ? '|+⟩'
                  : isEnt ? '∿' : '|0⟩'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="se-timeline">
        {timeline.map((t, i) => (
          <div key={i} className={`se-tick ${i <= step ? 'se-tick--done' : ''}`}>
            <div className="se-tick-dot" />
            <div className="se-tick-label">{t.label.split(' ')[0]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotResults({ data, running, done }: {
  data: SeleneData; running: boolean; done: boolean;
}) {
  const total = data.results.reduce((s, r) => s + r.count, 0);
  const fidelity = (
    data.results.filter(r => r.correlated).reduce((s, r) => s + r.count, 0) / total * 100
  ).toFixed(1);
  const noiseCount = data.results.filter(r => !r.correlated).reduce((s, r) => s + r.count, 0);

  return (
    <div className="shot-results">
      <div className="sr-header">
        <span className="sr-sim-badge">{data.simulator}</span>
        <span className="sr-shots">{data.shots} shots</span>
        {running && (
          <span className="sr-running">
            <span className="pulse-dot" /> Simulating…
          </span>
        )}
        {done && <span className="sr-done">✓ Complete</span>}
      </div>

      {done && (
        <div className="sr-bars">
          {data.results.map((r, i) => {
            const pct = r.count / total;
            return (
              <div key={i} className="sr-row"
                style={{ animationDelay: `${i * 80}ms` }}>
                <span className="sr-ket">|{r.state}⟩</span>
                <div className="sr-bar-wrap">
                  <div className="sr-bar"
                    style={{
                      width: `${pct * 100}%`,
                      background: r.correlated
                        ? 'linear-gradient(90deg,#1a6b4a,#2a9d6a)'
                        : 'linear-gradient(90deg,#8a2020,#c84040)',
                      animationDelay: `${i * 80 + 100}ms`,
                    }}
                  />
                </div>
                <span className="sr-count">{r.count}</span>
                <span className="sr-pct">{(pct * 100).toFixed(0)}%</span>
                {!r.correlated && r.count > 0 && (
                  <span className="sr-noise">noise</span>
                )}
              </div>
            );
          })}
          <div className="sr-note">
            Fidelity: {fidelity}% · {noiseCount} noise shots
          </div>
        </div>
      )}

      {!done && !running && (
        <div className="sr-idle">Press ▶ Run Pipeline to simulate</div>
      )}
    </div>
  );
}

export default function SelenePanel({ data, tket, stateStep, running, done, isActive }: Props) {
  return (
    <div className={`pv-panel ${isActive ? 'pv-panel--active pv-panel--purple' : ''}`}>
      <div className="panel-header">
        <span className="badge badge-purple">◉ Selene</span>
        <span className="panel-name">selene_sim.run_shots()</span>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StateEvolution data={data} tket={tket} step={stateStep} />
        <ShotResults    data={data} running={running} done={done} />
      </div>

      <style>{`
        /* ── State evolution ── */
        .state-evo { display: flex; flex-direction: column; gap: 10px; }
        .se-step-label {
          font-family: var(--font-mono); font-size: 11px; color: var(--gold);
        }
        .se-qubits { display: flex; gap: 12px; flex-wrap: wrap; }
        .se-qubit  { display: flex; flex-direction: column; align-items: center; gap: 5px; }
        .se-qubit-label {
          font-family: var(--font-mono); font-size: 10px; color: var(--muted);
        }
        .se-bloch {
          width: 50px; height: 50px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-mono); font-size: 12px; font-weight: 700;
          border: 2px solid var(--green); background: #0d1a12; color: var(--green);
          transition: all 0.4s ease;
        }
        .se-bloch--sup {
          background: #161a08; border-color: var(--gold); color: var(--gold);
          animation: superpos 1s ease infinite alternate;
        }
        .se-bloch--ent {
          background: #0a0d1a; border-color: var(--blue); color: var(--blue);
          animation: entangle 1.5s ease infinite;
        }
        .se-bloch--cls {
          background: #1a0a1a; border-color: var(--purple); color: var(--purple);
        }

        .se-timeline { display: flex; overflow-x: auto; }
        .se-tick {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          opacity: 0.3; transition: opacity 0.35s; min-width: 52px;
          position: relative;
        }
        .se-tick::before {
          content: ""; position: absolute; top: 5px; left: -50%;
          width: 100%; height: 1px; background: var(--border);
        }
        .se-tick:first-child::before { display: none; }
        .se-tick--done { opacity: 1; }
        .se-tick-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: var(--border); border: 2px solid var(--border);
        }
        .se-tick--done .se-tick-dot {
          background: var(--green); border-color: var(--green);
        }
        .se-tick-label {
          font-family: var(--font-mono); font-size: 9px;
          color: var(--muted); text-align: center;
        }

        /* ── Shot results ── */
        .shot-results { display: flex; flex-direction: column; gap: 10px; }
        .sr-header {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .sr-sim-badge {
          font-family: var(--font-mono); font-size: 12px;
          color: var(--purple); background: #1a0a2a;
          border: 1px solid color-mix(in srgb,var(--purple) 40%,transparent);
          padding: 2px 10px; border-radius: 5px;
        }
        .sr-shots { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
        .sr-running {
          display: flex; align-items: center; gap: 6px;
          font-family: var(--font-mono); font-size: 11px; color: var(--gold);
        }
        .pulse-dot {
          width: 7px; height: 7px; border-radius: 50%; background: var(--gold);
          animation: pulse 1s ease infinite;
        }
        .sr-done { font-family: var(--font-mono); font-size: 11px; color: var(--green); }

        .sr-bars { display: flex; flex-direction: column; gap: 8px; }
        .sr-row {
          display: flex; align-items: center; gap: 9px;
          animation: slideIn 0.3s ease both;
        }
        .sr-ket   { font-family: var(--font-mono); font-size: 13px; width: 46px; }
        .sr-bar-wrap { flex: 1; height: 10px; background: var(--bg3); border-radius: 5px; overflow: hidden; }
        .sr-bar   { height: 100%; border-radius: 5px; animation: grow 0.7s ease both; }
        .sr-count { font-family: var(--font-mono); font-size: 11px; color: var(--muted); width: 30px; text-align: right; }
        .sr-pct   { font-family: var(--font-mono); font-size: 11px; color: var(--text); width: 36px; }
        .sr-noise {
          font-family: var(--font-mono); font-size: 9px;
          color: var(--red); background: #200a0a;
          padding: 1px 6px; border-radius: 3px;
        }
        .sr-note  {
          font-family: var(--font-mono); font-size: 11px;
          color: var(--muted); margin-top: 6px;
          padding-top: 8px; border-top: 1px solid var(--border);
        }
        .sr-idle  {
          font-family: var(--font-mono); font-size: 12px;
          color: #2a2d40; padding: 12px 0;
        }
      `}</style>
    </div>
  );
}
