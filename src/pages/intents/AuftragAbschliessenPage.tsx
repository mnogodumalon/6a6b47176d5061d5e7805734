/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offenen/in Bearbeitung befindlichen Auftrag auswählen →
 *         2) Prüfprotokoll erfassen (erstellt Pruefprotokoll-Record, setzt Auftrag auf 'abgeschlossen') →
 *         3) Zusammenfassung mit Abschlussbestätigung.
 * Reads: auftraege. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import type { Auftraege } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconClipboardCheck, IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Prüfprotokoll form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnisKey, setPruefergebnisKey] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Submission state — stored for idempotency and summary display
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Summary display state (captured at submission time)
  const [summaryData, setSummaryData] = useState<{
    auftragsnummer: string;
    pruefergebnisKey: string;
    pruefergebnisLabel: string;
    monteur: string;
    pruefungsdatum: string;
  } | null>(null);

  // Filter: only offen or in_bearbeitung
  const eligibleAuftraege = auftraege.filter(
    (a) =>
      a.fields.status?.key === 'offen' || a.fields.status?.key === 'in_bearbeitung'
  );

  const handleAuftragSelect = (id: string) => {
    const found = auftraege.find((a) => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!selectedAuftrag) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnisKey) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Idempotency guard: only create Pruefprotokoll if not yet created
      let pid = protokollId;
      if (!pid) {
        const payload: Record<string, unknown> = {
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum,
          pruefergebnis: pruefergebnisKey,
        };
        if (maengelbeschreibung.trim()) payload.maengelbeschreibung = maengelbeschreibung.trim();
        if (massnahmen.trim()) payload.massnahmen = massnahmen.trim();
        if (bemerkungen.trim()) payload.bemerkungen_pruef = bemerkungen.trim();

        const created = await LivingAppsService.createPruefprotokollEntry(payload);
        pid = created.record_id;
        setProtokollId(pid);
      }

      // Always re-attempt the status update (idempotent)
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: 'abgeschlossen',
      });

      const ergebnis = PRUEFERGEBNIS_OPTIONS.find((o) => o.key === pruefergebnisKey);
      setSummaryData({
        auftragsnummer: selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id,
        pruefergebnisKey,
        pruefergebnisLabel: ergebnis?.label ?? pruefergebnisKey,
        monteur: `${vorname.trim()} ${nachname.trim()}`,
        pruefungsdatum,
      });

      await fetchAll();
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Speichern.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
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
    setSummaryData(null);
    setStep(1);
  };

  const isFormValid =
    vorname.trim().length > 0 &&
    nachname.trim().length > 0 &&
    pruefungsdatum.length > 0 &&
    pruefergebnisKey.length > 0;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag als abgeschlossen markieren"
      steps={[
        { label: 'Auftrag' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschluss' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Auftrag auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map((a) => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
            subtitle: a.fields.auftragsbeschreibung ?? '–',
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleAuftragSelect}
          searchPlaceholder="Auftragsnummer oder Beschreibung suchen …"
          emptyText="Keine offenen oder in Bearbeitung befindlichen Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" />}
        />
      )}

      {/* Step 2: Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-6 max-w-2xl mx-auto">
            {/* Selected Auftrag context */}
            <div className="rounded-2xl border bg-card p-4 flex items-start gap-3 overflow-hidden">
              <IconClipboardCheck size={20} className="text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </p>
                {selectedAuftrag.fields.auftragsbeschreibung && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {selectedAuftrag.fields.auftragsbeschreibung}
                  </p>
                )}
                {selectedAuftrag.fields.status && (
                  <div className="mt-1">
                    <StatusBadge
                      statusKey={selectedAuftrag.fields.status.key}
                      label={selectedAuftrag.fields.status.label}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Mini-form */}
            <div className="rounded-2xl border bg-card p-5 space-y-5 overflow-hidden">
              <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>

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

              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum und -uhrzeit *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={(e) => setPruefungsdatum(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pruefergebnis">Prüfergebnis *</Label>
                <Select value={pruefergebnisKey} onValueChange={setPruefergebnisKey}>
                  <SelectTrigger id="pruefergebnis" className="w-full">
                    <SelectValue placeholder="Ergebnis wählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRUEFERGEBNIS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {pruefergebnisKey !== 'bestanden' && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">
                    Mängelbeschreibung
                    {pruefergebnisKey === 'nicht_bestanden' && ' (empfohlen)'}
                  </Label>
                  <Textarea
                    id="maengel"
                    value={maengelbeschreibung}
                    onChange={(e) => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibung der festgestellten Mängel …"
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen (optional)</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={(e) => setMassnahmen(e.target.value)}
                  placeholder="Eingeleitete oder geplante Maßnahmen …"
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen (optional)</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={(e) => setBemerkungen(e.target.value)}
                  placeholder="Weitere Anmerkungen …"
                  rows={2}
                />
              </div>

              {submitError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive">
                  <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="w-full sm:w-auto"
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!isFormValid || submitting}
                  className="w-full sm:flex-1"
                >
                  {submitting ? 'Wird gespeichert …' : 'Prüfprotokoll speichern & Auftrag abschließen'}
                </Button>
              </div>
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

      {/* Step 3: Zusammenfassung */}
      {step === 3 && (
        summaryData ? (
          <div className="space-y-6 max-w-lg mx-auto text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary/10 p-5">
                <IconCircleCheck size={48} className="text-primary" stroke={1.5} />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold">Auftrag erfolgreich abgeschlossen</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Das Prüfprotokoll wurde erstellt und der Status aktualisiert.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-5 text-left space-y-3 overflow-hidden">
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground">Auftrag</span>
                <span className="font-medium truncate">{summaryData.auftragsnummer}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                <StatusBadge
                  statusKey={summaryData.pruefergebnisKey}
                  label={summaryData.pruefergebnisLabel}
                />
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground">Monteur</span>
                <span className="font-medium">{summaryData.monteur}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-muted-foreground">Prüfdatum</span>
                <span className="font-medium">
                  {summaryData.pruefungsdatum.replace('T', ' ')}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button onClick={handleReset} className="w-full sm:w-auto">
                Weiteren Auftrag abschließen
              </Button>
              <Button variant="outline" asChild className="w-full sm:w-auto">
                <a href="#/">Zur Startseite</a>
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
    </IntentWizardShell>
  );
}
