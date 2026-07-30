/**
 * AuftragAbschliessenPage — Auftrag abschließen & Prüfprotokoll erstellen.
 * Schritte: 1) Auftrag wählen → 2) Prüfprotokoll erfassen → 3) Zusammenfassung.
 * Reads: auftraege, kunden. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { IconClipboardCheck, IconCheck, IconAlertTriangle, IconX } from '@tabler/icons-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Auftraege } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfprotokoll' },
  { label: 'Zusammenfassung' },
];

type PruefergebnisKey = 'nicht_bestanden' | 'bestanden_mit_maengeln' | 'bestanden';

interface SummaryData {
  auftragsnummer: string;
  kundeLabel: string;
  monteurVorname: string;
  monteurNachname: string;
  pruefungsdatum: string;
  pruefergebnis: PruefergebnisKey;
  maengelbeschreibung: string;
  massnahmen: string;
  bemerkungen: string;
}

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();
  const [searchParams, setSearchParams] = useSearchParams();

  // Step state — initialize from URL
  const [step, setStep] = useState<number>(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    return urlStep >= 1 && urlStep <= 3 ? urlStep : 1;
  });

  // Step 1 state
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Step 2 form state
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [pruefergebnis, setPruefergebnis] = useState<PruefergebnisKey | ''>('');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 3 summary state
  const [summary, setSummary] = useState<SummaryData | null>(null);

  // Deep-link: auftragId pre-selects the order and jumps to step 2
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (auftragId && auftraege.length > 0 && !selectedAuftrag) {
      const found = auftraege.find(a => a.record_id === auftragId);
      if (found) {
        setSelectedAuftrag(found);
        setStep(2);
      }
    }
  }, [auftraege, searchParams, selectedAuftrag]);

  // Keep URL in sync with step
  const handleStepChange = (newStep: number) => {
    setStep(newStep);
    const params = new URLSearchParams(searchParams);
    if (newStep > 1) {
      params.set('step', String(newStep));
    } else {
      params.delete('step');
    }
    setSearchParams(params, { replace: true });
  };

  // Filter auftraege: exclude abgeschlossen and storniert
  const offeneAuftraege = auftraege.filter(
    a => a.fields.status?.key !== 'abgeschlossen' && a.fields.status?.key !== 'storniert'
  );

  // Resolve kunde label from applookup URL
  const resolveKundeLabel = (auftrag: Auftraege): string => {
    if (!auftrag.fields.kunde) return '';
    const kundeId = extractRecordId(auftrag.fields.kunde);
    if (!kundeId) return '';
    const kunde = kundenMap.get(kundeId);
    if (!kunde) return '';
    const parts = [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : (kunde.fields.firma ?? '');
  };

  const handleSelectAuftrag = (id: string) => {
    const found = auftraege.find(a => a.record_id === id);
    if (found) {
      setSelectedAuftrag(found);
      const params = new URLSearchParams(searchParams);
      params.set('auftragId', id);
      setSearchParams(params, { replace: true });
      handleStepChange(2);
    }
  };

  const handleSubmitProtokoll = async () => {
    if (!selectedAuftrag || !pruefergebnis) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: monteurVorname,
        monteur_name_nachname: monteurNachname,
        pruefungsdatum: pruefungsdatum,
        pruefergebnis: pruefergebnis,
        maengelbeschreibung: maengelbeschreibung || undefined,
        massnahmen: massnahmen || undefined,
        bemerkungen_pruef: bemerkungenPruef || undefined,
      });

      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: 'abgeschlossen',
      });

      await fetchAll();

      setSummary({
        auftragsnummer: selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id,
        kundeLabel: resolveKundeLabel(selectedAuftrag),
        monteurVorname,
        monteurNachname,
        pruefungsdatum,
        pruefergebnis: pruefergebnis as PruefergebnisKey,
        maengelbeschreibung,
        massnahmen,
        bemerkungen: bemerkungenPruef,
      });

      handleStepChange(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftrag(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis('');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setSubmitError(null);
    setSummary(null);
    const params = new URLSearchParams();
    setSearchParams(params, { replace: true });
    setStep(1);
  };

  const pruefergebnisConfig: Record<PruefergebnisKey, { label: string; icon: React.ReactNode; bg: string; border: string; text: string }> = {
    bestanden: {
      label: 'Bestanden',
      icon: <IconCheck size={20} stroke={2.5} />,
      bg: 'bg-green-50',
      border: 'border-green-400',
      text: 'text-green-700',
    },
    bestanden_mit_maengeln: {
      label: 'Bestanden mit Mängeln',
      icon: <IconAlertTriangle size={20} stroke={2.5} />,
      bg: 'bg-yellow-50',
      border: 'border-yellow-400',
      text: 'text-yellow-700',
    },
    nicht_bestanden: {
      label: 'Nicht bestanden',
      icon: <IconX size={20} stroke={2.5} />,
      bg: 'bg-red-50',
      border: 'border-red-400',
      text: 'text-red-700',
    },
  };

  const showMaengel = pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  const step2Valid =
    monteurVorname.trim() !== '' &&
    monteurNachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnis !== '';

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftrag als abgeschlossen markieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={handleStepChange}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Auftrag wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={offeneAuftraege.map(a => {
            const kundeLabel = resolveKundeLabel(a);
            return {
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: [
                a.fields.auftragsbeschreibung
                  ? a.fields.auftragsbeschreibung.length > 80
                    ? a.fields.auftragsbeschreibung.slice(0, 80) + '…'
                    : a.fields.auftragsbeschreibung
                  : null,
                kundeLabel ? `Kunde: ${kundeLabel}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              stats: [],
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            };
          })}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftrag suchen..."
          emptyText="Keine offenen Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} />}
        />
      )}

      {/* Step 2: Prüfprotokoll erfassen */}
      {step === 2 && selectedAuftrag && (
        <div className="space-y-5">
          {/* Selected order summary */}
          <div className="rounded-2xl border bg-card p-4 space-y-1 overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">
                {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
              </span>
              {selectedAuftrag.fields.status && (
                <StatusBadge
                  statusKey={selectedAuftrag.fields.status.key}
                  label={selectedAuftrag.fields.status.label}
                />
              )}
            </div>
            {resolveKundeLabel(selectedAuftrag) && (
              <p className="text-xs text-muted-foreground">
                Kunde: {resolveKundeLabel(selectedAuftrag)}
              </p>
            )}
            {selectedAuftrag.fields.auftragsbeschreibung && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {selectedAuftrag.fields.auftragsbeschreibung}
              </p>
            )}
          </div>

          {/* Form */}
          <div className="rounded-2xl border bg-card p-5 space-y-5 overflow-hidden">
            <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>

            {/* Monteur */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="monteur-vorname">
                  Vorname des Monteurs <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="monteur-vorname"
                  value={monteurVorname}
                  onChange={e => setMonteurVorname(e.target.value)}
                  placeholder="z. B. Max"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monteur-nachname">
                  Nachname des Monteurs <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="monteur-nachname"
                  value={monteurNachname}
                  onChange={e => setMonteurNachname(e.target.value)}
                  placeholder="z. B. Mustermann"
                />
              </div>
            </div>

            {/* Prüfungsdatum */}
            <div className="space-y-1.5">
              <Label htmlFor="pruefungsdatum">
                Prüfungsdatum <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={e => setPruefungsdatum(e.target.value)}
                className="max-w-xs"
              />
            </div>

            {/* Prüfergebnis — tile buttons */}
            <div className="space-y-2">
              <Label>
                Prüfergebnis <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(Object.keys(pruefergebnisConfig) as PruefergebnisKey[]).map(key => {
                  const cfg = pruefergebnisConfig[key];
                  const isSelected = pruefergebnis === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPruefergebnis(key)}
                      className={`flex items-center gap-2.5 p-4 rounded-xl border-2 transition-all text-left w-full ${
                        isSelected
                          ? `${cfg.bg} ${cfg.border} ${cfg.text} font-semibold`
                          : 'bg-card border-muted hover:border-primary/40 text-foreground'
                      }`}
                    >
                      <span className={`shrink-0 ${isSelected ? cfg.text : 'text-muted-foreground'}`}>
                        {cfg.icon}
                      </span>
                      <span className="text-sm leading-tight">{cfg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mängelbeschreibung — only when relevant */}
            {showMaengel && (
              <div className="space-y-1.5">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={e => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibe die festgestellten Mängel..."
                  rows={3}
                />
              </div>
            )}

            {/* Maßnahmen — only when Mängelbeschreibung is filled */}
            {showMaengel && maengelbeschreibung.trim() !== '' && (
              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Welche Maßnahmen wurden eingeleitet oder sind erforderlich?"
                  rows={3}
                />
              </div>
            )}

            {/* Bemerkungen */}
            <div className="space-y-1.5">
              <Label htmlFor="bemerkungen-pruef">Bemerkungen (optional)</Label>
              <Textarea
                id="bemerkungen-pruef"
                value={bemerkungenPruef}
                onChange={e => setBemerkungenPruef(e.target.value)}
                placeholder="Weitere Hinweise zur Prüfung..."
                rows={2}
              />
            </div>

            {/* Error */}
            {submitError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 flex-wrap pt-1">
              <Button
                onClick={handleSubmitProtokoll}
                disabled={!step2Valid || submitting}
                className="min-w-[200px]"
              >
                {submitting ? 'Wird gespeichert...' : 'Prüfprotokoll speichern & Auftrag abschließen'}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleStepChange(1)}
                disabled={submitting}
              >
                Zurück
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Zusammenfassung */}
      {step === 3 && summary && (
        <div className="space-y-5">
          {/* Success banner */}
          <div className="rounded-2xl bg-green-50 border border-green-200 p-5 flex items-start gap-4 overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
              <IconCheck size={20} className="text-green-700" stroke={2.5} />
            </div>
            <div>
              <h2 className="font-semibold text-green-800 text-base">Auftrag erfolgreich abgeschlossen</h2>
              <p className="text-sm text-green-700 mt-0.5">
                Das Prüfprotokoll wurde erstellt und der Auftrag als abgeschlossen markiert.
              </p>
            </div>
          </div>

          {/* Summary card */}
          <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Zusammenfassung</h3>

            <div className="space-y-3">
              {/* Auftrag */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{summary.auftragsnummer}</span>
                  <StatusBadge statusKey="abgeschlossen" label="Abgeschlossen" />
                </div>
              </div>

              {summary.kundeLabel && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Kunde</span>
                  <span className="font-medium text-sm">{summary.kundeLabel}</span>
                </div>
              )}

              <div className="border-t" />

              {/* Monteur */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Monteur</span>
                <span className="font-medium text-sm">{summary.monteurVorname} {summary.monteurNachname}</span>
              </div>

              {/* Prüfungsdatum */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Prüfungsdatum</span>
                <span className="font-medium text-sm">
                  {summary.pruefungsdatum
                    ? format(new Date(summary.pruefungsdatum), 'dd.MM.yyyy HH:mm')
                    : '—'}
                </span>
              </div>

              {/* Prüfergebnis */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    summary.pruefergebnis === 'bestanden'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : summary.pruefergebnis === 'bestanden_mit_maengeln'
                      ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      : 'bg-red-100 text-red-700 border-red-200'
                  }`}
                >
                  {summary.pruefergebnis === 'bestanden' && <IconCheck size={12} stroke={2.5} />}
                  {summary.pruefergebnis === 'bestanden_mit_maengeln' && <IconAlertTriangle size={12} stroke={2.5} />}
                  {summary.pruefergebnis === 'nicht_bestanden' && <IconX size={12} stroke={2.5} />}
                  {pruefergebnisConfig[summary.pruefergebnis].label}
                </span>
              </div>

              {/* Mängelbeschreibung */}
              {summary.maengelbeschreibung && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Mängelbeschreibung</span>
                  <p className="text-sm bg-secondary rounded-lg p-3">{summary.maengelbeschreibung}</p>
                </div>
              )}

              {/* Maßnahmen */}
              {summary.massnahmen && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Maßnahmen</span>
                  <p className="text-sm bg-secondary rounded-lg p-3">{summary.massnahmen}</p>
                </div>
              )}

              {/* Bemerkungen */}
              {summary.bemerkungen && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Bemerkungen</span>
                  <p className="text-sm bg-secondary rounded-lg p-3">{summary.bemerkungen}</p>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleReset} variant="outline">
              Weiteren Auftrag abschließen
            </Button>
            <a href="#/">
              <Button variant="default">Zurück zum Dashboard</Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
