/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag auswählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen → 3) Abschließen & bestätigen.
 * Reads: auftraege, kunden. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconFileCheck,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Step state — initialized from URL param
  const urlStep = parseInt(searchParams.get('step') ?? '', 10);
  const initialStep = urlStep >= 1 && urlStep <= 3 ? urlStep : 1;
  const [step, setStep] = useState(initialStep);

  // Step 1 — Auftrag selection
  const auftragIdFromUrl = searchParams.get('auftragId') ?? '';
  const [selectedAuftragId, setSelectedAuftragId] = useState(auftragIdFromUrl);

  // Step 2 — Prüfprotokoll form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? 'bestanden');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3 — result state (idempotency guard)
  const [protokollId, setProtokollId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Derive kundenMap for display
  const kundenMap = useMemo(() => {
    const m = new Map<string, string>();
    kunden.forEach(k => {
      const name = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
      if (name) m.set(k.record_id, name);
    });
    return m;
  }, [kunden]);

  // Filter: only offen or in_bearbeitung
  const eligibleAuftraege = useMemo(
    () =>
      auftraege.filter((a: Auftraege) => {
        const key = a.fields.status?.key ?? '';
        return key === 'offen' || key === 'in_bearbeitung';
      }),
    [auftraege]
  );

  const selectedAuftrag = useMemo(
    () => auftraege.find(a => a.record_id === selectedAuftragId) ?? null,
    [auftraege, selectedAuftragId]
  );

  // Step 1 — select an Auftrag
  const handleSelectAuftrag = (id: string) => {
    setSelectedAuftragId(id);
    setStep(2);
  };

  // Step 3 — save Prüfprotokoll + optionally update Auftrag status
  const handleAbschliessen = async () => {
    if (!selectedAuftragId) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Idempotency: only create the Prüfprotokoll if it hasn't been created yet
      let pid = protokollId;
      if (!pid) {
        const created = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
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

      // Update Auftrag status only when bestanden or bestanden_mit_maengeln
      if (pruefergebnis === 'bestanden' || pruefergebnis === 'bestanden_mit_maengeln') {
        await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
          status: 'abgeschlossen',
        });
      }
      // If nicht_bestanden: status stays in_bearbeitung — no update needed

      await fetchAll();
      setDone(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftragId('');
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? 'bestanden');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId('');
    setSaveError(null);
    setDone(false);
    setStep(1);
  };

  const step2Valid = vorname.trim() !== '' && nachname.trim() !== '' && pruefungsdatum !== '' && pruefergebnis !== '';

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag abschließen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1 — Auftrag auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map(a => {
            const kundeUrl = a.fields.kunde ?? '';
            const kundeId = kundeUrl.split('/').pop() ?? '';
            const kundeName = kundenMap.get(kundeId);
            return {
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: [
                a.fields.auftragsbeschreibung,
                a.fields.monteur ? `Monteur: ${a.fields.monteur}` : null,
                kundeName ? `Kunde: ${kundeName}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            };
          })}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftragsnummer, Beschreibung oder Monteur suchen..."
          emptyText="Keine offenen oder laufenden Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} />}
        />
      )}

      {/* Step 2 — Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-5">
            {/* Auftrag-Kontext */}
            <div className="rounded-2xl border bg-card p-4 flex items-start gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardCheck size={20} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </p>
                {selectedAuftrag.fields.auftragsbeschreibung && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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

            {/* Prüfer-Daten */}
            <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
              <h2 className="font-semibold text-sm text-foreground">Prüfer-Angaben</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname *</Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname *</Label>
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
            </div>

            {/* Prüfergebnis */}
            <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
              <h2 className="font-semibold text-sm text-foreground">Prüfergebnis *</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRUEFERGEBNIS_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPruefergebnis(opt.key)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      pruefergebnis === opt.key
                        ? opt.key === 'bestanden'
                          ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                          : opt.key === 'bestanden_mit_maengeln'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                          : 'border-red-500 bg-red-50 dark:bg-red-950/30'
                        : 'border-border bg-card hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {opt.key === 'bestanden' && (
                        <IconCircleCheck size={18} className={pruefergebnis === opt.key ? 'text-green-600' : 'text-muted-foreground'} />
                      )}
                      {opt.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={18} className={pruefergebnis === opt.key ? 'text-amber-600' : 'text-muted-foreground'} />
                      )}
                      {opt.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={18} className={pruefergebnis === opt.key ? 'text-red-600' : 'text-muted-foreground'} />
                      )}
                      <span className={`text-sm font-medium ${
                        pruefergebnis === opt.key
                          ? opt.key === 'bestanden'
                            ? 'text-green-700 dark:text-green-400'
                            : opt.key === 'bestanden_mit_maengeln'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-red-700 dark:text-red-400'
                          : 'text-foreground'
                      }`}>
                        {opt.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Optionale Felder */}
            <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
              <h2 className="font-semibold text-sm text-foreground">Weitere Details (optional)</h2>
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
                  placeholder="Eingeleitete oder empfohlene Maßnahmen..."
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Weitere Bemerkungen..."
                  rows={2}
                />
              </div>
            </div>

            {/* Navigation */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="w-full sm:w-auto">
                Zurück
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!step2Valid}
                className="w-full sm:flex-1"
              >
                Weiter zur Zusammenfassung
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

      {/* Step 3 — Zusammenfassung & Abschließen */}
      {step === 3 && (
        selectedAuftrag && vorname && nachname ? (
          done ? (
            /* Success state */
            <div className="space-y-5">
              <div className="rounded-2xl border bg-card p-8 flex flex-col items-center text-center gap-4 overflow-hidden">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  pruefergebnis === 'nicht_bestanden' ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-green-100 dark:bg-green-950/40'
                }`}>
                  {pruefergebnis === 'nicht_bestanden'
                    ? <IconAlertTriangle size={28} className="text-amber-600" />
                    : <IconCircleCheck size={28} className="text-green-600" />
                  }
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {pruefergebnis === 'nicht_bestanden'
                      ? 'Prüfprotokoll gespeichert'
                      : 'Auftrag erfolgreich abgeschlossen'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {pruefergebnis === 'nicht_bestanden'
                      ? 'Der Auftrag bleibt zur Nachbesserung in Bearbeitung.'
                      : pruefergebnis === 'bestanden_mit_maengeln'
                      ? 'Auftrag abgeschlossen — Mängel wurden dokumentiert.'
                      : 'Das Prüfprotokoll wurde gespeichert und der Status aktualisiert.'}
                  </p>
                </div>
                <div className="w-full rounded-xl border bg-secondary/50 p-4 text-left space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Auftrag</span>
                    <span className="font-medium truncate ml-2">
                      {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Prüfer</span>
                    <span className="font-medium">{vorname} {nachname}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Ergebnis</span>
                    <span className="font-medium">
                      {PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button variant="outline" onClick={handleReset} className="w-full sm:w-auto">
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/" className="flex-1">
                  <Button className="w-full">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            /* Confirmation state */
            <div className="space-y-5">
              {/* Zusammenfassung */}
              <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
                <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <IconFileCheck size={16} className="text-primary" />
                  Zusammenfassung
                </h2>

                <div className="space-y-3">
                  <div className="rounded-xl border bg-secondary/50 p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auftrag</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                      </span>
                      {selectedAuftrag.fields.status && (
                        <StatusBadge
                          statusKey={selectedAuftrag.fields.status.key}
                          label={selectedAuftrag.fields.status.label}
                        />
                      )}
                    </div>
                    {selectedAuftrag.fields.auftragsbeschreibung && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {selectedAuftrag.fields.auftragsbeschreibung}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border bg-secondary/50 p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prüfprotokoll</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Prüfer</span>
                      <span className="font-medium text-right">{vorname} {nachname}</span>
                      <span className="text-muted-foreground">Datum</span>
                      <span className="font-medium text-right">
                        {pruefungsdatum
                          ? format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm', { locale: de })
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Prüfergebnis — prominent */}
                  <div className={`rounded-xl border p-4 ${
                    pruefergebnis === 'bestanden'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                      : pruefergebnis === 'bestanden_mit_maengeln'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                      : 'border-red-500 bg-red-50 dark:bg-red-950/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {pruefergebnis === 'bestanden' && <IconCircleCheck size={20} className="text-green-600 shrink-0" />}
                      {pruefergebnis === 'bestanden_mit_maengeln' && <IconAlertTriangle size={20} className="text-amber-600 shrink-0" />}
                      {pruefergebnis === 'nicht_bestanden' && <IconAlertTriangle size={20} className="text-red-600 shrink-0" />}
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm ${
                          pruefergebnis === 'bestanden' ? 'text-green-700 dark:text-green-400'
                          : pruefergebnis === 'bestanden_mit_maengeln' ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-700 dark:text-red-400'
                        }`}>
                          {PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                        </p>
                        {maengelbeschreibung && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{maengelbeschreibung}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Info-Hinweis je nach Ergebnis */}
                  <div className={`rounded-xl border p-3 flex items-start gap-2 ${
                    pruefergebnis === 'nicht_bestanden'
                      ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20'
                  }`}>
                    <IconInfoCircle size={16} className={`shrink-0 mt-0.5 ${
                      pruefergebnis === 'nicht_bestanden' ? 'text-amber-600' : 'text-blue-600'
                    }`} />
                    <p className="text-xs text-muted-foreground">
                      {pruefergebnis === 'bestanden'
                        ? 'Der Auftrag wird auf "Abgeschlossen" gesetzt.'
                        : pruefergebnis === 'bestanden_mit_maengeln'
                        ? 'Der Auftrag wird auf "Abgeschlossen" gesetzt. Die Mängel sind im Protokoll dokumentiert.'
                        : 'Der Auftrag bleibt im Status "In Bearbeitung" — eine Nachbesserung ist erforderlich.'}
                    </p>
                  </div>
                </div>
              </div>

              {saveError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                  <IconAlertTriangle size={15} className="shrink-0" />
                  {saveError}
                </div>
              )}

              {/* Navigation */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={saving}
                  className="w-full sm:w-auto"
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleAbschliessen}
                  disabled={saving}
                  className="w-full sm:flex-1"
                >
                  {saving
                    ? 'Wird gespeichert...'
                    : pruefergebnis === 'nicht_bestanden'
                    ? 'Protokoll speichern'
                    : 'Auftrag abschließen'}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht die Angaben aus Schritt 1 und 2.
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
