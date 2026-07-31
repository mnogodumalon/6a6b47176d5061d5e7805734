/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll anlegen →
 *        3) Bestätigen & Auftragsstatus setzen.
 * Reads: auftraege, kunden (via kundenMap). Writes: pruefprotokoll (createPruefprotokollEntry),
 *        auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconChevronRight,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1 state
  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);

  // Step 2 state
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnisKey, setPruefergebnisKey] = useState(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3 state
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string>('');

  // Enrich auftraege with kundeName
  const enrichedAuftraege = useMemo((): EnrichedAuftraege[] => {
    return auftraege.map(a => {
      const kundeId = extractRecordId(a.fields.kunde ?? null);
      const kunde = kundeId ? kundenMap.get(kundeId) : undefined;
      const kundeName = kunde
        ? [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ')
        : '';
      return { ...a, kundeName };
    });
  }, [auftraege, kundenMap, kunden]);

  // Only show eligible auftraege (offen or in_bearbeitung)
  const eligibleAuftraege = useMemo(() => {
    return enrichedAuftraege.filter(a => {
      const key = a.fields.status?.key;
      return key === 'offen' || key === 'in_bearbeitung';
    });
  }, [enrichedAuftraege]);

  const handleAuftragSelect = (id: string) => {
    const found = eligibleAuftraege.find(a => a.record_id === id);
    if (found) {
      setSelectedAuftrag(found);
      setStep(2);
    }
  };

  const pruefungsdatumValid = pruefungsdatum.length > 0;
  const step2Valid =
    monteurVorname.trim().length > 0 &&
    monteurNachname.trim().length > 0 &&
    pruefungsdatumValid &&
    pruefergebnisKey.length > 0;

  const handleCreateProtokollAndProceed = async () => {
    if (!selectedAuftrag || !step2Valid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: monteurVorname.trim(),
        monteur_name_nachname: monteurNachname.trim(),
        pruefungsdatum: pruefungsdatum,
        pruefergebnis: pruefergebnisKey,
        maengelbeschreibung:
          pruefergebnisKey === 'nicht_bestanden' || pruefergebnisKey === 'bestanden_mit_maengeln'
            ? maengelbeschreibung.trim() || undefined
            : undefined,
        massnahmen:
          pruefergebnisKey !== 'bestanden'
            ? massnahmen.trim() || undefined
            : undefined,
        bemerkungen_pruef: bemerkungen.trim() || undefined,
      });
      setProtokollId(result.record_id);
      await fetchAll();
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Prüfprotokolls');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAbschliessen = async () => {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);

    const nextStatus =
      pruefergebnisKey === 'bestanden' || pruefergebnisKey === 'bestanden_mit_maengeln'
        ? 'abgeschlossen'
        : 'in_bearbeitung';

    try {
      // Guard: create protokoll if not yet created (retry safety)
      let pid = protokollId;
      if (!pid) {
        const result = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: monteurVorname.trim(),
          monteur_name_nachname: monteurNachname.trim(),
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnisKey,
          maengelbeschreibung:
            pruefergebnisKey === 'nicht_bestanden' || pruefergebnisKey === 'bestanden_mit_maengeln'
              ? maengelbeschreibung.trim() || undefined
              : undefined,
          massnahmen:
            pruefergebnisKey !== 'bestanden'
              ? massnahmen.trim() || undefined
              : undefined,
          bemerkungen_pruef: bemerkungen.trim() || undefined,
        });
        pid = result.record_id;
        setProtokollId(pid);
      }

      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: nextStatus,
      });
      setFinalStatus(nextStatus);
      await fetchAll();
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Abschließen des Auftrags');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftrag(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum('');
    setPruefergebnisKey(PRUEFERGEBNIS_OPTIONS[2]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setDone(false);
    setFinalStatus('');
    setStep(1);
  };

  if (done && selectedAuftrag) {
    const ergebnisOption = PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnisKey);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-card rounded-2xl shadow-lg overflow-hidden p-8 space-y-6 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <IconCircleCheck size={40} className="text-primary" stroke={1.5} />
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Auftrag abgeschlossen</h2>
            <p className="text-muted-foreground mt-1">
              Auftrag <span className="font-semibold text-foreground">{selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}</span> wurde erfolgreich bearbeitet.
            </p>
          </div>
          <div className="bg-secondary rounded-xl p-4 space-y-3 text-left">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Auftragsnummer</span>
              <span className="text-sm font-medium">{selectedAuftrag.fields.auftragsnummer ?? '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Prüfergebnis</span>
              <StatusBadge statusKey={pruefergebnisKey} label={ergebnisOption?.label ?? pruefergebnisKey} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Neuer Status</span>
              {finalStatus === 'abgeschlossen' ? (
                <StatusBadge statusKey="abgeschlossen" label="Abgeschlossen" />
              ) : (
                <StatusBadge statusKey="in_bearbeitung" label="In Bearbeitung" />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <Button onClick={handleReset} className="w-full">
              Weiteren Auftrag abschließen
            </Button>
            <a href="#/" className="block w-full">
              <Button variant="outline" className="w-full">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll anlegen und Auftrag abschließen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* SCHRITT 1: Auftrag wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
            subtitle: [
              a.kundeName ? `Kunde: ${a.kundeName}` : null,
              a.fields.auftragsdatum ? `Datum: ${formatDate(a.fields.auftragsdatum)}` : null,
            ].filter(Boolean).join(' · '),
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            icon: <IconClipboardCheck size={20} className="text-primary" stroke={1.5} />,
          }))}
          onSelect={handleAuftragSelect}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen oder in Bearbeitung befindlichen Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" stroke={1.5} />}
        />
      )}

      {/* SCHRITT 2: Prüfprotokoll anlegen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-5 max-w-2xl mx-auto">
            {/* Context card */}
            <div className="bg-secondary rounded-xl p-4 flex items-start gap-3">
              <IconClipboardCheck size={20} className="text-primary mt-0.5 shrink-0" stroke={1.5} />
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </p>
                {selectedAuftrag.kundeName && (
                  <p className="text-sm text-muted-foreground">{selectedAuftrag.kundeName}</p>
                )}
              </div>
              <div className="ml-auto shrink-0">
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>
            </div>

            {/* Monteur */}
            <div className="bg-card rounded-2xl border p-5 space-y-4">
              <h3 className="font-semibold text-foreground">Monteur</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="monteur-vorname">Vorname *</Label>
                  <Input
                    id="monteur-vorname"
                    value={monteurVorname}
                    onChange={e => setMonteurVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monteur-nachname">Nachname *</Label>
                  <Input
                    id="monteur-nachname"
                    value={monteurNachname}
                    onChange={e => setMonteurNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>
            </div>

            {/* Prüfung */}
            <div className="bg-card rounded-2xl border p-5 space-y-4">
              <h3 className="font-semibold text-foreground">Prüfung</h3>
              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum &amp; -uhrzeit *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pruefergebnis">Prüfergebnis *</Label>
                <Select value={pruefergebnisKey} onValueChange={setPruefergebnisKey}>
                  <SelectTrigger id="pruefergebnis" className="w-full">
                    <SelectValue placeholder="Ergebnis wählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRUEFERGEBNIS_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Mängelbeschreibung — nur bei Mängeln / nicht bestanden */}
              {(pruefergebnisKey === 'nicht_bestanden' || pruefergebnisKey === 'bestanden_mit_maengeln') && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengelbeschreibung"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibe die festgestellten Mängel …"
                    rows={3}
                  />
                </div>
              )}

              {/* Maßnahmen — wenn nicht "bestanden" */}
              {pruefergebnisKey !== 'bestanden' && (
                <div className="space-y-1.5">
                  <Label htmlFor="massnahmen">Maßnahmen</Label>
                  <Textarea
                    id="massnahmen"
                    value={massnahmen}
                    onChange={e => setMassnahmen(e.target.value)}
                    placeholder="Welche Maßnahmen sind erforderlich? …"
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Weitere Bemerkungen …"
                  rows={2}
                />
              </div>
            </div>

            {submitError && (
              <div className="bg-destructive/10 rounded-xl p-3 flex items-start gap-2">
                <IconAlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" stroke={1.5} />
                <p className="text-sm text-destructive">{submitError}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="sm:w-auto w-full"
              >
                Zurück
              </Button>
              <Button
                onClick={handleCreateProtokollAndProceed}
                disabled={!step2Valid || submitting}
                className="sm:flex-1 w-full"
              >
                {submitting ? 'Wird gespeichert …' : (
                  <>Weiter zur Bestätigung <IconChevronRight size={16} stroke={2} /></>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen ausgewählten Auftrag aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* SCHRITT 3: Bestätigen & abschließen */}
      {step === 3 && (
        selectedAuftrag ? (
          <div className="space-y-5 max-w-2xl mx-auto">
            {/* Summary card */}
            <div className="bg-card rounded-2xl border p-5 space-y-4">
              <h3 className="font-semibold text-foreground">Zusammenfassung</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                  <span className="text-sm font-medium">
                    {selectedAuftrag.fields.auftragsnummer ?? '—'}
                  </span>
                </div>
                {selectedAuftrag.kundeName && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Kunde</span>
                    <span className="text-sm font-medium">{selectedAuftrag.kundeName}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Aktueller Status</span>
                  {selectedAuftrag.fields.status && (
                    <StatusBadge
                      statusKey={selectedAuftrag.fields.status.key}
                      label={selectedAuftrag.fields.status.label}
                    />
                  )}
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Monteur</span>
                    <span className="text-sm font-medium">
                      {monteurVorname} {monteurNachname}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Prüfungsdatum</span>
                  <span className="text-sm font-medium">
                    {pruefungsdatum
                      ? format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm')
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                  <StatusBadge
                    statusKey={pruefergebnisKey}
                    label={PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnisKey)?.label ?? pruefergebnisKey}
                  />
                </div>
              </div>
            </div>

            {/* Result-dependent info & action */}
            {pruefergebnisKey === 'nicht_bestanden' && (
              <div className="bg-destructive/10 rounded-xl p-4 flex items-start gap-3">
                <IconAlertTriangle size={20} className="text-destructive mt-0.5 shrink-0" stroke={1.5} />
                <div>
                  <p className="text-sm font-semibold text-destructive">Nicht bestanden</p>
                  <p className="text-sm text-destructive/80 mt-0.5">
                    Der Auftrag wird auf „In Bearbeitung" gesetzt. Die Mängel müssen behoben werden.
                  </p>
                </div>
              </div>
            )}

            {pruefergebnisKey === 'bestanden_mit_maengeln' && (
              <div className="bg-amber-500/10 rounded-xl p-4 flex items-start gap-3">
                <IconAlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" stroke={1.5} />
                <div>
                  <p className="text-sm font-semibold text-amber-700">Bestanden mit Mängeln</p>
                  <p className="text-sm text-amber-700/80 mt-0.5">
                    Der Auftrag wird trotzdem abgeschlossen. Die Mängel wurden dokumentiert.
                  </p>
                </div>
              </div>
            )}

            {pruefergebnisKey === 'bestanden' && (
              <div className="bg-primary/10 rounded-xl p-4 flex items-start gap-3">
                <IconCircleCheck size={20} className="text-primary mt-0.5 shrink-0" stroke={1.5} />
                <div>
                  <p className="text-sm font-semibold text-primary">Bestanden</p>
                  <p className="text-sm text-primary/80 mt-0.5">
                    Die Prüfung ist erfolgreich. Der Auftrag wird auf „Abgeschlossen" gesetzt.
                  </p>
                </div>
              </div>
            )}

            {submitError && (
              <div className="bg-destructive/10 rounded-xl p-3 flex items-start gap-2">
                <IconAlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" stroke={1.5} />
                <p className="text-sm text-destructive">{submitError}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="sm:w-auto w-full"
                disabled={submitting}
              >
                Zurück
              </Button>

              {pruefergebnisKey === 'nicht_bestanden' ? (
                <Button
                  variant="destructive"
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="sm:flex-1 w-full"
                >
                  {submitting ? 'Wird verarbeitet …' : 'Auftrag zurücksetzen auf „In Bearbeitung"'}
                </Button>
              ) : pruefergebnisKey === 'bestanden_mit_maengeln' ? (
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="sm:flex-1 w-full"
                >
                  {submitting ? 'Wird abgeschlossen …' : 'Auftrag abschließen (mit Mängeln)'}
                </Button>
              ) : (
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="sm:flex-1 w-full"
                >
                  {submitting ? 'Wird abgeschlossen …' : 'Auftrag abschließen'}
                </Button>
              )}
            </div>
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
