// src/utils/highlight.ts
// Lightweight regex-based syntax highlighters for Guppy and HUGR JSON
// No external deps — works in both SSR (Astro) and client (React)

export function highlightGuppy(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(#.*$)/gm,  m => `<span class="hl-com">${m}</span>`)
    .replace(/(".*?"|'.*?')/g, m => `<span class="hl-str">${m}</span>`)
    .replace(/\b(from|import|def|return|tuple|if|else|for|in|as|not|and|or|True|False|None)\b/g,
             m => `<span class="hl-kw">${m}</span>`)
    .replace(/(@[\w.]+)/g, m => `<span class="hl-dec">${m}</span>`)
    .replace(/\b(qubit|int|bool|float|GuppyModule|array|str)\b/g,
             m => `<span class="hl-typ">${m}</span>`)
    .replace(/\b(\d[\d.e-]*)\b/g, m => `<span class="hl-num">${m}</span>`)
    .replace(/\b([a-z_]\w*)\s*(?=\()/g,
             (_, name) => `<span class="hl-fn">${name}</span>`);
}

export function highlightJson(json: string): string {
  return json
    .replace(/("(?:type|name|parent|input|output|qubits|qubit|t|edges|nodes|op|signature)")\s*:/g,
             m => `<span class="hl-jkey">${m}</span>`)
    .replace(/:\s*(".*?")/g, (_, v) => `: <span class="hl-jstr">${v}</span>`)
    .replace(/:\s*(\d+)/g,   (_, v) => `: <span class="hl-jnum">${v}</span>`)
    .replace(/\b(true|false|null)\b/g, m => `<span class="hl-jkw">${m}</span>`);
}
