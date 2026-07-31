import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconBolt, IconChevronDown, IconCode, IconDownload, IconFile, IconFileTypePdf,
  IconLoader2, IconPhoto, IconPlayerPlay, IconTrash, IconX,
} from '@tabler/icons-react';
import { useActions } from '@/context/ActionsContext';
import type { Action, FileAttachment } from '@/lib/actions-agent';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const TITLE = 'Werkzeuge';
const SUBTITLE_AVAILABLE = 'verfügbar';
const RUN_LABEL = 'Ausführen';
const BUSY_LABEL = 'In Arbeit...';
const DELETE_LABEL = 'Löschen';
const SOURCE_LABEL = 'Quellcode';
const CODE_LABEL = 'Code';
const VIEW_CHANGES_LABEL = 'Änderungen ansehen';
const DOWNLOAD_LABEL = 'Herunterladen';
const FILES_LABEL = 'Dateien';

const ORIGIN_LABELS: Record<string, string> = {
  fix: 'Auto-Fix',
  chat: 'Chat',
  initial: 'Erstellt',
  revert: 'Wiederhergestellt',
};

function relTime(d?: string) {
  if (!d) return '';
  try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: de }); } catch { return d; }
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <IconFileTypePdf size={14} className="shrink-0 text-red-500" />;
  if (mimeType.startsWith('image/')) return <IconPhoto size={14} className="shrink-0 text-blue-500" />;
  return <IconFile size={14} className="shrink-0 text-muted-foreground" />;
}

function formatDateTime(d?: string) {
  if (!d) return '';
  try { return format(parseISO(d), 'dd.MM.yyyy, HH:mm', { locale: de }); } catch { return d; }
}

function FileItem({ file, fresh, onDownload, onDelete }: {
  file: FileAttachment;
  fresh?: boolean;
  onDownload: (url: string, filename: string) => void;
  onDelete: (file: FileAttachment) => void;
}) {
  return (
    <li className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors duration-500 ${fresh ? 'bg-primary/15' : 'hover:bg-accent/50'}`}>
      <FileIcon mimeType={file.mime_type} />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{file.filename}</div>
        {file.created_at && (
          <div className="text-[11px] text-muted-foreground/70 truncate">{formatDateTime(file.created_at)}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDownload(file.url, file.filename)}
        className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-primary hover:bg-primary/10 transition-colors"
        title={DOWNLOAD_LABEL}
      >
        <IconDownload size={14} />
      </button>
      <button
        type="button"
        onClick={() => onDelete(file)}
        className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
        title={DELETE_LABEL}
      >
        <IconTrash size={14} />
      </button>
    </li>
  );
}

interface ActionRowProps {
  action: Action;
  files: FileAttachment[];
  freshFileIds: Set<string>;
  running: boolean;
  disabled: boolean;
  devMode: boolean;
  highlight: boolean;
  onRun: (action: Action) => void;
  onDelete: (action: Action) => Promise<void>;
  onShowCode: (action: Action) => void;
  onShowChanges: (action: Action) => void;
  onDownload: (url: string, filename: string) => void;
  onDeleteFile: (file: FileAttachment) => void;
}

function ActionRow({
  action, files, freshFileIds, running, disabled, devMode, highlight,
  onRun, onDelete, onShowCode, onShowChanges, onDownload, onDeleteFile,
}: ActionRowProps) {
  const [filesOpen, setFilesOpen] = useState(false);
  const latest = action.versions.length > 0 ? action.versions[action.versions.length - 1] : null;

  // A run just produced new files: open the list so the highlight is seen
  const hasFreshFiles = files.some(f => freshFileIds.has(`${f.app_id}/${f.identifier}`));
  useEffect(() => {
    if (hasFreshFiles) setFilesOpen(true);
  }, [hasFreshFiles]);

  // Arriving via highlight (code drawer ←, version/run-card title): latch
  // the flash locally so it plays out even when the context marker clears
  // mid-animation, center the card so it's unmissable in a long list, and
  // open the files list — the run the user came from usually left its
  // output there.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!highlight) return;
    setFlash(true);
    setFilesOpen(true);
    rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);

  return (
    <div
      ref={rowRef}
      onAnimationEnd={(e) => { if (e.animationName === 'action-return') setFlash(false); }}
      className={`rounded-2xl border bg-card shadow-sm overflow-hidden${flash ? ' animate-[action-return_2s_ease-out_0.25s_both]' : ''}`}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <IconBolt size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{action.title || action.identifier}</h3>
          {action.description && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{action.description}</p>
          )}
          {devMode && (
            <p className="text-[11px] font-mono text-muted-foreground/70 mt-1 truncate">{action.identifier}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => onRun(action)}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPlay size={14} />}
            <span className="hidden sm:inline">{running ? BUSY_LABEL : RUN_LABEL}</span>
          </button>
          {devMode && (
            <button
              type="button"
              onClick={() => onShowCode(action)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
              title={SOURCE_LABEL}
            >
              <IconCode size={14} />
              <span className="hidden sm:inline">{CODE_LABEL}</span>
            </button>
          )}
        </div>
      </div>

      {(files.length > 0 || devMode) && (
        <div className="flex items-center gap-1 px-3 pb-3 pt-0 border-t">
          {files.length > 0 ? (
            <button
              type="button"
              onClick={() => setFilesOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              <IconFile size={12} />
              {files.length} {FILES_LABEL}
              <IconChevronDown size={12} className={`transition-transform ${filesOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <span />
          )}
          {devMode && latest && action.current_version > 0 ? (
            <button
              type="button"
              onClick={() => onShowChanges(action)}
              className="flex-1 min-w-0 truncate text-left px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              title={VIEW_CHANGES_LABEL}
            >
              <span className="font-semibold text-foreground">v{action.current_version}</span>
              {' · '}{ORIGIN_LABELS[latest.origin] || latest.origin}{' · '}{relTime(latest.ts)}
              {latest.summary ? ` — ${latest.summary}` : ''}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={() => { void onDelete(action); }}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            title={DELETE_LABEL}
          >
            <IconTrash size={14} />
          </button>
        </div>
      )}

      {filesOpen && files.length > 0 && (
        <ul className="border-t bg-muted/20 py-1 px-1">
          {files.map((f, idx) => (
            <FileItem key={`${f.url}-${idx}`} file={f} fresh={freshFileIds.has(`${f.app_id}/${f.identifier}`)} onDownload={onDownload} onDelete={onDeleteFile} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ActionsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function ActionsDrawer({ open, onClose }: ActionsDrawerProps) {
  const {
    actions, runAction, deleteAction, showActionCode, openCodeDrawer, deleteAppAttachment,
    devMode, runningActionId, filesByAction, freshFileIds, downloadFile, setChatOpen,
    codeDrawerAction, actionsHighlight,
  } = useActions();

  // Footer version line → drawer, focused on the latest change's diff
  const showChanges = (a: Action) => openCodeDrawer(a, { version: a.current_version, tab: 'diff' });

  const unassigned = filesByAction['__unassigned__'] || [];
  const total = actions.length + (unassigned.length > 0 ? 1 : 0);

  // Esc closes — unless the code drawer is stacked on top (it owns Esc then)
  useEffect(() => {
    if (!open || codeDrawerAction) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, codeDrawerAction]);

  if (!open) return null;

  const handleDownload = (url: string, filename: string) => { void downloadFile(url, filename); };
  const handleDeleteFile = (f: FileAttachment) => { void deleteAppAttachment(f); };

  // Render through a portal so `position: fixed` aligns with the viewport
  // and not with the sidebar's transformed stacking context (the sidebar
  // uses `transform` for its slide-in animation, which would otherwise
  // anchor `right-0` to the sidebar's right edge instead of the screen).
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[var(--z-overlay)] bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={TITLE}
        className="fixed top-0 right-0 z-[var(--z-overlay)] h-full w-full sm:max-w-xl bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        <header className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold tracking-tight truncate">{TITLE}</h2>
            {total > 0 && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{total} {SUBTITLE_AVAILABLE}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Schließen"
          >
            <IconX size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {actions.length === 0 && unassigned.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                <IconBolt size={22} className="text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Noch keine Werkzeuge angelegt</p>
                <p className="mt-1 max-w-[16rem] text-sm text-muted-foreground">
                  Beschreibe im Chat, was du automatisieren willst — daraus entsteht dein erstes Werkzeug.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { onClose(); setChatOpen(true); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Im Chat erstellen
              </button>
            </div>
          ) : (
            <>
              {actions.map(a => (
                <ActionRow
                  key={`${a.app_id}/${a.identifier}`}
                  action={a}
                  files={filesByAction[a.identifier] || []}
                  freshFileIds={freshFileIds}
                  running={runningActionId === a.identifier}
                  disabled={runningActionId !== null}
                  devMode={devMode}
                  highlight={actionsHighlight?.appId === a.app_id && actionsHighlight?.identifier === a.identifier}
                  onRun={runAction}
                  onDelete={deleteAction}
                  onShowCode={showActionCode}
                  onShowChanges={showChanges}
                  onDownload={handleDownload}
                  onDeleteFile={handleDeleteFile}
                />
              ))}
              {unassigned.length > 0 && (
                <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <IconFile size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{FILES_LABEL}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{unassigned.length} {unassigned.length === 1 ? 'Datei' : 'Dateien'}</p>
                    </div>
                  </div>
                  <ul className="border-t bg-muted/20 py-1 px-1">
                    {unassigned.map((f, idx) => (
                      <FileItem key={`${f.url}-${idx}`} file={f} fresh={freshFileIds.has(`${f.app_id}/${f.identifier}`)} onDownload={handleDownload} onDelete={handleDeleteFile} />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>,
    document.body
  );
}
