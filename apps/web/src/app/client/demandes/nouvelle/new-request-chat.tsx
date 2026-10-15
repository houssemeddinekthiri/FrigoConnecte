'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CalendarCheck, ClipboardCheck, PackagePlus, Repeat, Send, ShieldCheck, Snowflake, Wrench } from 'lucide-react';
import { createServiceRequestSchema, type EquipmentDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { PhotoPicker, type Uploaded } from '@/components/photo-picker';
import { Input, Textarea } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { estimateText, type Estimate } from '@/lib/estimate';

type Answers = { serviceType?: string; trade?: string; description?: string; urgency?: string; budget?: string };
interface Step {
  key: keyof Answers | 'address' | 'photos' | 'send';
  ask: string;
  choices?: [value: string, label: string][];
  placeholder?: string;
}

// 4 questions au lieu d'un formulaire de 9 champs : le titre est déduit de la description,
// code postal et ville viennent de l'adresse trouvée par le géocodage.
const STEPS: Step[] = [
  { key: 'serviceType', ask: 'Bonjour 👋 De quoi avez-vous besoin ?', choices: [['breakdown', 'Une panne'], ['maintenance', 'Un entretien'], ['installation', 'Une installation'], ['audit', 'Un audit'], ['compliance', 'Une mise en conformité'], ['annual_contract', 'Un contrat annuel']] },
  { key: 'trade', ask: 'Sur quel type d\'équipement ?', choices: [['refrigeration', 'Froid commercial'], ['air_conditioning', 'Climatisation'], ['heating', 'Chauffage'], ['ventilation', 'Ventilation'], ['heat_pump', 'Pompe à chaleur'], ['maintenance_company', 'Plusieurs / je ne sais pas']] },
  { key: 'description', ask: 'Décrivez la situation en quelques mots (marque, symptômes, depuis quand…).', placeholder: 'Ex : le compresseur ne démarre plus depuis ce matin, la chambre froide est à 12 °C' },
  { key: 'urgency', ask: 'C\'est urgent ?', choices: [['emergency', 'Urgence, panne bloquante'], ['high', 'Sous 24 h'], ['normal', 'Sous quelques jours'], ['low', 'Pas pressé']] },
  { key: 'address', ask: 'Où doit avoir lieu l\'intervention ? (adresse complète)', placeholder: '1 place Bellecour, 69002 Lyon' },
  { key: 'budget', ask: 'Avez-vous un budget maximum en tête ? Les pros le voient et vous proposent un devis adapté ; vous gardez la décision finale.', choices: [['none', 'Pas de limite précise'], ['500', 'Jusqu\'à 500 €'], ['1500', 'Jusqu\'à 1 500 €'], ['5000', 'Jusqu\'à 5 000 €'], ['15000', 'Jusqu\'à 15 000 €']] },
  { key: 'photos', ask: 'Une photo de la machine, de l\'étiquette ou du code d\'erreur aide les pros à chiffrer plus vite (facultatif).' },
  { key: 'send', ask: 'Tout est prêt. On l\'envoie aux prestataires, ou vous la gardez en brouillon ?', choices: [['publish', 'Publier maintenant'], ['draft', 'Garder en brouillon']] },
];

const ICONS: Record<string, typeof Wrench> = { breakdown: Wrench, maintenance: CalendarCheck, installation: PackagePlus, audit: ClipboardCheck, compliance: ShieldCheck, annual_contract: Repeat };

/** API Adresse (data.gouv.fr) : gratuite, sans clé. Une seule saisie → adresse, CP, ville et coordonnées. */
async function geocode(q: string) {
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`);
  const f = (await res.json()).features?.[0];
  if (!f) throw new Error('ADDRESS_NOT_FOUND');
  const [lng, lat] = f.geometry.coordinates as [number, number];
  const p = f.properties as { name: string; postcode: string; city: string; label: string };
  return { address: p.name, postalCode: p.postcode, city: p.city, label: p.label, location: { lat, lng } };
}

export function NewRequestChat({ preferredProviderId }: { preferredProviderId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [msgs, setMsgs] = useState<{ from: 'bot' | 'me'; text: string }[]>([{ from: 'bot', text: STEPS[0].ask }]);
  const [value, setValue] = useState('');
  const [where, setWhere] = useState('');
  const [eqId, setEqId] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];

  const equipment = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment') }).data;
  // dernière adresse utilisée → proposée en un clic
  const lastAddress = useQuery({
    queryKey: ['last-address'],
    queryFn: async () => {
      const [last] = await api<{ id: string }[]>('service-requests');
      if (!last) return null;
      const d = await api<{ address: string; postalCode: string; city: string }>(`service-requests/${last.id}`);
      return `${d.address}, ${d.postalCode} ${d.city}`;
    },
  }).data;

  const publish = useMutation({
    mutationFn: async ({ a, asDraft }: { a: Answers; asDraft: boolean }) => {
      const { label: _label, ...place } = await geocode(where);
      const body = createServiceRequestSchema.parse({ ...a, ...place, attachmentIds: photos.map((p) => p.id), equipmentId: eqId || undefined, preferredProviderId, budgetMaxCents: a.budget && a.budget !== 'none' ? Number(a.budget) * 100 : undefined, draft: asDraft, title: a.description!.split('\n')[0].slice(0, 80) });
      return api<{ id: string }>('service-requests', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-requests'] }); router.push('/client'); },
    onError: (e) => {
      const notFound = e instanceof Error && e.message === 'ADDRESS_NOT_FOUND';
      setError(notFound ? 'Adresse introuvable, vérifiez-la.' : 'Envoi impossible, réessayez dans un instant.');
      if (notFound) { setIndex(STEPS.findIndex((s) => s.key === 'address')); setMsgs((m) => [...m, { from: 'bot', text: STEPS[STEPS.length - 2].ask }]); }
    },
  });

  const waiting = publish.isPending || publish.isSuccess;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs]);

  /** Après le choix du domaine : fourchette indicative, ajoutée à la conversation si on en a une. */
  async function hint(serviceType: string | undefined, trade: string) {
    const e = await api<Estimate | null>(`service-requests/estimate?serviceType=${serviceType}&trade=${trade}`).catch(() => null);
    if (e) setMsgs((m) => [...m, { from: 'bot', text: `💡 Repère : ce type de demande donne en général des devis de ${estimateText(e)}. Indicatif, chaque pro chiffre selon votre cas.` }]);
  }

  function submit(v: string, label: string) {
    v = v.trim();
    if (step.key === 'description' && v.length < 10) return setError('Quelques mots de plus, pour que les pros comprennent.');
    if (step.key === 'address' && v.length < 3) return setError('Indiquez une adresse.');
    setError('');
    const next = { ...answers, ...(step.key !== 'address' && step.key !== 'photos' && step.key !== 'send' && { [step.key]: v }) };
    setAnswers(next);
    setValue('');
    const added: typeof msgs = [{ from: 'me', text: label }];
    if (step.key === 'send') {
      added.push({ from: 'bot', text: v === 'draft' ? 'Je l\'enregistre en brouillon…' : 'Parfait, je publie votre demande et je préviens les prestataires proches…' });
      publish.mutate({ a: next, asDraft: v === 'draft' });
    } else {
      if (step.key === 'address') setWhere(v);
      if (step.key === 'trade') void hint(next.serviceType, v);
      setIndex(index + 1);
      added.push({ from: 'bot', text: STEPS[index + 1].ask });
    }
    setMsgs((m) => [...m, ...added]);
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="h-1.5 bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={Math.min(index, STEPS.length)} aria-label="Progression">
        <div className="h-full bg-primary transition-all" style={{ width: `${(Math.min(index + (waiting ? 1 : 0), STEPS.length) / STEPS.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-between border-b px-5 py-3 text-sm">
        <span className="font-medium">Assistant FrigoConnect</span>
        <span className="text-muted-foreground">Étape {Math.min(index + 1, STEPS.length)} sur {STEPS.length}</span>
      </div>
      <div className="flex min-h-[22rem] flex-col p-5">
      <div className="max-h-[50dvh] flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={m.from === 'me' ? 'flex justify-end' : 'flex items-end gap-2'}>
            {m.from === 'bot' && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Snowflake className="size-4" /></span>}
            <p className={m.from === 'me' ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground' : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-secondary px-4 py-2 text-sm'}>{m.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {!waiting && (
        <div className="mt-3 border-t pt-3">
          {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
          {step.key === 'address' && equipment?.map((q) => {
            const full = `${q.address}, ${q.postalCode} ${q.city}`;
            return <Button key={q.id} type="button" variant="outline" className="mb-2 mr-2" onClick={() => { setEqId(q.id); submit(full, full); }}>📍 {q.label}</Button>;
          })}
          {step.key === 'address' && lastAddress && !equipment?.some((q) => lastAddress.startsWith(q.address)) && (
            <Button type="button" variant="outline" className="mb-2" onClick={() => submit(lastAddress, lastAddress)}>📍 {lastAddress}</Button>
          )}
          {step.key === 'photos' ? (
            <div className="grid gap-3">
              <PhotoPicker value={photos} onChange={setPhotos} />
              <Button type="button" onClick={() => submit('', photos.length ? `${photos.length} fichier(s) joint(s)` : 'Pas de photo')}>{photos.length ? 'Continuer' : 'Passer cette étape'}</Button>
            </div>
          ) : step.choices ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {step.choices.map(([v, l]) => {
                const Icon = step.key === 'serviceType' ? ICONS[v] : undefined;
                return <Button key={v} type="button" variant="outline" className="h-auto justify-start gap-2 whitespace-normal px-4 py-3 text-left hover:border-primary hover:bg-primary/5" onClick={() => submit(v, l)}>{Icon && <Icon className="text-primary" />}{l}</Button>;
              })}
            </div>
          ) : (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(value, value); }}>
              {step.key === 'description'
                ? <Textarea key={step.key} autoFocus rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={step.placeholder} aria-label="Votre réponse" />
                : <Input key={step.key} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={step.placeholder} aria-label="Votre réponse" autoComplete="street-address" />}
              <Button type="submit" size="icon" aria-label="Envoyer"><Send /></Button>
            </form>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
