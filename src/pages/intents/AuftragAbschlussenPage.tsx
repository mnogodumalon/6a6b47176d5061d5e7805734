/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offenen Auftrag auswählen → 2) Prüfprotokoll ausfüllen → 3) Status aktualisieren & Abschluss bestätigen.
 * Reads: auftraege, kunden (via kundenMap for display). Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { EnrichedAuftraege } from '@/types/enriched';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { IconClipboardCheck, IconCheck, IconAlertTriangle } from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];
const AUFTRAEGE_STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const ABGESCHLOSSEN_KEY = AUFTRAEGE_STATUS_OPTIONS.find(o => o.key === 'abgeschlossen')?.key ?? AUFTRAEGE_STATUS_OPTIONS[0]?.key ?? '';

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschluss' },
];

function getNowDatetimeLocal(): string {
  const now = new Date();
  return format(now, "yyyy-MM-dd'T'HH:mm");
}

export default function AuftragAbschlussenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();

  // Step management
  const [step, setStep] = useState(1);

  // Step 1 — selected Auftrag
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2 — Prüfprotokoll form
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(getNowDatetimeLocal());
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');
  const [step2Submitting, setStep2Submitting] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3 — Protokoll id (idempotency guard) + status selection
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState(ABGESCHLOSSEN_KEY);
  const [step3Submitting, setStep3Submitting] = useState(false);
  const [step3Error, setStep3Error] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Enrich auftraege with kunde name
  const enrichedAuftraege = useMemo<EnrichedAuftraege[]>(() => {
    return auftraege.map(a => {
      const kundeId = extractRecordId(a.fields.kunde ?? null);
      const kunde = kundeId ? kundenMap.get(kundeId) : undefined;
      const kundeName = kunde
        ? [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || kunde.fields.firma || 'Unbekannter Kunde'
        : 'Unbekannter Kunde';
      return { ...a, kundeName };
    });
  }, [auftraege, kundenMap]);

  // Filter: exclude already 'abgeschlossen' orders
  const offeneAuftraege = useMemo(() => {
    return enrichedAuftraege.filter(a => a.fields.status?.key !== 'abgeschlossen');
  }, [enrichedAuftraege]);

  const selectedAuftrag = useMemo(() => {
    if (!selectedAuftragId) return null;
    return enrichedAuftraege.find(a => a.record_id === selectedAuftragId) ?? null;
  }, [selectedAuftragId, enrichedAuftraege]);

  // Step 1 handlers
  function handleSelectAuftrag(id: string) {
    setSelectedAuftragId(id);
    const auftrag = enrichedAuftraege.find(a => a.record_id === id);
    if (auftrag?.fields.monteur) {
      // Pre-fill monteur name if available (it's a single text field, not first+last)
      // Just try to split by space for convenience
      const parts = (auftrag.fields.monteur ?? '').trim().split(/\s+/);
      if (parts.length >= 2) {
        setVorname(parts[0]);
        setNachname(parts.slice(1).join(' '));
      } else if (parts.length === 1 && parts[0]) {
        setVorname(parts[0]);
        setNachname('');
      }
    }
    setStep(2);
  }

  // Step 2: submit Prüfprotokoll
  async function handleSubmitPruefprotokoll() {
    if (!selectedAuftragId) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis) {
      setStep2Error('Bitte alle Pflichtfelder ausfüllen.');
      return;
    }
    setStep2Submitting(true);
    setStep2Error(null);
    try {
      const result = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
        monteur_name_vorname: vorname.trim(),
        monteur_name_nachname: nachname.trim(),
        pruefungsdatum,
        pruefergebnis,
        maengelbeschreibung: maengelbeschreibung || undefined,
        massnahmen: massnahmen || undefined,
        bemerkungen_pruef: bemerkungenPruef || undefined,
      });
      setProtokollId(result.record_id);
      setStep(3);
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Fehler beim Speichern des Prüfprotokolls.');
    } finally {
      setStep2Submitting(false);
    }
  }

  // Step 3: update Auftrag status
  async function handleAbschliessen() {
    if (!selectedAuftragId) return;
    setStep3Submitting(true);
    setStep3Error(null);
    try {
      // Idempotency guard: create Prüfprotokoll only if not yet done
      let pid = protokollId;
      if (!pid) {
        const result = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum,
          pruefergebnis,
          maengelbeschreibung: maengelbeschreibung || undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungenPruef || undefined,
        });
        pid = result.record_id;
        setProtokollId(pid);
      }
      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, { status: finalStatus });
      await fetchAll();
      setDone(true);
    } catch (err) {
      setStep3Error(err instanceof Error ? err.message : 'Fehler beim Abschließen des Auftrags.');
    } finally {
      setStep3Submitting(false);
    }
  }

  function handleReset() {
    setStep(1);
    setSelectedAuftragId(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(getNowDatetimeLocal());
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setStep2Error(null);
    setProtokollId(null);
    setFinalStatus(ABGESCHLOSSEN_KEY);
    setStep3Error(null);
    setDone(false);
  }

  // Success screen
  if (done && selectedAuftrag) {
    const ergebnisLabel = PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis;
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <a href="#/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
            &larr; Zurück zum Dashboard
          </a>
          <h1 className="text-2xl font-bold tracking-tight">Auftrag abschließen</h1>
        </div>
        <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <IconCheck size={28} className="text-primary" stroke={2.5} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">
              Auftrag {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id} wurde erfolgreich abgeschlossen.
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Kunde: {selectedAuftrag.kundeName}
            </p>
          </div>
          <div className="rounded-xl border bg-secondary/50 p-4 text-left space-y-2 max-w-sm mx-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prüfprotokoll</p>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Monteur:</span> {vorname} {nachname}</p>
              <p><span className="text-muted-foreground">Datum:</span> {pruefungsdatum.replace('T', ' ')}</p>
              <p><span className="text-muted-foreground">Ergebnis:</span> {ergebnisLabel}</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button variant="outline" onClick={handleReset}>
              Weiteren Auftrag abschließen
            </Button>
            <a href="#/">
              <Button>Zurück zum Dashboard</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftragsstatus aktualisieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Auftrag auswählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Wähle den Auftrag, den du abschließen möchtest. Bereits abgeschlossene Aufträge werden nicht angezeigt.
            </p>
          </div>
          <EntitySelectStep
            items={offeneAuftraege.map(a => ({
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: [
                a.kundeName,
                a.fields.wunschtermin ? `Wunschtermin: ${a.fields.wunschtermin.slice(0, 10)}` : null,
              ].filter(Boolean).join(' · '),
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectAuftrag}
            searchPlaceholder="Auftrag suchen..."
            emptyText="Keine offenen Aufträge gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
          />
        </div>
      )}

      {/* ── Step 2: Prüfprotokoll ausfüllen ── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Prüfprotokoll ausfüllen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag: <span className="font-medium text-foreground">{selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}</span>
                {' · '}Kunde: <span className="font-medium text-foreground">{selectedAuftrag.kundeName}</span>
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Monteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">
                    Vorname des Monteurs <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="z. B. Max"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">
                    Nachname des Monteurs <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="z. B. Mustermann"
                  />
                </div>
              </div>

              {/* Prüfungsdatum */}
              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">
                  Prüfungsdatum & -uhrzeit <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Prüfergebnis */}
              <div className="space-y-1.5">
                <Label>
                  Prüfergebnis <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mängelbesch­reibung */}
              <div className="space-y-1.5">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={e => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibe festgestellte Mängel (optional)"
                  rows={3}
                />
              </div>

              {/* Maßnahmen */}
              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Welche Maßnahmen wurden ergriffen? (optional)"
                  rows={3}
                />
              </div>

              {/* Bemerkungen */}
              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungenPruef}
                  onChange={e => setBemerkungenPruef(e.target.value)}
                  placeholder="Sonstige Bemerkungen (optional)"
                  rows={2}
                />
              </div>
            </div>

            {step2Error && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <IconAlertTriangle size={16} stroke={2} className="shrink-0" />
                {step2Error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="sm:w-auto w-full">
                Zurück
              </Button>
              <Button
                onClick={handleSubmitPruefprotokoll}
                disabled={step2Submitting || !vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis}
                className="flex-1"
              >
                {step2Submitting ? 'Wird gespeichert…' : 'Prüfprotokoll speichern & weiter'}
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

      {/* ── Step 3: Status aktualisieren & Abschluss ── */}
      {step === 3 && (
        selectedAuftrag && protokollId ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Abschluss bestätigen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Überprüfe die Zusammenfassung und setze den finalen Status des Auftrags.
              </p>
            </div>

            {/* Auftrag summary */}
            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auftrag</p>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                  </p>
                  <p className="text-sm text-muted-foreground">{selectedAuftrag.kundeName}</p>
                  {selectedAuftrag.fields.auftragsbeschreibung && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{selectedAuftrag.fields.auftragsbeschreibung}</p>
                  )}
                </div>
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>
            </div>

            {/* Prüfprotokoll summary */}
            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prüfprotokoll</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Monteur</p>
                  <p className="font-medium">{vorname} {nachname}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Datum</p>
                  <p className="font-medium">{pruefungsdatum.replace('T', ' ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Ergebnis</p>
                  <p className="font-medium">
                    {PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                  </p>
                </div>
              </div>
            </div>

            {/* Final status selection */}
            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Neuer Auftragsstatus</p>
              <Select value={finalStatus} onValueChange={setFinalStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status wählen" />
                </SelectTrigger>
                <SelectContent>
                  {AUFTRAEGE_STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.key} value={opt.key}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {step3Error && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <IconAlertTriangle size={16} stroke={2} className="shrink-0" />
                {step3Error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="sm:w-auto w-full">
                Zurück
              </Button>
              <Button
                onClick={handleAbschliessen}
                disabled={step3Submitting || !finalStatus}
                className="flex-1"
              >
                {step3Submitting ? 'Wird abgeschlossen…' : 'Auftrag jetzt abschließen'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Eingaben aus den vorherigen Schritten.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
