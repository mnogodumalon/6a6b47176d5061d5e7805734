import { ensureUploadableImage } from "@/lib/ai";

const AGENT_ENDPOINT = "https://my.living-apps.de/actions-agent";
const APPGROUP_ID = "6a6b47176d5061d5e7805734";
// UI language of this generated app — the agent answers in this language.
const LANG = "de";

export interface InputSchemaProperty {
  type: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: string[];
  default?: unknown;
  examples?: unknown[];
  "x-enum-descriptions"?: Record<string, string>;
}

export interface InputSchema {
  type: "object";
  properties: Record<string, InputSchemaProperty>;
  required?: string[];
  "x-preflight"?: boolean;
}

export interface ActionMetadata {
  title?: string;
  input_schema?: InputSchema;
  output_schema?: Record<string, unknown>;
  description?: string;
}

export interface ActionVersionMeta {
  v: number;
  ts: string;
  origin: string;
  summary: string;
  revert_of?: number;
}

export interface ActionVersion extends ActionVersionMeta {
  code: string;
}

export interface ActionHistory {
  current: number;
  versions: ActionVersion[];
}

export interface Action {
  identifier: string;
  title: string;
  description: string;
  app_id: string;
  app_name: string;
  value: string;
  metadata: ActionMetadata | null;
  current_version: number;
  versions: ActionVersionMeta[];
}

export interface FixResultEvent {
  appId: string;
  action: string;
  success: boolean;
  error: string | null;
}

export interface ActionCodeChangedEvent {
  appId: string;
  action: string;
  version: number;
  summary: string;
  origin: string;
}

export interface FileAttachment {
  identifier: string;
  filename: string;
  mime_type: string;
  url: string;
  app_id: string;
  app_name: string;
  created_at: string;
  action_identifier: string;
}

export async function fetchActionsAndFiles(): Promise<{ actions: Action[]; files: FileAttachment[] }> {
  const resp = await fetch(
    `${AGENT_ENDPOINT}/actions?appgroup_id=${APPGROUP_ID}`,
    { credentials: "include" },
  );
  if (!resp.ok) return { actions: [], files: [] };
  const data = await resp.json();
  const actions: Action[] = [];
  const files: FileAttachment[] = [];
  for (const app of data.apps || []) {
    for (const action of app.actions || []) {
      actions.push({
        identifier: action.identifier,
        title: action.title || "",
        description: action.description || "",
        app_id: app.app_id,
        app_name: app.app_name,
        value: action.value || "",
        metadata: action.metadata ?? null,
        // Defaults keep the UI working against a backend without versioning
        current_version: action.current_version ?? 0,
        versions: action.versions ?? [],
      });
    }
    for (const file of app.files || []) {
      files.push({
        identifier: file.identifier,
        filename: file.filename || file.identifier,
        mime_type: file.mime_type || "application/octet-stream",
        url: file.url || "",
        app_id: app.app_id,
        app_name: app.app_name,
        created_at: file.created_at || "",
        action_identifier: file.action_identifier || "",
      });
    }
  }
  return { actions, files };
}

export async function executeAction(
  appId: string,
  actionIdentifier: string,
  inputs?: Record<string, unknown>,
  files?: File[],
  // Test-run of a historical version (code from the history param);
  // omitted → the active version runs, exactly as before
  version?: number,
): Promise<{ stdout: string | null; error: string | null; runId: string | null }> {
  let resp: Response;

  if (inputs || (files && files.length > 0)) {
    const formData = new FormData();
    formData.append("app_id", appId);
    formData.append("action_identifier", actionIdentifier);
    if (version != null) formData.append("version", String(version));
    if (inputs) formData.append("inputs", JSON.stringify(inputs));
    if (files) {
      // HEIC/HEIF → JPEG before upload (iPhone photos; server 500s on HEIC).
      for (const file of files) formData.append("files", await ensureUploadableImage(file));
    }
    resp = await fetch(`${AGENT_ENDPOINT}/execute`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } else {
    resp = await fetch(`${AGENT_ENDPOINT}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // JSON.stringify drops the key when version is undefined
      body: JSON.stringify({ app_id: appId, action_identifier: actionIdentifier, version }),
    });
  }

  const data = await resp.json();
  return {
    stdout: data.stdout ?? null,
    error: data.error ?? null,
    // Trace correlator, present when the backend runs with tracing enabled
    // (success AND error responses) — absent on older backends
    runId: typeof data.run_id === 'string' ? data.run_id : null,
  };
}

export async function deleteAction(
  appId: string,
  actionIdentifier: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/actions/apps/${appId}/${actionIdentifier}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      return { ok: false, error: data?.detail || `HTTP ${resp.status}` };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteAppAttachment(
  appId: string,
  identifier: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/app-attachments/${appId}/${identifier}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      return { ok: false, error: data?.detail || `HTTP ${resp.status}` };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchActionHistory(
  appId: string,
  actionIdentifier: string,
): Promise<ActionHistory> {
  const resp = await fetch(
    `${AGENT_ENDPOINT}/actions/apps/${appId}/${actionIdentifier}/history`,
    { credentials: "include" },
  );
  if (!resp.ok) return { current: 0, versions: [] };
  const data = await resp.json();
  return { current: data.current ?? 0, versions: data.versions ?? [] };
}

export async function revertAction(
  appId: string,
  actionIdentifier: string,
  to: number,
  expectedCurrent?: number,
): Promise<{ ok: boolean; current: number | null; version: ActionVersion | null; error: string | null }> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/actions/apps/${appId}/${actionIdentifier}/revert`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to, expected_current: expectedCurrent ?? null }),
      },
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      return { ok: false, current: null, version: null, error: data?.detail || `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return { ok: true, current: data.current ?? null, version: data.version ?? null, error: null };
  } catch (err) {
    return { ok: false, current: null, version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Persistent chat history (appgroup params via the agent service) -------
// Every function degrades gracefully against an old backend: fetch errors and
// non-OK responses turn into "no history", never into a broken chat.

export interface ChatSessionAction {
  app_id: string;
  identifier: string;
  title?: string;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  origin: string; // 'chat' | 'fix'
  mine?: boolean;
  user?: { id?: string; name?: string; initials?: string };
  action?: ChatSessionAction;
  // Rolling AI teaser (backend-generated, absent on old backends/entries);
  // display falls back to the raw title/preview when missing
  ai?: { title?: string; summary?: string; emoji?: string; msg_count?: number; ts?: string };
}

// Persisted message — a sanitized projection of the UI Message type.
// The index signature lets fields from newer app versions round-trip
// untouched through this one (forward compatibility).
export interface StoredChatMessage {
  role: string;
  content: string;
  ts?: string;
  kind?: string;
  attachment?: { name: string };
  versionInfo?: {
    appId: string;
    actionIdentifier: string;
    version: number;
    summary: string;
    origin: string;
  };
  runInfo?: {
    appId: string;
    actionIdentifier: string;
    actionName: string;
    version?: number | null;
    status: string;
  };
  runId?: string;
  [key: string]: unknown;
}

export interface ChatTranscript {
  id: string;
  created_at?: string;
  updated_at?: string;
  origin?: string;
  action?: ChatSessionAction;
  messages: StoredChatMessage[];
}

export async function fetchChatSessions(): Promise<ChatSessionMeta[]> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/chats?appgroup_id=${APPGROUP_ID}`,
      { credentials: "include" },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return ((data.sessions ?? []) as ChatSessionMeta[]).filter(s => s && s.id);
  } catch {
    return [];
  }
}

export async function fetchChatTranscript(threadId: string): Promise<ChatTranscript | null> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/chats/${threadId}?appgroup_id=${APPGROUP_ID}`,
      { credentials: "include" },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data.messages)) return null;
    return data as ChatTranscript;
  } catch {
    return null;
  }
}

export async function saveChatTranscript(
  threadId: string,
  payload: { messages: StoredChatMessage[]; action?: ChatSessionAction; origin?: string },
  // keepalive lets a flush on tab-hide finish after the page is gone.
  // Browsers cap keepalive bodies at ~64 KB — larger transcripts already
  // had a debounced save moments earlier, so a dropped flush loses little.
  keepalive = false,
): Promise<ChatSessionMeta | null> {
  try {
    const resp = await fetch(`${AGENT_ENDPOINT}/chats/${threadId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive,
      body: JSON.stringify({ appgroup_id: APPGROUP_ID, ...payload }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.session ?? null) as ChatSessionMeta | null;
  } catch {
    return null;
  }
}

export async function deleteChatSession(threadId: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${AGENT_ENDPOINT}/chats/${threadId}?appgroup_id=${APPGROUP_ID}`,
      { method: "DELETE", credentials: "include" },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  const resp = await fetch(url, { credentials: "include" });
  const blob = await resp.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseDataUri(uri: string): { mimeType: string; data: string } | null {
  const m = uri.match(/^data:([^;]+);base64,(.+)$/s);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

async function readAgentStream(
  resp: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer));
    } catch {
      // skip
    }
  }
}

export async function agentChat(
  messages: Array<{ role: string; content: string; image?: string; imageName?: string }>,
  threadId: string,
  onContent: (delta: string) => void,
  onFixResult?: (result: FixResultEvent) => void,
  opts?: {
    // Set while the chat is docked to an action's code view — the agent
    // resolves "the code" / "this action" to it. version/current_version
    // tell it which timeline entry is on screen.
    activeAction?: { app_id: string; identifier: string; version?: number; current_version?: number };
    onCodeChanged?: (event: ActionCodeChangedEvent) => void;
  },
): Promise<void> {
  const resp = await fetch(`${AGENT_ENDPOINT}/copilotkit/agents/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: "klar-agent",
      threadId,
      state: {},
      properties: {
        appgroup_id: APPGROUP_ID,
        lang: LANG,
        // JSON.stringify drops the key when undefined
        active_action: opts?.activeAction,
      },
      messages: messages.map((m) => {
        const parsed = m.image ? parseDataUri(m.image) : null;
        const content = parsed
          ? [
              { type: "text", text: m.content },
              // name: the original filename — the agent stages the upload
              // under it (JSON.stringify drops the key when undefined).
              { type: "binary", mimeType: parsed.mimeType, data: parsed.data, name: m.imageName },
            ]
          : m.content;
        return {
          id: crypto.randomUUID(),
          role: m.role,
          content,
          createdAt: new Date().toISOString(),
        };
      }),
      actions: [],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent API ${resp.status}: ${text.slice(0, 200)}`);
  }

  await readAgentStream(resp, (event) => {
    if (event.type === "TextMessageContent") {
      onContent(event.content as string);
    } else if (event.type === "FixResult" && onFixResult) {
      onFixResult(event as unknown as FixResultEvent);
    } else if (event.type === "ActionCodeChanged" && opts?.onCodeChanged) {
      opts.onCodeChanged(event as unknown as ActionCodeChangedEvent);
    }
  });
}

export async function fixAction(
  ctx: {
    appId: string;
    actionIdentifier: string;
    threadId: string;
    error: string;
    stdout?: string;
    inputs?: Record<string, unknown>;
    files?: File[];
    // Trace id of the failing /execute run — links fix.end to it server-side
    runId?: string;
  },
  onContent: (content: string) => void,
  onCodeChanged?: (event: ActionCodeChangedEvent) => void,
): Promise<FixResultEvent | null> {
  const formData = new FormData();
  formData.append("app_id", ctx.appId);
  formData.append("action_identifier", ctx.actionIdentifier);
  formData.append("thread_id", ctx.threadId);
  formData.append("appgroup_id", APPGROUP_ID);
  formData.append("lang", LANG);
  formData.append("error", ctx.error);
  if (ctx.stdout) formData.append("stdout", ctx.stdout);
  if (ctx.runId) formData.append("run_id", ctx.runId);
  if (ctx.inputs) formData.append("inputs", JSON.stringify(ctx.inputs));
  if (ctx.files) {
    // HEIC/HEIF → JPEG before upload (iPhone photos; server 500s on HEIC).
    for (const file of ctx.files) formData.append("files", await ensureUploadableImage(file));
  }

  const resp = await fetch(`${AGENT_ENDPOINT}/agents/fix`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent API ${resp.status}: ${text.slice(0, 200)}`);
  }

  let fixResult: FixResultEvent | null = null;
  await readAgentStream(resp, (event) => {
    if (event.type === "TextMessageContent") {
      onContent(event.content as string);
    } else if (event.type === "FixResult") {
      fixResult = event as unknown as FixResultEvent;
    } else if (event.type === "ActionCodeChanged" && onCodeChanged) {
      onCodeChanged(event as unknown as ActionCodeChangedEvent);
    }
  });
  return fixResult;
}
