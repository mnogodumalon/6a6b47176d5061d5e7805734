import type { Pruefprotokoll, Auftraege } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { APP_IDS } from '@/types/app';
import { AttachmentsSection } from '@/components/AttachmentsSection';
import { MediaThumbnail } from '@/components/widgets/MediaViewer';
import { Badge } from '@/components/ui/badge';
import { IconPencil, IconFileText } from '@tabler/icons-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

function formatDate(d?: string) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd.MM.yyyy', { locale: de }); } catch { return d; }
}

interface PruefprotokollViewDialogProps {
  open: boolean;
  onClose: () => void;
  record: Pruefprotokoll | null;
  onEdit: (record: Pruefprotokoll) => void;
  auftraegeList: Auftraege[];
}

export function PruefprotokollViewDialog({ open, onClose, record, onEdit, auftraegeList }: PruefprotokollViewDialogProps) {
  function getAuftraegeDisplayName(url?: unknown) {
    if (!url) return '—';
    const id = extractRecordId(url);
    return auftraegeList.find(r => r.record_id === id)?.fields.auftragsnummer ?? '—';
  }

  if (!record) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prüfprotokoll anzeigen</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { onClose(); onEdit(record); }}>
            <IconPencil className="h-3.5 w-3.5 mr-1.5" />
            Bearbeiten
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Auftrag</Label>
            <p className="text-sm">{getAuftraegeDisplayName(record.fields.auftrag_pruef)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Vorname des Monteurs</Label>
            <p className="text-sm">{record.fields.monteur_name_vorname ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nachname des Monteurs</Label>
            <p className="text-sm">{record.fields.monteur_name_nachname ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Datum der Prüfung</Label>
            <p className="text-sm">{formatDate(record.fields.pruefungsdatum)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prüfergebnis</Label>
            <Badge variant="secondary">{record.fields.pruefergebnis?.label ?? '—'}</Badge>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mängelbeschreibung</Label>
            <p className="text-sm whitespace-pre-wrap">{record.fields.maengelbeschreibung ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Eingeleitete Maßnahmen</Label>
            <p className="text-sm whitespace-pre-wrap">{record.fields.massnahmen ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fotos / Anhänge</Label>
            {record.fields.fotos ? (
              <MediaThumbnail src={record.fields.fotos} fit="contain" className="w-full rounded-lg border" />
            ) : <p className="text-sm text-muted-foreground">—</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Bemerkungen</Label>
            <p className="text-sm whitespace-pre-wrap">{record.fields.bemerkungen_pruef ?? '—'}</p>
          </div>
          <div className="pt-2 border-t border-border">
            <AttachmentsSection appId={APP_IDS.PRUEFPROTOKOLL} recordId={record.record_id} readOnly />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}