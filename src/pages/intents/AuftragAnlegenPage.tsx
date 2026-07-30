/**
 * @intent AuftragAnlegen
 * @description Auftrag in 4 Schritten anlegen: Kunde wählen, Auftrag erstellen, Positionen hinzufügen, Zusammenfassung
 *
 * Steps:
 *   1) Kunde wählen — bestehenden Kunden auswählen oder neuen Kunden inline anlegen
 *   2) Auftrag erstellen — Auftragsnummer, Datum, Status, Priorität, Beschreibung, Wunschtermin, Monteur
 *   3) Positionen hinzufügen — Material aus der Liste auswählen, Menge & Einheit festlegen
 *   4) Zusammenfassung — Übersicht des erstellten Auftrags mit Rücksetzen- und Dashboard-Option
 *
 * Reads: kunden, material
 * Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry)
 * Composes: IntentWizardShell, EntitySelectStep
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  IconUser,
  IconPlus,
  IconCheck,
  IconArrowRight,
  IconArrowLeft,
  IconClipboardList,
  IconPackage,
  IconTrash,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

// ---------- Types ----------

interface PositionEntry {
  material: Material;
  menge: number;
  positionsbeschreibung: string;
  einheit_position: string;
}

// ---------- Component ----------

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Wizard step (1-based), initialized from URL ?step=N
  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    return s >= 1 && s <= 4 ? s : 1;
  })();
  const [step, setStep] = useState(initialStep);

  // Step 1: Kunde wählen
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [newKundeFirma, setNewKundeFirma] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);

  // Step 2: Auftrag erstellen
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState('');
  const [auftragStatus, setAuftragStatus] = useState('offen');
  const [auftragPrioritaet, setAuftragPrioritaet] = useState('normal');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreateLoading, setAuftragCreateLoading] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);

  // Step 3: Positionen
  const [positionen, setPositionen] = useState<PositionEntry[]>([]);
  const [addingMaterialId, setAddingMaterialId] = useState<string | null>(null);
  const [pendingMenge, setPendingMenge] = useState<Record<string, number>>({});
  const [pendingBeschreibung, setPendingBeschreibung] = useState<Record<string, string>>({});
  const [pendingEinheit, setPendingEinheit] = useState<Record<string, string>>({});
  const [positionenSaving, setPositionenSaving] = useState(false);
  const [positionenError, setPositionenError] = useState<string | null>(null);

  // Step 4: Result
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // ---------- Handlers ----------

  const handleKundeSelect = (id: string) => {
    const k = kunden.find(k => k.record_id === id) ?? null;
    setSelectedKunde(k);
    setStep(2);
  };

  const handleCreateKunde = async () => {
    if (!newKundeVorname.trim() || !newKundeNachname.trim()) return;
    setKundeCreateLoading(true);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname.trim(),
        nachname: newKundeNachname.trim(),
        telefon: newKundeTelefon.trim() || undefined,
        firma: newKundeFirma.trim() || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeTelefon('');
      setNewKundeFirma('');
      // After fetchAll, the kunden list is updated — find and select the new record
      const refreshed = await LivingAppsService.getKunden();
      const newKunde = refreshed.find(k => k.record_id === created.record_id) ?? null;
      if (newKunde) {
        setSelectedKunde(newKunde);
        setStep(2);
      }
    } catch (err) {
      console.error('Fehler beim Anlegen des Kunden:', err);
    } finally {
      setKundeCreateLoading(false);
    }
  };

  const handleCreateAuftrag = async () => {
    if (!selectedKunde || !auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()) return;
    setAuftragCreateLoading(true);
    setAuftragCreateError(null);
    try {
      const result = await LivingAppsService.createAuftraegeEntry({
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum, // already YYYY-MM-DD from <input type="date">
        status: auftragStatus,
        prioritaet: auftragPrioritaet,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        wunschtermin: wunschtermin || undefined, // already YYYY-MM-DDTHH:MM from <input type="datetime-local">
        monteur: monteur.trim() || undefined,
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
      });
      setCreatedAuftragId(result.record_id);
      setStep(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Auftrags');
    } finally {
      setAuftragCreateLoading(false);
    }
  };

  const handleAddPosition = (mat: Material) => {
    setAddingMaterialId(mat.record_id);
    if (!pendingEinheit[mat.record_id]) {
      setPendingEinheit(prev => ({
        ...prev,
        [mat.record_id]: LOOKUP_OPTIONS['auftragspositionen']['einheit_position'][0]?.key ?? 'stueck',
      }));
    }
    if (!pendingMenge[mat.record_id]) {
      setPendingMenge(prev => ({ ...prev, [mat.record_id]: 1 }));
    }
  };

  const handleConfirmPosition = (mat: Material) => {
    const menge = pendingMenge[mat.record_id] ?? 1;
    const einheit = pendingEinheit[mat.record_id] ?? 'stueck';
    const beschreibung = pendingBeschreibung[mat.record_id] ?? '';

    // Remove if already added, then re-add with new values
    setPositionen(prev => {
      const filtered = prev.filter(p => p.material.record_id !== mat.record_id);
      return [...filtered, { material: mat, menge, positionsbeschreibung: beschreibung, einheit_position: einheit }];
    });
    setAddingMaterialId(null);
  };

  const handleRemovePosition = (materialId: string) => {
    setPositionen(prev => prev.filter(p => p.material.record_id !== materialId));
  };

  const handleSavePositionen = async () => {
    if (!createdAuftragId) return;
    setPositionenSaving(true);
    setPositionenError(null);
    try {
      for (const pos of positionen) {
        await LivingAppsService.createAuftragspositionenEntry({
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.material.record_id),
          menge: pos.menge,
          positionsbeschreibung: pos.positionsbeschreibung || undefined,
          einheit_position: pos.einheit_position,
        });
      }
      setStep(4);
    } catch (err) {
      setPositionenError(err instanceof Error ? err.message : 'Fehler beim Speichern der Positionen');
    } finally {
      setPositionenSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedKunde(null);
    setShowCreateKunde(false);
    setNewKundeVorname('');
    setNewKundeNachname('');
    setNewKundeTelefon('');
    setNewKundeFirma('');
    setAuftragsnummer('');
    setAuftragsdatum('');
    setAuftragStatus('offen');
    setAuftragPrioritaet('normal');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setPositionen([]);
    setAddingMaterialId(null);
    setPendingMenge({});
    setPendingBeschreibung({});
    setPendingEinheit({});
    setCreatedAuftragId(null);
    setAuftragCreateError(null);
    setPositionenError(null);
    setStep(1);
  };

  // ---------- Lookup options ----------

  const statusOptions = LOOKUP_OPTIONS['auftraege']['status'] ?? [];
  const prioritaetOptions = LOOKUP_OPTIONS['auftraege']['prioritaet'] ?? [];
  const einheitOptions = LOOKUP_OPTIONS['auftragspositionen']['einheit_position'] ?? [];

  // ---------- Render ----------

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde wählen, Auftrag erfassen und Positionen hinzufügen"
      steps={[
        { label: 'Kunde wählen' },
        { label: 'Auftrag erstellen' },
        { label: 'Positionen' },
        { label: 'Zusammenfassung' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ===================== STEP 1: Kunde wählen ===================== */}
      {step === 1 && (
        <div className="space-y-4">
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)',
              subtitle: k.fields.firma,
              stats: k.fields.telefon ? [{ label: 'Telefon', value: k.fields.telefon }] : undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden. Lege einen neuen Kunden an."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowCreateKunde(v => !v)}
            createDialog={showCreateKunde && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="neue-vorname">Vorname *</Label>
                    <Input
                      id="neue-vorname"
                      value={newKundeVorname}
                      onChange={e => setNewKundeVorname(e.target.value)}
                      placeholder="Max"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neue-nachname">Nachname *</Label>
                    <Input
                      id="neue-nachname"
                      value={newKundeNachname}
                      onChange={e => setNewKundeNachname(e.target.value)}
                      placeholder="Mustermann"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neue-firma">Firma</Label>
                    <Input
                      id="neue-firma"
                      value={newKundeFirma}
                      onChange={e => setNewKundeFirma(e.target.value)}
                      placeholder="Muster GmbH"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neue-telefon">Telefon</Label>
                    <Input
                      id="neue-telefon"
                      value={newKundeTelefon}
                      onChange={e => setNewKundeTelefon(e.target.value)}
                      placeholder="+49 123 456789"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowCreateKunde(false)} disabled={kundeCreateLoading}>
                    Abbrechen
                  </Button>
                  <Button
                    onClick={handleCreateKunde}
                    disabled={!newKundeVorname.trim() || !newKundeNachname.trim() || kundeCreateLoading}
                  >
                    {kundeCreateLoading ? 'Wird angelegt...' : 'Kunden anlegen'}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ===================== STEP 2: Auftrag erstellen ===================== */}
      {step === 2 && selectedKunde && (
        <div className="space-y-5">
          {/* Kunde-Kontext */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 border">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <IconUser size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')}
              </p>
              {selectedKunde.fields.firma && (
                <p className="text-xs text-muted-foreground truncate">{selectedKunde.fields.firma}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="ml-auto shrink-0 gap-1">
              <IconArrowLeft size={14} />
              Ändern
            </Button>
          </div>

          {/* Formular */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <h2 className="text-base font-semibold">Auftragsdetails</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                <Input
                  id="auftragsnummer"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder="AU-2026-001"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="auftragsdatum">Auftragsdatum *</Label>
                <Input
                  id="auftragsdatum"
                  type="date"
                  value={auftragsdatum}
                  onChange={e => setAuftragsdatum(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="auftrag-status">Status *</Label>
              <Select value={auftragStatus} onValueChange={setAuftragStatus}>
                <SelectTrigger id="auftrag-status">
                  <SelectValue placeholder="Status wählen" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(opt => (
                    <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priorität</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {prioritaetOptions.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setAuftragPrioritaet(opt.key)}
                    className={`p-3 rounded-xl border text-sm font-medium transition-colors text-center w-full ${
                      auftragPrioritaet === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:border-primary/50 hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="auftragsbeschreibung">Auftragsbeschreibung *</Label>
              <Textarea
                id="auftragsbeschreibung"
                value={auftragsbeschreibung}
                onChange={e => setAuftragsbeschreibung(e.target.value)}
                placeholder="Beschreibe den Auftrag..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="wunschtermin">Wunschtermin</Label>
                <Input
                  id="wunschtermin"
                  type="datetime-local"
                  value={wunschtermin}
                  onChange={e => setWunschtermin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="monteur">Monteur</Label>
                <Input
                  id="monteur"
                  value={monteur}
                  onChange={e => setMonteur(e.target.value)}
                  placeholder="Name des Monteurs"
                />
              </div>
            </div>

            {auftragCreateError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {auftragCreateError}
              </div>
            )}

            <div className="flex gap-2 justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <IconArrowLeft size={15} />
                Zurück
              </Button>
              <Button
                onClick={handleCreateAuftrag}
                disabled={
                  !auftragsnummer.trim() ||
                  !auftragsdatum ||
                  !auftragsbeschreibung.trim() ||
                  auftragCreateLoading
                }
                className="gap-1.5"
              >
                {auftragCreateLoading ? 'Wird erstellt...' : (
                  <>
                    Auftrag erstellen
                    <IconArrowRight size={15} />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== STEP 3: Positionen hinzufügen ===================== */}
      {step === 3 && createdAuftragId && (
        <div className="space-y-4">
          {/* Counter */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border">
            <div className="flex items-center gap-2">
              <IconClipboardList size={18} className="text-primary" />
              <span className="text-sm font-medium">
                {positionen.length === 0
                  ? 'Noch keine Positionen hinzugefügt'
                  : `${positionen.length} ${positionen.length === 1 ? 'Position' : 'Positionen'} hinzugefügt`}
              </span>
            </div>
          </div>

          {/* Hinzugefügte Positionen */}
          {positionen.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Hinzugefügte Positionen</p>
              {positionen.map(pos => {
                const einheitLabel = einheitOptions.find(e => e.key === pos.einheit_position)?.label ?? pos.einheit_position;
                return (
                  <div
                    key={pos.material.record_id}
                    className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <IconCheck size={15} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pos.material.fields.bezeichnung ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {pos.menge} {einheitLabel}
                        {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePosition(pos.material.record_id)}
                      className="shrink-0 text-destructive hover:text-destructive"
                    >
                      <IconTrash size={15} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Materialliste */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Material hinzufügen</p>
            {material.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Kein Material vorhanden.
              </div>
            ) : (
              material.map(mat => {
                const isAdded = positionen.some(p => p.material.record_id === mat.record_id);
                const isExpanded = addingMaterialId === mat.record_id;
                const matEinheit = pendingEinheit[mat.record_id] ??
                  (LOOKUP_OPTIONS['auftragspositionen']['einheit_position'][0]?.key ?? 'stueck');

                return (
                  <div key={mat.record_id} className="rounded-xl border bg-card overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                        <IconPackage size={17} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mat.fields.bezeichnung ?? '—'}</p>
                        <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                          {mat.fields.artikelnummer && <span>Art. {mat.fields.artikelnummer}</span>}
                          {mat.fields.lagerbestand !== undefined && (
                            <span>Bestand: {mat.fields.lagerbestand} {mat.fields.einheit?.label ?? ''}</span>
                          )}
                        </div>
                      </div>
                      {isAdded && !isExpanded ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddPosition(mat)}
                          className="shrink-0 gap-1 text-primary border-primary/30"
                        >
                          <IconCheck size={14} />
                          Bearbeiten
                        </Button>
                      ) : !isExpanded ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddPosition(mat)}
                          className="shrink-0 gap-1"
                        >
                          <IconPlus size={14} />
                          Hinzufügen
                        </Button>
                      ) : null}
                    </div>

                    {/* Inline-Formular für diese Position */}
                    {isExpanded && (
                      <div className="border-t bg-secondary/30 p-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label>Menge *</Label>
                            <Input
                              type="number"
                              min={1}
                              value={pendingMenge[mat.record_id] ?? 1}
                              onChange={e =>
                                setPendingMenge(prev => ({
                                  ...prev,
                                  [mat.record_id]: Math.max(1, parseInt(e.target.value, 10) || 1),
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Einheit</Label>
                            <Select
                              value={matEinheit}
                              onValueChange={v =>
                                setPendingEinheit(prev => ({ ...prev, [mat.record_id]: v }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {einheitOptions.map(opt => (
                                  <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Beschreibung</Label>
                            <Input
                              value={pendingBeschreibung[mat.record_id] ?? ''}
                              onChange={e =>
                                setPendingBeschreibung(prev => ({
                                  ...prev,
                                  [mat.record_id]: e.target.value,
                                }))
                              }
                              placeholder="Optional..."
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" size="sm" onClick={() => setAddingMaterialId(null)}>
                            Abbrechen
                          </Button>
                          <Button size="sm" onClick={() => handleConfirmPosition(mat)} className="gap-1">
                            <IconCheck size={14} />
                            Bestätigen
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {positionenError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {positionenError}
            </div>
          )}

          <div className="flex gap-2 justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-1.5" disabled={positionenSaving}>
              <IconArrowLeft size={15} />
              Zurück
            </Button>
            <Button onClick={handleSavePositionen} disabled={positionenSaving} className="gap-1.5">
              {positionenSaving ? 'Wird gespeichert...' : (
                <>
                  {positionen.length === 0 ? 'Ohne Positionen abschließen' : `${positionen.length} ${positionen.length === 1 ? 'Position' : 'Positionen'} speichern`}
                  <IconArrowRight size={15} />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ===================== STEP 4: Zusammenfassung ===================== */}
      {step === 4 && selectedKunde && createdAuftragId && (
        <div className="space-y-5">
          {/* Erfolgs-Header */}
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <IconCheck size={32} className="text-primary" stroke={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Auftrag erfolgreich angelegt!</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Der Auftrag wurde mit {positionen.length} {positionen.length === 1 ? 'Position' : 'Positionen'} gespeichert.
              </p>
            </div>
          </div>

          {/* Zusammenfassungs-Karte */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zusammenfassung</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Kunde</p>
                  <p className="text-sm font-medium">
                    {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')}
                  </p>
                  {selectedKunde.fields.firma && (
                    <p className="text-xs text-muted-foreground">{selectedKunde.fields.firma}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                  <p className="text-sm font-medium">{auftragsnummer}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Auftragsdatum</p>
                  <p className="text-sm font-medium">
                    {auftragsdatum
                      ? format(new Date(auftragsdatum + 'T00:00:00'), 'dd.MM.yyyy', { locale: de })
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm font-medium">
                    {statusOptions.find(s => s.key === auftragStatus)?.label ?? auftragStatus}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Priorität</p>
                  <p className="text-sm font-medium">
                    {prioritaetOptions.find(p => p.key === auftragPrioritaet)?.label ?? auftragPrioritaet}
                  </p>
                </div>
                {monteur && (
                  <div>
                    <p className="text-xs text-muted-foreground">Monteur</p>
                    <p className="text-sm font-medium">{monteur}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Positionen</p>
                  <p className="text-sm font-medium">{positionen.length}</p>
                </div>
              </div>
            </div>

            {positionen.length > 0 && (
              <div className="border-t pt-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Materialien</p>
                {positionen.map(pos => {
                  const einheitLabel = einheitOptions.find(e => e.key === pos.einheit_position)?.label ?? pos.einheit_position;
                  return (
                    <div key={pos.material.record_id} className="flex justify-between text-sm">
                      <span className="truncate min-w-0 mr-2">{pos.material.fields.bezeichnung ?? '—'}</span>
                      <span className="text-muted-foreground shrink-0">{pos.menge} {einheitLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Aktionen */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button onClick={handleReset} variant="outline" className="gap-1.5">
              <IconPlus size={15} />
              Neuen Auftrag anlegen
            </Button>
            <a href="#/">
              <Button className="w-full sm:w-auto gap-1.5">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
