import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { Action, ActionCodeChangedEvent, ChatSessionAction, ChatSessionMeta, FileAttachment, StoredChatMessage } from '@/lib/actions-agent';
import { fetchActionsAndFiles, executeAction, deleteAction as deleteActionApi, deleteAppAttachment as deleteAppAttachmentApi, agentChat, fixAction, revertAction as revertActionApi, downloadFile, fetchChatSessions, fetchChatTranscript, saveChatTranscript, deleteChatSession as deleteChatSessionApi } from '@/lib/actions-agent';

export type ExecErrorContext = {
  actionName: string;
  actionIdentifier: string;
  appId: string;
  errorText: string;
  stdout?: string;
  inputs?: Record<string, unknown>;
  files?: File[];
  // Trace id of the failing run — forwarded to the fix agent (failed_run)
  runId?: string;
};

// Where the code drawer should land when opened (e.g. from a version card)
export type CodeDrawerFocus = { version: number; tab: 'code' | 'diff' };

// Payload of a version card in the chat — one per code save by the agent
export type VersionInfo = {
  appId: string;
  actionIdentifier: string;
  version: number;
  summary: string;
  origin: string;
};

// Payload of a run card in the chat — one per successful action execution
export type RunInfo = {
  appId: string;
  actionIdentifier: string;
  actionName: string;
  version?: number | null;
  status: 'ok';
};

// Result of the most recent action execution — feeds the code drawer's
// output tab (version is set for test-runs of a historical version)
export type RunResult = {
  appId: string;
  actionIdentifier: string;
  actionName: string;
  version: number | null;
  inputs?: Record<string, unknown>;
  files?: File[];
  stdout: string | null;
  error: string | null;
  ts: number;
  // Trace correlator of this run — absent when the backend has tracing off
  runId?: string | null;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  // Original filename of the attached file — the agent stages uploads
  // under this name instead of a generated upload_NN.ext.
  imageName?: string;
  // 'action' = auto-generated invocation notice (Aktion: …), styled as a
  // neutral system event instead of a primary user bubble.
  kind?: 'action';
  fixContext?: ExecErrorContext;
  versionInfo?: VersionInfo;
  // Successful action run — rendered as a run card with typed result rows
  // (files, images, links) instead of raw JSON/URLs; content keeps the raw
  // stdout so older app versions render the plain fallback.
  runInfo?: RunInfo;
  // Trace id of the /execute run behind this message (success or error) —
  // the support correlator; absent when the backend has tracing disabled.
  runId?: string;
  // Fields a NEWER app version stored that this one does not know — kept
  // verbatim and written back on save, so old code never strips new data.
  ext?: Record<string, unknown>;
};

interface ActionsContextType {
  actions: Action[];
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  messages: Message[];
  chatLoading: boolean;
  runAction: (action: Action, version?: number, opts?: { silent?: boolean }) => void;
  lastRunResult: RunResult | null;
  sendMessage: (text: string, image?: string, imageName?: string) => void;
  fixError: (messageId: string) => void;
  fixLastRun: () => void;
  fixingMessageId: string | null;
  chatSessions: ChatSessionMeta[];
  activeThreadId: string;
  // Timestamp of the restored session (divider in the panel), null for fresh chats
  resumedSessionAt: string | null;
  refreshChatSessions: () => Promise<void>;
  loadChatSession: (id: string) => Promise<void>;
  newChatSession: (action?: ChatSessionAction) => void;
  // Werkzeug binding of the ACTIVE session (null = general conversation)
  sessionAction: ChatSessionAction | null;
  // What the code drawer's chat dock shows — see the state's comment
  dockScope: 'action' | 'global';
  setDockScope: (scope: 'action' | 'global') => void;
  deleteChatSession: (id: string) => Promise<void>;
  runningActionId: string | null;
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  betaMode: boolean;
  setBetaMode: (v: boolean) => void;
  showActionCode: (action: Action) => void;
  actionsDrawerOpen: boolean;
  openActionsDrawer: () => void;
  closeActionsDrawer: () => void;
  codeDrawerAction: Action | null;
  codeDrawerFocus: CodeDrawerFocus | null;
  openCodeDrawer: (action: Action, focus?: CodeDrawerFocus) => void;
  openCodeDrawerFor: (appId: string, identifier: string, focus?: CodeDrawerFocus) => void;
  closeCodeDrawer: () => void;
  backToActions: () => void;
  showActionInOverview: (appId: string, identifier: string) => void;
  reportCodeDrawerSelection: (sel: { version: number; current_version: number } | null) => void;
  actionsHighlight: { appId: string; identifier: string } | null;
  revertActionVersion: (appId: string, identifier: string, to: number, expectedCurrent?: number) => Promise<void>;
  deleteAction: (action: Action) => Promise<void>;
  inputFormAction: Action | null;
  inputFormOptions: Record<string, Array<{ value: string; label: string }>> | null;
  submitActionInputs: (action: Action, inputs: Record<string, unknown>, files: File[]) => void;
  cancelInputForm: () => void;
  files: FileAttachment[];
  filesByAction: Record<string, FileAttachment[]>;
  freshFileIds: Set<string>;
  downloadFile: (url: string, filename: string) => Promise<void>;
  deleteAppAttachment: (file: FileAttachment) => Promise<void>;
}

const ActionsContext = createContext<ActionsContextType | null>(null);

function readChannelCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some(c => c === 'channel=beta');
}

function writeChannelCookie(beta: boolean): void {
  const value = beta ? 'beta' : 'stable';
  document.cookie = `channel=${value}; path=/; max-age=31536000; SameSite=Lax`;
}

function execErrorUpdate(
  action: Action,
  errorText: string,
  stdout?: string | null,
  inputs?: Record<string, unknown>,
  files?: File[],
  runId?: string | null,
): Pick<Message, 'content' | 'fixContext' | 'runId'> {
  const name = action.title || action.identifier;
  return {
    content: `**Etwas klappte nicht bei der Ausführung von \`${name}\`:**\n\`\`\`\n${errorText}\n\`\`\``,
    runId: runId ?? undefined,
    fixContext: {
      actionName: name,
      actionIdentifier: action.identifier,
      appId: action.app_id,
      errorText,
      stdout: stdout || undefined,
      inputs,
      files,
      runId: runId ?? undefined,
    },
  };
}

// --- Chat persistence: (de)serialization between UI messages and the stored
// shape. Data URIs and live File objects never persist (an attachment leaves
// only its name); fixContext is session-local by design. Unknown fields from
// newer app versions round-trip untouched via `ext` (forward compatibility).
const KNOWN_STORED_MSG_FIELDS = new Set(['role', 'content', 'ts', 'kind', 'attachment', 'versionInfo', 'runInfo', 'runId']);

function serializeMessages(messages: Message[]): StoredChatMessage[] {
  return messages
    .filter(m => m.content || m.versionInfo || m.runInfo || m.imageName)
    .map(m => {
      const out: StoredChatMessage = { ...(m.ext ?? {}), role: m.role, content: m.content };
      if (m.kind) out.kind = m.kind;
      if (m.versionInfo) out.versionInfo = m.versionInfo;
      if (m.runInfo) out.runInfo = m.runInfo;
      if (m.runId) out.runId = m.runId;
      if (m.image || m.imageName) out.attachment = { name: m.imageName || 'Upload' };
      return out;
    });
}

function deserializeMessages(stored: StoredChatMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of stored) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const msg: Message = {
      id: crypto.randomUUID(),
      // safe: the guard above skipped every other value
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    };
    if (m.kind === 'action') msg.kind = 'action';
    const vi = m.versionInfo;
    if (vi && typeof vi.version === 'number') msg.versionInfo = vi as VersionInfo;
    const ri = m.runInfo;
    if (ri && typeof ri.actionName === 'string' && ri.status === 'ok') msg.runInfo = ri as RunInfo;
    if (typeof m.runId === 'string' && m.runId) msg.runId = m.runId;
    if (m.attachment?.name) msg.imageName = m.attachment.name;
    const ext: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) {
      if (!KNOWN_STORED_MSG_FIELDS.has(k)) ext[k] = v;
    }
    if (Object.keys(ext).length) msg.ext = ext;
    out.push(msg);
  }
  return out;
}

export function useActions() {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used within ActionsProvider');
  return ctx;
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  // `${app_id}/${identifier}` → content signature of every file in the last
  // fetch; null until the first successful fetch (its files are not "new").
  // freshFileIds marks the rows to tint: new ids or replaced files.
  const knownFilesRef = useRef<Map<string, string> | null>(null);
  const [freshFileIds, setFreshFileIds] = useState<Set<string>>(() => new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  // Explizit string: ohne Annotation erbt der State das schmale
  // UUID-Template-Literal aus crypto.randomUUID() und lehnt später
  // zugewiesene Session-IDs (plain string) ab (TS2345).
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [fixingMessageId, setFixingMessageId] = useState<string | null>(null);
  const chatLoadingRef = useRef(false);
  // Id of the assistant bubble the current stream fills — version cards are
  // inserted BEFORE it so the agent's final answer stays the last message
  // (same principle as the fix-status note in startFix).
  const streamingAnswerIdRef = useRef<string | null>(null);
  const [inputFormAction, setInputFormAction] = useState<Action | null>(null);
  const [inputFormOptions, setInputFormOptions] = useState<
    Record<string, Array<{ value: string; label: string }>> | null
  >(null);

  const filesByAction = useMemo(() => {
    const map: Record<string, FileAttachment[]> = {};
    for (const f of files) {
      const key = f.action_identifier || '__unassigned__';
      (map[key] ??= []).push(f);
    }
    // Newest first — a fresh run's output lands on top where the user looks
    for (const list of Object.values(map)) {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.filename.localeCompare(b.filename));
    }
    return map;
  }, [files]);

  const [devMode, setDevMode] = useState(() => {
    try { return localStorage.getItem('developer-mode') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('developer-mode', String(devMode)); } catch {}
  }, [devMode]);

  const [betaMode, setBetaModeState] = useState(() => {
    try { return readChannelCookie(); } catch { return false; }
  });

  const setBetaMode = useCallback((v: boolean) => {
    setBetaModeState(v);
    try { writeChannelCookie(v); } catch {}
  }, []);

  const refreshActions = useCallback(async () => {
    try {
      const result = await fetchActionsAndFiles();
      setActions(result.actions);
      setFiles(result.files);
      // Files that appeared or were replaced since the previous fetch: the
      // drawer expands the owning card's file list and tints those rows. An
      // action that overwrites its single output file yields no new id —
      // the signature catches that case. The null ref skips the initial
      // load — nothing is "new" then.
      const sig = (f: FileAttachment) => `${f.created_at}|${f.url}|${f.filename}`;
      const current = new Map<string, string>();
      for (const f of result.files) current.set(`${f.app_id}/${f.identifier}`, sig(f));
      const known = knownFilesRef.current;
      knownFilesRef.current = current;
      if (known) {
        const added = result.files.filter(f => known.get(`${f.app_id}/${f.identifier}`) !== sig(f));
        if (added.length) {
          console.debug('[actions] new files:', added.map(f => f.filename));
          setFreshFileIds(prev => new Set([...prev, ...added.map(f => `${f.app_id}/${f.identifier}`)]));
        }
      }
    } catch {
      // silently ignore — actions panel will be empty
    }
  }, []);

  useEffect(() => {
    void refreshActions();
  }, [refreshActions]);

  // The Werkzeuge drawer and the code drawer form one navigation stack:
  // the overview is the base level, the code view stacks on top of it.
  const [actionsDrawerOpen, setActionsDrawerOpen] = useState(false);
  // Marks the card to spotlight in the Werkzeuge overview (code drawer →
  // back, version-card chip). The row latches the flash locally when it sees
  // the marker (ActionRow), so this is only a signal — the generous timeout
  // just keeps a marker alive long enough for rows that mount late (drawer
  // opening, list refresh) without letting it go stale forever.
  const [actionsHighlight, setActionsHighlight] = useState<{ appId: string; identifier: string } | null>(null);

  useEffect(() => {
    if (!actionsHighlight) return;
    const t = setTimeout(() => setActionsHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [actionsHighlight]);

  // Drop the new-file marks after a viewing window — the rows are tinted
  // as long as their id is in the set; removal fades via transition-colors
  useEffect(() => {
    if (!freshFileIds.size) return;
    const t = setTimeout(() => setFreshFileIds(new Set()), 4000);
    return () => clearTimeout(t);
  }, [freshFileIds]);

  // --- Persistent chat sessions --------------------------------------------
  // The rendered transcript is frontend-owned: it carries UI-only items
  // (action bubbles, version cards) the agent stream never sees. Saves are
  // debounced PUTs through the agent service; the backend derives the index
  // entry and keeps its own step log for agent-memory rehydration.
  const [chatSessions, setChatSessions] = useState<ChatSessionMeta[]>([]);
  const [resumedSessionAt, setResumedSessionAt] = useState<string | null>(null);
  // Session id stored on the last unload — the auto-resume target
  const [initialResumeId] = useState<string | null>(() => {
    try { return localStorage.getItem('chat-session'); } catch { return null; }
  });

  const messagesRef = useRef<Message[]>([]);
  const threadIdRef = useRef(threadId);
  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);
  const chatDirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  // Loading a stored transcript must not count as new activity — it would
  // bump the session's updated_at just for looking at it
  const skipDirtyRef = useRef(false);
  // Werkzeug binding + origin of the CURRENT session (index chips). The
  // first binding wins; "new chat" and fixes reset them.
  const sessionActionRef = useRef<ChatSessionAction | null>(null);
  const sessionOriginRef = useRef<'chat' | 'fix'>('chat');
  // State mirror of sessionActionRef — the code drawer's context chip and
  // the dock's scoped empty state render from it
  const [sessionAction, setSessionAction] = useState<ChatSessionAction | null>(null);
  const applySessionAction = useCallback((a: ChatSessionAction | null) => {
    sessionActionRef.current = a;
    setSessionAction(a);
  }, []);
  // Once the user interacts, the mount-time auto-resume must not take over
  const interactedRef = useRef(false);

  const upsertSessionMeta = useCallback((meta: ChatSessionMeta | null) => {
    if (!meta) return;
    setChatSessions(prev => [meta, ...prev.filter(s => s.id !== meta.id)]);
  }, []);

  const persistChat = useCallback((keepalive = false) => {
    if (!chatDirtyRef.current) return;
    const msgs = serializeMessages(messagesRef.current);
    if (!msgs.length) return;
    chatDirtyRef.current = false;
    void saveChatTranscript(threadIdRef.current, {
      messages: msgs,
      action: sessionActionRef.current ?? undefined,
      origin: sessionOriginRef.current,
    }, keepalive).then(upsertSessionMeta);
  }, [upsertSessionMeta]);

  // Debounced save on every transcript change + last-session bookmark
  useEffect(() => {
    messagesRef.current = messages;
    if (!messages.length) return;
    try { localStorage.setItem('chat-session', threadIdRef.current); } catch {}
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return; }
    chatDirtyRef.current = true;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistChat(), 800);
    return () => { if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current); };
  }, [messages, persistChat]);

  // Tab hidden/closed: flush what the debounce still holds (keepalive
  // lets the request finish after the page is gone)
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') persistChat(true); };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [persistChat]);

  const refreshChatSessions = useCallback(async () => {
    setChatSessions(await fetchChatSessions());
  }, []);

  // Mount: fetch the session index and restore the last session's transcript
  // — a browser reload no longer wipes the conversation
  useEffect(() => {
    void refreshChatSessions();
    if (!initialResumeId) return;
    let cancelled = false;
    void fetchChatTranscript(initialResumeId).then(t => {
      if (cancelled || !t || interactedRef.current) return;
      const restored = deserializeMessages(t.messages);
      if (!restored.length) return;
      if (t.action) applySessionAction(t.action);
      if (t.origin === 'fix') sessionOriginRef.current = 'fix';
      skipDirtyRef.current = true;
      setThreadId(initialResumeId);
      threadIdRef.current = initialResumeId;
      setMessages(prev => (prev.length ? prev : restored));
      setResumedSessionAt(t.updated_at ?? t.created_at ?? '');
    });
    return () => { cancelled = true; };
  }, [initialResumeId, refreshChatSessions, applySessionAction]);

  const loadChatSession = useCallback(async (id: string) => {
    if (chatLoadingRef.current) return; // never swap sessions mid-stream
    interactedRef.current = true;
    if (id === threadIdRef.current && messagesRef.current.length) return;
    persistChat(); // flush the outgoing session before switching
    const t = await fetchChatTranscript(id);
    if (!t) return;
    applySessionAction(t.action ?? null);
    sessionOriginRef.current = t.origin === 'fix' ? 'fix' : 'chat';
    chatDirtyRef.current = false;
    skipDirtyRef.current = true;
    setThreadId(id);
    threadIdRef.current = id;
    setMessages(deserializeMessages(t.messages));
    setResumedSessionAt(t.updated_at ?? t.created_at ?? '');
  }, [persistChat, applySessionAction]);

  // Swap to a fresh session, optionally bound to a Werkzeug — flushes the
  // outgoing session first and returns the new thread id. No loading guard:
  // sendMessage calls this mid-flight for the dock's lazy session switch.
  const beginFreshSession = useCallback((action?: ChatSessionAction | null) => {
    persistChat(); // the outgoing session is safe in the store
    applySessionAction(action ?? null);
    sessionOriginRef.current = 'chat';
    chatDirtyRef.current = false;
    const fresh = crypto.randomUUID();
    setThreadId(fresh);
    threadIdRef.current = fresh;
    setMessages([]);
    setResumedSessionAt(null);
    return fresh;
  }, [persistChat, applySessionAction]);

  // Started from the code drawer's dock, the fresh session is tagged with
  // the viewed Werkzeug so it shows up under the dock's tool filter later.
  const newChatSession = useCallback((action?: ChatSessionAction) => {
    if (chatLoadingRef.current) return; // never swap sessions mid-stream
    interactedRef.current = true;
    beginFreshSession(action ?? null);
  }, [beginFreshSession]);

  const deleteChatSessionFn = useCallback(async (id: string) => {
    if (id === threadIdRef.current && chatLoadingRef.current) return;
    if (!(await deleteChatSessionApi(id))) return;
    setChatSessions(prev => prev.filter(s => s.id !== id));
    if (id === threadIdRef.current) {
      // Deleting the conversation you are in starts a fresh one
      applySessionAction(null);
      sessionOriginRef.current = 'chat';
      chatDirtyRef.current = false;
      const fresh = crypto.randomUUID();
      setThreadId(fresh);
      threadIdRef.current = fresh;
      setMessages([]);
      setResumedSessionAt(null);
    }
  }, []);

  const openActionsDrawer = useCallback(() => setActionsDrawerOpen(true), []);
  const closeActionsDrawer = useCallback(() => setActionsDrawerOpen(false), []);

  // On execution errors the Werkzeug UI must give way to the chat, where the
  // exception and the auto-fix button live.
  const focusChatOnError = useCallback(() => {
    setActionsDrawerOpen(false);
    setChatOpen(true);
  }, []);

  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);

  // silent = drawer-initiated run: the drawer's output tab is the single
  // surface — no chat bubbles, no chat-busy state, no focus stealing. The
  // chat stays reserved for the conversation with the agent.
  const executeAndReport = useCallback((action: Action, inputs?: Record<string, unknown>, files?: File[], version?: number, silent = false) => {
    if (chatLoadingRef.current) return;
    interactedRef.current = true;
    chatLoadingRef.current = true;
    if (!silent) setChatLoading(true);
    setRunningActionId(action.identifier);
    if (!silent) setChatOpen(true);

    const placeholderId = crypto.randomUUID();
    if (!silent) {
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', kind: 'action', content: `Aktion: ${action.title || action.identifier}${version != null ? ` (v${version})` : ''}` },
        { id: placeholderId, role: 'assistant', content: 'In Arbeit...' },
      ]);
    }

    executeAction(action.app_id, action.identifier, inputs, files, version)
      .then(result => {
        setLastRunResult({
          appId: action.app_id,
          actionIdentifier: action.identifier,
          actionName: action.title || action.identifier,
          version: version ?? null,
          inputs,
          files,
          stdout: result.stdout,
          error: result.error,
          ts: Date.now(),
          runId: result.runId,
        });
        if (silent) return;
        if (result.error) focusChatOnError();
        setMessages(prev =>
          prev.map(m => m.id === placeholderId
            ? { ...m, ...(result.error
                // Test-runs of a historical version get no auto-fix button —
                // the fix agent edits the ACTIVE code, not the tested one
                ? (version != null
                    ? { content: execErrorUpdate(action, result.error, result.stdout).content, runId: result.runId ?? undefined }
                    : execErrorUpdate(action, result.error, result.stdout, inputs, files, result.runId))
                : {
                    content: result.stdout || '(no output)',
                    runId: result.runId ?? undefined,
                    runInfo: {
                      appId: action.app_id,
                      actionIdentifier: action.identifier,
                      actionName: action.title || action.identifier,
                      version: version ?? null,
                      status: 'ok' as const,
                    },
                  }) }
            : m)
        );
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        setLastRunResult({
          appId: action.app_id,
          actionIdentifier: action.identifier,
          actionName: action.title || action.identifier,
          version: version ?? null,
          inputs,
          files,
          stdout: null,
          error: msg,
          ts: Date.now(),
        });
        if (silent) return;
        focusChatOnError();
        setMessages(prev =>
          prev.map(m =>
            m.id === placeholderId
              ? { ...m, content: `Fehler bei der Ausführung: ${msg}` }
              : m,
          )
        );
      })
      .finally(() => {
        chatLoadingRef.current = false;
        if (!silent) setChatLoading(false);
        setRunningActionId(null);
        void refreshActions();
        window.dispatchEvent(new Event('dashboard-refresh'));
      });
  }, [refreshActions, focusChatOnError]);

  // Version + silent flag pending between opening the input dialog and its
  // submit — set by runAction, consumed by submitActionInputs
  const pendingRunVersionRef = useRef<number | null>(null);
  const pendingRunSilentRef = useRef(false);

  const runAction = useCallback((action: Action, version?: number, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    pendingRunVersionRef.current = version ?? null;
    pendingRunSilentRef.current = silent;
    const schema = action.metadata?.input_schema;
    if (!schema?.properties || Object.keys(schema.properties).length === 0) {
      executeAndReport(action, undefined, undefined, version, silent);
      return;
    }

    if (schema['x-preflight']) {
      // Two-phase: run preflight to get dynamic options
      if (chatLoadingRef.current) return;
      chatLoadingRef.current = true;
      if (!silent) setChatLoading(true);
      setRunningActionId(action.identifier);
      if (!silent) setChatOpen(true);

      const placeholderId = crypto.randomUUID();
      if (!silent) {
        setMessages(prev => [
          ...prev,
          { id: placeholderId, role: 'assistant', content: 'Wird vorbereitet...' },
        ]);
      }

      // Preflight runs the SAME version so the dialog options match the
      // code that will be tested
      executeAction(action.app_id, action.identifier, {}, undefined, version)
        .then(result => {
          setMessages(prev => prev.filter(m => m.id !== placeholderId));

          if (result.error) {
            setRunningActionId(null);
            if (silent) {
              // Drawer runs: the preflight error belongs to the output tab
              setLastRunResult({
                appId: action.app_id,
                actionIdentifier: action.identifier,
                actionName: action.title || action.identifier,
                version: version ?? null,
                inputs: {},
                stdout: result.stdout,
                error: result.error,
                ts: Date.now(),
                runId: result.runId,
              });
              return;
            }
            focusChatOnError();
            // In eine Konstante heben: das if (result.error)-Narrowing gilt
            // nicht innerhalb der Callback-Funktion (TS2345 string|null).
            const preflightError = result.error;
            setMessages(prev => [
              ...prev,
              { id: crypto.randomUUID(), role: 'assistant', ...execErrorUpdate(action, preflightError, result.stdout, undefined, undefined, result.runId) },
            ]);
            return;
          }

          let options: Record<string, Array<{ value: string; label: string }>> | null = null;
          try {
            const parsed = JSON.parse(result.stdout || '');
            if (parsed._options && typeof parsed._options === 'object') {
              options = parsed._options;
            }
          } catch { /* not JSON — fall back to schema-only form */ }

          setInputFormOptions(options);
          setInputFormAction(action);
        })
        .catch(err => {
          setRunningActionId(null);
          const msg = err instanceof Error ? err.message : String(err);
          setMessages(prev => prev.filter(m => m.id !== placeholderId));
          if (silent) {
            setLastRunResult({
              appId: action.app_id,
              actionIdentifier: action.identifier,
              actionName: action.title || action.identifier,
              version: version ?? null,
              inputs: {},
              stdout: null,
              error: msg,
              ts: Date.now(),
            });
            return;
          }
          focusChatOnError();
          setMessages(prev => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', content: `Fehler bei der Ausführung: ${msg}` },
          ]);
        })
        .finally(() => {
          chatLoadingRef.current = false;
          if (!silent) setChatLoading(false);
        });
      return;
    }

    // No preflight: show form immediately
    setInputFormOptions(null);
    setInputFormAction(action);
  }, [executeAndReport, focusChatOnError]);

  const submitActionInputs = useCallback((action: Action, inputs: Record<string, unknown>, files: File[]) => {
    setInputFormAction(null);
    setInputFormOptions(null);
    executeAndReport(action, inputs, files.length > 0 ? files : undefined, pendingRunVersionRef.current ?? undefined, pendingRunSilentRef.current);
  }, [executeAndReport]);

  const cancelInputForm = useCallback(() => {
    pendingRunVersionRef.current = null;
    pendingRunSilentRef.current = false;
    setInputFormAction(null);
    setInputFormOptions(null);
    setRunningActionId(null);
  }, []);

  const [codeDrawerAction, setCodeDrawerAction] = useState<Action | null>(null);
  const [codeDrawerFocus, setCodeDrawerFocus] = useState<CodeDrawerFocus | null>(null);
  // What the drawer's chat dock shows: 'action' = the viewed Werkzeug's
  // context (fresh empty state until the first send when the active session
  // belongs elsewhere), 'global' = the currently active conversation.
  const [dockScope, setDockScope] = useState<'action' | 'global'>('action');
  // The drawer's live timeline selection, mirrored here so sendMessage can
  // tell the agent which version is on screen. A ref (not state): read only
  // at send time, must not re-render the provider on every timeline click.
  const codeDrawerSelectionRef = useRef<{ version: number; current_version: number } | null>(null);
  const reportCodeDrawerSelection = useCallback((sel: { version: number; current_version: number } | null) => {
    codeDrawerSelectionRef.current = sel;
  }, []);

  const openCodeDrawer = useCallback((action: Action, focus?: CodeDrawerFocus) => {
    // The Werkzeuge overview (if open) stays mounted beneath — the code
    // drawer stacks on top and ← returns to it, scroll position intact.
    setCodeDrawerFocus(focus ?? null);
    setCodeDrawerAction(action);
    // The dock always starts in the viewed action's context — never a
    // foreign conversation under foreign code
    setDockScope('action');
  }, []);

  const openCodeDrawerFor = useCallback((appId: string, identifier: string, focus?: CodeDrawerFocus) => {
    const action = actions.find(a => a.app_id === appId && a.identifier === identifier);
    if (action) openCodeDrawer(action, focus);
  }, [actions, openCodeDrawer]);

  const closeCodeDrawer = useCallback(() => {
    setCodeDrawerAction(null);
    setCodeDrawerFocus(null);
  }, []);

  // ← in the code drawer: one level up to the Werkzeuge overview — no matter
  // where the code view was opened from (overview, dashboard card, version
  // card in the chat). The card the user came from flashes briefly.
  const backToActions = useCallback(() => {
    if (codeDrawerAction) {
      setActionsHighlight({ appId: codeDrawerAction.app_id, identifier: codeDrawerAction.identifier });
    }
    setCodeDrawerAction(null);
    setCodeDrawerFocus(null);
    setActionsDrawerOpen(true);
  }, [codeDrawerAction]);

  // The dev-mode </> button opens the code drawer (used to dump the source
  // into the chat as a markdown message)
  const showActionCode = useCallback((action: Action) => {
    openCodeDrawer(action);
  }, [openCodeDrawer]);

  // Non-dev target of the version-card chip: the Werkzeuge overview with the
  // action's card flashing briefly (devs land in the code drawer instead).
  const showActionInOverview = useCallback((appId: string, identifier: string) => {
    setActionsHighlight({ appId, identifier });
    setActionsDrawerOpen(true);
  }, []);

  const appendVersionCard = useCallback((info: VersionInfo) => {
    const card: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', versionInfo: info };
    setMessages(prev => {
      // During a chat/fix stream the card slots in above the answer bubble;
      // standalone cards (manual revert) simply append.
      const streamingId = streamingAnswerIdRef.current;
      const idx = streamingId ? prev.findIndex(m => m.id === streamingId) : -1;
      const at = idx === -1 ? prev.length : idx;
      return [...prev.slice(0, at), card, ...prev.slice(at)];
    });
  }, []);

  // The agent saved action code during a chat/fix turn: show a version card
  // in the chat, refresh the actions, and let an open code drawer jump to
  // the new version.
  const handleCodeChanged = useCallback((event: ActionCodeChangedEvent) => {
    appendVersionCard({
      appId: event.appId,
      actionIdentifier: event.action,
      version: event.version,
      summary: event.summary,
      origin: event.origin,
    });
    void refreshActions();
    window.dispatchEvent(new CustomEvent('action-code-changed', {
      detail: { appId: event.appId, identifier: event.action, version: event.version },
    }));
  }, [appendVersionCard, refreshActions]);

  const revertActionVersion = useCallback(async (appId: string, identifier: string, to: number, expectedCurrent?: number) => {
    const result = await revertActionApi(appId, identifier, to, expectedCurrent);
    if (!result.ok || !result.version) {
      setChatOpen(true);
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `**Wiederherstellen fehlgeschlagen:** ${result.error ?? ''}` },
      ]);
      return;
    }
    appendVersionCard({
      appId,
      actionIdentifier: identifier,
      version: result.version.v,
      summary: `Zurückgesetzt auf Version ${to}`,
      origin: 'revert',
    });
    void refreshActions();
    window.dispatchEvent(new Event('dashboard-refresh'));
    window.dispatchEvent(new CustomEvent('action-code-changed', {
      detail: { appId, identifier, version: result.version.v },
    }));
  }, [appendVersionCard, refreshActions]);

  const deleteActionFn = useCallback(async (action: Action) => {
    const confirmed = window.confirm(`Aktion löschen "${action.identifier}" (aus "${action.app_name}")?`);
    if (!confirmed) return;
    const result = await deleteActionApi(action.app_id, action.identifier);
    setChatOpen(true);
    if (result.error) {
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `**Fehler bei der Ausführung:** ${result.error}` },
      ]);
    } else {
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `Aktion gelöscht: \`${action.identifier}\` (aus \`${action.app_name}\`).` },
      ]);
      await refreshActions();
    }
  }, [refreshActions]);

  const deleteAppAttachmentFn = useCallback(async (file: FileAttachment) => {
    const confirmed = window.confirm(`Datei löschen "${file.filename}"?`);
    if (!confirmed) return;
    const result = await deleteAppAttachmentApi(file.app_id, file.identifier);
    if (result.error) {
      setChatOpen(true);
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `**Fehler bei der Ausführung:** ${result.error}` },
      ]);
    } else {
      await refreshActions();
    }
  }, [refreshActions]);

  const releaseFixContexts = useCallback((appId: string, actionIdentifier: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.fixContext && m.fixContext.appId === appId && m.fixContext.actionIdentifier === actionIdentifier
          ? { ...m, fixContext: undefined }
          : m,
      )
    );
  }, []);

  const sendMessage = useCallback(async (text: string, image?: string, imageName?: string) => {
    if (chatLoadingRef.current) return;
    interactedRef.current = true;
    chatLoadingRef.current = true;
    setChatLoading(true);

    // Scoped dock showing the fresh empty state: the first send starts the
    // promised fresh session, bound to the viewed Werkzeug (lazy switch —
    // merely opening the drawer never touches the active conversation)
    let baseMessages = messages;
    let targetThread = threadId;
    const sa = sessionActionRef.current;
    if (codeDrawerAction && dockScope === 'action'
        && !(sa && sa.app_id === codeDrawerAction.app_id && sa.identifier === codeDrawerAction.identifier)) {
      targetThread = beginFreshSession({
        app_id: codeDrawerAction.app_id,
        identifier: codeDrawerAction.identifier,
        title: codeDrawerAction.title || codeDrawerAction.identifier,
      });
      baseMessages = [];
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      image: image ?? undefined,
      imageName: image ? imageName ?? undefined : undefined,
    };
    const assistantId = crypto.randomUUID();
    streamingAnswerIdRef.current = assistantId;

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ]);

    try {
      const apiMessages = baseMessages
        .concat(userMsg)
        .map(m => ({ role: m.role, content: m.content, image: m.image, imageName: m.imageName }));

      await agentChat(apiMessages, targetThread, (delta) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m,
          )
        );
      }, (fixResult) => {
        // A fix pending on this thread verified during the chat turn.
        if (fixResult.success) releaseFixContexts(fixResult.appId, fixResult.action);
      }, {
        // Docked to the code drawer: the agent resolves "the code" to it
        activeAction: codeDrawerAction
          ? {
              app_id: codeDrawerAction.app_id,
              identifier: codeDrawerAction.identifier,
              ...(codeDrawerSelectionRef.current ?? {}),
            }
          : undefined,
        onCodeChanged: handleCodeChanged,
      });
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Fehler bei der Ausführung: ${err instanceof Error ? err.message : String(err)}` }
            : m,
        )
      );
    } finally {
      streamingAnswerIdRef.current = null;
      chatLoadingRef.current = false;
      setChatLoading(false);
      void refreshActions();
      window.dispatchEvent(new Event('dashboard-refresh'));
    }
  }, [messages, threadId, refreshActions, releaseFixContexts, codeDrawerAction, dockScope, beginFreshSession, handleCodeChanged]);

  const startFix = useCallback(async (ctx: ExecErrorContext, sourceMessageId: string | null) => {
    if (chatLoadingRef.current) return;
    chatLoadingRef.current = true;
    setChatLoading(true);
    setFixingMessageId(sourceMessageId);

    // Fresh thread: the fix conversation becomes the active chat session,
    // so follow-up questions from the fix agent continue on the same thread.
    // The outgoing conversation is flushed to the store first — a fix
    // ARCHIVES the previous session (find it in the history), never wipes it.
    interactedRef.current = true;
    persistChat();
    applySessionAction({ app_id: ctx.appId, identifier: ctx.actionIdentifier, title: ctx.actionName });
    sessionOriginRef.current = 'fix';
    chatDirtyRef.current = false;
    setResumedSessionAt(null);
    const fixThreadId = crypto.randomUUID();
    setThreadId(fixThreadId);
    threadIdRef.current = fixThreadId;
    const answerId = crypto.randomUUID();
    streamingAnswerIdRef.current = answerId;
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `**Korrektur für \`${ctx.actionName}\`** — neue Chat-Sitzung für diese Korrektur gestartet.\n\`\`\`\n${ctx.errorText}\n\`\`\``,
      },
      { id: answerId, role: 'assistant', content: '' },
    ]);

    let answerText = '';
    try {
      const result = await fixAction(
        {
          appId: ctx.appId,
          actionIdentifier: ctx.actionIdentifier,
          threadId: fixThreadId,
          error: ctx.errorText,
          stdout: ctx.stdout,
          inputs: ctx.inputs,
          files: ctx.files,
          runId: ctx.runId,
        },
        (content) => {
          answerText += content;
          setMessages(prev =>
            prev.map(m => m.id === answerId ? { ...m, content: m.content + content } : m)
          );
        },
        handleCodeChanged,
      );
      if (result?.success) {
        // The agent's verified replay WAS the execution — nothing to re-run.
        void refreshActions();
        window.dispatchEvent(new Event('dashboard-refresh'));
      } else {
        // The status note goes BEFORE the agent's answer so a clarifying
        // question stays last and visible; the Auto-Fix button re-arms on
        // the answer itself (or on the note when the stream stayed empty).
        const note: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result?.error
            ? `**Die Aktion schlägt weiterhin fehl:**\n\`\`\`\n${result.error}\n\`\`\``
            : '*Die Korrektur ist noch nicht bestätigt — deine ursprüngliche Eingabe bleibt erhalten.*',
          ...(answerText ? {} : { fixContext: ctx }),
        };
        setMessages(prev => {
          const armed = answerText
            ? prev.map(m => m.id === answerId ? { ...m, fixContext: ctx } : m)
            : prev;
          const idx = armed.findIndex(m => m.id === answerId);
          const at = idx === -1 ? armed.length : idx;
          return [...armed.slice(0, at), note, ...armed.slice(at)];
        });
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `**Korrektur-Anfrage fehlgeschlagen:** ${err instanceof Error ? err.message : String(err)}\n\n*Deine ursprüngliche Eingabe bleibt erhalten — du kannst es erneut versuchen.*`,
          fixContext: ctx,
        },
      ]);
    } finally {
      streamingAnswerIdRef.current = null;
      setFixingMessageId(null);
      chatLoadingRef.current = false;
      setChatLoading(false);
    }
  }, [refreshActions, handleCodeChanged, persistChat, applySessionAction]);

  const fixError = useCallback((messageId: string) => {
    const ctx = messages.find(m => m.id === messageId)?.fixContext;
    if (!ctx) return;
    void startFix(ctx, messageId);
  }, [messages, startFix]);

  // Auto-fix entry for the code drawer's output tab — only the ACTIVE
  // version's failures are fixable (the fix agent edits the active code)
  const fixLastRun = useCallback(() => {
    const run = lastRunResult;
    if (!run || !run.error || run.version != null) return;
    void startFix({
      actionName: run.actionName,
      actionIdentifier: run.actionIdentifier,
      appId: run.appId,
      errorText: run.error,
      stdout: run.stdout || undefined,
      inputs: run.inputs,
      files: run.files,
      runId: run.runId ?? undefined,
    }, null);
  }, [lastRunResult, startFix]);

  return (
    <ActionsContext.Provider
      value={{ actions, chatOpen, setChatOpen, messages, chatLoading, runningActionId, runAction, lastRunResult, sendMessage, fixError, fixLastRun, fixingMessageId, chatSessions, activeThreadId: threadId, resumedSessionAt, refreshChatSessions, loadChatSession, newChatSession, deleteChatSession: deleteChatSessionFn, sessionAction, dockScope, setDockScope, devMode, setDevMode, betaMode, setBetaMode, showActionCode, actionsDrawerOpen, openActionsDrawer, closeActionsDrawer, codeDrawerAction, codeDrawerFocus, openCodeDrawer, openCodeDrawerFor, closeCodeDrawer, backToActions, showActionInOverview, reportCodeDrawerSelection, actionsHighlight, revertActionVersion, deleteAction: deleteActionFn, inputFormAction, inputFormOptions, submitActionInputs, cancelInputForm, files, filesByAction, freshFileIds, downloadFile, deleteAppAttachment: deleteAppAttachmentFn }}
    >
      {children}
    </ActionsContext.Provider>
  );
}
