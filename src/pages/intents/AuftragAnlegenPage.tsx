/**
 * AuftragAnlegenPage
 *
 * Intent: Neuen Auftrag anlegen
 * Flow: Kunde auswählen → Auftragsdaten erfassen → Materialien hinzufügen → Zusammenfassung & Erstellen
 * Entities: Kunden (read), Aufträge (create), Material (read), Auftragspositionen (create)
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge
 */
import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  IconUser,
  IconPlus,
  IconTrash,
  IconCheck,
  IconAlertCircle,
  IconClipboardList,
} from '@tabler/icons-react';

// ---- Types ----

interface Position {
  id: string; // local key only
  materialId: string;
  menge: number;
  einheit_position: string;
  positionsbeschreibung: string;
}

interface AuftragForm {
  auftragsnummer: string;
  auftragsdatum: string;
  status: string;
  prioritaet: string | undefined;
  auftragsbeschreibung: string;
  wunschtermin: string;
  liefertermin: string;
  monteur: string;
  auftrag_notizen: string;
}

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftragsdaten' },
  { label: 'Materialien' },
  { label: 'Abschluss' },
];

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']['status'];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']['prioritaet'];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']['einheit_position'];

function kundeLabel(k: Kunden) {
  const name = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
  return name || k.fields.firma || k.record_id;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Step state — read ?step= from URL, default to 1
  const initialStep = Math.min(
    Math.max(parseInt(searchParams.get('step') ?? '1', 10) || 1, 1),
    4,
  );
  const [step, setStep] = useState(initialStep);

  // Step 1: selected customer
  const initialKundeId = searchParams.get('kundeId') ?? null;
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(initialKundeId);

  // Step 1: create customer mini-form
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [newKundeFirma, setNewKundeFirma] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2: order form
  const [auftragForm, setAuftragForm] = useState<AuftragForm>({
    auftragsnummer: '',
    auftragsdatum: '',
    status: STATUS_OPTIONS[0]?.key ?? 'offen',
    prioritaet: undefined,
    auftragsbeschreibung: '',
    wunschtermin: '',
    liefertermin: '',
    monteur: '',
    auftrag_notizen: '',
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof AuftragForm, string>>>({});

  // Step 3: positions
  const [positions, setPositions] = useState<Position[]>([]);

  // Step 4: submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successAuftragId, setSuccessAuftragId] = useState<string | null>(null);

  // ---- Handlers ----

  const handleSelectKunde = useCallback(
    (id: string) => {
      setSelectedKundeId(id);
      setStep(2);
    },
    [],
  );

  const handleCreateKunde = useCallback(async () => {
    if (!newKundeVorname.trim() && !newKundeNachname.trim() && !newKundeFirma.trim()) {
      setKundeCreateError('Bitte mindestens Vorname, Nachname oder Firma angeben.');
      return;
    }
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const result = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname || undefined,
        nachname: newKundeNachname || undefined,
        telefon: newKundeTelefon || undefined,
        firma: newKundeFirma || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeTelefon('');
      setNewKundeFirma('');
      setSelectedKundeId(result.record_id);
      setStep(2);
    } catch {
      setKundeCreateError('Kunde konnte nicht angelegt werden. Bitte erneut versuchen.');
    } finally {
      setKundeCreateLoading(false);
    }
  }, [newKundeVorname, newKundeNachname, newKundeTelefon, newKundeFirma, fetchAll]);

  const validateStep2 = useCallback(() => {
    const errs: Partial<Record<keyof AuftragForm, string>> = {};
    if (!auftragForm.auftragsnummer.trim()) errs.auftragsnummer = 'Pflichtfeld';
    if (!auftragForm.auftragsdatum) errs.auftragsdatum = 'Pflichtfeld';
    if (!auftragForm.status) errs.status = 'Pflichtfeld';
    if (!auftragForm.auftragsbeschreibung.trim()) errs.auftragsbeschreibung = 'Pflichtfeld';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [auftragForm]);

  const handleStep2Next = useCallback(() => {
    if (validateStep2()) setStep(3);
  }, [validateStep2]);

  const addPosition = useCallback(() => {
    setPositions(prev => [
      ...prev,
      {
        id: String(Date.now()),
        materialId: material[0]?.record_id ?? '',
        menge: 1,
        einheit_position: EINHEIT_OPTIONS[0]?.key ?? 'stueck',
        positionsbeschreibung: '',
      },
    ]);
  }, [material]);

  const removePosition = useCallback((id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id));
  }, []);

  const updatePosition = useCallback(
    (id: string, field: keyof Omit<Position, 'id'>, value: string | number) => {
      setPositions(prev =>
        prev.map(p => (p.id === id ? { ...p, [field]: value } : p)),
      );
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedKundeId) {
      setSubmitError('Kein Kunde ausgewählt.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const auftrag = await LivingAppsService.createAuftraegeEntry({
        auftragsnummer: auftragForm.auftragsnummer,
        auftragsdatum: auftragForm.auftragsdatum,
        status: auftragForm.status,
        prioritaet: auftragForm.prioritaet || undefined,
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
        auftragsbeschreibung: auftragForm.auftragsbeschreibung,
        wunschtermin: auftragForm.wunschtermin || undefined,
        liefertermin: auftragForm.liefertermin || undefined,
        monteur: auftragForm.monteur || undefined,
        auftrag_notizen: auftragForm.auftrag_notizen || undefined,
      });

      for (const pos of positions) {
        if (!pos.materialId) continue;
        await LivingAppsService.createAuftragspositionenEntry({
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, auftrag.record_id),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: pos.menge,
          einheit_position: pos.einheit_position,
          positionsbeschreibung: pos.positionsbeschreibung || undefined,
        });
      }

      setSuccessAuftragId(auftrag.record_id);
      await fetchAll();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [selectedKundeId, auftragForm, positions, fetchAll]);

  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedKundeId(null);
    setAuftragForm({
      auftragsnummer: '',
      auftragsdatum: '',
      status: STATUS_OPTIONS[0]?.key ?? 'offen',
      prioritaet: undefined,
      auftragsbeschreibung: '',
      wunschtermin: '',
      liefertermin: '',
      monteur: '',
      auftrag_notizen: '',
    });
    setPositions([]);
    setSubmitError(null);
    setSuccessAuftragId(null);
    setFormErrors({});
  }, []);

  // ---- Derived data ----

  const selectedKunde = kunden.find(k => k.record_id === selectedKundeId) ?? null;

  // ---- Render ----

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Schritt für Schritt zum fertigen Auftrag"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ===== STEP 1: Kunde auswählen ===== */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Kunde auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Wähle einen bestehenden Kunden oder lege einen neuen an.
            </p>
          </div>

          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: kundeLabel(k),
              subtitle: [k.fields.firma, k.fields.ort].filter(Boolean).join(' · '),
              stats: k.fields.telefon ? [{ label: 'Tel.', value: k.fields.telefon }] : [],
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectKunde}
            searchPlaceholder="Kunde suchen..."
            emptyText="Noch kein Kunde vorhanden."
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => {
              setShowCreateKunde(v => !v);
              setKundeCreateError(null);
            }}
            createDialog={
              showCreateKunde ? (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Vorname</label>
                      <Input
                        value={newKundeVorname}
                        onChange={e => setNewKundeVorname(e.target.value)}
                        placeholder="Vorname"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Nachname</label>
                      <Input
                        value={newKundeNachname}
                        onChange={e => setNewKundeNachname(e.target.value)}
                        placeholder="Nachname"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Firma</label>
                      <Input
                        value={newKundeFirma}
                        onChange={e => setNewKundeFirma(e.target.value)}
                        placeholder="Firma (optional)"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Telefon</label>
                      <Input
                        value={newKundeTelefon}
                        onChange={e => setNewKundeTelefon(e.target.value)}
                        placeholder="Telefon (optional)"
                      />
                    </div>
                  </div>
                  {kundeCreateError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <IconAlertCircle size={13} /> {kundeCreateError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCreateKunde}
                      disabled={kundeCreateLoading}
                      size="sm"
                    >
                      {kundeCreateLoading ? 'Wird angelegt…' : 'Kunden anlegen & auswählen'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCreateKunde(false)}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </div>
              ) : null
            }
          />
        </div>
      )}

      {/* ===== STEP 2: Auftragsdaten erfassen ===== */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Auftragsdaten erfassen</h2>
            {selectedKunde && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag für <span className="font-medium text-foreground">{kundeLabel(selectedKunde)}</span>
              </p>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-5 space-y-4">
            {/* Auftragsnummer + Datum */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Auftragsnummer <span className="text-destructive">*</span>
                </label>
                <Input
                  value={auftragForm.auftragsnummer}
                  onChange={e =>
                    setAuftragForm(f => ({ ...f, auftragsnummer: e.target.value }))
                  }
                  placeholder="z. B. AUF-2026-001"
                />
                {formErrors.auftragsnummer && (
                  <p className="text-xs text-destructive">{formErrors.auftragsnummer}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Auftragsdatum <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={auftragForm.auftragsdatum}
                  onChange={e =>
                    setAuftragForm(f => ({ ...f, auftragsdatum: e.target.value }))
                  }
                />
                {formErrors.auftragsdatum && (
                  <p className="text-xs text-destructive">{formErrors.auftragsdatum}</p>
                )}
              </div>
            </div>

            {/* Status + Priorität */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Status <span className="text-destructive">*</span>
                </label>
                <Select
                  value={auftragForm.status}
                  onValueChange={v => setAuftragForm(f => ({ ...f, status: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Status wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.status && (
                  <p className="text-xs text-destructive">{formErrors.status}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Priorität</label>
                <Select
                  value={auftragForm.prioritaet}
                  onValueChange={v => setAuftragForm(f => ({ ...f, prioritaet: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Priorität wählen (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITAET_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Beschreibung */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Auftragsbeschreibung <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={auftragForm.auftragsbeschreibung}
                onChange={e =>
                  setAuftragForm(f => ({ ...f, auftragsbeschreibung: e.target.value }))
                }
                placeholder="Beschreibe den Auftrag..."
                rows={3}
              />
              {formErrors.auftragsbeschreibung && (
                <p className="text-xs text-destructive">{formErrors.auftragsbeschreibung}</p>
              )}
            </div>

            {/* Wunschtermin + Liefertermin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Wunschtermin</label>
                <Input
                  type="datetime-local"
                  value={auftragForm.wunschtermin}
                  onChange={e =>
                    setAuftragForm(f => ({ ...f, wunschtermin: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Liefertermin</label>
                <Input
                  type="datetime-local"
                  value={auftragForm.liefertermin}
                  onChange={e =>
                    setAuftragForm(f => ({ ...f, liefertermin: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Monteur */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Monteur</label>
              <Input
                value={auftragForm.monteur}
                onChange={e =>
                  setAuftragForm(f => ({ ...f, monteur: e.target.value }))
                }
                placeholder="Name des Monteurs (optional)"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>
              Zurück
            </Button>
            <Button onClick={handleStep2Next}>
              Weiter zu Materialien
            </Button>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Materialien hinzufügen ===== */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Materialien hinzufügen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Füge Positionen für diesen Auftrag hinzu. Das kannst du auch überspringen.
            </p>
          </div>

          <div className="space-y-3">
            {positions.length === 0 && (
              <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
                <IconClipboardList size={32} className="mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Noch keine Positionen hinzugefügt.</p>
              </div>
            )}

            {positions.map((pos, idx) => (
              <div
                key={pos.id}
                className="rounded-2xl border bg-card p-4 space-y-3 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    Position {idx + 1}
                  </span>
                  <button
                    onClick={() => removePosition(pos.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Position entfernen"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>

                {/* Material */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Material</label>
                  <Select
                    value={pos.materialId}
                    onValueChange={v => updatePosition(pos.id, 'materialId', v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Material wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {material.map((m: Material) => (
                        <SelectItem key={m.record_id} value={m.record_id}>
                          {m.fields.bezeichnung ?? m.record_id}
                          {m.fields.artikelnummer
                            ? ` (${m.fields.artikelnummer})`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Menge + Einheit + Beschreibung */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Menge <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={pos.menge}
                      onChange={e =>
                        updatePosition(pos.id, 'menge', parseFloat(e.target.value) || 1)
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Einheit</label>
                    <Select
                      value={pos.einheit_position}
                      onValueChange={v => updatePosition(pos.id, 'einheit_position', v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EINHEIT_OPTIONS.map(o => (
                          <SelectItem key={o.key} value={o.key}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Bezeichnung</label>
                    <Input
                      value={pos.positionsbeschreibung}
                      onChange={e =>
                        updatePosition(pos.id, 'positionsbeschreibung', e.target.value)
                      }
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </div>
            ))}

            {material.length > 0 && (
              <Button
                variant="outline"
                onClick={addPosition}
                className="w-full gap-2"
              >
                <IconPlus size={15} />
                Position hinzufügen
              </Button>
            )}

            {material.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Kein Material im System vorhanden — Positionen können später ergänzt werden.
              </p>
            )}
          </div>

          {/* Position count badge */}
          {positions.length > 0 && (
            <div className="rounded-xl bg-secondary px-4 py-2 text-sm text-foreground inline-flex items-center gap-2">
              <IconClipboardList size={15} className="text-primary" />
              <span>
                <span className="font-semibold">{positions.length}</span>{' '}
                {positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
              </span>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>
              Zurück
            </Button>
            <Button onClick={() => setStep(4)}>
              Weiter zur Zusammenfassung
            </Button>
          </div>
        </div>
      )}

      {/* ===== STEP 4: Zusammenfassung & Abschluss ===== */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Zusammenfassung</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Überprüfe die Angaben und lege den Auftrag an.
            </p>
          </div>

          {!successAuftragId ? (
            <>
              {/* Summary card */}
              <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
                {/* Kunde */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <IconUser size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Kunde</p>
                    <p className="text-sm font-medium text-foreground truncate">
                      {selectedKunde ? kundeLabel(selectedKunde) : '—'}
                    </p>
                    {selectedKunde?.fields.firma && (
                      <p className="text-xs text-muted-foreground truncate">
                        {selectedKunde.fields.firma}
                      </p>
                    )}
                  </div>
                </div>

                <hr className="border-border" />

                {/* Auftrag details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                    <p className="font-medium">{auftragForm.auftragsnummer || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Auftragsdatum</p>
                    <p className="font-medium">{auftragForm.auftragsdatum || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <StatusBadge
                      statusKey={auftragForm.status}
                      label={STATUS_OPTIONS.find(o => o.key === auftragForm.status)?.label ?? auftragForm.status}
                    />
                  </div>
                  {auftragForm.prioritaet && (
                    <div>
                      <p className="text-xs text-muted-foreground">Priorität</p>
                      <p className="font-medium">
                        {PRIORITAET_OPTIONS.find(o => o.key === auftragForm.prioritaet)?.label ?? auftragForm.prioritaet}
                      </p>
                    </div>
                  )}
                  {auftragForm.monteur && (
                    <div>
                      <p className="text-xs text-muted-foreground">Monteur</p>
                      <p className="font-medium">{auftragForm.monteur}</p>
                    </div>
                  )}
                  {auftragForm.wunschtermin && (
                    <div>
                      <p className="text-xs text-muted-foreground">Wunschtermin</p>
                      <p className="font-medium">{auftragForm.wunschtermin.replace('T', ' ')}</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Beschreibung</p>
                  <p className="text-sm">{auftragForm.auftragsbeschreibung}</p>
                </div>

                {positions.length > 0 && (
                  <>
                    <hr className="border-border" />
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Positionen ({positions.length})
                      </p>
                      <div className="space-y-2">
                        {positions.map((pos, idx) => {
                          const mat = material.find(m => m.record_id === pos.materialId);
                          const einheitLabel =
                            EINHEIT_OPTIONS.find(o => o.key === pos.einheit_position)?.label ??
                            pos.einheit_position;
                          return (
                            <div
                              key={pos.id}
                              className="flex items-center gap-2 text-sm text-foreground"
                            >
                              <span className="text-muted-foreground w-5 shrink-0">
                                {idx + 1}.
                              </span>
                              <span className="flex-1 min-w-0 truncate">
                                {mat?.fields.bezeichnung ?? '—'}
                                {pos.positionsbeschreibung
                                  ? ` — ${pos.positionsbeschreibung}`
                                  : ''}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {pos.menge} {einheitLabel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {submitError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex items-start gap-2 text-sm text-destructive">
                  <IconAlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(3)}>
                  Zurück
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Wird angelegt…' : 'Auftrag anlegen'}
                </Button>
              </div>
            </>
          ) : (
            /* Success state */
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <IconCheck size={28} className="text-green-600" stroke={2.5} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Auftrag wurde angelegt!
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Auftragsnummer:{' '}
                  <span className="font-medium text-foreground">
                    {auftragForm.auftragsnummer}
                  </span>
                  {positions.length > 0 && (
                    <>
                      {' '}· {positions.length}{' '}
                      {positions.length === 1 ? 'Position' : 'Positionen'} angelegt
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={handleReset}>
                  Neuen Auftrag anlegen
                </Button>
                <a href="#/">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
