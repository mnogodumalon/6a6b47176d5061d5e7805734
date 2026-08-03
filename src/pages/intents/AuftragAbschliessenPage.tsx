/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen
 *        → 3) Bestätigen & Auftrag abschließen.
 * Reads: auftraege, kunden (via kundenMap).
 * Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
  IconChevronLeft,
} from '@tabler/icons-react';
import { formatDate } from '@/lib/formatters';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1: selected auftrag
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2: Prüfprotokoll fields
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnis, setPruefergebnis] = useState<string>(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3: submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [finalStatusApplied, setFinalStatusApplied] = useState<string | null>(null);

  // Filtered auftraege: only offen or in_bearbeitung
  const eligibleAuftraege = useMemo(
    () => auftraege.filter(a => {
      const key = a.fields.status?.key;
      return key === 'offen' || key === 'in_bearbeitung';
    }),
    [auftraege]
  );

  const selectedAuftrag: Auftraege | undefined = useMemo(
    () => auftraege.find(a => a.record_id === selectedAuftragId),
    [auftraege, selectedAuftragId]
  );

  const kundeNameForAuftrag = useMemo(() => {
    if (!selectedAuftrag) return '—';
    const kundeId = extractRecordId(selectedAuftrag.fields.kunde);
    if (!kundeId) return '—';
    const k = kundenMap.get(kundeId);
    if (!k) return '—';
    return [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '—';
  }, [selectedAuftrag, kundenMap]);

  const showMaengelfeld =
    pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  const schritt2Valid =
    monteurVorname.trim() !== '' &&
    monteurNachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnis !== '' &&
    (!showMaengelfeld || maengelbeschreibung.trim() !== '');

  function handleSelectAuftrag(id: string) {
    setSelectedAuftragId(id);
    // Pre-fill Monteur from auftrag if available
    const a = auftraege.find(x => x.record_id === id);
    if (a?.fields.monteur) {
      const parts = a.fields.monteur.trim().split(/\s+/);
      setMonteurVorname(parts[0] ?? '');
      setMonteurNachname(parts.slice(1).join(' ') ?? '');
    }
    // Default pruefungsdatum to today
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setStep(2);
  }

  async function handleAbschliessen() {
    if (!selectedAuftragId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency: only create Prüfprotokoll if not already created this run
      let pid = protokollId;
      if (!pid) {
        const protokoll = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: monteurVorname,
          monteur_name_nachname: monteurNachname,
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnis,
          maengelbeschreibung: showMaengelfeld ? maengelbeschreibung : undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungen || undefined,
        });
        pid = protokoll.record_id;
        setProtokollId(pid);
      }

      // Determine new status based on Prüfergebnis
      const newStatus =
        pruefergebnis === 'nicht_bestanden' ? 'in_bearbeitung' : 'abgeschlossen';

      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
        status: newStatus,
      });

      setFinalStatusApplied(newStatus);
      setDone(true);
      await fetchAll();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftragId(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum('');
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setFinalStatusApplied(null);
    setStep(1);
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftragsstatus aktualisieren"
      steps={[
        { label: 'Auftrag' },
        { label: 'Prüfprotokoll' },
        { label: 'Bestätigen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Auftrag wählen ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Nur offene und in Bearbeitung befindliche Aufträge werden angezeigt.
            </p>
          </div>
          <EntitySelectStep
            searchPlaceholder="Auftragsnummer, Monteur oder Kundennamen suchen …"
            emptyText="Keine offenen Aufträge gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
            items={eligibleAuftraege.map(a => {
              const kundeId = extractRecordId(a.fields.kunde);
              const kunde = kundeId ? kundenMap.get(kundeId) : undefined;
              const kundeName = kunde
                ? [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || kunde.fields.firma || '—'
                : '—';
              return {
                id: a.record_id,
                title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
                subtitle: `${kundeName} · ${formatDate(a.fields.auftragsdatum)} · Monteur: ${a.fields.monteur ?? '—'}`,
                status: a.fields.status
                  ? { key: a.fields.status.key, label: a.fields.status.label }
                  : undefined,
                stats: a.fields.prioritaet
                  ? [{ label: 'Priorität', value: a.fields.prioritaet.label }]
                  : [],
                icon: <IconClipboardCheck size={20} className="text-primary" />,
              };
            })}
            onSelect={handleSelectAuftrag}
          />
        </div>
      )}

      {/* ── Schritt 2: Prüfprotokoll erfassen ─────────────────────── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Prüfprotokoll erfassen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag: <span className="font-medium text-foreground">{selectedAuftrag.fields.auftragsnummer ?? selectedAuftragId}</span>
                {' · '}{kundeNameForAuftrag}
              </p>
            </div>

            {/* Monteur */}
            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Monteur</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Vorname *</label>
                  <Input
                    value={monteurVorname}
                    onChange={e => setMonteurVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nachname *</label>
                  <Input
                    value={monteurNachname}
                    onChange={e => setMonteurNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>
            </div>

            {/* Prüfung */}
            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Prüfung</h3>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prüfungsdatum und -uhrzeit *</label>
                <Input
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prüfergebnis *</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnis(opt.key)}
                      className={`rounded-xl border p-3 text-sm font-medium text-left transition-colors ${
                        pruefergebnis === opt.key
                          ? opt.key === 'nicht_bestanden'
                            ? 'border-red-400 bg-red-50 text-red-700'
                            : opt.key === 'bestanden_mit_maengeln'
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-green-400 bg-green-50 text-green-700'
                          : 'border-muted bg-card text-muted-foreground hover:border-primary/40 hover:bg-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {showMaengelfeld && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Mängelbeschreibung *
                  </label>
                  <Textarea
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibung der festgestellten Mängel …"
                    rows={3}
                  />
                </div>
              )}
            </div>

            {/* Optionale Felder */}
            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Weitere Angaben (optional)</h3>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Maßnahmen</label>
                <Textarea
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Eingeleitete oder geplante Maßnahmen …"
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Bemerkungen</label>
                <Textarea
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Allgemeine Bemerkungen zur Prüfung …"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="gap-1.5"
              >
                <IconChevronLeft size={16} />
                Zurück
              </Button>
              <Button
                disabled={!schritt2Valid}
                onClick={() => setStep(3)}
                className="flex-1"
              >
                Weiter zur Bestätigung
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Auftrag.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ── Schritt 3: Bestätigen ─────────────────────────────────── */}
      {step === 3 && (
        selectedAuftrag ? (
          done ? (
            /* ── Erfolgsmeldung ── */
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <IconCheck size={28} className="text-green-600" stroke={2.5} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">
                    {finalStatusApplied === 'abgeschlossen'
                      ? 'Auftrag erfolgreich abgeschlossen!'
                      : 'Prüfprotokoll gespeichert — Auftrag bleibt in Bearbeitung'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Prüfprotokoll wurde erstellt und der Auftragsstatus wurde aktualisiert.
                  </p>
                </div>

                {finalStatusApplied === 'in_bearbeitung' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700 text-left">
                    <div className="flex items-start gap-2">
                      <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        Da die Prüfung nicht bestanden wurde, bleibt der Auftrag im Status
                        <strong> In Bearbeitung</strong>. Bitte Mängel beheben und Auftrag
                        erneut prüfen.
                      </span>
                    </div>
                  </div>
                )}

                {/* Zusammenfassung */}
                <div className="rounded-xl border bg-secondary/30 p-4 text-left space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Auftragsnummer</span>
                    <span className="font-medium">{selectedAuftrag.fields.auftragsnummer ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kunde</span>
                    <span className="font-medium">{kundeNameForAuftrag}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prüfergebnis</span>
                    <StatusBadge
                      statusKey={pruefergebnis}
                      label={PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                    />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Neuer Status</span>
                    <StatusBadge
                      statusKey={finalStatusApplied ?? undefined}
                      label={
                        finalStatusApplied === 'abgeschlossen'
                          ? 'Abgeschlossen'
                          : 'In Bearbeitung'
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={handleReset} className="flex-1 gap-1.5">
                  <IconRefresh size={16} />
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/" className="flex-1">
                  <Button variant="default" className="w-full">
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            /* ── Bestätigungsansicht ── */
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Zusammenfassung & Bestätigen</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Bitte überprüfe die Angaben vor dem Abschließen.
                </p>
              </div>

              {/* Auftrag-Details */}
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold">Auftrag</h3>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Nummer</span>
                  <span className="font-medium">
                    {selectedAuftrag.fields.auftragsnummer ?? '—'}
                  </span>
                  <span className="text-muted-foreground">Kunde</span>
                  <span className="font-medium">{kundeNameForAuftrag}</span>
                  <span className="text-muted-foreground">Aktueller Status</span>
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status?.key}
                    label={selectedAuftrag.fields.status?.label}
                  />
                  {selectedAuftrag.fields.prioritaet && (
                    <>
                      <span className="text-muted-foreground">Priorität</span>
                      <span>{selectedAuftrag.fields.prioritaet.label}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Prüfprotokoll-Details */}
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold">Prüfprotokoll</h3>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Monteur</span>
                  <span className="font-medium">{monteurVorname} {monteurNachname}</span>
                  <span className="text-muted-foreground">Prüfungsdatum</span>
                  <span>{pruefungsdatum.replace('T', ' ').slice(0, 16)}</span>
                  <span className="text-muted-foreground">Prüfergebnis</span>
                  <StatusBadge
                    statusKey={pruefergebnis}
                    label={PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                  />
                </div>
                {showMaengelfeld && maengelbeschreibung && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Mängelbeschreibung</span>
                    <p className="text-sm bg-secondary/30 rounded-lg p-2">{maengelbeschreibung}</p>
                  </div>
                )}
                {massnahmen && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Maßnahmen</span>
                    <p className="text-sm bg-secondary/30 rounded-lg p-2">{massnahmen}</p>
                  </div>
                )}
              </div>

              {/* Hinweis bei nicht bestanden */}
              {pruefergebnis === 'nicht_bestanden' && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                  <div className="flex items-start gap-2">
                    <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>
                      Prüfung nicht bestanden — der Auftrag wird nach dem Bestätigen auf
                      <strong> In Bearbeitung</strong> gesetzt (nicht abgeschlossen).
                    </span>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  Fehler: {submitError}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={submitting}
                  className="gap-1.5"
                >
                  <IconChevronLeft size={16} />
                  Zurück
                </Button>
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="flex-1 gap-2"
                >
                  {submitting ? (
                    <>Wird gespeichert …</>
                  ) : pruefergebnis === 'nicht_bestanden' ? (
                    <>
                      <IconClipboardCheck size={16} />
                      Protokoll speichern & in Bearbeitung lassen
                    </>
                  ) : (
                    <>
                      <IconCheck size={16} />
                      Auftrag abschließen
                    </>
                  )}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Auftrag.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
