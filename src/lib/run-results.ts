// Shared result-handling for action runs — used by the chat's run cards
// (compact variant) and the code drawer's output tab (full variant).
// An action may return ANY JSON: the helpers here extract what can be
// rendered typed (files, images, links) and leave the rest as raw JSON.
import { useEffect, useState } from 'react';

export type Artifact = { url: string; filename: string };

// 'html' = generated HTML FILE (download + preview via blob);
// 'page' = a web page such as a record link (plain link row, no download)
export type ArtifactKind = 'pdf' | 'image' | 'html' | 'page' | 'other';

// Splits a run result into artifact URLs and the remaining JSON. Accepts a
// JSON object (URL values become artifacts), a bare URL string, or a
// JSON-encoded URL string. Fields already represented by an artifact (URL,
// filename hint) are stripped from the remainder so nothing appears twice.
export function splitRunOutput(stdout: string | null): { artifacts: Artifact[]; rest: string | null } {
  if (!stdout) return { artifacts: [], rest: null };
  const bareUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());
  if (bareUrl(stdout)) {
    const url = stdout.trim();
    return { artifacts: [{ url, filename: filenameFromUrl(url) }], rest: null };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { return { artifacts: [], rest: stdout }; }
  if (typeof parsed === 'string' && bareUrl(parsed)) {
    return { artifacts: [{ url: parsed.trim(), filename: filenameFromUrl(parsed) }], rest: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { artifacts: [], rest: stdout };
  const obj = parsed as Record<string, unknown>;
  const nameHint = [obj.dateiname, obj.filename, obj.name].find(v => typeof v === 'string') as string | undefined;
  const urls = Object.values(obj).filter((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v));
  const artifacts = urls.map(url => ({
    url,
    filename: (urls.length === 1 && nameHint) || filenameFromUrl(url),
  }));
  const urlSet = new Set(urls);
  const nameSet = new Set(artifacts.map(a => a.filename));
  const restEntries = Object.entries(obj).filter(([k, v]) =>
    !(typeof v === 'string' && (urlSet.has(v) || (nameSet.has(v) && ['dateiname', 'filename', 'name'].includes(k))))
  );
  return {
    artifacts,
    rest: restEntries.length ? JSON.stringify(Object.fromEntries(restEntries), null, 2) : null,
  };
}

function filenameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() || 'datei';
}

export function artifactKindFromExt(a: Artifact): ArtifactKind {
  const probe = (a.filename || a.url.split('?')[0]).toLowerCase();
  if (probe.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)$/.test(probe)) return 'image';
  if (/\.html?$/.test(probe)) return 'html';
  return 'other';
}

export type ArtifactProbe = { kind: ArtifactKind; filename?: string; attachment?: boolean };

// One probe per URL per page load, shared across every card and the drawer.
// GET + abort right after the headers arrive — file endpoints often answer
// HEAD with an error/HTML page, which would misclassify a PDF as a web page.
const probeCache = new Map<string, ArtifactProbe>();
const probePending = new Map<string, Promise<ArtifactProbe>>();

export function probeArtifact(url: string): Promise<ArtifactProbe> {
  const cached = probeCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = probePending.get(url);
  if (pending) return pending;
  const controller = new AbortController();
  const p = fetch(url, { credentials: 'include', signal: controller.signal })
    .then(resp => {
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      const cd = resp.headers.get('content-disposition') || '';
      controller.abort();
      if (!resp.ok) return { kind: 'other' as ArtifactKind };
      const fm = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const filename = fm ? decodeURIComponent(fm[1].trim()) : undefined;
      const attachment = cd.toLowerCase().includes('attachment');
      const kind: ArtifactKind = ct.includes('pdf') ? 'pdf'
        : ct.startsWith('image/') ? 'image'
        : ct.includes('html')
          ? (attachment || (filename && /\.html?$/i.test(filename)) ? 'html' : 'page')
          : 'other';
      return { kind, filename, attachment };
    })
    .catch(() => ({ kind: 'other' as ArtifactKind }))
    .then(result => {
      probeCache.set(url, result);
      probePending.delete(url);
      return result;
    });
  probePending.set(url, p);
  return p;
}

// Resolves probes for the given URLs; cached results render immediately.
export function useArtifactProbes(urls: string[]): Record<string, ArtifactProbe> {
  const [results, setResults] = useState<Record<string, ArtifactProbe>>(() => {
    const initial: Record<string, ArtifactProbe> = {};
    for (const url of urls) {
      const cached = probeCache.get(url);
      if (cached) initial[url] = cached;
    }
    return initial;
  });
  const key = urls.join('|');
  useEffect(() => {
    let alive = true;
    for (const url of urls) {
      if (results[url]) continue;
      void probeArtifact(url).then(p => {
        if (alive) setResults(r => (r[url] ? r : { ...r, [url]: p }));
      });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return results;
}

// "Öffnen": show the file in a new tab. Files served with
// Content-Disposition: attachment would download instead of displaying, so
// those are fetched and re-opened as a blob URL — the tab must be opened
// synchronously in the click handler or popup blockers eat it.
export function openArtifact(url: string, attachment?: boolean): void {
  if (!attachment) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const tab = window.open('about:blank', '_blank');
  fetch(url, { credentials: 'include' })
    .then(r => r.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      if (tab) tab.location = blobUrl;
      else window.open(blobUrl, '_blank');
    })
    .catch(() => {
      if (tab) tab.close();
      window.open(url, '_blank', 'noopener');
    });
}
