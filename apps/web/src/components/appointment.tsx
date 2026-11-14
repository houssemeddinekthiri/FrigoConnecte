'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import type { ContractDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { ApiError, api } from '@/lib/api';

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Valeur d'un champ `datetime-local` (heure locale du navigateur, sans fuseau). */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Fichier .ics d'un rendez-vous de 2 h : s'ouvre dans l'agenda du téléphone ou de l'ordinateur (Google, Apple, Outlook). */
function downloadIcs(contract: ContractDto, role: 'client' | 'provider') {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const text = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const start = new Date(contract.scheduledAt!);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FrigoConnect//FR', 'BEGIN:VEVENT',
    `UID:${contract.id}@frigoconnect`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 2 * 3_600_000))}`,
    `SUMMARY:${text(`Intervention : ${contract.requestTitle}`)}`,
    `DESCRIPTION:${text(`${role === 'client' ? 'Prestataire' : 'Client'} : ${contract.counterpartName}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  Object.assign(document.createElement('a'), { href: url, download: 'intervention.ics' }).click();
  URL.revokeObjectURL(url);
}

/** Rendez-vous d'intervention : le prestataire le fixe ou le déplace, le client en est prévenu ; chacun peut l'ajouter à son agenda. */
export function Appointment({ contract, role, onChange }: { contract: ContractDto; role: 'client' | 'provider'; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => api(`contracts/${contract.id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(value).toISOString() }) }),
    onSuccess: () => { setEditing(false); onChange(); },
  });
  const canSchedule = contract.actions.schedule;
  if (!contract.scheduledAt && !canSchedule) {
    // côté client, tant que rien n'est fixé : on dit simplement ce qui va se passer
    return role === 'client' && contract.status === 'active' && !contract.workDoneAt
      ? <p className="text-sm text-muted-foreground">Date d&apos;intervention : le prestataire la fixe une fois l&apos;acompte réglé, vous serez prévenu.</p>
      : null;
  }
  const open = () => { setValue(toLocalInput(contract.scheduledAt ? new Date(contract.scheduledAt) : new Date(Date.now() + 86_400_000))); save.reset(); setEditing(true); };

  return (
    <div className="grid gap-2 rounded-lg border bg-accent/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <CalendarClock className="size-4 shrink-0 text-primary" />
          {contract.scheduledAt ? <span>Intervention prévue <span className="first-letter:lowercase">{when(contract.scheduledAt)}</span></span> : 'Aucune date d\'intervention fixée'}
        </p>
        <div className="flex flex-wrap gap-2">
          {contract.scheduledAt && <Button size="sm" variant="outline" onClick={() => downloadIcs(contract, role)}><CalendarPlus /> Ajouter à mon agenda</Button>}
          {canSchedule && !editing && <Button size="sm" variant={contract.scheduledAt ? 'ghost' : 'default'} onClick={open}>{contract.scheduledAt ? 'Déplacer' : 'Planifier l\'intervention'}</Button>}
        </div>
      </div>
      {editing && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <label className="grid gap-1 text-xs font-medium">Date et heure
            <Input type="datetime-local" required value={value} min={toLocalInput(new Date())} onChange={(e) => setValue(e.target.value)} className="w-auto" />
          </label>
          <Button size="sm" disabled={save.isPending || !value}>{save.isPending ? 'Enregistrement…' : 'Confirmer'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
          <p className="w-full text-xs text-muted-foreground">Le client est prévenu par notification et par email.</p>
        </form>
      )}
      {save.isError && <p role="alert" className="text-destructive">{save.error instanceof ApiError ? ((save.error.body as { message?: string })?.message ?? 'Enregistrement impossible') : 'Enregistrement impossible'}</p>}
    </div>
  );
}
