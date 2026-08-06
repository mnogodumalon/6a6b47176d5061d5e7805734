/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag auswählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen → 3) Auftrag abschließen & bestätigen.
 * Reads: auftraege, kunden. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { IconClipboardCheck, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);

  // Schritt 2 — Prüfprotokoll
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Schritt 3 — Ergebnis
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [abgeschlossen, setAbgeschlossen] = useState(false);

  const eligibleAuftraege = auftraege.filter(
    (a) => a.fields.status?.key !== 'abgeschlossen' && a.fields.status?.key !== 'storniert'
  );

  const kundenMap = new Map(kunden.map((k) => [k.record_id, k]));

  const handleAuftragSelect = (id: string) => {
    const found = auftraege.find((a) => a.record_id === id) ?? null;
    setSelectedAuftrag(found as EnrichedAuftraege | null);
    setStep(2);
  };

  const pruefStep2Valid =
    vorname.trim() !== '' &&
    nachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnis !== '';

  const handleProtokollUndAbschluss = async () => {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let pid = protokollId;
      if (!pid) {
        const created = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname,
          monteur_name_nachname: nachname,
          pruefungsdatum,
          pruefergebnis,
          maengelbeschreibung: maengelbeschreibung || undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungen || undefined,
        });
        pid = created.record_id;
        setProtokollId(pid);
      }
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: 'abgeschlossen',
      });
      await fetchAll();
      setAbgeschlossen(true);
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setAbgeschlossen(false);
  };

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag abschließen"
      steps={[{ label: 'Auftrag' }, { label: 'Prüfprotokoll' }, { label: 'Abschluss' }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Schritt 1 — Auftrag auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map((a) => {
            const kundeRecord = a.fields.kunde
              ? kundenMap.get(
                  (() => {
                    try {
                      return a.fields.kunde.split('/').pop() ?? '';
                    } catch {
                      return '';
                    }
                  })()
                )
              : undefined;
            const kundeName = kundeRecord
              ? `${kundeRecord.fields.vorname ?? ''} ${kundeRecord.fields.nachname ?? ''}`.trim()
              : '–';
            return {
              id: a.record_id,
              title: a.fields.auftragsnummer ?? a.record_id,
              subtitle: kundeName,
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              stats: a.fields.prioritaet
                ? [{ label: 'Priorität', value: a.fields.prioritaet.label }]
                : [],
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            };
          })}
          onSelect={handleAuftragSelect}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen Aufträge gefunden"
        />
      )}

      {/* Schritt 2 — Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-6">
            <div className="rounded-2xl border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground">Ausgewählter Auftrag</p>
              <p className="font-semibold">{selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}</p>
              {selectedAuftrag.fields.status && (
                <StatusBadge
                  statusKey={selectedAuftrag.fields.status.key}
                  label={selectedAuftrag.fields.status.label}
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="vorname">Vorname Monteur *</Label>
                <Input
                  id="vorname"
                  value={vorname}
                  onChange={(e) => setVorname(e.target.value)}
                  placeholder="Vorname"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nachname">Nachname Monteur *</Label>
                <Input
                  id="nachname"
                  value={nachname}
                  onChange={(e) => setNachname(e.target.value)}
                  placeholder="Nachname"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pruefungsdatum">Prüfungsdatum *</Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={(e) => setPruefungsdatum(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Prüfergebnis *</Label>
              <div className="flex flex-wrap gap-2">
                {PRUEFERGEBNIS_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPruefergebnis(opt.key)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      pruefergebnis === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-foreground hover:bg-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {pruefergebnis === 'nicht_bestanden' && (
              <div className="space-y-1">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={(e) => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibung der festgestellten Mängel …"
                  rows={3}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="massnahmen">Maßnahmen</Label>
              <Textarea
                id="massnahmen"
                value={massnahmen}
                onChange={(e) => setMassnahmen(e.target.value)}
                placeholder="Durchgeführte oder erforderliche Maßnahmen …"
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bemerkungen">Bemerkungen</Label>
              <Textarea
                id="bemerkungen"
                value={bemerkungen}
                onChange={(e) => setBemerkungen(e.target.value)}
                placeholder="Weitere Bemerkungen …"
                rows={2}
              />
            </div>

            {submitError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="w-full sm:w-auto">
                Zurück
              </Button>
              <Button
                disabled={!pruefStep2Valid || submitting}
                onClick={handleProtokollUndAbschluss}
                className="w-full sm:flex-1"
              >
                {submitting ? 'Wird gespeichert …' : 'Prüfprotokoll speichern & Auftrag abschließen'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* Schritt 3 — Bestätigung */}
      {step === 3 && (
        selectedAuftrag ? (
          <div className="space-y-6">
            {abgeschlossen ? (
              <div className="rounded-2xl border bg-card p-6 space-y-4 text-center">
                <div className="flex justify-center">
                  <IconCircleCheck size={48} className="text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-lg">Auftrag erfolgreich abgeschlossen</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
                  </p>
                </div>

                <div className="rounded-xl border bg-secondary p-4 text-left space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Prüfergebnis</p>
                  {(() => {
                    const opt = PRUEFERGEBNIS_OPTIONS.find((o) => o.key === pruefergebnis);
                    return opt ? (
                      <StatusBadge statusKey={opt.key} label={opt.label} />
                    ) : null;
                  })()}
                  <p className="text-sm">
                    <span className="text-muted-foreground">Monteur: </span>
                    {vorname} {nachname}
                  </p>
                  {pruefungsdatum && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Datum: </span>
                      {format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm')}
                    </p>
                  )}
                  {maengelbeschreibung && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Mängel: </span>
                      {maengelbeschreibung}
                    </p>
                  )}
                </div>

                {pruefergebnis === 'nicht_bestanden' && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 flex gap-2 items-start text-left">
                    <IconAlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">
                      Prüfung nicht bestanden. Auftrag wurde dennoch abgeschlossen. Bitte Folgemaßnahmen einleiten.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button onClick={handleReset} variant="outline" className="w-full sm:w-auto">
                    Weiteren Auftrag abschließen
                  </Button>
                  <a href="#/" className="w-full sm:w-auto">
                    <Button className="w-full">Zurück zum Dashboard</Button>
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 space-y-3">
                <p className="text-sm text-muted-foreground">Abschluss konnte nicht bestätigt werden.</p>
                <Button variant="outline" onClick={() => setStep(2)}>Zurück zum Protokoll</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
