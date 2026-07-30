/**
 * AuftragAbschliessenPage — 3-Schritt-Wizard zum Abschließen eines Serviceauftrags.
 * Schritte: 1) Offenen Auftrag auswählen → 2) Prüfprotokoll erfassen → 3) Auftrag abschließen & bestätigen.
 * Liest: auftraege, kunden (via kundenMap). Schreibt: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Verwendet: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  IconClipboardCheck,
  IconCheck,
  IconAlertTriangle,
  IconUser,
  IconCalendar,
  IconCircleCheck,
} from '@tabler/icons-react';

const AUFTRAEGE_STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const ABGESCHLOSSEN_KEY = AUFTRAEGE_STATUS.find(o => o.key === 'abgeschlossen')?.key ?? 'abgeschlossen';

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 state
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Step 2 state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');
  const [step2Saving, setStep2Saving] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [createdPruefprotokollId, setCreatedPruefprotokollId] = useState<string | null>(null);

  // Step 3 state
  const [step3Saving, setStep3Saving] = useState(false);
  const [step3Error, setStep3Error] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Resolve kunde name helper
  const resolveKundeName = (auftrag: Auftraege): string => {
    if (!auftrag.fields.kunde) return '';
    const id = extractRecordId(auftrag.fields.kunde);
    if (!id) return '';
    const k = kundenMap.get(id);
    if (!k) return '';
    return `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim();
  };

  // Filter out completed/cancelled orders
  const offeneAuftraege = useMemo(
    () => auftraege.filter(a => a.fields.status?.key !== ABGESCHLOSSEN_KEY && a.fields.status?.key !== 'storniert'),
    [auftraege]
  );

  // We need kunden in scope to suppress unused-var — already used via kundenMap above
  void kunden;

  // Step 1: select order
  const handleSelectAuftrag = (id: string) => {
    const found = auftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setCurrentStep(2);
  };

  // Step 2: create Prüfprotokoll
  const handleSubmitPruefprotokoll = async () => {
    if (!selectedAuftrag) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis) return;

    setStep2Saving(true);
    setStep2Error(null);
    try {
      const result = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: vorname.trim(),
        monteur_name_nachname: nachname.trim(),
        pruefungsdatum: pruefungsdatum,
        pruefergebnis: pruefergebnis,
        maengelbeschreibung: maengelbeschreibung.trim() || undefined,
        massnahmen: massnahmen.trim() || undefined,
        bemerkungen_pruef: bemerkungenPruef.trim() || undefined,
      });
      setCreatedPruefprotokollId(result.record_id);
      await fetchAll();
      setCurrentStep(3);
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Fehler beim Speichern des Prüfprotokolls.');
    } finally {
      setStep2Saving(false);
    }
  };

  // Step 3: mark order as completed
  const handleAbschliessen = async () => {
    if (!selectedAuftrag) return;
    setStep3Saving(true);
    setStep3Error(null);
    try {
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: ABGESCHLOSSEN_KEY,
      });
      await fetchAll();
      setDone(true);
    } catch (err) {
      setStep3Error(err instanceof Error ? err.message : 'Fehler beim Abschließen des Auftrags.');
    } finally {
      setStep3Saving(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setStep2Error(null);
    setStep3Error(null);
    setCreatedPruefprotokollId(null);
    setDone(false);
    setCurrentStep(1);
  };

  const showMaengel =
    pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  const selectedPruefergebnis = PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis);

  // Success screen
  if (done && selectedAuftrag) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg overflow-hidden shadow-lg">
          <CardContent className="p-8 space-y-6 text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-100 p-4">
                <IconCircleCheck size={48} className="text-green-600" stroke={1.5} />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Auftrag abgeschlossen!</h2>
              <p className="text-muted-foreground">
                Auftrag <strong>{selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}</strong> wurde erfolgreich abgeschlossen.
              </p>
            </div>
            <div className="bg-secondary rounded-2xl p-4 text-left space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                <span className="font-medium">{selectedAuftrag.fields.auftragsnummer ?? '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                <StatusBadge statusKey={pruefergebnis} label={selectedPruefergebnis?.label} />
              </div>
              {createdPruefprotokollId && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Prüfprotokoll erstellt</span>
                  <span className="text-sm text-green-600 font-medium">Ja</span>
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button className="flex-1" onClick={handleReset}>
                Weiteren Auftrag abschließen
              </Button>
              <Button variant="outline" className="flex-1" asChild>
                <a href="#/">Zurück zum Dashboard</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftrag abschließen"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Auftrag auswählen */}
      {currentStep === 1 && (
        <EntitySelectStep
          items={offeneAuftraege.map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
            subtitle: `Kunde: ${resolveKundeName(a)}`,
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            stats: [
              { label: 'Datum', value: a.fields.auftragsdatum ?? '—' },
              { label: 'Monteur', value: a.fields.monteur ?? '—' },
            ],
            icon: <IconClipboardCheck size={20} className="text-primary" stroke={1.5} />,
          }))}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen Aufträge vorhanden."
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" stroke={1.5} />}
        />
      )}

      {/* Step 2: Prüfprotokoll erstellen */}
      {currentStep === 2 && selectedAuftrag && (
        <div className="space-y-6">
          {/* Context header */}
          <div className="rounded-2xl bg-secondary p-4 flex items-start gap-3">
            <IconClipboardCheck size={20} className="text-primary mt-0.5 shrink-0" stroke={1.5} />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Ausgewählter Auftrag</p>
              <p className="font-semibold text-foreground truncate">
                {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
              </p>
              {resolveKundeName(selectedAuftrag) && (
                <p className="text-sm text-muted-foreground truncate">
                  Kunde: {resolveKundeName(selectedAuftrag)}
                </p>
              )}
            </div>
          </div>

          {/* Mini-form */}
          <div className="space-y-5">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <IconUser size={18} stroke={1.5} className="text-primary" />
              Monteur
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vorname">
                  Vorname <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vorname"
                  value={vorname}
                  onChange={e => setVorname(e.target.value)}
                  placeholder="Vorname"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nachname">
                  Nachname <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nachname"
                  value={nachname}
                  onChange={e => setNachname(e.target.value)}
                  placeholder="Nachname"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pruefungsdatum" className="flex items-center gap-1.5">
                <IconCalendar size={15} stroke={1.5} />
                Prüfungsdatum <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={e => setPruefungsdatum(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <IconCheck size={15} stroke={1.5} />
                Prüfergebnis <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRUEFERGEBNIS_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setPruefergebnis(option.key)}
                    className={`rounded-2xl border p-3 text-left transition-all ${
                      pruefergebnis === option.key
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {option.key === 'bestanden' && (
                        <IconCheck size={16} className="text-green-600 shrink-0" stroke={2} />
                      )}
                      {option.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={16} className="text-amber-500 shrink-0" stroke={2} />
                      )}
                      {option.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={16} className="text-destructive shrink-0" stroke={2} />
                      )}
                      <span className="text-sm font-medium text-foreground leading-tight">
                        {option.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {showMaengel && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-4">
                <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                  <IconAlertTriangle size={16} stroke={2} />
                  Bitte beschreibe die festgestellten Mängel
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengelbeschreibung"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Festgestellte Mängel beschreiben …"
                    rows={3}
                    className="resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="massnahmen">Maßnahmen</Label>
                  <Textarea
                    id="massnahmen"
                    value={massnahmen}
                    onChange={e => setMassnahmen(e.target.value)}
                    placeholder="Erforderliche Maßnahmen …"
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>
            )}

            {!showMaengel && (
              <div className="space-y-1.5">
                <Label htmlFor="massnahmen-ok">Maßnahmen (optional)</Label>
                <Textarea
                  id="massnahmen-ok"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Durchgeführte Maßnahmen …"
                  rows={2}
                  className="resize-none"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="bemerkungen">Bemerkungen (optional)</Label>
              <Textarea
                id="bemerkungen"
                value={bemerkungenPruef}
                onChange={e => setBemerkungenPruef(e.target.value)}
                placeholder="Weitere Bemerkungen …"
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          {step2Error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {step2Error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              variant="outline"
              className="sm:w-auto"
              onClick={() => setCurrentStep(1)}
              disabled={step2Saving}
            >
              Zurück
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmitPruefprotokoll}
              disabled={
                step2Saving ||
                !vorname.trim() ||
                !nachname.trim() ||
                !pruefungsdatum ||
                !pruefergebnis
              }
            >
              {step2Saving ? 'Wird gespeichert …' : 'Prüfprotokoll speichern & weiter'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Auftrag abschließen */}
      {currentStep === 3 && selectedAuftrag && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-secondary p-5 space-y-4">
            <h3 className="text-base font-semibold text-foreground">Zusammenfassung</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                <span className="font-medium text-foreground">
                  {selectedAuftrag.fields.auftragsnummer ?? '—'}
                </span>
              </div>
              {resolveKundeName(selectedAuftrag) && (
                <div className="flex justify-between items-center py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">Kunde</span>
                  <span className="font-medium text-foreground">{resolveKundeName(selectedAuftrag)}</span>
                </div>
              )}
              {selectedAuftrag.fields.auftragsdatum && (
                <div className="flex justify-between items-center py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">Auftragsdatum</span>
                  <span className="font-medium text-foreground">{selectedAuftrag.fields.auftragsdatum}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Monteur</span>
                <span className="font-medium text-foreground">
                  {`${vorname} ${nachname}`.trim()}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Prüfungsdatum</span>
                <span className="font-medium text-foreground">{pruefungsdatum.replace('T', ' ')}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                <StatusBadge
                  statusKey={pruefergebnis}
                  label={selectedPruefergebnis?.label}
                />
              </div>
            </div>
          </div>

          {showMaengel && maengelbeschreibung && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800 mb-1 flex items-center gap-2">
                <IconAlertTriangle size={16} stroke={2} />
                Mängel festgestellt
              </p>
              <p className="text-sm text-amber-700">{maengelbeschreibung}</p>
            </div>
          )}

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm text-foreground">
              Mit dem Abschließen wird der Auftrag auf <strong>Abgeschlossen</strong> gesetzt.
              Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
          </div>

          {step3Error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {step3Error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              variant="outline"
              className="sm:w-auto"
              onClick={() => setCurrentStep(2)}
              disabled={step3Saving}
            >
              Zurück
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleAbschliessen}
              disabled={step3Saving}
            >
              {step3Saving ? 'Wird abgeschlossen …' : (
                <span className="flex items-center gap-2">
                  <IconCircleCheck size={18} stroke={2} />
                  Auftrag abschließen
                </span>
              )}
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
