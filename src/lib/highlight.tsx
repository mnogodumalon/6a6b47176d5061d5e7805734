import { useState } from 'react';
import { IconCopy, IconCheck } from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Lightweight Python syntax highlighter (no external deps) — shared by the
// ChatWidget markdown renderer and the action code drawer.
// ---------------------------------------------------------------------------

export function highlightPython(code: string): React.ReactNode[] {
  const tokens: Array<{ type: string; text: string }> = [];
  const re = /(#[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|"""[\s\S]*?"""|'''[\s\S]*?''')|(@\w+)|\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|raise|yield|lambda|and|or|not|in|is|True|False|None|break|continue|pass|async|await|global|nonlocal|del|assert)\b|\b(print|len|range|str|int|float|list|dict|set|tuple|isinstance|type|super|self|cls|enumerate|zip|map|filter|sorted|open|Exception|ValueError|TypeError|KeyError|RuntimeError|StopIteration|property|staticmethod|classmethod|__init__|__name__|__main__)\b|\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) tokens.push({ type: 'plain', text: code.slice(last, m.index) });
    if (m[1]) tokens.push({ type: 'comment', text: m[0] });
    else if (m[2]) tokens.push({ type: 'string', text: m[0] });
    else if (m[3]) tokens.push({ type: 'decorator', text: m[0] });
    else if (m[4]) tokens.push({ type: 'keyword', text: m[0] });
    else if (m[5]) tokens.push({ type: 'builtin', text: m[0] });
    else if (m[6]) tokens.push({ type: 'number', text: m[0] });
    else tokens.push({ type: 'plain', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < code.length) tokens.push({ type: 'plain', text: code.slice(last) });

  const colorMap: Record<string, string> = {
    comment: 'text-emerald-600',
    string: 'text-amber-600',
    keyword: 'text-purple-600 font-medium',
    builtin: 'text-blue-600',
    number: 'text-orange-600',
    decorator: 'text-rose-600',
    plain: '',
  };

  return tokens.map((t, i) => (
    t.type === 'plain'
      ? <span key={i}>{t.text}</span>
      : <span key={i} className={colorMap[t.type]}>{t.text}</span>
  ));
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
      title={copied ? "Kopiert!" : "Code kopieren"}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {copied && <span>Kopiert!</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Line diff (LCS) — powers the "changes" view of the action code drawer.
// ---------------------------------------------------------------------------

export interface DiffOp {
  t: ' ' | '+' | '-';
  line: string;
  // Line number in the NEW file (unset for removed lines)
  no?: number;
}

export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', line: a[i], no: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', line: a[i] });
      i++;
    } else {
      ops.push({ t: '+', line: b[j], no: j + 1 });
      j++;
    }
  }
  while (i < n) { ops.push({ t: '-', line: a[i] }); i++; }
  while (j < m) { ops.push({ t: '+', line: b[j], no: j + 1 }); j++; }
  return ops;
}
