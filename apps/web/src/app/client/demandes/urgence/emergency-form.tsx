'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed, Siren } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createServiceRequestSchema, TRADES, type EquipmentDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { TRADE_LABELS } from '@/lib/format';
import { geocode } from '@/lib/geocode';

/** Urgence : panne bloquante, type « dépannage », publiée tout de suite. Adresse = un équipement enregistré, le GPS, ou saisie libre. */
export function EmergencyForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const equipment = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment') }).data ?? [];
  const [eqId, setEqId] = useState('');
  const [trade, setTrade] = useState('refrigeration');
  const [description, setDescription] = useState('');
  const [where, setWhere] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const eq = equipment.find((q) => q.id === eqId);

  const pickEquipment = (id: string) => {
    setEqId(id);
    const q = equipment.find((x) => x.id === id);
    if (q) { setTrade(q.trade); setWhere(`${q.address}, ${q.postalCode} ${q.city}`); }
  };

  function locate() {
    setError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${coords.longitude}&lat=${coords.latitude}`);
          setWhere((await res.json()).features?.[0]?.properties?.label ?? '');
        } catch { setError('Position introuvable, saisissez l\'adresse.'); }
        setLocating(false);
      },
      () => { setError('Position refusée, saisissez l\'adresse.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const send = useMutation({
    mutationFn: async () => {
      const place = await geocode(where);
      const text = description.trim();
      const body = createServiceRequestSchema.parse({
        serviceType: 'breakdown', trade, urgency: 'emergency', ...place,
        title: `Urgence : ${text.split('\n')[0].slice(0, 100)}`, description: text, equipment: eq ? eq.details ?? eq.label : undefined, equipmentId: eq?.id,
      });
      return api<{ id: string }>('service-requests', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: ({ id }) => { void qc.invalidateQueries({ queryKey: ['my-requests'] }); router.push(`/client/demandes/${id}`); },
    onError: (e) => setError(e instanceof Error && e.message === 'ADDRESS_NOT_FOUND' ? 'Adresse introuvable, vérifiez-la.' : 'Envoi impossible, réessayez ou appelez-nous.'),
  });

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setError(''); if (description.trim().length < 10) return setError('Décrivez la panne en quelques mots.'); send.mutate(); }}>
      {equipment.length > 0 && (
        <Field label="Quel équipement ?">
          <Select value={eqId} onChange={(e) => pickEquipment(e.target.value)}>
            <option value="">— Autre / je ne sais pas —</option>
            {equipment.map((q) => <option key={q.id} value={q.id}>{q.label} · {q.city}</option>)}
          </Select>
        </Field>
      )}
      {!eq && <Field label="Domaine"><Select value={trade} onChange={(e) => setTrade(e.target.value)}>{TRADES.map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}</Select></Field>}
      <Field label="Que se passe-t-il ?"><Textarea autoFocus rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex : le compresseur ne démarre plus, la chambre froide est à 12 °C" /></Field>
      <Field label="Où ?">
        <div className="flex gap-2">
          <Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Adresse complète" autoComplete="street-address" required />
          <Button type="button" variant="outline" disabled={locating} onClick={locate} aria-label="Utiliser ma position"><LocateFixed /></Button>
        </div>
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" variant="destructive" disabled={send.isPending}><Siren /> {send.isPending ? 'Envoi…' : 'Envoyer l\'urgence'}</Button>
    </form>
  );
}
