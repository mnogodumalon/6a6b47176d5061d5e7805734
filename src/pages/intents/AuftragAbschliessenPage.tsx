/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag auswählen (nur 'offen' oder 'in_bearbeitung') →
 *        2) Prüfprotokoll erfassen (createPruefprotokollEntry) →
 *        3) Status aktualisieren & abschließen (updateAuftraegeEntry).
 * Reads: auftraege, kunden (für Kundenname). Writes: pruefprotokoll (create), auftraege (update).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconRefresh,
  IconHome,
} from '@tabler/icons-react';
import { formatDate, lookupKey } from '@/lib/formatters';

const AUFTRAEGE_STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, loading, error, fetchAll } = useDashboardData();

  // Step state
  const [step, setStep] = useState(1);

  // Step 1 — selected Auftrag
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2 — Prüfprotokoll form fields
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3 — final status + idempotency guard
  const [finalStatus, setFinalStatus] = useState('abgeschlossen');
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Kundenmap for display
  const kundenMap = new Map(kunden.map(k => [k.record_id, k]));

  // Filter: only offen or in_bearbeitung
  const eligibleAuftraege = auftraege.filter(a => {
    const s = lookupKey(a.fields.status);
    return s === 'offen' || s === 'in_bearbeitung';
  });

  const selectedAuftrag: Auftraege | undefined = selectedAuftragId
    ? auftraege.find(a => a.record_id === selectedAuftragId)
    : undefined;

  // Suggest status based on Prüfergebnis
  const suggestedStatus =
    pruefergebnis === 'nicht_bestanden' ? 'in_bearbeitung' : 'abgeschlossen';

  // --- Step 1: select Auftrag ---
  function handleSelectAuftrag(id: string) {
    setSelectedAuftragId(id);
    // Reset downstream state when a new Auftrag is picked
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setStep(2);
  }

  // --- Step 2: validate & proceed ---
  function handleProceedToStep3() {
    // Set suggested status before moving
    setFinalStatus(suggestedStatus);
    setSubmitError(null);
    setStep(3);
  }

  // --- Step 3: submit ---
  async function handleSubmit() {
    if (!selectedAuftragId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency: only create Prüfprotokoll if not already created
      let pid = protokollId;
      if (!pid) {
        const protokoll = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: vorname,
          monteur_name_nachname: nachname,
          pruefungsdatum,
          pruefergebnis,
          maengelbeschreibung:
            pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln'
              ? maengelbeschreibung
              : undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungen || undefined,
        });
        pid = protokoll.record_id;
        setProtokollId(pid);
      }

      // Always update status (update is repeatable)
      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
        status: finalStatus,
      });

      await fetchAll();
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftragId(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setFinalStatus('abgeschlossen');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setStep(1);
  }

  const step2Valid = vorname.trim() !== '' && nachname.trim() !== '' && pruefungsdatum !== '' && pruefergebnis !== '';

  // Helper: Kundenname for an Auftrag
  function getKundeName(a: Auftraege): string {
    if (!a.fields.kunde) return '';
    // Extract record id from the URL
    const parts = a.fields.kunde.split('/');
    const kid = parts[parts.length - 1];
    const k = kundenMap.get(kid);
    if (!k) return '';
    return [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
  }

  // Prüfergebnis label
  function getPruefergebnisLabel(key: string): string {
    return PRUEFERGEBNIS_OPTIONS.find(o => o.key === key)?.label ?? key;
  }

  // Status label
  function getStatusLabel(key: string): string {
    return AUFTRAEGE_STATUS.find(o => o.key === key)?.label ?? key;
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftragsstatus aktualisieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── Step 1: Auftrag auswählen ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-4">
              Wähle einen offenen oder in Bearbeitung befindlichen Auftrag aus, den du abschließen möchtest.
            </p>
            <EntitySelectStep
              items={eligibleAuftraege.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
                subtitle: [
                  a.fields.auftragsdatum ? formatDate(a.fields.auftragsdatum) : null,
                  getKundeName(a) || null,
                  a.fields.monteur ? `Monteur: ${a.fields.monteur}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                status: a.fields.status
                  ? { key: lookupKey(a.fields.status) ?? '', label: a.fields.status.label }
                  : undefined,
                stats: [
                  {
                    label: 'Priorität',
                    value: a.fields.prioritaet?.label ?? '—',
                  },
                ],
                icon: <IconClipboardCheck size={20} className="text-primary" />,
              }))}
              onSelect={handleSelectAuftrag}
              searchPlaceholder="Auftragsnummer oder Kunde suchen..."
              emptyText="Keine offenen oder in Bearbeitung befindlichen Aufträge vorhanden."
              emptyIcon={<IconClipboardCheck size={32} />}
            />
          </div>
        </div>
      )}

      {/* ─── Step 2: Prüfprotokoll erfassen ────────────────────────── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-4">
            {/* Context card */}
            <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardCheck size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftragId?.slice(-6)}`}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedAuftrag.fields.status && (
                    <StatusBadge
                      statusKey={lookupKey(selectedAuftrag.fields.status)}
                      label={selectedAuftrag.fields.status.label}
                    />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {getKundeName(selectedAuftrag) || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mini-form */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname Monteur *</Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname Monteur *</Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Prüfergebnis *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnis(opt.key)}
                      className={`rounded-xl border p-3 text-sm font-medium text-left transition-colors ${
                        pruefergebnis === opt.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent'
                      }`}
                    >
                      {opt.key === 'bestanden' && (
                        <IconCircleCheck size={16} className="mb-1 text-green-600" />
                      )}
                      {opt.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={16} className="mb-1 text-amber-500" />
                      )}
                      {opt.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={16} className="mb-1 text-destructive" />
                      )}
                      <div>{opt.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {(pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln') && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibe die festgestellten Mängel..."
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Eingeleitete oder geplante Maßnahmen..."
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Weitere Anmerkungen zum Prüfvorgang..."
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
              <Button
                disabled={!step2Valid}
                onClick={handleProceedToStep3}
                className="flex-1 sm:flex-none"
              >
                Weiter zu Schritt 3
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht die Auswahl aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ─── Step 3: Status aktualisieren & abschließen ─────────────── */}
      {step === 3 && (
        selectedAuftrag ? (
          done ? (
            /* Success state */
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto">
                <IconCircleCheck size={28} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Auftrag erfolgreich abgeschlossen</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Prüfprotokoll wurde erfasst und der Status auf{' '}
                  <span className="font-medium">{getStatusLabel(finalStatus)}</span> gesetzt.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <Button variant="outline" onClick={handleReset} className="gap-2">
                  <IconRefresh size={16} />
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/">
                  <Button className="gap-2 w-full">
                    <IconHome size={16} />
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Zusammenfassung</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">Auftragsnummer</p>
                    <p className="font-medium">
                      {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftragId?.slice(-6)}`}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">Aktueller Status</p>
                    {selectedAuftrag.fields.status ? (
                      <StatusBadge
                        statusKey={lookupKey(selectedAuftrag.fields.status)}
                        label={selectedAuftrag.fields.status.label}
                      />
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">Monteur</p>
                    <p className="font-medium">{[vorname, nachname].filter(Boolean).join(' ') || '—'}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">Prüfergebnis</p>
                    <p className="font-medium">{getPruefergebnisLabel(pruefergebnis)}</p>
                  </div>
                  {(pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln') && maengelbeschreibung && (
                    <div className="col-span-full space-y-0.5">
                      <p className="text-muted-foreground text-xs uppercase tracking-wide">Mängel</p>
                      <p className="text-sm">{maengelbeschreibung}</p>
                    </div>
                  )}
                </div>

                {pruefergebnis === 'nicht_bestanden' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2 items-start">
                    <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <p>Das Prüfergebnis ist "Nicht bestanden". Es wird empfohlen, den Status auf "In Bearbeitung" zu setzen.</p>
                  </div>
                )}
              </div>

              {/* Final status selector */}
              <div className="rounded-2xl border bg-card p-5 space-y-3">
                <h2 className="font-semibold text-base">Neuen Status festlegen</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="finalStatus">Status nach Abschluss</Label>
                  <Select value={finalStatus} onValueChange={setFinalStatus}>
                    <SelectTrigger id="finalStatus" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUFTRAEGE_STATUS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                          {opt.key === suggestedStatus && ' (empfohlen)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {submitError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex gap-2 items-start">
                  <IconAlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <p>{submitError}</p>
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                  Zurück
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 sm:flex-none gap-2"
                >
                  {submitting ? (
                    <>
                      <IconRefresh size={16} className="animate-spin" />
                      Wird gespeichert...
                    </>
                  ) : (
                    <>
                      <IconCircleCheck size={16} />
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
              Dieser Schritt braucht die Auswahl aus Schritt 1.
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
