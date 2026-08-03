/**
 * Auftrag abschließen — 4-Schritt-Wizard.
 * Steps: 1) Auftrag auswählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen →
 *        3) Auftrag abschließen (Bestätigung mit Zusammenfassung) → 4) Fertig.
 * Reads: auftraege, kunden (via kundenMap). Writes: pruefprotokoll (createPruefprotokollEntry),
 *        auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { lookupKey, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconRefresh,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
  { label: 'Fertig' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1: selected Auftrag
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2: Prüfprotokoll form
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnisKey, setPruefergebnisKey] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Step 3: submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [protokollId, setProtokollId] = useState<string | null>(null);

  // Step 4: summary
  const [closedAuftragsnummer, setClosedAuftragsnummer] = useState<string | null>(null);
  const [closedPruefergebnis, setClosedPruefergebnis] = useState<string | null>(null);
  const [closedPruefergebnisLabel, setClosedPruefergebnisLabel] = useState<string | null>(null);

  // Filter auftraege to only offen or in_bearbeitung
  const eligibleAuftraege = useMemo<Auftraege[]>(() => {
    return auftraege.filter(a => {
      const key = lookupKey(a.fields.status);
      return key === 'offen' || key === 'in_bearbeitung';
    });
  }, [auftraege]);

  const selectedAuftrag = useMemo(
    () => (selectedAuftragId ? auftraege.find(a => a.record_id === selectedAuftragId) ?? null : null),
    [selectedAuftragId, auftraege]
  );

  const selectedKunde = useMemo(() => {
    if (!selectedAuftrag?.fields.kunde) return null;
    const match = selectedAuftrag.fields.kunde.match(/([a-f0-9]{24})$/i);
    if (!match) return null;
    return kundenMap.get(match[1]) ?? null;
  }, [selectedAuftrag, kundenMap]);

  const kundeName = selectedKunde
    ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') ||
      selectedKunde.fields.firma ||
      '—'
    : '—';

  function handleSelectAuftrag(id: string) {
    setSelectedAuftragId(id);
    setStep(2);
  }

  function handleReset() {
    setStep(1);
    setSelectedAuftragId(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnisKey(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setSubmitting(false);
    setSubmitError(null);
    setProtokollId(null);
    setClosedAuftragsnummer(null);
    setClosedPruefergebnis(null);
    setClosedPruefergebnisLabel(null);
  }

  const pruefStep2Valid =
    vorname.trim() !== '' &&
    nachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnisKey !== '';

  const showMaengel =
    pruefergebnisKey === 'nicht_bestanden' || pruefergebnisKey === 'bestanden_mit_maengeln';

  async function handleAbschliessen() {
    if (!selectedAuftragId || !selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotent: create Prüfprotokoll only once even on retry
      let pid = protokollId;
      if (!pid) {
        const pruefResult = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnisKey,
          maengelbeschreibung: showMaengel ? maengelbeschreibung.trim() || undefined : undefined,
          massnahmen: massnahmen.trim() || undefined,
          bemerkungen_pruef: bemerkungen.trim() || undefined,
        });
        pid = pruefResult.record_id;
        setProtokollId(pid);
      }

      // Update Auftrag status to abgeschlossen
      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
        status: 'abgeschlossen',
      });

      await fetchAll();

      const ergebnisLabel =
        PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnisKey)?.label ?? pruefergebnisKey;
      setClosedAuftragsnummer(selectedAuftrag.fields.auftragsnummer ?? '—');
      setClosedPruefergebnis(pruefergebnisKey);
      setClosedPruefergebnisLabel(ergebnisLabel);
      setStep(4);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Ein unbekannter Fehler ist aufgetreten.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag als abgeschlossen markieren"
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
          <div className="rounded-2xl border bg-card p-4 overflow-hidden">
            <h2 className="font-semibold text-base mb-1">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Nur offene und in Bearbeitung befindliche Aufträge können abgeschlossen werden.
            </p>
            <EntitySelectStep
              searchPlaceholder="Auftragsnummer oder Monteur suchen..."
              emptyText="Keine offenen Aufträge gefunden."
              emptyIcon={<IconClipboardCheck size={32} />}
              items={eligibleAuftraege.map(a => {
                const sKey = lookupKey(a.fields.status);
                const sLabel =
                  LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === sKey)?.label ??
                  sKey ??
                  '';
                const pKey = lookupKey(a.fields.prioritaet);
                const pLabel =
                  LOOKUP_OPTIONS['auftraege']?.['prioritaet']?.find(o => o.key === pKey)?.label ??
                  '';
                const kundeRecord = (() => {
                  const m = a.fields.kunde?.match(/([a-f0-9]{24})$/i);
                  return m ? kundenMap.get(m[1]) : undefined;
                })();
                const kundeText = kundeRecord
                  ? [kundeRecord.fields.vorname, kundeRecord.fields.nachname]
                      .filter(Boolean)
                      .join(' ') ||
                    kundeRecord.fields.firma ||
                    ''
                  : '';
                return {
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
                  subtitle: [
                    kundeText,
                    a.fields.auftragsdatum ? formatDate(a.fields.auftragsdatum) : '',
                    a.fields.monteur ? `Monteur: ${a.fields.monteur}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  status: sKey ? { key: sKey, label: sLabel } : undefined,
                  stats: pLabel ? [{ label: 'Priorität', value: pLabel }] : undefined,
                  icon: <IconClipboardCheck size={20} className="text-primary" />,
                };
              })}
              onSelect={handleSelectAuftrag}
            />
          </div>
        </div>
      )}

      {/* ── Step 2: Prüfprotokoll erfassen ── */}
      {step === 2 && (
        selectedAuftragId ? (
          <div className="space-y-4">
            {/* Context card */}
            <div className="rounded-2xl border bg-secondary/40 p-4 overflow-hidden">
              <p className="text-xs text-muted-foreground mb-1">Gewählter Auftrag</p>
              <p className="font-semibold text-sm">
                {selectedAuftrag?.fields.auftragsnummer ?? selectedAuftragId}
              </p>
              {kundeName !== '—' && (
                <p className="text-xs text-muted-foreground">{kundeName}</p>
              )}
            </div>

            {/* Form */}
            <div className="rounded-2xl border bg-card p-4 space-y-4 overflow-hidden">
              <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="vorname">Vorname Monteur *</Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nachname">Nachname Monteur *</Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum &amp; Uhrzeit *</Label>
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
                      onClick={() => setPruefergebnisKey(opt.key)}
                      className={`text-left rounded-xl border p-3 text-sm font-medium transition-colors ${
                        pruefergebnisKey === opt.key
                          ? opt.key === 'bestanden'
                            ? 'bg-green-100 text-green-700 border-green-300'
                            : opt.key === 'nicht_bestanden'
                            ? 'bg-red-100 text-red-700 border-red-300'
                            : 'bg-amber-100 text-amber-700 border-amber-300'
                          : 'bg-card hover:bg-accent border-border'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {showMaengel && (
                <div className="space-y-1">
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

              <div className="space-y-1">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Eingeleitete oder empfohlene Maßnahmen..."
                  rows={2}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Weitere Bemerkungen zur Prüfung..."
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
              <Button
                disabled={!pruefStep2Valid}
                onClick={() => setStep(3)}
              >
                Weiter zur Bestätigung
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt setzt einen ausgewählten Auftrag voraus.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ── Step 3: Bestätigung & Abschließen ── */}
      {step === 3 && (
        selectedAuftragId ? (
          <div className="space-y-4">
            {/* Summary card */}
            <div className="rounded-2xl border bg-card p-5 space-y-3 overflow-hidden">
              <h2 className="font-semibold text-base">Zusammenfassung</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Auftragsnummer</p>
                  <p className="font-medium">
                    {selectedAuftrag?.fields.auftragsnummer ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Kunde</p>
                  <p className="font-medium">{kundeName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Auftragsdatum</p>
                  <p className="font-medium">
                    {formatDate(selectedAuftrag?.fields.auftragsdatum)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Monteur (Protokoll)</p>
                  <p className="font-medium">
                    {vorname} {nachname}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Prüfungsdatum</p>
                  <p className="font-medium">
                    {pruefungsdatum
                      ? format(parseISO(pruefungsdatum), 'dd.MM.yyyy, HH:mm', { locale: de })
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Prüfergebnis</p>
                  <StatusBadge
                    statusKey={pruefergebnisKey}
                    label={
                      PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnisKey)?.label ??
                      pruefergebnisKey
                    }
                  />
                </div>
              </div>
              {showMaengel && maengelbeschreibung && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Mängelbeschreibung</p>
                  <p className="text-sm bg-secondary/50 rounded-lg p-2">{maengelbeschreibung}</p>
                </div>
              )}
            </div>

            {/* Warning for not_bestanden / bestanden_mit_maengeln */}
            {(pruefergebnisKey === 'nicht_bestanden' ||
              pruefergebnisKey === 'bestanden_mit_maengeln') && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3 overflow-hidden">
                <IconAlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-800 mb-1">
                    Achtung: Prüfung nicht vollständig bestanden
                  </p>
                  <p className="text-amber-700">
                    Der Auftrag wird trotzdem als <strong>abgeschlossen</strong> markiert. Mängel und
                    Maßnahmen sind im Prüfprotokoll dokumentiert. Bitte bestätige, dass du den
                    Auftrag dennoch abschließen möchtest.
                  </p>
                </div>
              </div>
            )}

            {submitError && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive overflow-hidden">
                <strong>Fehler:</strong> {submitError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                Zurück
              </Button>
              <Button
                onClick={handleAbschliessen}
                disabled={submitting}
                className="gap-2"
              >
                {submitting ? (
                  <>
                    <IconRefresh size={16} className="animate-spin" />
                    Wird abgeschlossen...
                  </>
                ) : (
                  <>
                    <IconCircleCheck size={16} />
                    {pruefergebnisKey === 'bestanden'
                      ? 'Auftrag abschließen'
                      : 'Auftrag trotzdem abschließen'}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt setzt einen ausgewählten Auftrag voraus.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ── Step 4: Fertig ── */}
      {step === 4 && (
        <div className="text-center py-12 space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <IconCircleCheck size={32} className="text-green-600" stroke={2} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Auftrag abgeschlossen!</h2>
            {closedAuftragsnummer && (
              <p className="text-muted-foreground text-sm">
                Auftrag <strong>{closedAuftragsnummer}</strong> wurde erfolgreich abgeschlossen.
              </p>
            )}
            {closedPruefergebnis && closedPruefergebnisLabel && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Prüfergebnis:</span>
                <StatusBadge
                  statusKey={closedPruefergebnis}
                  label={closedPruefergebnisLabel}
                />
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={handleReset} variant="outline">
              Weiteren Auftrag abschließen
            </Button>
            <Button asChild>
              <a href="#/">Zurück zum Dashboard</a>
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
