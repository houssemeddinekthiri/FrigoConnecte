'use client';

import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api';

/**
 * Action qui exige un MOTIF (refus, suspension, litige…) : le motif est enregistré dans le journal d'audit.
 * Un clic ouvre la zone de saisie ; la confirmation reste désactivée tant que le motif est trop court.
 */
export function ReasonAction({ label, confirmLabel, variant = 'outline', minLength = 5, onSubmit }: {
  label: string; confirmLabel?: string; variant?: ButtonProps['variant']; minLength?: number; onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return <Button size="sm" variant={variant} onClick={() => setOpen(true)}>{label}</Button>;

  return (
    <form
      className="grid w-full gap-2 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(reason.trim());
          setOpen(false);
          setReason('');
        } catch (err) {
          setError(err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Action impossible') : 'Action impossible');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-sm font-medium">Motif (enregistré dans le journal d&apos;audit)
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} autoFocus />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant={variant === 'outline' ? 'default' : variant} disabled={busy || reason.trim().length < minLength}>{confirmLabel ?? label}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </form>
  );
}
