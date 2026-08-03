import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';

/** Dashboard data + the OPTIMISTIC-WRITE API.
 *
 *  The per-entity setters (`set<Entity>`) are exported for exactly one job:
 *  optimistic updates on drag writes (onEventDrop / onEventResize /
 *  onCardMove). Call the setter FIRST — the bar/card lands instantly — then
 *  fire the PATCH in the background and call `fetchAll()` ONLY in the catch.
 *  Never await the PATCH before updating state (the UI freezes for the full
 *  round-trip on every drag) and never refetch after a successful write.
 *  There is no other mechanism (no `__optimistic`, no `mutate`).
 */
export function useDashboardData() {
  const [kunden, setKunden] = useState<Kunden[]>([]);
  const [material, setMaterial] = useState<Material[]>([]);
  const [auftraege, setAuftraege] = useState<Auftraege[]>([]);
  const [auftragspositionen, setAuftragspositionen] = useState<Auftragspositionen[]>([]);
  const [pruefprotokoll, setPruefprotokoll] = useState<Pruefprotokoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [kundenData, materialData, auftraegeData, auftragspositionenData, pruefprotokollData] = await Promise.all([
        LivingAppsService.getKunden(),
        LivingAppsService.getMaterial(),
        LivingAppsService.getAuftraege(),
        LivingAppsService.getAuftragspositionen(),
        LivingAppsService.getPruefprotokoll(),
      ]);
      setKunden(kundenData);
      setMaterial(materialData);
      setAuftraege(auftraegeData);
      setAuftragspositionen(auftragspositionenData);
      setPruefprotokoll(pruefprotokollData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fehler beim Laden der Daten'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    async function silentRefresh() {
      try {
        const [kundenData, materialData, auftraegeData, auftragspositionenData, pruefprotokollData] = await Promise.all([
          LivingAppsService.getKunden(),
          LivingAppsService.getMaterial(),
          LivingAppsService.getAuftraege(),
          LivingAppsService.getAuftragspositionen(),
          LivingAppsService.getPruefprotokoll(),
        ]);
        setKunden(kundenData);
        setMaterial(materialData);
        setAuftraege(auftraegeData);
        setAuftragspositionen(auftragspositionenData);
        setPruefprotokoll(pruefprotokollData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleRefresh);
  }, []);

  const kundenMap = useMemo(() => {
    const m = new Map<string, Kunden>();
    kunden.forEach(r => m.set(r.record_id, r));
    return m;
  }, [kunden]);

  const materialMap = useMemo(() => {
    const m = new Map<string, Material>();
    material.forEach(r => m.set(r.record_id, r));
    return m;
  }, [material]);

  const auftraegeMap = useMemo(() => {
    const m = new Map<string, Auftraege>();
    auftraege.forEach(r => m.set(r.record_id, r));
    return m;
  }, [auftraege]);

  return { kunden, setKunden, material, setMaterial, auftraege, setAuftraege, auftragspositionen, setAuftragspositionen, pruefprotokoll, setPruefprotokoll, loading, error, fetchAll, kundenMap, materialMap, auftraegeMap };
}