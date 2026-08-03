/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur 'offen' oder 'in_bearbeitung') →
 *        2) Prüfprotokoll erfassen (erstellt neuen Pruefprotokoll-Eintrag) →
 *        3) Auftrag abschließen (aktualisiert Auftrag-Status basierend auf Prüfergebnis).
 * Reads: auftraege, kunden (via kundenMap). Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState } from 'react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconArrowRight,
  IconRefresh,
  IconClipboardList,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1: selected Auftrag
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2: Prüfprotokoll form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);

  // Filter Aufträge: only 'offen' or 'in_bearbeitung'
  const eligibleAuftraege = auftraege.filter(a => {
    const sk = lookupKey(a.fields.status);
    return sk === 'offen' || sk === 'in_bearbeitung';
  });

  // Enrich with Kundename for display
  const enrichedEligible: EnrichedAuftraege[] = eligibleAuftraege.map(a => {
    const kundeId = a.fields.kunde ? a.fields.kunde.match(/([a-f0-9]{24})$/i)?.[1] : undefined;
    const kunde = kundeId ? kundenMap.get(kundeId) : undefined;
    const kundeName = kunde
      ? [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || kunde.fields.firma || '—'
      : '—';
    return { ...a, kundeName };
  });

  const selectedAuftrag = selectedAuftragId
    ? enrichedEligible.find(a => a.record_id === selectedAuftragId) ?? null
    : null;

  function handleSelectAuftrag(id: string) {
    setSelectedAuftragId(id);
    setStep(2);
  }

  async function handleSaveProtokoll() {
    if (!selectedAuftragId) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis) return;

    setSaving(true);
    setSaveError(null);

    try {
      // Idempotency guard: only create if not yet created
      let pid = protokollId;
      if (!pid) {
        const created = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnis,
          maengelbeschreibung: maengelbeschreibung.trim() || undefined,
          massnahmen: massnahmen.trim() || undefined,
          bemerkungen_pruef: bemerkungen.trim() || undefined,
        });
        pid = created.record_id;
        setProtokollId(pid);
      }

      // Determine new status for Auftrag
      const newStatus =
        pruefergebnis === 'bestanden' ? 'abgeschlossen' : 'in_bearbeitung';

      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
        status: newStatus,
      });

      setFinalStatus(newStatus);
      await fetchAll();
      setStep(3);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setStep(1);
    setSelectedAuftragId(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setSaveError(null);
    setProtokollId(null);
    setFinalStatus(null);
  }

  const pruefergebnisLabel =
    PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis;

  const isStep2Valid =
    vorname.trim().length > 0 &&
    nachname.trim().length > 0 &&
    pruefungsdatum.length > 0 &&
    pruefergebnis.length > 0;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftragsstatus aktualisieren"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfprotokoll' },
        { label: 'Abgeschlossen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Auftrag wählen ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-4">
              Wähle einen offenen oder laufenden Auftrag aus, um das Prüfprotokoll zu erfassen und den Auftrag abzuschließen.
            </p>
            <EntitySelectStep
              items={enrichedEligible.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
                subtitle: [
                  a.kundeName !== '—' ? `Kunde: ${a.kundeName}` : null,
                  a.fields.wunschtermin ? `Wunschtermin: ${formatDateTime(a.fields.wunschtermin)}` : null,
                  a.fields.monteur ? `Monteur: ${a.fields.monteur}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                status: a.fields.status
                  ? { key: lookupKey(a.fields.status) ?? '', label: a.fields.status.label }
                  : undefined,
                icon: <IconClipboardList size={20} className="text-primary" />,
              }))}
              onSelect={handleSelectAuftrag}
              searchPlaceholder="Auftrag suchen..."
              emptyText="Keine offenen oder laufenden Aufträge gefunden."
              emptyIcon={<IconClipboardCheck size={32} />}
            />
          </div>
        </div>
      )}

      {/* ── Step 2: Prüfprotokoll erfassen ────────────────────── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-4">
            {/* Context panel: selected Auftrag details */}
            <div className="rounded-2xl border bg-secondary/40 p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <IconClipboardList size={18} className="text-primary shrink-0" />
                  <span className="font-semibold text-sm">
                    {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                  </span>
                </div>
                <StatusBadge
                  statusKey={lookupKey(selectedAuftrag.fields.status)}
                  label={selectedAuftrag.fields.status?.label}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {selectedAuftrag.kundeName !== '—' && (
                  <div>
                    <span className="text-muted-foreground">Kunde: </span>
                    <span>{selectedAuftrag.kundeName}</span>
                  </div>
                )}
                {selectedAuftrag.fields.wunschtermin && (
                  <div>
                    <span className="text-muted-foreground">Wunschtermin: </span>
                    <span>{formatDateTime(selectedAuftrag.fields.wunschtermin)}</span>
                  </div>
                )}
                {selectedAuftrag.fields.monteur && (
                  <div>
                    <span className="text-muted-foreground">Monteur: </span>
                    <span>{selectedAuftrag.fields.monteur}</span>
                  </div>
                )}
                {selectedAuftrag.fields.auftragsdatum && (
                  <div>
                    <span className="text-muted-foreground">Auftragsdatum: </span>
                    <span>{formatDate(selectedAuftrag.fields.auftragsdatum)}</span>
                  </div>
                )}
              </div>
              {selectedAuftrag.fields.auftragsbeschreibung && (
                <p className="text-sm text-muted-foreground border-t pt-2 mt-1 line-clamp-2">
                  {selectedAuftrag.fields.auftragsbeschreibung}
                </p>
              )}
            </div>

            {/* Prüfprotokoll mini-form */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname Prüfer *</Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname Prüfer *</Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum & Uhrzeit *</Label>
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
                  {PRUEFERGEBNIS_OPTIONS.map(opt => {
                    const isSelected = pruefergebnis === opt.key;
                    const colorMap: Record<string, string> = {
                      bestanden: isSelected
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-border bg-card text-foreground hover:border-green-300',
                      bestanden_mit_maengeln: isSelected
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-border bg-card text-foreground hover:border-amber-300',
                      nicht_bestanden: isSelected
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-border bg-card text-foreground hover:border-red-300',
                    };
                    const color = colorMap[opt.key] ?? (isSelected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground hover:border-primary/30');
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPruefergebnis(opt.key)}
                        className={`rounded-xl border-2 p-3 text-sm font-medium text-center transition-colors ${color}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln') && (
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

              {(pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln') && (
                <div className="space-y-1.5">
                  <Label htmlFor="massnahmen">Maßnahmen</Label>
                  <Textarea
                    id="massnahmen"
                    value={massnahmen}
                    onChange={e => setMassnahmen(e.target.value)}
                    placeholder="Welche Maßnahmen sind erforderlich?"
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
                  placeholder="Weitere Bemerkungen zum Prüfvorgang..."
                  rows={2}
                />
              </div>

              {saveError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2">
                  <IconAlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{saveError}</p>
                </div>
              )}

              {/* Hinweis zur Statusänderung */}
              <div className="rounded-xl border bg-secondary/40 p-3 text-sm text-muted-foreground">
                {pruefergebnis === 'bestanden' ? (
                  <span className="text-green-700">
                    Der Auftrag wird nach der Bestätigung auf <strong>Abgeschlossen</strong> gesetzt.
                  </span>
                ) : (
                  <span className="text-amber-700">
                    Bei Mängeln oder nicht bestandener Prüfung wird der Auftrag auf <strong>In Bearbeitung</strong> gesetzt.
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="w-full sm:w-auto"
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleSaveProtokoll}
                  disabled={!isStep2Valid || saving}
                  className="w-full sm:w-auto gap-2"
                >
                  {saving ? (
                    <>
                      <IconRefresh size={16} className="animate-spin" />
                      Wird gespeichert...
                    </>
                  ) : (
                    <>
                      Protokoll speichern & Auftrag abschließen
                      <IconArrowRight size={16} />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Auftrag aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ── Step 3: Ergebnis / Abgeschlossen ─────────────────── */}
      {step === 3 && (
        selectedAuftrag && protokollId && finalStatus ? (
          <div className="space-y-4">
            {/* Success banner */}
            <div className={`rounded-2xl border-2 p-6 flex flex-col items-center text-center gap-3 ${
              finalStatus === 'abgeschlossen'
                ? 'border-green-300 bg-green-50'
                : 'border-amber-300 bg-amber-50'
            }`}>
              {finalStatus === 'abgeschlossen' ? (
                <IconCircleCheck size={48} className="text-green-600" />
              ) : (
                <IconAlertTriangle size={48} className="text-amber-600" />
              )}
              <div>
                <h2 className={`text-xl font-bold ${finalStatus === 'abgeschlossen' ? 'text-green-700' : 'text-amber-700'}`}>
                  {finalStatus === 'abgeschlossen'
                    ? 'Auftrag erfolgreich abgeschlossen'
                    : 'Prüfung mit Mängeln — Auftrag zurück in Bearbeitung'}
                </h2>
                <p className={`text-sm mt-1 ${finalStatus === 'abgeschlossen' ? 'text-green-600' : 'text-amber-600'}`}>
                  {finalStatus === 'abgeschlossen'
                    ? 'Das Prüfprotokoll wurde erfasst und der Auftrag als abgeschlossen markiert.'
                    : 'Das Prüfprotokoll wurde erfasst. Der Auftrag wurde auf "In Bearbeitung" gesetzt, um die Mängel zu beheben.'}
                </p>
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Zusammenfassung</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                    <p className="font-medium text-sm">
                      {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                    </p>
                  </div>
                  {selectedAuftrag.kundeName !== '—' && (
                    <div>
                      <p className="text-xs text-muted-foreground">Kunde</p>
                      <p className="font-medium text-sm">{selectedAuftrag.kundeName}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Neuer Status</p>
                    <StatusBadge
                      statusKey={finalStatus}
                      label={
                        finalStatus === 'abgeschlossen' ? 'Abgeschlossen' : 'In Bearbeitung'
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Prüfer</p>
                    <p className="font-medium text-sm">{vorname} {nachname}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Prüfungsdatum</p>
                    <p className="font-medium text-sm">
                      {pruefungsdatum
                        ? (() => {
                            try {
                              const [datePart, timePart] = pruefungsdatum.split('T');
                              const [year, month, day] = (datePart ?? '').split('-');
                              if (!year || !month || !day) return pruefungsdatum;
                              const time = timePart ? ` ${timePart}` : '';
                              return `${day}.${month}.${year}${time}`;
                            } catch {
                              return pruefungsdatum;
                            }
                          })()
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Prüfergebnis</p>
                    <StatusBadge
                      statusKey={pruefergebnis}
                      label={pruefergebnisLabel}
                    />
                  </div>
                </div>
              </div>
              {maengelbeschreibung && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Mängelbeschreibung</p>
                  <p className="text-sm mt-0.5">{maengelbeschreibung}</p>
                </div>
              )}
              {massnahmen && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Maßnahmen</p>
                  <p className="text-sm mt-0.5">{massnahmen}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleReset} variant="outline" className="w-full sm:w-auto gap-2">
                <IconRefresh size={16} />
                Weiteren Auftrag abschließen
              </Button>
              <a href="#/" className="w-full sm:w-auto">
                <Button variant="default" className="w-full gap-2">
                  <IconClipboardCheck size={16} />
                  Zurück zum Dashboard
                </Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt ein abgeschlossenes Prüfprotokoll aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(selectedAuftragId ? 2 : 1)}>
              Neu starten
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}

