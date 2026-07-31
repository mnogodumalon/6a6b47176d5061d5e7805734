/**
 * Auftrag anlegen — 4-Schritt-Wizard.
 * Steps: 1) Kunden wählen → 2) Auftragsdaten eingeben → 3) Positionen hinzufügen → 4) Zusammenfassung.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import {
  IconUser,
  IconClipboardList,
  IconPackage,
  IconCircleCheck,
  IconPlus,
  IconTrash,
  IconLoader2,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatDateTime } from '@/lib/formatters';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionEntry {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
  bemerkung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard step
  const [step, setStep] = useState(1);

  // Step 1 — Kunden
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2 — Auftragsdaten
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragSubmitting, setAuftragSubmitting] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);

  // Created Auftrag id (idempotency guard)
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // Step 3 — Positionen
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [positionBemerkung, setPositionBemerkung] = useState('');
  const [positionSubmitting, setPositionSubmitting] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [addedPositionen, setAddedPositionen] = useState<PositionEntry[]>([]);

  // Neue Kunde anlegen
  const handleKundeCreate = async () => {
    if (!neuerVorname.trim() || !neuerNachname.trim()) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim(),
        nachname: neuerNachname.trim(),
        telefon: neueTelefon.trim() || undefined,
      });
      await fetchAll();
      // Find newly created record from refreshed data to get its full object
      setShowKundeCreate(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeueTelefon('');
      // Auto-select the newly created customer
      setSelectedKunde({
        record_id: created.record_id,
        created_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        updated_at: null,
        createdat: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        updatedat: null,
        fields: {
          vorname: neuerVorname.trim(),
          nachname: neuerNachname.trim(),
          telefon: neueTelefon.trim() || undefined,
        },
      });
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden.');
    } finally {
      setKundeCreateLoading(false);
    }
  };

  // Auftrag anlegen (idempotency: only create if not yet created)
  const handleAuftragSubmit = async () => {
    if (!selectedKunde || !auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()) return;
    setAuftragSubmitting(true);
    setAuftragError(null);
    try {
      let auftragId = createdAuftragId;
      if (!auftragId) {
        const payload: Record<string, unknown> = {
          auftragsnummer: auftragsnummer.trim(),
          auftragsdatum,
          status: statusKey,
          auftragsbeschreibung: auftragsbeschreibung.trim(),
          kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
        };
        if (prioritaetKey && prioritaetKey !== 'none') payload.prioritaet = prioritaetKey;
        if (wunschtermin) payload.wunschtermin = wunschtermin;
        if (monteur.trim()) payload.monteur = monteur.trim();

        const created = await LivingAppsService.createAuftraegeEntry(payload);
        auftragId = created.record_id;
        setCreatedAuftragId(auftragId);
      }
      setStep(3);
    } catch (err) {
      setAuftragError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags.');
    } finally {
      setAuftragSubmitting(false);
    }
  };

  // Position hinzufügen
  const handlePositionAdd = async () => {
    if (!selectedMaterial || !positionMenge || Number(positionMenge) <= 0 || !createdAuftragId) return;
    setPositionSubmitting(true);
    setPositionError(null);
    try {
      const payload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterial.record_id),
        menge: Number(positionMenge),
      };
      if (positionEinheitKey && positionEinheitKey !== 'none') payload.einheit_position = positionEinheitKey;
      if (positionBeschreibung.trim()) payload.positionsbeschreibung = positionBeschreibung.trim();
      if (positionBemerkung.trim()) payload.bemerkung = positionBemerkung.trim();

      await LivingAppsService.createAuftragspositionenEntry(payload);

      setAddedPositionen(prev => [
        ...prev,
        {
          materialId: selectedMaterial.record_id,
          materialName: selectedMaterial.fields.bezeichnung ?? selectedMaterial.record_id,
          menge: positionMenge,
          einheitKey: positionEinheitKey,
          positionsbeschreibung: positionBeschreibung.trim(),
          bemerkung: positionBemerkung.trim(),
        },
      ]);

      // Reset position form
      setSelectedMaterial(null);
      setPositionMenge('1');
      setPositionEinheitKey('none');
      setPositionBeschreibung('');
      setPositionBemerkung('');
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position.');
    } finally {
      setPositionSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKunde(null);
    setShowKundeCreate(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeueTelefon('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setCreatedAuftragId(null);
    setSelectedMaterial(null);
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
    setPositionBemerkung('');
    setAddedPositionen([]);
    setAuftragError(null);
    setPositionError(null);
  };

  const statusLabel = STATUS_OPTIONS.find(o => o.key === statusKey)?.label ?? statusKey;
  const prioritaetLabel = prioritaetKey !== 'none'
    ? PRIORITAET_OPTIONS.find(o => o.key === prioritaetKey)?.label
    : undefined;

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Schritt für Schritt zum fertigen Auftrag"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Positionen' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── Step 1: Kunde wählen ─── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Kunde wählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle den Kunden aus, für den der Auftrag angelegt werden soll.
            </p>
          </div>
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · ') || undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={(id) => {
              const found = kunden.find(k => k.record_id === id) ?? null;
              setSelectedKunde(found);
              setStep(2);
            }}
            searchPlaceholder="Kunden suchen..."
            emptyIcon={<IconUser size={32} />}
            emptyText="Keine Kunden gefunden."
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(v => !v)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Vorname *</label>
                    <Input
                      value={neuerVorname}
                      onChange={e => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Nachname *</label>
                    <Input
                      value={neuerNachname}
                      onChange={e => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Telefon</label>
                  <Input
                    value={neueTelefon}
                    onChange={e => setNeueTelefon(e.target.value)}
                    placeholder="+49 ..."
                    type="tel"
                  />
                </div>
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    disabled={!neuerVorname.trim() || !neuerNachname.trim() || kundeCreateLoading}
                    onClick={handleKundeCreate}
                    className="flex-1"
                  >
                    {kundeCreateLoading && <IconLoader2 size={15} className="animate-spin mr-1.5" />}
                    Anlegen & auswählen
                  </Button>
                  <Button variant="outline" onClick={() => setShowKundeCreate(false)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ─── Step 2: Auftragsdaten ─── */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Auftragsdaten eingeben</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Kunde: <span className="font-medium text-foreground">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')}
                  {selectedKunde.fields.firma ? ` · ${selectedKunde.fields.firma}` : ''}
                </span>
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Auftragsnummer + Datum */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Status *</label>
                <Select value={statusKey} onValueChange={setStatusKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priorität */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priorität</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPrioritaetKey('none')}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      prioritaetKey === 'none'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border hover:border-primary/40'
                    }`}
                  >
                    Keine
                  </button>
                  {PRIORITAET_OPTIONS.map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setPrioritaetKey(o.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        prioritaetKey === o.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border hover:border-primary/40'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Beschreibung */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Auftragsbeschreibung *</label>
                <textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll gemacht werden?"
                  rows={3}
                  className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 resize-none"
                />
              </div>

              {/* Wunschtermin + Monteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Monteur</label>
                  <Input
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragError && (
                <p className="text-sm text-destructive">{auftragError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="shrink-0"
                >
                  Zurück
                </Button>
                <Button
                  disabled={
                    !auftragsnummer.trim() ||
                    !auftragsdatum ||
                    !auftragsbeschreibung.trim() ||
                    auftragSubmitting
                  }
                  onClick={handleAuftragSubmit}
                  className="flex-1"
                >
                  {auftragSubmitting && <IconLoader2 size={15} className="animate-spin mr-1.5" />}
                  Auftrag anlegen & weiter
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ─── Step 3: Positionen hinzufügen ─── */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Positionen hinzufügen</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Wähle Material aus und füge es als Position hinzu. Du kannst mehrere Positionen anlegen.
                </p>
              </div>
              {addedPositionen.length > 0 && (
                <div className="shrink-0 text-center">
                  <span className="text-2xl font-bold text-primary">{addedPositionen.length}</span>
                  <p className="text-xs text-muted-foreground">
                    {addedPositionen.length === 1 ? 'Position' : 'Positionen'}
                  </p>
                </div>
              )}
            </div>

            {/* Added positions list */}
            {addedPositionen.length > 0 && (
              <div className="rounded-2xl border bg-card divide-y overflow-hidden">
                {addedPositionen.map((pos, idx) => {
                  const einheitLabel = pos.einheitKey !== 'none'
                    ? EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label
                    : undefined;
                  return (
                    <div key={idx} className="flex items-center gap-3 p-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <IconPackage size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pos.materialName}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.menge} {einheitLabel ?? ''}
                          {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Material selection */}
            {!selectedMaterial ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Material auswählen</h3>
                <EntitySelectStep
                  items={material.map(m => ({
                    id: m.record_id,
                    title: m.fields.bezeichnung ?? '(Kein Name)',
                    subtitle: [
                      m.fields.artikelnummer ? `Art.-Nr.: ${m.fields.artikelnummer}` : null,
                      m.fields.lagerbestand != null ? `Lager: ${m.fields.lagerbestand}` : null,
                    ].filter(Boolean).join(' · ') || undefined,
                    status: m.fields.verfuegbarkeit
                      ? { key: m.fields.verfuegbarkeit.key, label: m.fields.verfuegbarkeit.label }
                      : undefined,
                    icon: <IconPackage size={20} className="text-primary" />,
                  }))}
                  onSelect={(id) => {
                    const found = material.find(m => m.record_id === id) ?? null;
                    setSelectedMaterial(found);
                  }}
                  searchPlaceholder="Material suchen..."
                  emptyIcon={<IconPackage size={32} />}
                  emptyText="Kein Material gefunden."
                />
              </div>
            ) : (
              /* Position details form */
              <div className="rounded-2xl border bg-card p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <IconPackage size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{selectedMaterial.fields.bezeichnung ?? '(Kein Name)'}</p>
                    {selectedMaterial.fields.artikelnummer && (
                      <p className="text-xs text-muted-foreground">Art.-Nr.: {selectedMaterial.fields.artikelnummer}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMaterial(null)}
                    className="shrink-0 text-muted-foreground"
                  >
                    Ändern
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Menge *</label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={positionMenge}
                      onChange={e => setPositionMenge(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Einheit</label>
                    <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                      <SelectTrigger>
                        <SelectValue placeholder="Einheit wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Einheit</SelectItem>
                        {EINHEIT_POSITION_OPTIONS.map(o => (
                          <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Positionsbeschreibung</label>
                  <Input
                    value={positionBeschreibung}
                    onChange={e => setPositionBeschreibung(e.target.value)}
                    placeholder="Kurze Beschreibung dieser Position"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Bemerkung</label>
                  <textarea
                    value={positionBemerkung}
                    onChange={e => setPositionBemerkung(e.target.value)}
                    placeholder="Optionale Bemerkung"
                    rows={2}
                    className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 resize-none"
                  />
                </div>

                {positionError && (
                  <p className="text-sm text-destructive">{positionError}</p>
                )}

                <Button
                  disabled={!positionMenge || Number(positionMenge) <= 0 || positionSubmitting}
                  onClick={handlePositionAdd}
                  className="w-full"
                >
                  {positionSubmitting
                    ? <IconLoader2 size={15} className="animate-spin mr-1.5" />
                    : <IconPlus size={15} className="mr-1.5" />
                  }
                  Position hinzufügen
                </Button>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="shrink-0"
              >
                Zurück
              </Button>
              <Button
                variant={addedPositionen.length === 0 ? 'outline' : 'default'}
                onClick={() => setStep(4)}
                className="flex-1"
              >
                {addedPositionen.length === 0
                  ? 'Weiter ohne Positionen'
                  : `Weiter mit ${addedPositionen.length} ${addedPositionen.length === 1 ? 'Position' : 'Positionen'}`
                }
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}

      {/* ─── Step 4: Zusammenfassung ─── */}
      {step === 4 && (
        createdAuftragId && selectedKunde ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconCircleCheck size={24} className="text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Auftrag erfolgreich angelegt!</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Hier ist deine Zusammenfassung.</p>
              </div>
            </div>

            <div className="rounded-2xl border bg-card divide-y overflow-hidden">
              {/* Auftragsnummer */}
              <div className="flex items-center justify-between p-4 gap-3">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <IconClipboardList size={16} className="shrink-0" />
                  Auftragsnummer
                </span>
                <span className="text-sm font-semibold text-right">{auftragsnummer}</span>
              </div>

              {/* Kunde */}
              <div className="flex items-center justify-between p-4 gap-3">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <IconUser size={16} className="shrink-0" />
                  Kunde
                </span>
                <span className="text-sm font-medium text-right">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')}
                  {selectedKunde.fields.firma ? ` (${selectedKunde.fields.firma})` : ''}
                </span>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between p-4 gap-3">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge statusKey={statusKey} label={statusLabel} />
              </div>

              {/* Priorität */}
              {prioritaetLabel && (
                <div className="flex items-center justify-between p-4 gap-3">
                  <span className="text-sm text-muted-foreground">Priorität</span>
                  <span className="text-sm font-medium">{prioritaetLabel}</span>
                </div>
              )}

              {/* Wunschtermin */}
              {wunschtermin && (
                <div className="flex items-center justify-between p-4 gap-3">
                  <span className="text-sm text-muted-foreground">Wunschtermin</span>
                  <span className="text-sm font-medium">{formatDateTime(wunschtermin)}</span>
                </div>
              )}

              {/* Auftragsdatum */}
              <div className="flex items-center justify-between p-4 gap-3">
                <span className="text-sm text-muted-foreground">Auftragsdatum</span>
                <span className="text-sm font-medium">{formatDate(auftragsdatum)}</span>
              </div>

              {/* Monteur */}
              {monteur.trim() && (
                <div className="flex items-center justify-between p-4 gap-3">
                  <span className="text-sm text-muted-foreground">Monteur</span>
                  <span className="text-sm font-medium">{monteur.trim()}</span>
                </div>
              )}

              {/* Positionen */}
              <div className="flex items-center justify-between p-4 gap-3">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <IconPackage size={16} className="shrink-0" />
                  Positionen
                </span>
                <span className="text-sm font-semibold text-primary">
                  {addedPositionen.length === 0
                    ? 'Keine Positionen'
                    : `${addedPositionen.length} ${addedPositionen.length === 1 ? 'Position' : 'Positionen'}`}
                </span>
              </div>

              {/* Position detail list */}
              {addedPositionen.length > 0 && (
                <div className="bg-secondary/40 px-4 py-2 space-y-1">
                  {addedPositionen.map((pos, idx) => {
                    const einheitLabel = pos.einheitKey !== 'none'
                      ? EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label
                      : '';
                    return (
                      <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <IconPackage size={13} className="shrink-0" />
                        <span className="truncate">
                          {pos.materialName} — {pos.menge} {einheitLabel}
                          {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button onClick={handleReset} variant="outline" className="flex-1">
                Neuen Auftrag anlegen
              </Button>
              <a href="#/" className="flex-1">
                <Button className="w-full">Zurück zum Dashboard</Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die vorherigen Schritte.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
