// src/data/programs.ts
// All pipeline program data: Guppy source, HUGR IR, TKET circuit, Selene results
// Separated from UI so programs can be added/edited without touching components

export interface HUGRNode {
  id: number;
  kind: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

export interface HUGREdge {
  from: number;
  to: number;
  label: string;
  type: 'hierarchy' | 'quantum' | 'classical' | 'dataflow';
}

export interface TKETGate {
  type: string;
  qubits: number[];
  bits?: number[];
  col: number;
  native?: boolean;
}

export interface TKETStats {
  gates: number;
  depth: number;
  twoQ: number;
  note?: string;
}

export interface SeleneResult {
  state: string;
  count: number;
  correlated: boolean;
}

export interface TimelineStep {
  step: number;
  label: string;
  state: number[];
  phase?: number[];
  sup?: boolean;
  entangled?: boolean;
  classical?: boolean;
}

export interface Program {
  name: string;
  description: string;
  guppy: string;
  hugr: {
    nodes: HUGRNode[];
    edges: HUGREdge[];
    json: string;
  };
  tket: {
    qubits: string[];
    bits: string[];
    gates: TKETGate[];
    stats: TKETStats;
    optimised: {
      gates: TKETGate[];
      stats: TKETStats;
    };
  };
  selene: {
    shots: number;
    simulator: string;
    results: SeleneResult[];
    timeline: TimelineStep[];
  };
}

export const PROGRAMS: Record<string, Program> = {
  bell: {
    name: 'Bell State',
    description: 'Maximally entangled 2-qubit state',
    guppy: `from guppylang import guppy
from guppylang.std.quantum import qubit, owned, h, cx, measure

@guppy
def bell_pair(
    q1: qubit @owned,
    q2: qubit @owned,
) -> tuple[bool, bool]:
    h(q1)            # superposition (in-place)
    cx(q1, q2)       # entangle (in-place)
    return measure(q1), measure(q2)`,

    hugr: {
      nodes: [
        { id: 0, kind: 'Module',   label: 'Module',          x: 50, y: 10, color: '#5a6a8a' },
        { id: 1, kind: 'FuncDefn', label: 'FuncDefn\nbell_pair', x: 50, y: 22, color: '#4a80c8' },
        { id: 2, kind: 'Input',    label: 'Input\n[Q, Q]',   x: 25, y: 40, color: '#3a6a5a' },
        { id: 3, kind: 'H',        label: 'H',               x: 25, y: 56, color: '#1a6b4a' },
        { id: 4, kind: 'CX',       label: 'CX',              x: 50, y: 68, color: '#4a80c8' },
        { id: 5, kind: 'Measure',  label: 'Measure',         x: 30, y: 82, color: '#a040c8' },
        { id: 6, kind: 'Measure',  label: 'Measure',         x: 65, y: 82, color: '#a040c8' },
        { id: 7, kind: 'Output',   label: 'Output\n[B, B]',  x: 50, y: 94, color: '#8a4a3a' },
      ],
      edges: [
        { from: 0, to: 1, label: 'contains', type: 'hierarchy' },
        { from: 1, to: 2, label: '',          type: 'dataflow'  },
        { from: 2, to: 3, label: 'Q',         type: 'quantum'   },
        { from: 2, to: 4, label: 'Q',         type: 'quantum'   },
        { from: 3, to: 4, label: 'Q',         type: 'quantum'   },
        { from: 4, to: 5, label: 'Q',         type: 'quantum'   },
        { from: 4, to: 6, label: 'Q',         type: 'quantum'   },
        { from: 5, to: 7, label: 'B',         type: 'classical' },
        { from: 6, to: 7, label: 'B',         type: 'classical' },
      ],
      json: `{
  "nodes": [
    { "parent": 0, "op": { "type": "Module" } },
    {
      "parent": 0,
      "op": {
        "type": "FuncDefn",
        "name": "bell_pair",
        "signature": {
          "input":  [{"t":"Q"},{"t":"Q"}],
          "output": [{"t":"B"},{"t":"B"}]
        }
      }
    },
    { "parent": 1, "op": { "type": "Input" } },
    { "parent": 1, "op": { "type": "H",       "qubits": [0]   } },
    { "parent": 1, "op": { "type": "CX",      "qubits": [0,1] } },
    { "parent": 1, "op": { "type": "Measure", "qubit": 0      } },
    { "parent": 1, "op": { "type": "Measure", "qubit": 1      } },
    { "parent": 1, "op": { "type": "Output"                   } }
  ],
  "edges": [
    [2,0, 3,0, {"t":"Q"}],
    [2,1, 4,1, {"t":"Q"}],
    [3,0, 4,0, {"t":"Q"}],
    [4,0, 5,0, {"t":"Q"}],
    [4,1, 6,0, {"t":"Q"}],
    [5,0, 7,0, {"t":"B"}],
    [6,0, 7,1, {"t":"B"}]
  ]
}`,
    },

    tket: {
      qubits: ['q[0]', 'q[1]'],
      bits:   ['c[0]', 'c[1]'],
      gates: [
        { type: 'H',       qubits: [0],    col: 0 },
        { type: 'CX',      qubits: [0, 1], col: 1 },
        { type: 'Measure', qubits: [0], bits: [0], col: 2 },
        { type: 'Measure', qubits: [1], bits: [1], col: 2 },
      ],
      stats: { gates: 4, depth: 3, twoQ: 1 },
      optimised: {
        gates: [
          { type: 'H',       qubits: [0],    col: 0 },
          { type: 'ZZMax',   qubits: [0, 1], col: 1, native: true },
          { type: 'Rz',      qubits: [0],    col: 2, native: true },
          { type: 'Rz',      qubits: [1],    col: 2, native: true },
          { type: 'Measure', qubits: [0], bits: [0], col: 3 },
          { type: 'Measure', qubits: [1], bits: [1], col: 3 },
        ],
        stats: { gates: 6, depth: 4, twoQ: 1, note: 'CX → ZZMax (H2 native gate)' },
      },
    },

    selene: {
      shots: 200,
      simulator: 'Stim',
      results: [
        { state: '00', count: 101, correlated: true  },
        { state: '11', count: 95,  correlated: true  },
        { state: '01', count: 2,   correlated: false },
        { state: '10', count: 2,   correlated: false },
      ],
      timeline: [
        { step: 0, label: 'Init |00⟩',       state: [0, 0]   },
        { step: 1, label: 'After H on q[0]',  state: [0.5, 0], sup: true   },
        { step: 2, label: 'After CX',         state: [0.5, 0.5], entangled: true },
        { step: 3, label: 'Measured',         state: [1, 1],  classical: true },
      ],
    },
  },

  ghz: {
    name: 'GHZ State',
    description: '3-qubit maximally entangled',
    guppy: `from guppylang import guppy
from guppylang.std.quantum import qubit, owned, h, cx, measure

@guppy
def ghz3(
    q1: qubit @owned,
    q2: qubit @owned,
    q3: qubit @owned,
) -> tuple[bool, bool, bool]:
    h(q1)
    cx(q1, q2)
    cx(q1, q3)
    return measure(q1), measure(q2), measure(q3)`,

    hugr: {
      nodes: [
        { id: 0, kind: 'Module',   label: 'Module',         x: 50, y: 8,  color: '#5a6a8a' },
        { id: 1, kind: 'FuncDefn', label: 'FuncDefn\nghz3', x: 50, y: 20, color: '#4a80c8' },
        { id: 2, kind: 'Input',    label: 'Input\n[Q,Q,Q]', x: 50, y: 33, color: '#3a6a5a' },
        { id: 3, kind: 'H',        label: 'H',              x: 20, y: 47, color: '#1a6b4a' },
        { id: 4, kind: 'CX',       label: 'CX₁',            x: 38, y: 59, color: '#4a80c8' },
        { id: 5, kind: 'CX',       label: 'CX₂',            x: 62, y: 68, color: '#4a80c8' },
        { id: 6, kind: 'Measure',  label: 'M',              x: 20, y: 81, color: '#a040c8' },
        { id: 7, kind: 'Measure',  label: 'M',              x: 50, y: 81, color: '#a040c8' },
        { id: 8, kind: 'Measure',  label: 'M',              x: 80, y: 81, color: '#a040c8' },
        { id: 9, kind: 'Output',   label: 'Output\n[B,B,B]',x: 50, y: 93, color: '#8a4a3a' },
      ],
      edges: [
        { from: 2, to: 3, label: 'Q', type: 'quantum'   },
        { from: 2, to: 4, label: 'Q', type: 'quantum'   },
        { from: 2, to: 5, label: 'Q', type: 'quantum'   },
        { from: 3, to: 4, label: 'Q', type: 'quantum'   },
        { from: 4, to: 5, label: 'Q', type: 'quantum'   },
        { from: 4, to: 6, label: 'Q', type: 'quantum'   },
        { from: 5, to: 7, label: 'Q', type: 'quantum'   },
        { from: 5, to: 8, label: 'Q', type: 'quantum'   },
        { from: 6, to: 9, label: 'B', type: 'classical' },
        { from: 7, to: 9, label: 'B', type: 'classical' },
        { from: 8, to: 9, label: 'B', type: 'classical' },
      ],
      json: `{
  "nodes": [
    {"parent":0,"op":{"type":"Module"}},
    {"parent":0,"op":{"type":"FuncDefn","name":"ghz3",
      "signature":{
        "input": [{"t":"Q"},{"t":"Q"},{"t":"Q"}],
        "output":[{"t":"B"},{"t":"B"},{"t":"B"}]
      }}},
    {"parent":1,"op":{"type":"Input"}},
    {"parent":1,"op":{"type":"H",  "qubits":[0]}},
    {"parent":1,"op":{"type":"CX", "qubits":[0,1]}},
    {"parent":1,"op":{"type":"CX", "qubits":[0,2]}},
    {"parent":1,"op":{"type":"Measure","qubit":0}},
    {"parent":1,"op":{"type":"Measure","qubit":1}},
    {"parent":1,"op":{"type":"Measure","qubit":2}},
    {"parent":1,"op":{"type":"Output"}}
  ]
}`,
    },

    tket: {
      qubits: ['q[0]', 'q[1]', 'q[2]'],
      bits:   ['c[0]', 'c[1]', 'c[2]'],
      gates: [
        { type: 'H',       qubits: [0],    col: 0 },
        { type: 'CX',      qubits: [0, 1], col: 1 },
        { type: 'CX',      qubits: [0, 2], col: 2 },
        { type: 'Measure', qubits: [0], bits: [0], col: 3 },
        { type: 'Measure', qubits: [1], bits: [1], col: 3 },
        { type: 'Measure', qubits: [2], bits: [2], col: 3 },
      ],
      stats: { gates: 6, depth: 4, twoQ: 2 },
      optimised: {
        gates: [
          { type: 'H',       qubits: [0],    col: 0 },
          { type: 'ZZMax',   qubits: [0, 1], col: 1, native: true },
          { type: 'ZZMax',   qubits: [0, 2], col: 2, native: true },
          { type: 'Rz',      qubits: [0],    col: 3, native: true },
          { type: 'Measure', qubits: [0], bits: [0], col: 4 },
          { type: 'Measure', qubits: [1], bits: [1], col: 4 },
          { type: 'Measure', qubits: [2], bits: [2], col: 4 },
        ],
        stats: { gates: 7, depth: 5, twoQ: 2, note: 'CX → ZZMax for H2 hardware' },
      },
    },

    selene: {
      shots: 200,
      simulator: 'Stim',
      results: [
        { state: '000', count: 98, correlated: true  },
        { state: '111', count: 96, correlated: true  },
        { state: '001', count: 2,  correlated: false },
        { state: '010', count: 2,  correlated: false },
        { state: '100', count: 2,  correlated: false },
      ],
      timeline: [
        { step: 0, label: 'Init |000⟩',      state: [0, 0, 0]   },
        { step: 1, label: 'After H on q[0]',  state: [0.5, 0, 0], sup: true },
        { step: 2, label: 'After CX₁',        state: [0.5, 0.5, 0], entangled: true },
        { step: 3, label: 'After CX₂',        state: [0.5, 0.5, 0.5], entangled: true },
        { step: 4, label: 'Measured',         state: [1, 1, 1], classical: true },
      ],
    },
  },
};
