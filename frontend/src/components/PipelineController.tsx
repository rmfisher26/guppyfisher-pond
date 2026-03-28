// src/components/PipelineController.tsx
// Root React island — orchestrates all four panels and pipeline animation.
// Handles program switching, keyboard shortcuts, and shareable URL state.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Program } from '../data/programs';
import { PROGRAMS } from '../data/programs';
import GuppyPanelReact from './GuppyPanelReact';
import HUGRPanel       from './HUGRPanel';
import TKETPanel       from './TKETPanel';
import SelenePanel     from './SelenePanel';

const LIVE_BACKEND = import.meta.env.PUBLIC_LIVE_BACKEND === 'true';
const BACKEND_URL = 'http://localhost:8000';

const STAGES = ['guppy', 'hugr', 'tket', 'selene'] as const;
type Stage = typeof STAGES[number];

const STAGE_META: Record<Stage, { label: string; icon: string; color: string }> = {
  guppy:  { label: 'Guppy',   icon: '⬡', color: '#1a6b4a' },
  hugr:   { label: 'HUGR IR', icon: '◈', color: '#4a80c8' },
  tket:   { label: 'TKET',    icon: '◻', color: '#c84040' },
  selene: { label: 'Selene',  icon: '◉', color: '#a040c8' },
};

const FLOW_LABELS = ['compile→', 'lower→', 'emulate→'];

interface Props {
  initialProgram?: string;
}

function getInitialProgram(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const p = new URLSearchParams(window.location.search).get('program');
  return p && PROGRAMS[p] ? p : fallback;
}

export default function PipelineController({ initialProgram = 'bell' }: Props) {
  const [programKey, setProgramKey] = useState(() => getInitialProgram(initialProgram));
  const [activeIdx,  setActiveIdx]  = useState(0);
  const [reachedIdx, setReachedIdx] = useState(-1);
  const [running,    setRunning]    = useState(false);
  const [stateStep,  setStateStep]  = useState(0);
  const [seleneRun,  setSeleneRun]  = useState(false);
  const [seleneDone, setSeleneDone] = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [liveHugrJson,    setLiveHugrJson]    = useState<string | null>(null);
  const [liveSeleneData,  setLiveSeleneData]  = useState<Program['selene'] | null>(null);
  const [compileError,    setCompileError]    = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prog: Program = PROGRAMS[programKey] ?? PROGRAMS['bell'];

  // URL sync
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('program', programKey);
    window.history.replaceState({}, '', url.toString());
  }, [programKey]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!running) runPipeline(); }
      if (e.key === 'r' || e.key === 'R') resetPipeline();
      if (['1','2','3','4'].includes(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (reachedIdx >= idx) setActiveIdx(idx);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [running, reachedIdx]);

  const clearTimer = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const resetPipeline = useCallback(() => {
    clearTimer();
    setRunning(false); setReachedIdx(-1); setActiveIdx(0);
    setStateStep(0); setSeleneRun(false); setSeleneDone(false);
    setLiveHugrJson(null); setLiveSeleneData(null); setCompileError(null);
  }, []);

  useEffect(() => { resetPipeline(); }, [programKey]);
  useEffect(() => () => clearTimer(), []);

  const animatePipeline = (seleneMax: number) => {
    setRunning(true); setActiveIdx(0); setReachedIdx(0);
    const advance = (idx: number, delay: number) => {
      timerRef.current = setTimeout(() => {
        setActiveIdx(idx); setReachedIdx(idx);
        if (idx === 3) {
          setSeleneRun(true);
          let step = 0;
          const tick = () => {
            timerRef.current = setTimeout(() => {
              step++; setStateStep(step);
              if (step < seleneMax) tick();
              else { setSeleneDone(true); setRunning(false); }
            }, 620);
          };
          tick();
        } else { advance(idx + 1, 1100); }
      }, delay);
    };
    advance(1, 700);
  };

  const runPipeline = async () => {
    resetPipeline();
    await new Promise(r => setTimeout(r, 80));

    if (LIVE_BACKEND) {
      setRunning(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: prog.guppy }),
        });
        const data = await res.json();
        if (data.success && data.hugr_json) {
          setLiveHugrJson(JSON.stringify(data.hugr_json, null, 2));
          if (data.selene) setLiveSeleneData(data.selene);
          const seleneTimeline = data.selene?.timeline ?? prog.selene.timeline;
          animatePipeline(seleneTimeline.length - 1);
        } else {
          const errors = (data.lines ?? []).filter((l: { t: string }) => l.t === 'error').map((l: { text: string }) => l.text).join('\n');
          setCompileError(errors || 'Compilation failed');
          setRunning(false);
        }
        return;
      } catch {
        setCompileError('Backend unreachable at ' + BACKEND_URL);
        setRunning(false);
        return;
      }
    }

    animatePipeline(prog.selene.timeline.length - 1);
  };

  const shareUrl = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Top bar */}
      <div className="pc-topbar">
        <div className="pc-title"><span className="pc-mark">⬡</span> Pipeline Visualizer</div>
        <div className="pc-prog-tabs">
          {Object.entries(PROGRAMS).map(([key, p]) => (
            <button key={key}
              className={`pc-tab ${programKey === key ? 'pc-tab--active' : ''}`}
              onClick={() => setProgramKey(key)}>{p.name}</button>
          ))}
        </div>
        <div className="pc-actions">
          <button className="pc-share-btn" onClick={shareUrl}>{copied ? '✓ Copied' : '⎘ Share'}</button>
          <button className="pc-run-btn" onClick={runPipeline} disabled={running}>
            {running ? <><span className="spinner" /> Running…</> : <>▶ Run Pipeline</>}
          </button>
        </div>
      </div>

      {/* Stage tabs */}
      <div className="pc-stages">
        {STAGES.map((s, i) => {
          const meta = STAGE_META[s];
          const reached = reachedIdx >= i;
          const active  = activeIdx === i;
          return (
            <div key={s} className="pc-stage-group">
              <button
                className={`pc-stage ${active ? 'pc-stage--active' : ''} ${reached ? 'pc-stage--reached' : ''}`}
                style={{ color: reached ? meta.color : undefined }}
                onClick={() => reached && setActiveIdx(i)}
                disabled={!reached} title={`${meta.label} — press ${i+1}`}>
                <span className="pc-stage-icon">{meta.icon}</span>
                <span className="pc-stage-label" style={{ color: active ? meta.color : undefined }}>{meta.label}</span>
                <span className="pc-stage-status">{reached ? 'ready' : 'pending'}</span>
              </button>
              {i < STAGES.length - 1 && (
                <div className={`pc-arrow ${reachedIdx > i ? 'pc-arrow--active' : ''}`}>
                  <svg width="38" height="14" viewBox="0 0 38 14">
                    <defs>
                      <linearGradient id={`ag-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%"   stopColor={STAGE_META[STAGES[i]].color}   stopOpacity={reachedIdx > i ? 1 : 0.2}/>
                        <stop offset="100%" stopColor={STAGE_META[STAGES[i+1]].color} stopOpacity={reachedIdx > i ? 1 : 0.2}/>
                      </linearGradient>
                    </defs>
                    <line x1="2" y1="7" x2="30" y2="7" stroke={`url(#ag-${i})`} strokeWidth="2"
                      strokeDasharray={reachedIdx > i ? 'none' : '4,3'}/>
                    <polygon points="28,3 38,7 28,11"
                      fill={reachedIdx > i ? STAGE_META[STAGES[i+1]].color : '#2a3040'}/>
                  </svg>
                  <span className="pc-arrow-label">{FLOW_LABELS[i]}</span>
                </div>
              )}
            </div>
          );
        })}
        <div className="pc-kbd-hint">
          <kbd>Space</kbd> run &nbsp;<kbd>R</kbd> reset &nbsp;<kbd>1–4</kbd> jump
        </div>
      </div>

      {/* Progress bar */}
      <div className="pc-progress">
        <div className="pc-progress-fill"
          style={{ width: reachedIdx < 0 ? '0%' : `${((reachedIdx+1)/STAGES.length)*100}%` }}/>
      </div>

      {/* Four-panel grid */}
      <div className="pc-grid">
        <GuppyPanelReact code={prog.guppy} name={prog.name} description={prog.description} isActive={activeIdx === 0}/>
        <div style={{ opacity: reachedIdx >= 1 ? 1 : 0.35, transition: 'opacity 0.5s' }}>
          <HUGRPanel nodes={prog.hugr.nodes} edges={prog.hugr.edges} json={liveHugrJson ?? prog.hugr.json} isActive={activeIdx === 1}/>
        </div>
        <div style={{ opacity: reachedIdx >= 2 ? 1 : 0.35, transition: 'opacity 0.5s' }}>
          <TKETPanel data={prog.tket} isActive={activeIdx === 2}/>
        </div>
        <div style={{ opacity: reachedIdx >= 3 ? 1 : 0.35, transition: 'opacity 0.5s' }}>
          <SelenePanel data={liveSeleneData ?? prog.selene} tket={prog.tket} stateStep={stateStep}
            running={seleneRun && !seleneDone} done={seleneDone} isActive={activeIdx === 3}/>
        </div>
      </div>

      {/* Compile error banner */}
      {compileError && (
        <div className="pc-error-banner">
          <span className="pc-error-icon">✕</span>
          <pre className="pc-error-text">{compileError}</pre>
        </div>
      )}

      {/* Footer */}
      <div className="pc-footer">
        {LIVE_BACKEND
          ? <span><span className="pc-live-badge">⬤ Live</span> HUGR compiled by FastAPI backend at {BACKEND_URL}</span>
          : <span>Pipeline runs mock data — wire up the <a href="/playground">FastAPI backend</a> for real compilation</span>
        }
        <span className="pc-footer-sep">·</span>
        <a href="/tutorials" className="pc-footer-link">Tutorials</a>
        <span className="pc-footer-sep">·</span>
        <a href="/community" className="pc-footer-link">Community</a>
      </div>

      <style>{`
        .pc-topbar { background:var(--bg1); border-bottom:1px solid var(--border); padding:12px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
        .pc-mark { color:var(--green); }
        .pc-title { font-size:15px; font-weight:700; letter-spacing:-0.01em; }
        .pc-prog-tabs { display:flex; gap:6px; flex-wrap:wrap; }
        .pc-tab { background:var(--bg2); border:1px solid var(--border); border-radius:7px; padding:5px 13px; font-family:var(--font-mono); font-size:12px; color:var(--muted); cursor:pointer; transition:all 0.15s; }
        .pc-tab:hover { color:var(--text); border-color:var(--muted); }
        .pc-tab--active { border-color:var(--green); color:var(--green); background:#0d1a12; }
        .pc-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
        .pc-share-btn { background:var(--bg2); border:1px solid var(--border); border-radius:7px; padding:7px 14px; font-family:var(--font-mono); font-size:12px; color:var(--muted); cursor:pointer; transition:all 0.15s; }
        .pc-share-btn:hover { color:var(--text); border-color:var(--muted); }
        .pc-run-btn { display:flex; align-items:center; gap:8px; background:var(--green); color:#fff; border:none; border-radius:8px; padding:8px 20px; font-family:var(--font-body); font-size:14px; font-weight:700; cursor:pointer; transition:all 0.15s; }
        .pc-run-btn:hover:not(:disabled) { background:#22a06b; transform:translateY(-1px); }
        .pc-run-btn:disabled { background:var(--bg3); color:var(--muted); cursor:not-allowed; transform:none; }

        .pc-stages { display:flex; align-items:center; padding:14px 20px 0; gap:0; overflow-x:auto; }
        .pc-stage-group { display:flex; align-items:center; }
        .pc-stage { display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 16px; border-radius:9px; cursor:pointer; border:1px solid transparent; background:none; transition:all 0.18s; min-width:76px; color:var(--muted); }
        .pc-stage:hover:not(:disabled) { background:var(--bg2); }
        .pc-stage--active { background:var(--bg2); border-color:var(--border); }
        .pc-stage:disabled { cursor:default; }
        .pc-stage-icon  { font-size:16px; line-height:1; }
        .pc-stage-label { font-family:var(--font-mono); font-size:11px; font-weight:500; white-space:nowrap; }
        .pc-stage-status { font-family:var(--font-mono); font-size:9px; letter-spacing:0.05em; }
        .pc-stage--reached .pc-stage-status { color:var(--green); }
        .pc-stage:not(.pc-stage--reached) .pc-stage-status { color:var(--muted); }
        .pc-arrow { display:flex; flex-direction:column; align-items:center; gap:2px; padding:0 3px; margin-bottom:6px; }
        .pc-arrow-label { font-family:var(--font-mono); font-size:9px; color:var(--muted); white-space:nowrap; }
        .pc-kbd-hint { margin-left:auto; font-family:var(--font-mono); font-size:10px; color:#2a3040; display:flex; align-items:center; gap:2px; flex-shrink:0; padding-bottom:6px; }
        kbd { background:var(--bg3); border:1px solid var(--border); border-radius:3px; padding:1px 5px; font-size:10px; font-family:var(--font-mono); color:var(--muted); }

        .pc-progress { height:2px; background:var(--border); margin:10px 20px 0; border-radius:1px; overflow:hidden; }
        .pc-progress-fill { height:100%; background:linear-gradient(90deg,var(--green),var(--blue)); transition:width 0.55s ease; }

        .pc-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:14px 20px 0; }

        .pv-panel { background:var(--bg1); border:1px solid var(--border); border-radius:12px; overflow:hidden; transition:border-color 0.25s,box-shadow 0.25s; }
        .pv-panel--green.pv-panel--active  { border-color:var(--green);  box-shadow:0 0 28px color-mix(in srgb,var(--green) 12%,transparent); }
        .pv-panel--blue.pv-panel--active   { border-color:var(--blue);   box-shadow:0 0 28px color-mix(in srgb,var(--blue) 12%,transparent); }
        .pv-panel--red.pv-panel--active    { border-color:var(--red);    box-shadow:0 0 28px color-mix(in srgb,var(--red) 12%,transparent); }
        .pv-panel--purple.pv-panel--active { border-color:var(--purple); box-shadow:0 0 28px color-mix(in srgb,var(--purple) 12%,transparent); }

        .panel-header { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid var(--border); background:var(--bg2); flex-wrap:wrap; }
        .panel-name { font-size:13px; font-weight:600; color:var(--text); flex:1; min-width:80px; }
        .panel-body { padding:12px 16px; }
        .badge { font-family:var(--font-mono); font-size:11px; font-weight:600; padding:2px 9px; border-radius:5px; letter-spacing:0.04em; white-space:nowrap; }
        .badge-green  { background:color-mix(in srgb,var(--green) 20%,transparent);  color:var(--green); }
        .badge-blue   { background:color-mix(in srgb,var(--blue) 20%,transparent);   color:var(--blue); }
        .badge-red    { background:color-mix(in srgb,var(--red) 20%,transparent);    color:var(--red); }
        .badge-purple { background:color-mix(in srgb,var(--purple) 20%,transparent); color:var(--purple); }
        .panel-actions { display:flex; gap:5px; margin-left:auto; }
        .action-btn { background:var(--bg3); border:1px solid var(--border); border-radius:5px; padding:3px 10px; font-family:var(--font-mono); font-size:10px; color:var(--muted); cursor:pointer; transition:all 0.12s; }
        .action-btn:hover { color:var(--text); border-color:var(--muted); }
        .action-btn--on { color:var(--gold); border-color:var(--gold); background:#201808; }

        .pc-error-banner { display:flex; align-items:flex-start; gap:10px; margin:10px 20px 0; padding:10px 14px; background:#1a0808; border:1px solid #6a1a1a; border-radius:8px; }
        .pc-error-icon { color:#c84040; font-size:13px; flex-shrink:0; margin-top:1px; }
        .pc-error-text { margin:0; font-family:var(--font-mono); font-size:11px; color:#e08080; white-space:pre-wrap; line-height:1.6; }
        .pc-live-badge { color:#1a6b4a; font-size:9px; margin-right:4px; animation:pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .pc-footer { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:14px 20px; font-family:var(--font-mono); font-size:11px; color:var(--muted); border-top:1px solid var(--border); margin-top:14px; }
        .pc-footer a { color:var(--green); text-decoration:none; }
        .pc-footer a:hover { text-decoration:underline; }
        .pc-footer-sep { color:var(--border); }
        .pc-footer-link { color:var(--muted) !important; }
        .pc-footer-link:hover { color:var(--text) !important; }

        .spinner { width:12px; height:12px; border:2px solid transparent; border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; }

        @media(max-width:720px) { .pc-grid{grid-template-columns:1fr;} .pc-kbd-hint{display:none;} }
      `}</style>
    </>
  );
}
