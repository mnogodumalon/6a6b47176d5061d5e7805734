import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  IconX, IconCode, IconChevronDown, IconHistory, IconMessageCircle,
  IconChevronUp, IconRestore, IconPlayerPlay, IconWand, IconExternalLink,
  IconArrowLeft, IconBolt, IconLoader2, IconMessagePlus,
} from '@tabler/icons-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { useActions } from '@/context/ActionsContext';
import { fetchActionHistory, type Action, type ActionVersion } from '@/lib/actions-agent';
import { splitRunOutput, artifactKindFromExt as artifactKind, type ArtifactKind } from '@/lib/run-results';
import { highlightPython, CopyButton, diffLines } from '@/lib/highlight';
import { ChatPanel, ChatHistoryList, JsonView, RunIdChip } from '@/components/ChatWidget';

const ORIGIN_LABELS: Record<string, string> = {
  fix: 'Auto-Fix',
  chat: 'Chat',
  initial: 'Erstellt',
  revert: 'Wiederhergestellt',
};

function formatDateTime(d?: string) {
  if (!d) return '';
  try { return format(parseISO(d), 'dd.MM.yyyy, HH:mm', { locale: de }); } catch { return d; }
}

function relTime(d?: string) {
  if (!d) return '';
  try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: de }); } catch { return d; }
}

// Timeline label: the agent's own summary, or a localized fallback for
// revert/initial entries (their summaries are stored empty on purpose)
function versionSummary(v: ActionVersion): string {
  if (v.summary) return v.summary;
  if (v.origin === 'revert' && v.revert_of) return `Zurückgesetzt auf Version ${v.revert_of}`;
  return ORIGIN_LABELS[v.origin] || '';
}

// File artifacts in a run's stdout JSON: every http(s) string value becomes
// a card with open/download buttons and — for PDFs/images — an inline preview.
// Fields already shown on the card (URL, filename hint) are stripped from the
// remaining JSON so nothing appears twice.
// Artifact extraction/classification is shared with the chat's run cards —
// see @/lib/run-results (this file keeps only its iframe-preview probing).

function VersionEntry({ version, current, selected, onSelect }: {
  version: ActionVersion;
  current: number;
  selected: boolean;
  onSelect: (v: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(version.v)}
      aria-current={selected}
      className={`relative w-full shrink-0 rounded-xl px-3 py-2.5 text-left flex flex-col gap-0.5 transition-colors min-h-[2.75rem] ${
        selected ? 'bg-secondary' : 'hover:bg-muted'
      }`}
    >
      {selected && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-primary" />}
      <span className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold tabular-nums">v{version.v}</span>
        <span className="rounded-full border border-border bg-card px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          {ORIGIN_LABELS[version.origin] || version.origin}
        </span>
        {version.v === current && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
            Aktiv
          </span>
        )}
      </span>
      {versionSummary(version) && (
        <span className="text-xs leading-snug text-foreground">{versionSummary(version)}</span>
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums">{formatDateTime(version.ts)}</span>
    </button>
  );
}

export function ActionCodeDrawer() {
  const {
    codeDrawerAction: action, codeDrawerFocus, closeCodeDrawer, revertActionVersion,
    chatLoading, runAction, runningActionId, lastRunResult, fixLastRun, downloadFile,
    actions, openCodeDrawer, backToActions, closeActionsDrawer, actionsDrawerOpen,
    reportCodeDrawerSelection, newChatSession, sessionAction, dockScope, setDockScope,
  } = useActions();

  const [versions, setVersions] = useState<ActionVersion[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<'code' | 'diff' | 'out'>('code');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  // History popover over the dock bar; the filter defaults to this Werkzeug
  const [dockHistoryOpen, setDockHistoryOpen] = useState(false);
  const [dockHistoryFilter, setDockHistoryFilter] = useState<'tool' | 'all'>('tool');

  // Fresh conversation about this Werkzeug — the only chat surface while the
  // drawer is open is the dock, so the fresh-start entry point lives here
  // too. The session is tagged with the action so it later shows up under
  // the popover's tool filter.
  const startFreshChat = () => {
    newChatSession(action ? { app_id: action.app_id, identifier: action.identifier, title: action.title || action.identifier } : undefined);
    setDockScope('action');
    setDockHistoryOpen(false);
    setDockOpen(true);
  };

  // Context chip: what the dock currently talks about. 'action' shows the
  // viewed Werkzeug's context, 'global' the active conversation.
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const sessionMatchesAction = !!(sessionAction && action
    && sessionAction.app_id === action.app_id && sessionAction.identifier === action.identifier);
  const pickScope = (scope: 'action' | 'global') => {
    setScopeMenuOpen(false);
    setDockScope(scope);
    setDockOpen(true);
  };
  const [restoring, setRestoring] = useState(false);
  const lastRunTsRef = useRef(0);

  // The drawer stays mounted across opens — fold the popovers away whenever
  // it targets a different action (or none)
  useEffect(() => {
    setDockHistoryOpen(false);
    setDockHistoryFilter('tool');
    setScopeMenuOpen(false);
  }, [action]);

  // The latest execution of THIS action (feeds the output tab)
  const run = action && lastRunResult
    && lastRunResult.appId === action.app_id
    && lastRunResult.actionIdentifier === action.identifier
    ? lastRunResult
    : null;

  // Load history when the drawer opens (or is retargeted to a version)
  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    setVersions(null);
    setCurrent(action.current_version);
    setSelected(codeDrawerFocus?.version ?? action.current_version);
    setTab(codeDrawerFocus?.tab ?? 'code');
    setPickerOpen(false);
    setSwitcherOpen(false);
    // Only runs finishing AFTER opening switch to the output tab
    lastRunTsRef.current = Date.now();
    // Drop stale probes and free their blob preview URLs
    setProbes(prev => {
      Object.values(prev).forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      return {};
    });
    void fetchActionHistory(action.app_id, action.identifier).then(h => {
      if (cancelled) return;
      setVersions(h.versions);
      setCurrent(h.current);
      if (!codeDrawerFocus) setSelected(h.current);
    });
    return () => { cancelled = true; };
  }, [action, codeDrawerFocus]);

  // The agent (or a revert) saved a new version while the drawer is open:
  // reload the history and jump to the new version's diff (live update)
  useEffect(() => {
    if (!action) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { appId: string; identifier: string; version: number };
      if (detail.appId !== action.app_id || detail.identifier !== action.identifier) return;
      void fetchActionHistory(action.app_id, action.identifier).then(h => {
        setVersions(h.versions);
        setCurrent(h.current);
        setSelected(detail.version);
        setTab('diff');
      });
    };
    window.addEventListener('action-code-changed', handler);
    return () => window.removeEventListener('action-code-changed', handler);
  }, [action]);

  // Mirror the timeline selection into the context — sendMessage passes it
  // to the agent as part of active_action ("the user is looking at v3").
  useEffect(() => {
    if (!action || selected <= 0) return;
    reportCodeDrawerSelection({ version: selected, current_version: current });
    return () => reportCodeDrawerSelection(null);
  }, [action, selected, current, reportCodeDrawerSelection]);

  // While the agent works, surface the conversation in the dock
  useEffect(() => {
    if (chatLoading) setDockOpen(true);
  }, [chatLoading]);

  // A run finished while the drawer is open → surface its output
  useEffect(() => {
    if (run && run.ts > lastRunTsRef.current) {
      lastRunTsRef.current = run.ts;
      setTab('out');
    }
  }, [run]);

  // Esc peels one level at a time: open menu → code view → (the Werkzeuge
  // drawer underneath handles the final Esc itself)
  useEffect(() => {
    if (!action) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (switcherOpen) { setSwitcherOpen(false); return; }
      if (pickerOpen) { setPickerOpen(false); return; }
      backToActions();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [action, switcherOpen, pickerOpen, backToActions]);

  const sorted = useMemo(
    () => (versions ? [...versions].sort((a, b) => a.v - b.v) : []),
    [versions],
  );
  const newestFirst = useMemo(() => [...sorted].reverse(), [sorted]);
  const selectedEntry = sorted.find(v => v.v === selected) ?? null;
  const selectedIdx = selectedEntry ? sorted.indexOf(selectedEntry) : -1;
  const prevEntry = selectedIdx > 0 ? sorted[selectedIdx - 1] : null;

  // Fallback to the action's live code when there is no history (yet)
  const code = selectedEntry ? selectedEntry.code : (action?.value ?? '');
  const codeLines = useMemo(() => (code ? code.split('\n') : ['# Leere Aktion']), [code]);
  const diffOps = useMemo(
    () => (prevEntry ? diffLines(prevEntry.code.split('\n'), codeLines) : null),
    [prevEntry, codeLines],
  );

  const isOld = selectedEntry !== null && selected !== current;
  const isRunning = action !== null && runningActionId === action.identifier;
  const { artifacts, rest } = useMemo(
    () => (run && !run.error ? splitRunOutput(run.stdout) : { artifacts: [], rest: null }),
    [run],
  );

  // Extension-less artifact URLs (common: upload ids, record links) get a
  // HEAD probe — content-type decides the preview, content-disposition the
  // display name AND whether text/html is a generated FILE (attachment /
  // .html filename) or just a web page (record link → plain link row).
  // HTML files additionally get a blob previewUrl: attachment-served HTML
  // would otherwise trigger a download instead of rendering (iframe + tab).
  const [probes, setProbes] = useState<Record<string, { kind: ArtifactKind; filename?: string; previewUrl?: string }>>({});
  useEffect(() => {
    for (const a of artifacts) {
      if (probes[a.url]) continue;
      const extKind = artifactKind(a);
      if (extKind !== 'other' && extKind !== 'html') continue;

      const loadHtmlPreview = (filename?: string) =>
        fetch(a.url, { credentials: 'include' })
          .then(r => r.blob())
          .then(b => {
            const html = b.type.includes('html') ? b : new Blob([b], { type: 'text/html' });
            setProbes(p => ({ ...p, [a.url]: { kind: 'html', filename, previewUrl: URL.createObjectURL(html) } }));
          })
          .catch(() => setProbes(p => ({ ...p, [a.url]: { kind: 'html', filename } })));

      if (extKind === 'html') {
        void loadHtmlPreview();
        continue;
      }
      // GET + abort right after the headers arrive — file endpoints often
      // answer HEAD with an error/HTML page, which would misclassify a PDF
      // as a web page. Only a SUCCESSFUL html response counts as 'page';
      // anything broken falls back to the neutral card with open/download.
      const controller = new AbortController();
      fetch(a.url, { credentials: 'include', signal: controller.signal })
        .then(resp => {
          const ct = (resp.headers.get('content-type') || '').toLowerCase();
          const cd = resp.headers.get('content-disposition') || '';
          controller.abort();
          if (!resp.ok) {
            setProbes(p => ({ ...p, [a.url]: { kind: 'other' } }));
            return;
          }
          const fm = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
          const filename = fm ? decodeURIComponent(fm[1].trim()) : undefined;
          const kind: ArtifactKind = ct.includes('pdf') ? 'pdf'
            : ct.startsWith('image/') ? 'image'
            : ct.includes('html')
              ? (cd.toLowerCase().includes('attachment') || (filename && /\.html?$/i.test(filename)) ? 'html' : 'page')
              : 'other';
          if (kind === 'html') { void loadHtmlPreview(filename); return; }
          setProbes(p => ({ ...p, [a.url]: { kind, filename } }));
        })
        .catch(() => setProbes(p => ({ ...p, [a.url]: { kind: 'other' } })));
    }
  }, [artifacts, probes]);

  const handleSelect = useCallback((v: number) => {
    setSelected(v);
    setPickerOpen(false);
  }, []);

  // ✕ / backdrop: close the whole stack (code view + Werkzeuge overview)
  const closeAll = useCallback(() => {
    closeCodeDrawer();
    closeActionsDrawer();
  }, [closeCodeDrawer, closeActionsDrawer]);

  // Header switcher: retarget the drawer to another action in place —
  // the load effect above resets history, tabs, and probes
  const handleSwitch = useCallback((a: Action) => {
    setSwitcherOpen(false);
    if (action && a.app_id === action.app_id && a.identifier === action.identifier) return;
    openCodeDrawer(a);
  }, [action, openCodeDrawer]);

  const handleRestore = useCallback(async () => {
    if (!action || !selectedEntry) return;
    const ok = window.confirm(`Version wiederherstellen v${selectedEntry.v}?\n\nDer aktuelle Code wird ersetzt. Nichts geht verloren — es entsteht eine neue Version.`);
    if (!ok) return;
    setRestoring(true);
    try {
      await revertActionVersion(action.app_id, action.identifier, selectedEntry.v, current);
    } finally {
      setRestoring(false);
    }
  }, [action, selectedEntry, current, revertActionVersion]);

  if (!action) return null;

  const title = action.title || action.identifier;

  // Portal: `position: fixed` must anchor to the viewport, not a transformed
  // ancestor (same reasoning as ActionsDrawer). Stacking above the Werkzeuge
  // drawer relies on mount order: this portal is only ever created AFTER the
  // overview's (every entry path goes overview → code, never the reverse),
  // so with equal z-[var(--z-overlay)] the later DOM node wins.
  return createPortal(
    <>
      {/* Only one backdrop dims: while the overview lies underneath, its
          backdrop already provides the dim — this one just catches clicks. */}
      <div
        className={`fixed inset-0 z-[var(--z-overlay)] animate-in fade-in duration-150 ${actionsDrawerOpen ? '' : 'bg-black/40 backdrop-blur-sm'}`}
        onClick={closeAll}
      />
      <aside
        role="dialog"
        aria-label={title}
        className="fixed top-0 right-0 z-[var(--z-overlay)] h-full w-full sm:max-w-xl lg:max-w-3xl bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Header — ← goes one level up to the Werkzeuge overview; the title
            doubles as a switcher between actions when there is more than one */}
        <header className="relative flex items-center gap-2.5 px-3 sm:px-4 py-3.5 border-b shrink-0">
          <button
            type="button"
            onClick={backToActions}
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Zurück zu den Werkzeugen"
            title="Zurück zu den Werkzeugen"
          >
            <IconArrowLeft size={18} />
          </button>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <IconCode size={18} />
          </span>
          <div className="flex-1 min-w-0">
            {actions.length > 1 ? (
              <button
                type="button"
                onClick={() => setSwitcherOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={switcherOpen}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 -mx-1.5 text-left hover:bg-muted transition-colors"
                title="Aktion wechseln"
              >
                <span className="min-w-0">
                  <span className="block text-base font-semibold tracking-tight truncate">{title}</span>
                  <span className="block text-xs text-muted-foreground truncate mt-0.5">
                    <span className="font-mono bg-muted rounded px-1 py-px">{action.identifier}</span>
                    <span className="ml-2">{action.app_name}</span>
                  </span>
                </span>
                <IconChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${switcherOpen ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <>
                <h2 className="text-base font-semibold tracking-tight truncate">{title}</h2>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  <span className="font-mono bg-muted rounded px-1 py-px">{action.identifier}</span>
                  <span className="ml-2">{action.app_name}</span>
                </p>
              </>
            )}
          </div>
          <CopyButton text={code} />
          <button
            type="button"
            onClick={closeAll}
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Schließen"
          >
            <IconX size={18} />
          </button>

          {switcherOpen && (
            <div
              role="listbox"
              aria-label="Aktion wechseln"
              className="absolute left-14 top-full z-10 mt-1 flex max-h-80 w-80 max-w-[82vw] flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl"
            >
              <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                Aktion wechseln
              </div>
              {actions.map(a => {
                const isCurrent = a.app_id === action.app_id && a.identifier === action.identifier;
                const latest = a.versions.length > 0 ? a.versions[a.versions.length - 1] : null;
                return (
                  <button
                    key={`${a.app_id}/${a.identifier}`}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => handleSwitch(a)}
                    className={`flex w-full shrink-0 min-h-[2.75rem] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isCurrent ? 'bg-secondary' : 'hover:bg-muted'}`}
                  >
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <IconBolt size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.title || a.identifier}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        <span className="font-mono">{a.identifier}</span>
                        {latest ? ` · ${relTime(latest.ts)}` : ''}
                      </span>
                    </span>
                    {a.current_version > 0 && (
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        v{a.current_version}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Version timeline — rail on large screens */}
          <nav aria-label="Versionen" className="hidden lg:flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-3 py-3">
            <div className="px-2 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Versionen
            </div>
            {versions !== null && newestFirst.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground">Keine früheren Versionen</p>
            )}
            {newestFirst.map(v => (
              <VersionEntry key={v.v} version={v} current={current} selected={v.v === selected} onSelect={handleSelect} />
            ))}
          </nav>

          {/* Code pane */}
          <div className="flex flex-1 min-w-0 flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 shrink-0">
              {/* Version picker on small screens */}
              {newestFirst.length > 0 && (
                <div className="relative lg:hidden">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(o => !o)}
                    className="inline-flex min-h-[2.5rem] items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-muted transition-colors"
                  >
                    <IconHistory size={14} />
                    v{selected}
                    <IconChevronDown size={14} className={`transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {pickerOpen && (
                    <div className="absolute left-0 top-full z-10 mt-1 flex max-h-72 w-72 max-w-[78vw] flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
                      {newestFirst.map(v => (
                        <VersionEntry key={v.v} version={v} current={current} selected={v.v === selected} onSelect={handleSelect} />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'code'}
                onClick={() => setTab('code')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === 'code' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
              >
                Code
              </button>
              {prevEntry && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'diff'}
                  onClick={() => setTab('diff')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === 'diff' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
                >
                  Änderungen zu v{prevEntry.v}
                </button>
              )}
              {run && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'out'}
                  onClick={() => setTab('out')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === 'out' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
                >
                  Ausgabe
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                disabled={runningActionId !== null || chatLoading}
                onClick={() => runAction(action, isOld ? selected : undefined, { silent: true })}
                className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isRunning ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPlay size={14} />}
                {isRunning ? 'In Arbeit...' : isOld ? `v${selected} testen` : 'Ausführen'}
              </button>
            </div>

            {/* Not-the-active-version banner */}
            {isOld && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary px-3 py-2 text-xs shrink-0">
                <span>
                  Du siehst <b>v{selected}</b> ({formatDateTime(selectedEntry?.ts)}) — nicht die aktive Version.
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={restoring || chatLoading}
                  onClick={() => { void handleRestore(); }}
                  className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <IconRestore size={14} />
                  Diese Version wiederherstellen
                </button>
              </div>
            )}

            {/* Output of the latest run */}
            {tab === 'out' && run ? (
              <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-sm font-semibold text-foreground">
                    Testlauf{run.version != null ? ` v${run.version}` : (current > 0 ? ` v${current}` : '')}
                  </span>
                  <span className="tabular-nums">{formatDateTime(new Date(run.ts).toISOString())}</span>
                  {run.version != null && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">
                      Code aus der Historie — nicht wiederhergestellt
                    </span>
                  )}
                  {/* Support correlator — always visible here, the output
                      tab is where problems get reported from */}
                  {run.runId && <RunIdChip runId={run.runId} />}
                </div>
                {run.inputs && Object.keys(run.inputs).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Eingaben:</span>{' '}
                    <span className="font-mono break-all">{JSON.stringify(run.inputs)}</span>
                  </div>
                )}
                {run.error ? (
                  <>
                    <pre className="rounded-lg border border-red-200 bg-red-50 p-3 font-mono text-xs leading-relaxed text-red-700 whitespace-pre-wrap break-all">{run.error}</pre>
                    {run.version == null && (
                      <button
                        type="button"
                        onClick={fixLastRun}
                        disabled={chatLoading || runningActionId !== null}
                        className="inline-flex min-h-[2.5rem] w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <IconWand size={16} />
                        {chatLoading ? 'Wird behoben…' : 'Automatisch beheben'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {artifacts.map((a, i) => {
                      const probe = probes[a.url];
                      const kind = probe?.kind ?? artifactKind(a);
                      const name = probe?.filename || a.filename;
                      if (kind === 'page') {
                        // A web page (e.g. record link), not a download
                        return (
                          <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                            <IconExternalLink size={14} className="shrink-0 text-muted-foreground" />
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 flex-1 truncate text-xs text-primary underline underline-offset-2"
                            >
                              {a.url}
                            </a>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="space-y-2 rounded-xl border border-border bg-card p-3">
                          {kind === 'pdf' && (
                            <object data={a.url} type="application/pdf" className="h-80 w-full rounded-lg border border-border" aria-label={name} />
                          )}
                          {kind === 'image' && (
                            <img src={a.url} alt={name} className="max-h-80 max-w-full rounded-lg border border-border" />
                          )}
                          {kind === 'html' && (
                            <iframe src={probe?.previewUrl || a.url} sandbox="" title={name} className="h-80 w-full rounded-lg border border-border bg-white" />
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
                            <button
                              type="button"
                              onClick={() => window.open(probe?.previewUrl || a.url, '_blank', 'noopener')}
                              className="inline-flex min-h-[2rem] items-center rounded-lg border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted transition-colors"
                            >
                              Öffnen
                            </button>
                            <button
                              type="button"
                              onClick={() => { void downloadFile(a.url, name); }}
                              className="inline-flex min-h-[2rem] items-center rounded-lg border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted transition-colors"
                            >
                              Herunterladen
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {rest ? (
                      <div className="text-sm"><JsonView text={rest} /></div>
                    ) : artifacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">(keine Ausgabe)</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
            <div className="flex-1 min-h-0 overflow-auto bg-muted/20 py-2 font-mono text-xs leading-relaxed">
              {tab === 'diff' && diffOps ? (
                diffOps.map((op, i) => (
                  <div
                    key={i}
                    className={`flex ${op.t === '+' ? 'bg-emerald-100/60' : op.t === '-' ? 'bg-red-100/60' : ''}`}
                  >
                    <span className={`w-11 shrink-0 select-none pr-3 text-right tabular-nums ${op.t === '+' ? 'text-emerald-700' : op.t === '-' ? 'text-red-600' : 'text-muted-foreground/50'}`}>
                      {op.t === '-' ? '−' : op.no}
                    </span>
                    <span className={`whitespace-pre pr-6 ${op.t === '-' ? 'text-red-600' : ''}`}>
                      {op.t === '-' ? op.line || ' ' : highlightPython(op.line || ' ')}
                    </span>
                  </div>
                ))
              ) : (
                codeLines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-11 shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/50">{i + 1}</span>
                    <span className="whitespace-pre pr-6">{highlightPython(line || ' ')}</span>
                  </div>
                ))
              )}
            </div>
            )}

            {/* Status bar */}
            <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground tabular-nums shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>v{selectedEntry?.v ?? current}{isOld ? '' : ` · Aktiv`}</span>
              {selectedEntry && <span>{ORIGIN_LABELS[selectedEntry.origin] || selectedEntry.origin}</span>}
              {selectedEntry && <span>{formatDateTime(selectedEntry.ts)}</span>}
              <span>{codeLines.length} Zeilen</span>
            </div>
          </div>
        </div>

        {/* Chat dock — the SAME conversation as the floating chat widget */}
        <div className={`relative shrink-0 border-t border-border bg-card flex flex-col ${dockOpen ? 'h-[45dvh] min-h-[15rem]' : ''}`}>
          {/* Session history popover, filtered to this Werkzeug by default */}
          {dockHistoryOpen && (
            <div className="absolute bottom-full right-2 z-10 mb-2 flex max-h-[50dvh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              <div className="flex shrink-0 gap-1.5 px-3 pb-1 pt-2.5">
                <button
                  type="button"
                  onClick={() => setDockHistoryFilter('tool')}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${dockHistoryFilter === 'tool' ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
                >
                  Diese Aktion
                </button>
                <button
                  type="button"
                  onClick={() => setDockHistoryFilter('all')}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${dockHistoryFilter === 'all' ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
                >
                  Alle
                </button>
              </div>
              <ChatHistoryList
                compact
                filterAction={dockHistoryFilter === 'tool' && action ? { appId: action.app_id, identifier: action.identifier } : null}
                onSelect={(s) => {
                  setDockHistoryOpen(false);
                  setDockOpen(true);
                  // Sync the context chip: a foreign session shows as 'global'
                  setDockScope(s?.action && action && s.action.app_id === action.app_id && s.action.identifier === action.identifier ? 'action' : 'global');
                }}
                onNewChat={startFreshChat}
              />
            </div>
          )}
          <div className="relative flex shrink-0 items-center gap-1 px-2">
            {/* Context chip — what the dock currently talks about */}
            <button
              type="button"
              onClick={() => { setScopeMenuOpen(o => !o); setDockHistoryOpen(false); }}
              aria-expanded={scopeMenuOpen}
              title={dockScope === 'action' ? (action ? action.title || action.identifier : '') : 'Allgemeine Unterhaltung'}
              className={`flex min-w-0 max-w-[45%] shrink items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${scopeMenuOpen ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
            >
              {dockScope === 'action'
                ? <IconBolt size={12} className="shrink-0 text-primary" />
                : <IconMessageCircle size={12} className="shrink-0" />}
              <span className="min-w-0 truncate">{dockScope === 'action' ? (action ? action.title || action.identifier : '') : 'Allgemein'}</span>
              <IconChevronUp size={12} className="shrink-0 opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => setDockOpen(o => !o)}
              className="flex min-h-[2.25rem] min-w-0 flex-1 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-expanded={dockOpen}
            >
              <IconMessageCircle size={14} />
              Assistent
              {dockOpen ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={startFreshChat}
                title="Neue Unterhaltung zu dieser Aktion"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <IconMessagePlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => { setDockHistoryOpen(o => !o); setScopeMenuOpen(false); }}
                title="Verlauf"
                aria-expanded={dockHistoryOpen}
                className={`rounded-md p-1.5 transition-colors ${dockHistoryOpen ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              >
                <IconHistory size={14} />
              </button>
            </div>
            {scopeMenuOpen && (
              <div className="absolute bottom-full left-2 z-10 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-2xl">
                <button
                  type="button"
                  onClick={() => pickScope('action')}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><IconBolt size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{action ? action.title || action.identifier : ''}</span>
                    <span className="block text-xs text-muted-foreground">Fragen & Änderungen zu dieser Aktion</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => pickScope('global')}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><IconMessageCircle size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">Allgemeine Unterhaltung</span>
                    {sessionAction && !sessionMatchesAction && (
                      <span className="block truncate text-xs text-muted-foreground">Zuletzt: {sessionAction.title || sessionAction.identifier}</span>
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>
          <ChatPanel placeholder="Frage zum Code stellen…" collapsed={!dockOpen} />
        </div>
      </aside>
    </>,
    document.body
  );
}
