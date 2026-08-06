/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen|in_bearbeitung) → 2) Prüfprotokoll erfassen →
 *        3) Zusammenfassung bestätigen & Auftragsstatus aktualisieren.
 * Reads: auftraege, auftragspositionen, kunden. Writes: pruefprotokoll (createPruefprotokollEntry),
 *        auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { lookupKey, formatDate } from '@/lib/formatters';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  IconClipboardCheck,
  IconCircleCheck,
  IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, auftragspositionen, kunden, kundenMap, auftraegeMap, loading, error, fetchAll } =
    useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);

  // Schritt 2: Prüfprotokoll-Felder
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Schritt 3: Submission state
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap]
  );

  const eligibleAuftraege = useMemo(
    () =>
      enrichedAuftraege.filter((a) => {
        const key = lookupKey(a.fields.status);
        return key === 'offen' || key === 'in_bearbeitung';
      }),
    [enrichedAuftraege]
  );

  // Anzahl Positionen je Auftrag
  const positionCountMap = useMemo(() => {
    const m = new Map<string, number>();
    auftragspositionen.forEach((p) => {
      const id = extractRecordId(p.fields.auftrag);
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    });
    return m;
  }, [auftragspositionen]);

  const showMaengelFelder =
    pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  function handleAuftragSelect(id: string) {
    const found = eligibleAuftraege.find((a) => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    // Reset Schritt-2/3 state when a new Auftrag is selected
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setStep(2);
  }

  async function handleAbschliessen() {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency guard: nur anlegen wenn noch kein Protokoll erstellt
      let pid = protokollId;
      if (!pid) {
        const payload: {
          auftrag_pruef: string;
          monteur_name_vorname: string;
          monteur_name_nachname: string;
          pruefungsdatum: string;
          pruefergebnis: string;
          maengelbeschreibung?: string;
          massnahmen?: string;
          bemerkungen_pruef?: string;
        } = {
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname,
          monteur_name_nachname: nachname,
          pruefungsdatum,
          pruefergebnis,
        };
        if (showMaengelFelder && maengelbeschreibung) payload.maengelbeschreibung = maengelbeschreibung;
        if (showMaengelFelder && massnahmen) payload.massnahmen = massnahmen;
        if (bemerkungen) payload.bemerkungen_pruef = bemerkungen;

        const created = await LivingAppsService.createPruefprotokollEntry(payload);
        pid = created.record_id;
        setProtokollId(pid);
      }

      // Status-Transition je nach Prüfergebnis
      const neuerStatus =
        pruefergebnis === 'nicht_bestanden' ? 'in_bearbeitung' : 'abgeschlossen';
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: neuerStatus,
      });

      await fetchAll();
      setDone(true);
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setStep(1);
  }

  const pruefergebnisLabel =
    PRUEFERGEBNIS_OPTIONS.find((o) => o.key === pruefergebnis)?.label ?? pruefergebnis;

  const kundeLabel = selectedAuftrag
    ? selectedAuftrag.kundeName ||
      (() => {
        const id = extractRecordId(selectedAuftrag.fields.kunde);
        if (!id) return '—';
        const k = kundenMap.get(id);
        return k ? `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() : '—';
      })()
    : '—';

  // Zeige Schritt 3 — Zusammenfassung (vor Submit oder nach Erfolg)
  const summaryAuftrag =
    selectedAuftrag ??
    (step === 3
      ? eligibleAuftraege[0] ?? null // Fallback: sollte nie greifen
      : null);

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag abschließen"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschließen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Auftrag wählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map((a) => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
            subtitle: `${formatDate(a.fields.auftragsdatum)} · ${a.kundeName || '—'}`,
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            stats: [
              {
                label: 'Positionen',
                value: positionCountMap.get(a.record_id) ?? 0,
              },
            ],
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleAuftragSelect}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen Aufträge vorhanden"
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" />}
        />
      )}

      {/* ── Schritt 2: Prüfprotokoll erfassen ── */}
      {step === 2 && (
        <div className="space-y-6 max-w-lg">
          {!selectedAuftrag ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                Dieser Schritt benötigt einen ausgewählten Auftrag aus Schritt 1.
              </p>
              <Button variant="outline" onClick={() => setStep(1)}>
                Neu starten
              </Button>
            </div>
          ) : (
            <>
              {/* Auftrag-Kontext */}
              <div className="rounded-2xl border bg-card p-4 space-y-1">
                <p className="text-xs text-muted-foreground">Auftrag</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold">
                    {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
                  </span>
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status?.key}
                    label={selectedAuftrag.fields.status?.label}
                  />
                  <span className="text-sm text-muted-foreground">{selectedAuftrag.kundeName}</span>
                </div>
              </div>

              {/* Monteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname Monteur *</Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={(e) => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname Monteur *</Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={(e) => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              {/* Prüfungsdatum */}
              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={(e) => setPruefungsdatum(e.target.value)}
                />
              </div>

              {/* Prüfergebnis — Tile-Auswahl */}
              <div className="space-y-1.5">
                <Label>Prüfergebnis *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PRUEFERGEBNIS_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnis(opt.key)}
                      className={`rounded-2xl border p-3 text-sm font-medium text-left transition-colors ${
                        pruefergebnis === opt.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:bg-secondary'
                      }`}
                    >
                      {opt.key === 'bestanden' && (
                        <IconCircleCheck size={18} className="mb-1 text-green-600" />
                      )}
                      {opt.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={18} className="mb-1 text-amber-500" />
                      )}
                      {opt.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={18} className="mb-1 text-destructive" />
                      )}
                      <span className="block">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mängelfelder — konditionell */}
              {showMaengelFelder && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="maengel">Mängelbeschreibung</Label>
                    <Textarea
                      id="maengel"
                      value={maengelbeschreibung}
                      onChange={(e) => setMaengelbeschreibung(e.target.value)}
                      placeholder="Beschreibe die festgestellten Mängel …"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="massnahmen">Maßnahmen</Label>
                    <Textarea
                      id="massnahmen"
                      value={massnahmen}
                      onChange={(e) => setMassnahmen(e.target.value)}
                      placeholder="Welche Maßnahmen sind erforderlich? …"
                      rows={3}
                    />
                  </div>
                </>
              )}

              {/* Bemerkungen */}
              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={(e) => setBemerkungen(e.target.value)}
                  placeholder="Optionale Bemerkungen zum Prüfvorgang …"
                  rows={2}
                />
              </div>

              <div className="flex gap-3 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  Zurück
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis}
                >
                  Weiter zur Zusammenfassung
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Schritt 3: Zusammenfassung & Abschließen ── */}
      {step === 3 && (
        <div className="space-y-6 max-w-lg">
          {!selectedAuftrag ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                Dieser Schritt benötigt Angaben aus den vorherigen Schritten.
              </p>
              <Button variant="outline" onClick={() => setStep(1)}>
                Neu starten
              </Button>
            </div>
          ) : done ? (
            /* Erfolg */
            <div className="rounded-2xl border bg-card p-6 text-center space-y-4">
              <IconCircleCheck size={48} className="mx-auto text-green-600" />
              <h2 className="text-lg font-semibold">
                {pruefergebnis === 'nicht_bestanden'
                  ? 'Prüfprotokoll erfasst — Auftrag in Bearbeitung'
                  : 'Auftrag erfolgreich abgeschlossen'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Auftrag{' '}
                <strong>
                  {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
                </strong>{' '}
                wurde auf{' '}
                <strong>
                  {pruefergebnis === 'nicht_bestanden' ? 'In Bearbeitung' : 'Abgeschlossen'}
                </strong>{' '}
                gesetzt.
              </p>
              <div className="flex gap-3 justify-center flex-wrap pt-2">
                <Button onClick={handleReset} variant="outline">
                  <IconRefresh size={16} className="mr-1.5" />
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/">
                  <Button>Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            /* Zusammenfassung vor Bestätigung */
            <>
              <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b bg-secondary/40">
                  <p className="text-sm font-semibold text-foreground">Zusammenfassung</p>
                </div>
                <div className="divide-y">
                  <div className="px-4 py-3 flex justify-between text-sm gap-3">
                    <span className="text-muted-foreground">Auftragsnummer</span>
                    <span className="font-medium truncate">
                      {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
                    </span>
                  </div>
                  <div className="px-4 py-3 flex justify-between text-sm gap-3">
                    <span className="text-muted-foreground">Kunde</span>
                    <span className="font-medium truncate">{kundeLabel}</span>
                  </div>
                  <div className="px-4 py-3 flex justify-between text-sm gap-3">
                    <span className="text-muted-foreground">Monteur</span>
                    <span className="font-medium truncate">
                      {vorname} {nachname}
                    </span>
                  </div>
                  <div className="px-4 py-3 flex justify-between text-sm gap-3">
                    <span className="text-muted-foreground">Prüfungsdatum</span>
                    <span className="font-medium">
                      {pruefungsdatum
                        ? format(new Date(pruefungsdatum), 'dd.MM.yyyy, HH:mm')
                        : '—'}
                    </span>
                  </div>
                  <div className="px-4 py-3 flex justify-between text-sm gap-3">
                    <span className="text-muted-foreground">Prüfergebnis</span>
                    <span
                      className={`font-semibold ${
                        pruefergebnis === 'bestanden'
                          ? 'text-green-600'
                          : pruefergebnis === 'bestanden_mit_maengeln'
                          ? 'text-amber-600'
                          : 'text-destructive'
                      }`}
                    >
                      {pruefergebnisLabel}
                    </span>
                  </div>
                  {showMaengelFelder && maengelbeschreibung && (
                    <div className="px-4 py-3 text-sm">
                      <p className="text-muted-foreground mb-1">Mängelbeschreibung</p>
                      <p className="text-foreground">{maengelbeschreibung}</p>
                    </div>
                  )}
                  {showMaengelFelder && massnahmen && (
                    <div className="px-4 py-3 text-sm">
                      <p className="text-muted-foreground mb-1">Maßnahmen</p>
                      <p className="text-foreground">{massnahmen}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Hinweis bei nicht bestanden */}
              {pruefergebnis === 'nicht_bestanden' && (
                <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 flex gap-3">
                  <IconAlertTriangle size={20} className="text-destructive flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-destructive">Prüfung nicht bestanden</p>
                    <p className="text-muted-foreground mt-1">
                      Der Auftrag wird auf <strong>In Bearbeitung</strong> gesetzt. Bitte behebe
                      die festgestellten Mängel und führe eine erneute Prüfung durch.
                    </p>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                  Zurück
                </Button>
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                >
                  {submitting
                    ? 'Wird gespeichert …'
                    : pruefergebnis === 'nicht_bestanden'
                    ? 'Protokoll speichern & In Bearbeitung setzen'
                    : 'Protokoll speichern & Auftrag abschließen'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
