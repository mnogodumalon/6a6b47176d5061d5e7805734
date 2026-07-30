import { useState, useRef, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import { IconSparkles, IconX, IconSend, IconPaperclip, IconLoader2, IconFileTypePdf, IconFileSpreadsheet, IconMaximize, IconMinimize, IconWand, IconGitCommit, IconHistory, IconMessagePlus, IconMessageCircle, IconArrowLeft, IconSearch, IconTrash, IconCode, IconBolt, IconChevronRight, IconPhoto, IconFileText, IconExternalLink } from '@tabler/icons-react';
import { fileToDataUri } from '@/lib/ai';
import { TypingDots } from '@/components/TypingDots';
import { highlightPython, CopyButton } from '@/lib/highlight';
import { splitRunOutput, artifactKindFromExt, useArtifactProbes, openArtifact, type Artifact, type ArtifactProbe } from '@/lib/run-results';
import { useActions, type RunInfo } from '@/context/ActionsContext';
import type { ChatSessionMeta } from '@/lib/actions-agent';

// ---------------------------------------------------------------------------
// Lightweight Markdown renderer (no external deps)
// Supports: code blocks, inline code, bold, italic, headers, lists, links, auto-linked URLs
// ---------------------------------------------------------------------------

const URL_RE = /(https?:\/\/[^\s<>"'`)\]]+)/g;

function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function renderInline(text: string) {
  // Bold, italic, inline code, images, links — applied left-to-right
  const tokens: Array<{ type: string; text: string; href?: string }> = [];
  // Regex order: code, bold, italic, md-image, md-link (image must come before link)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', text: text.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) tokens.push({ type: 'code', text: raw.slice(1, -1) });
    else if (m[2]) tokens.push({ type: 'bold', text: raw.slice(2, -2) });
    else if (m[3]) tokens.push({ type: 'italic', text: raw.slice(1, -1) });
    else if (m[4]) {
      const im = raw.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (im) tokens.push({ type: 'image', text: im[1], href: im[2] });
    }
    else if (m[5]) {
      const lm = raw.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) tokens.push({ type: 'link', text: lm[1], href: lm[2] });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });

  return tokens.map((t, i) => {
    switch (t.type) {
      case 'code': return <code key={i} className="bg-black/5 rounded px-1 py-0.5 text-[0.85em] font-mono">{t.text}</code>;
      case 'bold': return <strong key={i}><Linkify text={t.text} /></strong>;
      case 'italic': return <em key={i}><Linkify text={t.text} /></em>;
      case 'image': {
        const safe = t.href && /^(https?:|data:image\/)/i.test(t.href);
        return safe ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            <img src={t.href} alt={t.text} className="max-w-full max-h-48 rounded-lg my-1.5 inline-block" loading="lazy" />
          </a>
        ) : <span key={i}>{t.text}</span>;
      }
      case 'link': return <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="underline">{t.text}</a>;
      default: return <Linkify key={i} text={t.text} />;
    }
  });
}

// ---------------------------------------------------------------------------
// JSON → structured UI renderer
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'boolean') return <span className="text-primary font-medium">{value ? 'true' : 'false'}</span>;
  if (typeof value === 'number') return <span className="font-medium">{value}</span>;
  if (typeof value === 'string') {
    URL_RE.lastIndex = 0;
    if (URL_RE.test(value)) { URL_RE.lastIndex = 0; return <a href={value.match(URL_RE)![0]} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{value}</a>; }
    return <span className="break-words">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">[]</span>;
    // Array of primitives: inline comma-separated
    if (value.every(v => v === null || typeof v !== 'object')) {
      return <span className="flex flex-wrap gap-1">{value.map((v, i) => <span key={i} className="inline-flex items-center bg-black/5 rounded px-1.5 py-0.5 text-[0.9em]"><JsonValue value={v} depth={depth + 1} /></span>)}</span>;
    }
    // Array of objects: render each
    return <div className="space-y-1.5 mt-1">{value.map((v, i) => <div key={i} className="rounded-lg border border-border/40 bg-card p-2"><JsonValue value={v} depth={depth + 1} /></div>)}</div>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground italic">{'{}'}</span>;
    return (
      <div className={`space-y-1 ${depth > 0 ? '' : ''}`}>
        {entries.map(([k, v]) => {
          const isSimple = v === null || typeof v !== 'object';
          return (
            <div key={k} className={isSimple ? 'flex items-baseline gap-2 min-w-0' : ''}>
              <span className="text-muted-foreground text-[0.85em] font-medium shrink-0">{k}</span>
              {isSimple ? <span className="min-w-0"><JsonValue value={v} depth={depth + 1} /></span> : <div className="mt-0.5 pl-3 border-l-2 border-border/30"><JsonValue value={v} depth={depth + 1} /></div>}
            </div>
          );
        })}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

export function JsonView({ text }: { text: string }) {
  const parsed = tryParseJson(text);
  if (parsed === undefined) {
    // Fallback: not valid JSON, render as code
    return (
      <pre className="my-1.5 p-2.5 rounded-lg bg-black/5 overflow-x-auto text-[0.85em] font-mono leading-relaxed whitespace-pre-wrap break-all">
        <code><Linkify text={text} /></code>
      </pre>
    );
  }
  return (
    <div className="my-1.5 p-2.5 rounded-lg bg-black/5 overflow-x-auto text-[0.9em]">
      <JsonValue value={parsed} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function ChatMarkdown({ content }: { content: string }) {
  // Split into code blocks and text segments
  const segments: Array<{ type: 'code' | 'text'; lang?: string; value: string }> = [];
  const codeRe = /(?:```|~~~)(\w*)\n?([\s\S]*?)(?:```|~~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: content.slice(last, m.index) });
    segments.push({ type: 'code', lang: m[1] || '', value: m[2].replace(/\n$/, '') });
    last = m.index + m[0].length;
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) });

  return (
    <>
      {segments.map((seg, si) => {
        if (seg.type === 'code') {
          // JSON code blocks → structured UI
          if (seg.lang === 'json' || (!seg.lang && tryParseJson(seg.value) !== undefined)) {
            return <JsonView key={si} text={seg.value} />;
          }
          if (seg.lang === 'python') {
            return (
              <div key={si}>
                <pre className="my-1.5 p-2.5 rounded-lg bg-black/5 overflow-x-auto text-[0.85em] font-mono leading-relaxed whitespace-pre-wrap break-all">
                  <code>{highlightPython(seg.value)}</code>
                </pre>
                <CopyButton text={seg.value} />
              </div>
            );
          }
          return (
            <pre key={si} className="my-1.5 p-2.5 rounded-lg bg-black/5 overflow-x-auto text-[0.85em] font-mono leading-relaxed whitespace-pre-wrap break-all">
              <code><Linkify text={seg.value} /></code>
            </pre>
          );
        }
        // Plain text that is entirely JSON → structured UI
        if (tryParseJson(seg.value) !== undefined) {
          return <JsonView key={si} text={seg.value} />;
        }
        // Text block: parse line-by-line for headers, lists, tables, paragraphs
        const lines = seg.value.split('\n');
        const elements: ReactElement[] = [];
        let listItems: Array<{ ordered: boolean; text: string }> = [];

        const flushList = () => {
          if (listItems.length === 0) return;
          const ordered = listItems[0].ordered;
          const Tag = ordered ? 'ol' : 'ul';
          elements.push(
            <Tag key={`list-${elements.length}`} className={`my-1 pl-4 ${ordered ? 'list-decimal' : 'list-disc'}`}>
              {listItems.map((li, j) => <li key={j}>{renderInline(li.text)}</li>)}
            </Tag>
          );
          listItems = [];
        };

        const parseTableRow = (row: string) =>
          row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

        const isTableSep = (row: string) =>
          /^\|?[\s-:|]+\|[\s-:|]*\|?$/.test(row) && row.includes('---');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Table: detect header row followed by separator row
          if (i + 1 < lines.length && line.includes('|') && isTableSep(lines[i + 1])) {
            flushList();
            const headers = parseTableRow(line);
            const sepCells = parseTableRow(lines[i + 1]);
            const aligns = sepCells.map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
            i += 1; // skip separator
            const bodyRows: string[][] = [];
            while (i + 1 < lines.length && lines[i + 1].includes('|')) {
              i++;
              bodyRows.push(parseTableRow(lines[i]));
            }
            elements.push(
              <div key={`tbl-${i}`} className="my-1.5 overflow-x-auto">
                <table className="w-full text-[0.85em] border-collapse">
                  <thead>
                    <tr>
                      {headers.map((h, ci) => (
                        <th key={ci} className="border border-border/50 px-2 py-1 font-semibold bg-black/5 text-left" style={{ textAlign: (aligns[ci] || 'left') as any }}>
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="border border-border/50 px-2 py-1" style={{ textAlign: (aligns[ci] || 'left') as any }}>
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            continue;
          }

          // Headers
          const hm = line.match(/^(#{1,3})\s+(.+)$/);
          if (hm) {
            flushList();
            const level = hm[1].length;
            const cls = level === 1 ? 'font-bold text-base mt-2 mb-1' : level === 2 ? 'font-semibold mt-1.5 mb-0.5' : 'font-semibold text-[0.95em] mt-1 mb-0.5';
            elements.push(<div key={`h-${i}`} className={cls}>{renderInline(hm[2])}</div>);
            continue;
          }
          // Unordered list
          const ulm = line.match(/^[\s]*[-*]\s+(.+)$/);
          if (ulm) { listItems.push({ ordered: false, text: ulm[1] }); continue; }
          // Ordered list
          const olm = line.match(/^[\s]*\d+\.\s+(.+)$/);
          if (olm) { listItems.push({ ordered: true, text: olm[1] }); continue; }
          // Regular line
          flushList();
          if (line.trim() === '') {
            if (i > 0 && i < lines.length - 1) elements.push(<div key={`br-${i}`} className="h-1" />);
          } else {
            elements.push(<div key={`p-${i}`}>{renderInline(line)}</div>);
          }
        }
        flushList();
        return <div key={si}>{elements}</div>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatWidget component
// ---------------------------------------------------------------------------

// File type display config — add new non-image types here
const FILE_TYPES: Record<string, { Icon: typeof IconFileTypePdf; label: string; color: string }> = {
  'application/pdf': { Icon: IconFileTypePdf, label: 'PDF', color: 'text-red-500' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { Icon: IconFileSpreadsheet, label: 'Excel', color: 'text-green-600' },
};

function getFileTypeInfo(dataUri: string) {
  for (const [mime, info] of Object.entries(FILE_TYPES)) {
    if (dataUri.startsWith(`data:${mime}`)) return info;
  }
  return null;
}

// Localized labels for version-history origins (agent-written summaries stay
// in the language the agent wrote them in; origins are localized here)
const ORIGIN_LABELS: Record<string, string> = {
  fix: 'Auto-Fix',
  chat: 'Chat',
  initial: 'Erstellt',
  revert: 'Wiederhergestellt',
};

// The version card's action identity: a pill naming the Werkzeug the version
// belongs to. Clicking it opens the action itself — devs land in the code
// drawer at that version, everyone else in the Werkzeuge overview with the
// card flashing. Falls back to a plain pill while the action isn't in the
// refreshed list yet (or was deleted).
function VersionActionChip({ appId, identifier, version }: { appId: string; identifier: string; version: number }) {
  const { actions, devMode, openCodeDrawerFor, showActionInOverview } = useActions();
  const action = actions.find(a => a.app_id === appId && a.identifier === identifier);
  const title = action?.title || identifier;
  if (!action) {
    return (
      <span title={title} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <IconBolt size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{title}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`${title} — Aktion öffnen`}
      onClick={() => devMode
        ? openCodeDrawerFor(appId, identifier, { version, tab: 'code' })
        : showActionInOverview(appId, identifier)}
      className="group inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
    >
      <IconBolt size={12} className="shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
      <IconChevronRight size={12} className="shrink-0 opacity-60 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Run cards — a successful action run rendered as a structured card. The
// result may be ANY JSON: URL values become typed artifact rows (image
// preview, file card with open/download, plain link), the remaining fields
// stay reachable as raw JSON. Compact sibling of the code drawer's output
// tab, sharing the classification in @/lib/run-results.
// ---------------------------------------------------------------------------

function ArtifactResultRow({ artifact, probe }: { artifact: Artifact; probe?: ArtifactProbe }) {
  const { downloadFile } = useActions();
  const extKind = artifactKindFromExt(artifact);
  const kind = extKind !== 'other' ? extKind : (probe?.kind ?? 'other');
  const filename = probe?.filename || artifact.filename;
  if (kind === 'page') {
    return (
      <a
        href={artifact.url}
        target="_blank"
        rel="noopener"
        className="inline-flex max-w-full items-center gap-1.5 self-start rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
      >
        <IconExternalLink size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{artifact.url}</span>
      </a>
    );
  }
  const Icon = kind === 'pdf' ? IconFileTypePdf : kind === 'image' ? IconPhoto : IconFileText;
  return (
    <div className="flex flex-col gap-1.5">
      {kind === 'image' && (
        <img src={artifact.url} alt={filename} className="max-h-36 max-w-full self-start rounded-lg border border-border" />
      )}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5">
        <Icon size={16} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{filename}</span>
        <button
          type="button"
          onClick={() => openArtifact(artifact.url, probe?.attachment)}
          className="shrink-0 text-xs font-semibold text-primary hover:underline"
        >
          Öffnen
        </button>
        <button
          type="button"
          onClick={() => void downloadFile(artifact.url, filename)}
          className="shrink-0 text-xs font-semibold text-primary hover:underline"
        >
          Herunterladen
        </button>
      </div>
    </div>
  );
}

export function RunResultCard({ info, raw }: { info: RunInfo; raw: string }) {
  // The title navigates like the version card's chip: devs land in the code
  // drawer (at the executed version for historical test-runs), everyone else
  // in the Werkzeuge overview with the card flashing. Plain text while the
  // action isn't in the refreshed list yet (or was deleted).
  const { actions, devMode, openCodeDrawerFor, showActionInOverview } = useActions();
  const action = actions.find(a => a.app_id === info.appId && a.identifier === info.actionIdentifier);
  const { artifacts, rest } = useMemo(() => splitRunOutput(raw), [raw]);
  const probeUrls = useMemo(
    () => artifacts.filter(a => artifactKindFromExt(a) === 'other').map(a => a.url),
    [artifacts],
  );
  const probes = useArtifactProbes(probeUrls);
  // The remainder decides its own shape: JSON renders structured, plain text
  // renders as markdown (an action may simply print a sentence)
  const restIsJson = useMemo(() => {
    if (!rest) return false;
    try { const p = JSON.parse(rest); return !!p && typeof p === 'object'; } catch { return false; }
  }, [rest]);
  return (
    <div className="mt-1.5 w-full max-w-[85%] rounded-xl border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconBolt size={13} />
        </span>
        {action ? (
          <button
            type="button"
            title={`${info.actionName} — Aktion öffnen`}
            onClick={() => devMode
              ? openCodeDrawerFor(info.appId, info.actionIdentifier, info.version != null ? { version: info.version, tab: 'code' } : undefined)
              : showActionInOverview(info.appId, info.actionIdentifier)}
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-primary transition-colors"
          >
            {info.actionName}{info.version != null ? ` (v${info.version})` : ''}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {info.actionName}{info.version != null ? ` (v${info.version})` : ''}
          </span>
        )}
        <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-1.5 py-px text-[10px] font-semibold text-green-700">
          ✓ Ausgeführt
        </span>
      </div>
      {(artifacts.length > 0 || rest) && (
        <div className="mt-2 flex flex-col gap-1.5">
          {artifacts.map(a => <ArtifactResultRow key={a.url} artifact={a} probe={probes[a.url]} />)}
          {rest && (artifacts.length > 0 ? (
            <details className="border-t border-dashed border-border pt-1.5">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">Details</summary>
              <JsonView text={rest} />
            </details>
          ) : restIsJson ? (
            <JsonView text={rest} />
          ) : (
            <div className="text-sm leading-relaxed"><ChatMarkdown content={rest} /></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Support correlator: quiet copy chip for a run's trace id. Desktop reveals
// it on hover of the message (or keyboard focus); on touch it stays visible
// but tiny and muted. Renders nothing when the backend sent no run id.
export function RunIdChip({ runId, className = '' }: { runId: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="RunID kopieren — bei Problemen für den Support angeben"
      onClick={() => {
        void navigator.clipboard?.writeText(runId).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      className={`inline-flex items-center font-mono text-[10px] tabular-nums text-muted-foreground/60 transition-opacity hover:text-muted-foreground focus-visible:opacity-100 ${className}`}
    >
      {copied ? 'Kopiert!' : runId}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat history — session helpers + the list shared by the floating widget's
// history view and the code drawer's dock popover
// ---------------------------------------------------------------------------

// Titles/previews are single-line plain text — the backend stores them
// stripped, but entries persisted before that (or by older backends) may
// still carry raw markdown, so rendering strips again.
function stripMd(text: string): string {
  return (text || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`{1,3}|~~)/g, '')
    .replace(/^[#>\s]+/, '');
}

function sessionGroup(iso: string): 'today' | 'yesterday' | 'older' {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'older';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = startOfDay(new Date()) - startOfDay(d);
  if (diff <= 0) return 'today';
  if (diff <= 86400000) return 'yesterday';
  return 'older';
}

function sessionTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

const GROUP_LABELS: Record<'today' | 'yesterday' | 'older', string> = {
  today: 'Heute',
  yesterday: 'Gestern',
  older: 'Älter',
};

export function ChatHistoryList({ filterAction, onSelect, onNewChat, compact = false }: {
  // Only sessions bound to this Werkzeug (the code drawer's filter)
  filterAction?: { appId: string; identifier: string } | null;
  // Receives the chosen session so the dock can sync its scope chip
  onSelect?: (s?: ChatSessionMeta) => void;
  // Renders a start-fresh CTA in the empty state — without it the list is
  // a dead end exactly when there is nothing to resume
  onNewChat?: () => void;
  compact?: boolean;
}) {
  const { chatSessions, activeThreadId, loadChatSession, deleteChatSession, refreshChatSessions } = useActions();
  const [query, setQuery] = useState('');
  // Two-step delete: the first tap arms the trash, the second deletes
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  useEffect(() => { void refreshChatSessions(); }, [refreshChatSessions]);

  const q = query.trim().toLowerCase();
  const visible = chatSessions.filter(s => {
    if (filterAction && !(s.action && s.action.app_id === filterAction.appId && s.action.identifier === filterAction.identifier)) return false;
    if (!q) return true;
    return `${s.title || ''} ${s.preview || ''} ${s.ai?.title || ''} ${s.ai?.summary || ''}`.toLowerCase().includes(q);
  });

  // Sessions arrive newest first — group consecutively by day bucket
  const groups: Array<{ key: 'today' | 'yesterday' | 'older'; sessions: ChatSessionMeta[] }> = [];
  for (const s of visible) {
    const key = sessionGroup(s.updated_at || s.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sessions.push(s);
    else groups.push({ key, sessions: [s] });
  }

  return (
    <>
      {!compact && chatSessions.length > 4 && (
        <div className="px-3 pt-2.5 pb-1 shrink-0">
          <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-2.5 py-1.5">
            <IconSearch size={13} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Verlauf durchsuchen…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
            <IconHistory size={24} stroke={1.5} />
            <p className="text-xs">Noch keine Unterhaltungen</p>
            {onNewChat && (
              <button
                type="button"
                onClick={onNewChat}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <IconMessagePlus size={13} />
                Neuer Chat
              </button>
            )}
          </div>
        )}
        {groups.map(group => (
          <div key={`${group.key}-${group.sessions[0].id}`}>
            <p className="px-2.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{GROUP_LABELS[group.key]}</p>
            {group.sessions.map(s => (
              <div key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => { void loadChatSession(s.id); onSelect?.(s); }}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${s.id === activeThreadId ? 'bg-accent' : 'hover:bg-muted/60'}`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${s.id === activeThreadId ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {/* fix/tool keep their semantic icons; plain chats get the AI topic emoji */}
                    {s.origin === 'fix' ? <IconWand size={14} /> : s.action ? <IconCode size={14} /> : s.ai?.emoji ? <span className="text-[13px] leading-none">{s.ai.emoji}</span> : <IconMessageCircle size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{stripMd(s.ai?.title || s.title) || 'Assistent'}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{sessionTime(s.updated_at || s.created_at)}</span>
                    </span>
                    {(s.ai?.summary || s.preview) && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stripMd(s.ai?.summary || s.preview)}</span>}
                    {(s.id === activeThreadId || s.origin === 'fix' || !!s.action || (!!s.user?.initials && !s.mine)) && (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {s.id === activeThreadId && (
                          <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-1.5 py-px text-[10px] font-semibold text-green-700">Aktiv</span>
                        )}
                        {s.origin === 'fix' && (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700">Auto-Fix</span>
                        )}
                        {s.action && (
                          <span className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded-full border border-[#bfdbfe] bg-secondary px-1.5 py-px text-[10px] font-semibold text-[#2563eb]">
                            <IconCode size={10} className="shrink-0" />
                            <span className="truncate">{s.action.title || s.action.identifier}</span>
                          </span>
                        )}
                        {s.user?.initials && !s.mine && (
                          <span title={s.user.name} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#bfdbfe] bg-secondary text-[8px] font-bold text-[#2563eb]">{s.user.initials}</span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (armedDelete === s.id) { void deleteChatSession(s.id); setArmedDelete(null); }
                    else setArmedDelete(s.id);
                  }}
                  onBlur={() => setArmedDelete(null)}
                  title="Sitzung löschen?"
                  className={`absolute right-2 top-2 items-center justify-center rounded-md border border-border bg-card p-1.5 shadow-sm transition-colors ${
                    armedDelete === s.id ? 'flex text-destructive' : 'hidden text-muted-foreground hover:text-destructive group-hover:flex'
                  }`}
                >
                  {armedDelete === s.id ? <span className="px-0.5 text-[11px] font-semibold">Löschen?</span> : <IconTrash size={13} />}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel — message list + attachment preview + composer. Rendered by the
// floating ChatWidget AND docked inside the action code drawer; both surfaces
// show the SAME conversation from ActionsContext. Parent must be flex-col.
// ---------------------------------------------------------------------------

export function ChatPanel({ placeholder = 'Frage stellen oder Bild hochladen...', autoFocus = false, collapsed = false }: { placeholder?: string; autoFocus?: boolean; collapsed?: boolean }) {
  const { messages, chatLoading, runningActionId, sendMessage, fixError, fixingMessageId, devMode, openCodeDrawerFor, revertActionVersion, chatSessions, activeThreadId, loadChatSession, resumedSessionAt, codeDrawerAction, dockScope, setDockScope, sessionAction } = useActions();
  const [input, setInput] = useState('');

  // Scoped dock: the drawer is open in the action's context, but the active
  // session belongs elsewhere — show the fresh empty state instead of a
  // foreign transcript; the first send starts the tagged session (the lazy
  // switch lives in sendMessage).
  const sessionMatchesDrawer = !!(codeDrawerAction && sessionAction
    && sessionAction.app_id === codeDrawerAction.app_id && sessionAction.identifier === codeDrawerAction.identifier);
  const scopedFresh = !!codeDrawerAction && dockScope === 'action' && !sessionMatchesDrawer;
  const [image, setImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatLoading, collapsed]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      // Delay focus to avoid iOS zoom glitch on panel open
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [autoFocus]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && !image) return;

    const userContent = text || ('Bild analysieren');
    sendMessage(userContent, image ?? undefined, fileName ?? undefined);
    setInput('');
    setImage(null);
    setFileName(null);
    // Dismiss keyboard on mobile after send
    inputRef.current?.blur();
  }, [input, image, fileName, sendMessage]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uri = await fileToDataUri(file);
      setImage(uri);
      setFileName(file.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
    e.target.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Messages (hidden while docked-collapsed — the composer stays) */}
      <div ref={scrollRef} className={collapsed ? 'hidden' : 'flex-1 overflow-y-auto px-4 py-3 space-y-3'}>
        {scopedFresh ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
            <IconBolt size={28} stroke={1.5} className="text-primary" />
            <p className="text-xs max-w-[280px]">Frag etwas zu dieser Aktion — die Antwort kennt Code und Versionen.</p>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              <button
                type="button"
                onClick={() => sendMessage('Was macht diese Aktion?')}
                className="rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                Was macht diese Aktion?
              </button>
              <button
                type="button"
                onClick={() => sendMessage('Erkläre mir den Code')}
                className="rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                Erkläre mir den Code
              </button>
            </div>
          </div>
        ) : (
        <>
        {codeDrawerAction && dockScope === 'global' && !sessionMatchesDrawer && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span>
              {sessionAction
                ? <>Diese Unterhaltung gehört zu <span className="font-medium text-foreground">„{sessionAction.title || sessionAction.identifier}"</span></>
                : 'Allgemeine Unterhaltung ohne Aktions-Bezug'}
            </span>
            <button type="button" onClick={() => setDockScope('action')} className="font-semibold text-primary hover:underline">
              Neue Unterhaltung zu dieser Aktion
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
            <IconSparkles size={28} stroke={1.5} />
            <p className="text-xs">{placeholder}</p>
            {chatSessions.filter(s => s.id !== activeThreadId).length > 0 && (
              <div className="mt-3 w-full max-w-[260px] text-left">
                <p className="mb-1.5 px-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Zuletzt</p>
                {chatSessions.filter(s => s.id !== activeThreadId).slice(0, 2).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      void loadChatSession(s.id);
                      // In the dock, keep the context chip in sync with the
                      // loaded session — otherwise the scoped empty state
                      // would hide the transcript it just loaded
                      if (codeDrawerAction) setDockScope(s.action && s.action.app_id === codeDrawerAction.app_id && s.action.identifier === codeDrawerAction.identifier ? 'action' : 'global');
                    }}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-accent/50"
                  >
                    {s.ai?.emoji ? (
                      <span className="shrink-0 text-[12px] leading-none">{s.ai.emoji}</span>
                    ) : (
                      <IconHistory size={13} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">{stripMd(s.ai?.title || s.title)}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{sessionTime(s.updated_at || s.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {resumedSessionAt !== null && messages.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span className="shrink-0">
              Sitzung fortgesetzt{sessionTime(resumedSessionAt) ? ` · ${sessionTime(resumedSessionAt)}` : ''}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {messages.map((m) => (
          m.role === 'assistant' && !m.content && !m.versionInfo ? null :
          <div key={m.id} className={`group flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.runInfo && m.role === 'assistant' ? (
              <RunResultCard info={m.runInfo} raw={m.content} />
            ) : (m.content || m.role === 'user') && (
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? m.kind === 'action'
                    ? 'bg-muted text-muted-foreground border border-border rounded-br-md'
                    : 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted text-foreground rounded-bl-md'
              }`}>
                {m.image && (() => {
                  const ft = getFileTypeInfo(m.image);
                  return ft ? (
                    <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-black/10">
                      <ft.Icon size={20} />
                      <span className="text-xs font-medium">{ft.label}</span>
                    </div>
                  ) : (
                    <img src={m.image} alt="" className="max-w-full max-h-32 rounded-lg mb-2" />
                  );
                })()}
                {/* Restored sessions keep only the attachment's name — the
                    data URI never persists, so a chip stands in for it */}
                {!m.image && m.imageName && (
                  <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-black/10">
                    <IconPaperclip size={14} />
                    <span className="text-xs font-medium truncate max-w-[200px]">{m.imageName}</span>
                  </div>
                )}
                {m.content === 'In Arbeit...' ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <IconLoader2 size={14} className="animate-spin" />
                    In Arbeit...
                  </span>
                ) : m.role === 'assistant' ? (
                  <ChatMarkdown content={m.content} />
                ) : (
                  m.content.split('\n').map((line, j) => (
                    <span key={j}>{line}{j < m.content.split('\n').length - 1 && <br />}</span>
                  ))
                )}
              </div>
            )}
            {m.fixContext && (
              <button
                type="button"
                onClick={() => fixError(m.id)}
                disabled={chatLoading || !!fixingMessageId}
                className="mt-1.5 inline-flex w-full max-w-[85%] items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <IconWand size={16} />
                {fixingMessageId === m.id ? 'Wird behoben…' : 'Automatisch beheben'}
              </button>
            )}
            {m.versionInfo && (
              <div className="mt-1.5 w-full max-w-[85%] rounded-xl border border-border border-l-[3px] border-l-primary bg-card px-3.5 py-2.5">
                <VersionActionChip appId={m.versionInfo.appId} identifier={m.versionInfo.actionIdentifier} version={m.versionInfo.version} />
                {m.versionInfo.summary && (
                  <div className="mt-1 text-sm font-medium text-foreground">{m.versionInfo.summary}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <IconGitCommit size={14} className="text-primary shrink-0" />
                    <span className="font-semibold text-foreground">v{m.versionInfo.version}</span>
                    <span>· {ORIGIN_LABELS[m.versionInfo.origin] || m.versionInfo.origin}</span>
                  </span>
                  {devMode && (
                    <button
                      type="button"
                      onClick={() => openCodeDrawerFor(m.versionInfo!.appId, m.versionInfo!.actionIdentifier, { version: m.versionInfo!.version, tab: 'diff' })}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Änderungen ansehen
                    </button>
                  )}
                  {m.versionInfo.version > 1 && (
                    <button
                      type="button"
                      disabled={chatLoading}
                      onClick={() => revertActionVersion(m.versionInfo!.appId, m.versionInfo!.actionIdentifier, m.versionInfo!.version - 1)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Rückgängig
                    </button>
                  )}
                </div>
              </div>
            )}
            {m.runId && (
              <RunIdChip runId={m.runId} className="mt-1 sm:opacity-0 sm:group-hover:opacity-100" />
            )}
          </div>
        ))}
        {chatLoading && messages.length > 0 && messages[messages.length - 1].content !== 'In Arbeit...' && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content === '' && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
              <TypingDots />
              Denkt nach...
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Attachment preview */}
      {image && (
        <div className="px-4 py-2">
          <div className="relative inline-block">
            {(() => {
              const ft = getFileTypeInfo(image);
              return ft ? (
                <div className="h-16 px-4 rounded-lg border border-border bg-muted flex items-center gap-2">
                  <ft.Icon size={24} className={`${ft.color} shrink-0`} />
                  <span className="text-xs font-medium truncate max-w-[200px]">{fileName || ft.label}</span>
                </div>
              ) : (
                <img src={image} alt="" className="h-16 rounded-lg border border-border" />
              );
            })()}
            <button
              onClick={() => { setImage(null); setFileName(null); }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center"
            >
              <IconX size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-2.5 py-2 border-t border-border bg-card safe-area-pb">
        <div className="flex items-end gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Datei anhängen"
          >
            <IconPaperclip size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            className="hidden"
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            style={{ fieldSizing: 'content', maxHeight: '4.5rem' } as React.CSSProperties}
            className="flex-1 resize-none bg-muted rounded-xl px-3 py-2 text-base sm:text-sm outline-none border-0 placeholder:text-muted-foreground/60 overflow-y-auto"
          />
          <button
            onClick={handleSend}
            disabled={chatLoading || !!runningActionId || (!input.trim() && !image)}
            className="shrink-0 p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <IconSend size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatWidget — floating button + panel chrome around the ChatPanel
// ---------------------------------------------------------------------------

export default function ChatWidget() {
  const { chatOpen, setChatOpen, codeDrawerAction, newChatSession } = useActions();
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 'history' swaps the panel body for the session list — same surface,
  // no second panel, back arrow returns to the conversation
  const [view, setView] = useState<'chat' | 'history'>('chat');

  useEffect(() => {
    if (!chatOpen) {
      setIsFullscreen(false);
      setView('chat');
    }
  }, [chatOpen]);

  // While the code drawer is open, its chat dock is the single chat surface —
  // the floating widget stays out of the way (same conversation either way).
  if (codeDrawerAction) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className={`
          fixed bottom-5 right-5 z-[var(--z-chrome)] w-12 h-12 rounded-full shadow-lg
          flex items-center justify-center transition-all duration-200
          ${chatOpen
            ? 'bg-muted text-muted-foreground hover:bg-muted/80'
            : 'bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl'
          }
        `}
        aria-label="Assistent"
      >
        {chatOpen ? <IconX size={18} /> : <IconSparkles size={18} />}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div className={`fixed z-[var(--z-chrome)] bg-card shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isFullscreen
            ? 'inset-0 rounded-none'
            : 'left-0 right-0 bottom-0 top-[40%] rounded-t-2xl sm:inset-auto sm:bottom-20 sm:right-5 sm:left-auto sm:top-auto sm:w-[480px] sm:h-[640px] sm:border sm:border-border sm:rounded-2xl'
        }`}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
            {view === 'history' ? (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setView('chat')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Assistent"
                >
                  <IconArrowLeft size={14} />
                </button>
                <span className="text-sm font-semibold text-foreground truncate">Verlauf</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconSparkles size={12} className="text-primary" />
                </div>
                <span className="text-sm font-semibold text-foreground truncate">Assistent</span>
              </div>
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              {view === 'chat' && (
                <button
                  onClick={() => setView('history')}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Verlauf"
                >
                  <IconHistory size={14} />
                </button>
              )}
              {/* New chat is reachable from BOTH views — from the history it
                  starts fresh and returns to the conversation */}
              <button
                onClick={() => { newChatSession(); setView('chat'); }}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Neuer Chat"
              >
                <IconMessagePlus size={14} />
              </button>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={isFullscreen ? 'Verkleinern' : 'Vollbild'}
              >
                {isFullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
              </button>
              <button
                onClick={() => setChatOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <IconX size={14} />
              </button>
            </div>
          </div>

          {view === 'history' ? (
            <ChatHistoryList onSelect={() => setView('chat')} onNewChat={() => { newChatSession(); setView('chat'); }} />
          ) : (
            <ChatPanel autoFocus={chatOpen} />
          )}
        </div>
      )}
    </>
  );
}
