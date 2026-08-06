/**
 * Auftrag Abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen → 3) Status aktualisieren & Bestätigung.
 * Reads: auftraege, kunden. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  IconClipboardCheck,
  IconCheck,
  IconAlertTriangle,
  IconUser,
  IconCalendar,
  IconRefresh,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);

  // Step 2 form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnisKey, setPruefergebnisKey] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3 state
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const enriched = enrichAuftraege(auftraege, { kundenMap });
  const eligible = enriched.filter(
    (a) =>
      a.fields.status?.key === 'offen' || a.fields.status?.key === 'in_bearbeitung'
  );

  const selectedPruefergebnis = PRUEFERGEBNIS_OPTIONS.find((o) => o.key === pruefergebnisKey);

  const handleSelectAuftrag = (id: string) => {
    const found = eligible.find((a) => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setStep(2);
  };

  const handleSubmitProtokoll = async () => {
    if (!selectedAuftrag) return;
    if (!vorname || !nachname || !pruefergebnisKey) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Idempotency guard: only create Prüfprotokoll if not yet created
      let pid = protokollId;
      if (!pid) {
        const result = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname,
          monteur_name_nachname: nachname,
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnisKey,
          maengelbeschreibung: maengelbeschreibung || undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungen || undefined,
        });
        pid = result.record_id;
        setProtokollId(pid);
      }

      // Update auftrag status based on pruefergebnis
      const newStatus = pruefergebnisKey === 'nicht_bestanden' ? 'in_bearbeitung' : 'abgeschlossen';
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: newStatus,
      });

      await fetchAll();
      setDone(true);
      setStep(3);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnisKey(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
  };

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag abschließen"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschluss' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Auftrag wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={eligible.map((a) => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
            subtitle: a.fields.auftragsbeschreibung ?? '',
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            stats: [
              { label: 'Priorität', value: a.fields.prioritaet?.label ?? '–' },
              { label: 'Kunde', value: a.kundeName },
            ],
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen Aufträge gefunden"
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2: Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-6">
            {/* Context card */}
            <div className="rounded-2xl border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  {selectedAuftrag.fields.auftragsnummer ?? 'Auftrag'}
                </span>
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>
              {selectedAuftrag.fields.auftragsbeschreibung && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {selectedAuftrag.fields.auftragsbeschreibung}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                <IconUser size={14} className="inline mr-1" />
                {selectedAuftrag.kundeName}
              </p>
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
              <Label htmlFor="pruefungsdatum">
                <IconCalendar size={14} className="inline mr-1" />
                Prüfungsdatum *
              </Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={(e) => setPruefungsdatum(e.target.value)}
              />
            </div>

            {/* Prüfergebnis */}
            <div className="space-y-2">
              <Label>Prüfergebnis *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRUEFERGEBNIS_OPTIONS.map((opt) => {
                  const isSelected = pruefergebnisKey === opt.key;
                  const colorClass =
                    opt.key === 'bestanden'
                      ? 'border-green-500 bg-green-50 text-green-800'
                      : opt.key === 'bestanden_mit_maengeln'
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-red-500 bg-red-50 text-red-800';
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnisKey(opt.key)}
                      className={`rounded-xl border-2 p-3 text-sm font-medium text-left transition-all ${
                        isSelected
                          ? colorClass
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {opt.key === 'bestanden' && (
                        <IconCheck size={16} className="mb-1" />
                      )}
                      {opt.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={16} className="mb-1" />
                      )}
                      {opt.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={16} className="mb-1" />
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mängelb eschreibung — nur wenn nicht bestanden */}
            {pruefergebnisKey !== 'bestanden' && (
              <div className="space-y-1.5">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={(e) => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibung der Mängel …"
                  rows={3}
                />
              </div>
            )}

            {/* Maßnahmen */}
            <div className="space-y-1.5">
              <Label htmlFor="massnahmen">Maßnahmen</Label>
              <Textarea
                id="massnahmen"
                value={massnahmen}
                onChange={(e) => setMassnahmen(e.target.value)}
                placeholder="Durchgeführte oder geplante Maßnahmen …"
                rows={3}
              />
            </div>

            {/* Bemerkungen */}
            <div className="space-y-1.5">
              <Label htmlFor="bemerkungen">Bemerkungen</Label>
              <Textarea
                id="bemerkungen"
                value={bemerkungen}
                onChange={(e) => setBemerkungen(e.target.value)}
                placeholder="Sonstige Bemerkungen …"
                rows={2}
              />
            </div>

            {submitError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
              <Button
                className="flex-1"
                disabled={!vorname || !nachname || !pruefergebnisKey || submitting}
                onClick={handleSubmitProtokoll}
              >
                {submitting ? (
                  <>
                    <IconRefresh size={16} className="mr-2 animate-spin" />
                    Wird gespeichert …
                  </>
                ) : (
                  <>
                    <IconClipboardCheck size={16} className="mr-2" />
                    Protokoll speichern & Auftrag abschließen
                  </>
                )}
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

      {/* Step 3: Bestätigung */}
      {step === 3 && (
        selectedAuftrag && done ? (
          <div className="space-y-6">
            {/* Success banner */}
            <div className="rounded-2xl border bg-card p-6 text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <IconCheck size={28} className="text-green-600" stroke={2} />
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {pruefergebnisKey === 'nicht_bestanden'
                  ? 'Prüfprotokoll gespeichert — Auftrag bleibt in Bearbeitung'
                  : 'Auftrag erfolgreich abgeschlossen'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {pruefergebnisKey === 'nicht_bestanden'
                  ? 'Da die Prüfung nicht bestanden wurde, bleibt der Auftrag auf „In Bearbeitung".'
                  : 'Das Prüfprotokoll wurde gespeichert und der Auftrag als abgeschlossen markiert.'}
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-2xl border bg-card divide-y overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Auftrag</span>
                <span className="font-medium text-foreground">
                  {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                {selectedPruefergebnis && (
                  <StatusBadge
                    statusKey={selectedPruefergebnis.key}
                    label={selectedPruefergebnis.label}
                  />
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Monteur</span>
                <span className="font-medium text-foreground">
                  {vorname} {nachname}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Prüfungsdatum</span>
                <span className="font-medium text-foreground">{pruefungsdatum.replace('T', ' ')}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Neuer Status</span>
                <StatusBadge
                  statusKey={pruefergebnisKey === 'nicht_bestanden' ? 'in_bearbeitung' : 'abgeschlossen'}
                  label={pruefergebnisKey === 'nicht_bestanden' ? 'In Bearbeitung' : 'Abgeschlossen'}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" className="flex-1" onClick={handleReset}>
                Weiteren Auftrag abschließen
              </Button>
              <a href="#/" className="flex-1">
                <Button className="w-full">Zurück zum Dashboard</Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht die Daten aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(selectedAuftrag ? 2 : 1)}>
              Neu starten
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
