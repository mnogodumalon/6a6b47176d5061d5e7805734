/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur nicht-abgeschlossene) → 2) Prüfprotokoll erfassen → 3) Status aktualisieren & Abschluss.
 * Reads: auftraege, kunden (kundenMap für Namen). Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 * Deep-link: ?auftragId=xxx springt direkt zu Schritt 2.
 */

import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { IconClipboardCheck, IconCircleCheck, IconAlertTriangle, IconUser, IconCalendar, IconHash } from '@tabler/icons-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const AUFTRAEGE_STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

// Keys for filtering: hide "abgeschlossen" and "storniert" records from step 1
const ABSCHLUSS_KEYS = new Set(['abgeschlossen', 'storniert']);

function getPruefergebnisColor(key: string | undefined): string {
  if (key === 'bestanden') return 'bg-green-100 text-green-800 border-green-200';
  if (key === 'bestanden_mit_maengeln') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (key === 'nicht_bestanden') return 'bg-red-100 text-red-800 border-red-200';
  return 'bg-secondary text-muted-foreground border-border';
}

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: ?auftragId=xxx → skip to step 2 with pre-selected Auftrag
  const initialAuftragId = searchParams.get('auftragId');
  const initialStep = initialAuftragId ? 2 : (Number(searchParams.get('step')) || 1);

  const [step, setStep] = useState(initialStep);
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(() => {
    if (initialAuftragId) {
      return null; // will be resolved after data loads in useMemo
    }
    return null;
  });

  // Protokoll form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnisKey, setPruefergebnisKey] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');
  const [protokollId, setProtokollId] = useState<string | null>(null);

  // Step 3 status
  const [neuerStatusKey, setNeuerStatusKey] = useState('abgeschlossen');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Filtered auftraege: hide abgeschlossen + storniert
  const filteredAuftraege = useMemo(() => {
    return auftraege.filter(a => {
      const statusKey = a.fields.status?.key;
      return !statusKey || !ABSCHLUSS_KEYS.has(statusKey);
    });
  }, [auftraege]);

  // Resolve deep-linked Auftrag once data is loaded
  const resolvedAuftrag = useMemo(() => {
    if (selectedAuftrag) return selectedAuftrag;
    if (initialAuftragId) {
      return auftraege.find(a => a.record_id === initialAuftragId) ?? null;
    }
    return null;
  }, [selectedAuftrag, initialAuftragId, auftraege]);

  const effectiveAuftrag = resolvedAuftrag;

  function handleStepChange(newStep: number) {
    setStep(newStep);
    const params = new URLSearchParams(searchParams);
    params.set('step', String(newStep));
    setSearchParams(params, { replace: true });
  }

  function handleSelectAuftrag(id: string) {
    const found = auftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    handleStepChange(2);
  }

  async function handleProtokolErstellen() {
    if (!effectiveAuftrag) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnisKey) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency guard: only create if not yet created
      let pid = protokollId;
      if (!pid) {
        const result = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl('6a6b46f93a346f58e17d78e4', effectiveAuftrag.record_id),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum: pruefungsdatum, // already in YYYY-MM-DDTHH:MM from datetime-local
          pruefergebnis: pruefergebnisKey,
          maengelbeschreibung: maengelbeschreibung.trim() || undefined,
          massnahmen: massnahmen.trim() || undefined,
          bemerkungen_pruef: bemerkungen.trim() || undefined,
        });
        pid = result.record_id;
        setProtokollId(pid);
      }
      handleStepChange(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Protokolls');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAbschliessen() {
    if (!effectiveAuftrag) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await LivingAppsService.updateAuftraegeEntry(effectiveAuftrag.record_id, {
        status: neuerStatusKey,
      });
      await fetchAll();
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Aktualisieren des Auftragsstatus');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnisKey(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setNeuerStatusKey('abgeschlossen');
    setSubmitError(null);
    setDone(false);
    const params = new URLSearchParams();
    params.set('step', '1');
    setSearchParams(params, { replace: true });
    setStep(1);
  }

  const pruefergebnisLabel = PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnisKey)?.label ?? pruefergebnisKey;

  const kundeNameForAuftrag = (a: Auftraege) => {
    if (!a.fields.kunde) return '';
    // kunde is stored as a URL; extract id to look up in kundenMap
    const parts = a.fields.kunde.split('/');
    const kundeId = parts[parts.length - 1];
    const kunde = kundenMap.get(kundeId);
    if (!kunde) return '';
    return [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || kunde.fields.firma || '';
  };

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftragsstatus aktualisieren"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschluss' },
      ]}
      currentStep={step}
      onStepChange={handleStepChange}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── Schritt 1: Auftrag wählen ─── */}
      {step === 1 && (
        <EntitySelectStep
          items={filteredAuftraege.map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(0, 8)}`,
            subtitle: [
              a.fields.auftragsdatum
                ? format(new Date(a.fields.auftragsdatum), 'dd.MM.yyyy', { locale: de })
                : null,
              kundeNameForAuftrag(a) || null,
            ].filter(Boolean).join(' · '),
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftragsnummer oder Kunde suchen …"
          emptyText="Keine offenen Aufträge gefunden. Alle Aufträge sind bereits abgeschlossen oder storniert."
          emptyIcon={<IconCircleCheck size={32} className="text-muted-foreground" />}
        />
      )}

      {/* ─── Schritt 2: Prüfprotokoll erfassen ─── */}
      {step === 2 && (
        effectiveAuftrag ? (
          <div className="space-y-6">
            {/* Auftrag-Kontext */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex flex-wrap gap-3 items-center">
              <IconHash size={18} className="text-muted-foreground shrink-0" />
              <span className="font-semibold text-foreground">
                {effectiveAuftrag.fields.auftragsnummer ?? 'Auftrag'}
              </span>
              {effectiveAuftrag.fields.status && (
                <StatusBadge
                  statusKey={effectiveAuftrag.fields.status.key}
                  label={effectiveAuftrag.fields.status.label}
                />
              )}
              {effectiveAuftrag.fields.auftragsdatum && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <IconCalendar size={14} />
                  {format(new Date(effectiveAuftrag.fields.auftragsdatum), 'dd.MM.yyyy', { locale: de })}
                </span>
              )}
              {kundeNameForAuftrag(effectiveAuftrag) && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <IconUser size={14} />
                  {kundeNameForAuftrag(effectiveAuftrag)}
                </span>
              )}
            </div>

            {/* Prüfprotokoll-Formular */}
            <div className="rounded-2xl border bg-card p-5 space-y-5">
              <h3 className="font-semibold text-foreground">Prüfprotokoll ausfüllen</h3>

              {/* Monteur Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname Monteur <span className="text-destructive">*</span></Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname Monteur <span className="text-destructive">*</span></Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              {/* Prüfungsdatum */}
              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum & Uhrzeit <span className="text-destructive">*</span></Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Prüfergebnis — Kacheln */}
              <div className="space-y-2">
                <Label>Prüfergebnis <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnisKey(opt.key)}
                      className={[
                        'rounded-xl border-2 p-3 text-sm font-medium transition-all text-left',
                        pruefergebnisKey === opt.key
                          ? getPruefergebnisColor(opt.key) + ' border-current ring-2 ring-offset-1'
                          : 'bg-card text-foreground border-border hover:border-primary/50',
                      ].join(' ')}
                    >
                      {opt.key === 'bestanden' && <IconCircleCheck size={16} className="mb-1" />}
                      {opt.key === 'nicht_bestanden' && <IconAlertTriangle size={16} className="mb-1" />}
                      {opt.key === 'bestanden_mit_maengeln' && <IconAlertTriangle size={16} className="mb-1" />}
                      <div>{opt.label}</div>
                    </button>
                  ))}
                </div>
                {/* Live-Badge */}
                {pruefergebnisKey && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">Aktuell gewählt:</span>
                    <Badge className={getPruefergebnisColor(pruefergebnisKey)}>
                      {pruefergebnisLabel}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Mängelbeschreibung (bedingt) */}
              {pruefergebnisKey && pruefergebnisKey !== 'bestanden' && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibe die festgestellten Mängel …"
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
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Geplante oder durchgeführte Maßnahmen …"
                  rows={3}
                />
              </div>

              {/* Bemerkungen */}
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

              {submitError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => handleStepChange(1)}
                  disabled={submitting}
                >
                  Zurück
                </Button>
                <Button
                  className="w-full sm:flex-1"
                  onClick={handleProtokolErstellen}
                  disabled={submitting || !vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnisKey}
                >
                  {submitting ? 'Wird gespeichert …' : 'Protokoll speichern & weiter'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Auftrag aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => handleStepChange(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* ─── Schritt 3: Status aktualisieren & Abschluss ─── */}
      {step === 3 && (
        done ? (
          /* Erfolgsanzeige */
          <div className="text-center py-12 space-y-6">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-100 p-4">
                <IconCircleCheck size={48} className="text-green-600" stroke={1.5} />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-foreground">Auftrag abgeschlossen</h3>
              <p className="text-muted-foreground text-sm">
                Das Prüfprotokoll wurde erfasst und der Auftragsstatus aktualisiert.
              </p>
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
        ) : (
          effectiveAuftrag ? (
            <div className="space-y-6">
              {/* Zusammenfassung Prüfprotokoll */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-foreground">Zusammenfassung Prüfprotokoll</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Auftrag</span>
                    <div className="font-medium">
                      {effectiveAuftrag.fields.auftragsnummer ?? effectiveAuftrag.record_id}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Monteur</span>
                    <div className="font-medium">{vorname} {nachname}</div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Prüfungsdatum</span>
                    <div className="font-medium">
                      {pruefungsdatum
                        ? format(new Date(pruefungsdatum), "dd.MM.yyyy 'um' HH:mm 'Uhr'", { locale: de })
                        : '–'}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Prüfergebnis</span>
                    <div>
                      <Badge className={getPruefergebnisColor(pruefergebnisKey)}>
                        {pruefergebnisLabel}
                      </Badge>
                    </div>
                  </div>
                  {maengelbeschreibung && (
                    <div className="sm:col-span-2 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Mängelbeschreibung</span>
                      <div className="text-foreground whitespace-pre-wrap">{maengelbeschreibung}</div>
                    </div>
                  )}
                  {massnahmen && (
                    <div className="sm:col-span-2 space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Maßnahmen</span>
                      <div className="text-foreground whitespace-pre-wrap">{massnahmen}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Neuen Status wählen */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-foreground">Auftragsstatus aktualisieren</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="neuerStatus">Neuer Status <span className="text-destructive">*</span></Label>
                  <Select value={neuerStatusKey} onValueChange={setNeuerStatusKey}>
                    <SelectTrigger id="neuerStatus" className="w-full">
                      <SelectValue placeholder="Status wählen …" />
                    </SelectTrigger>
                    <SelectContent>
                      {AUFTRAEGE_STATUS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {submitError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                    {submitError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => handleStepChange(2)}
                    disabled={submitting}
                  >
                    Zurück
                  </Button>
                  <Button
                    className="w-full sm:flex-1"
                    onClick={handleAbschliessen}
                    disabled={submitting || !neuerStatusKey}
                  >
                    {submitting ? 'Wird gespeichert …' : 'Auftrag abschließen'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                Dieser Schritt benötigt die Daten aus den vorherigen Schritten.
              </p>
              <Button variant="outline" onClick={() => handleStepChange(1)}>
                Neu starten
              </Button>
            </div>
          )
        )
      )}
    </IntentWizardShell>
  );
}
