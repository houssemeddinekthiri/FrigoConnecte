'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, Search, Wrench } from 'lucide-react';
import { z } from 'zod';
import { registerSchema, type RegisterInput } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { api } from '@/lib/api';

type FormValues = z.input<typeof registerSchema>;

const CLIENT_LABELS = {
  individual: 'Particulier',
  company: 'Entreprise',
  shop: 'Commerce',
  hotel: 'Hôtel',
  restaurant: 'Restaurant',
  syndic: 'Syndic / copropriété',
  public_body: 'Collectivité',
} as const;

const ACCOUNT_TYPES = [
  { value: 'client', icon: Search, title: 'Je cherche un pro', text: 'Dépannage, entretien, installation' },
  { value: 'provider', icon: Wrench, title: 'Je suis un pro', text: 'Recevoir des demandes et des clients' },
] as const;

export function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { accountType: 'client', clientType: 'individual' },
  });
  const signup = useMutation({ mutationFn: (v: RegisterInput) => api('auth/register', { method: 'POST', body: JSON.stringify(v) }) });

  if (signup.isSuccess) {
    return <p role="status" className="rounded-lg bg-success/10 p-4 text-success">Si cette adresse est valide, un email de vérification vient d&apos;être envoyé. Vérifiez-le puis connectez-vous.</p>;
  }

  const isClient = watch('accountType') === 'client';
  const needsCompany = isClient && watch('clientType') !== 'individual';
  const e = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  // un champ facultatif vide doit être « absent », pas une chaîne vide (sinon la validation du format échoue)
  const optional = { setValueAs: (v: string) => (v?.trim() ? v.trim() : undefined) };

  return (
    <form onSubmit={handleSubmit((v) => signup.mutate(v))} className="grid gap-3" noValidate>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Type de compte</legend>
        {ACCOUNT_TYPES.map(({ value, icon: Icon, title, text }) => (
          <label key={value} className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-input p-3 transition has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" value={value} {...register('accountType')} className="sr-only" />
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span>
            <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{text}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prénom" error={e('firstName')}><Input {...register('firstName')} autoComplete="given-name" aria-invalid={!!errors.firstName} /></Field>
        <Field label="Nom" error={e('lastName')}><Input {...register('lastName')} autoComplete="family-name" aria-invalid={!!errors.lastName} /></Field>
        <Field label="Email" error={e('email')}><Input {...register('email')} type="email" autoComplete="email" aria-invalid={!!errors.email} /></Field>
        <Field label="Téléphone (optionnel)" error={e('phone')}><Input {...register('phone', optional)} type="tel" placeholder="+33612345678" autoComplete="tel" aria-invalid={!!errors.phone} /></Field>
        {isClient && (
          <Field label="Vous êtes">
            <Select {...register('clientType')}>
              {Object.entries(CLIENT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
        )}
        {needsCompany && <Field label="Raison sociale" error={e('companyName')}><Input {...register('companyName', optional)} autoComplete="organization" aria-invalid={!!errors.companyName} /></Field>}
        <Field label="Mot de passe" error={e('password')}>
          <div className="relative">
            <Input {...register('password')} type={showPassword ? 'text' : 'password'} placeholder="10 caractères minimum" autoComplete="new-password" aria-invalid={!!errors.password} className="pr-11" />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" {...register('acceptTerms')} className="mt-1 size-4 accent-[var(--primary)]" />
        J&apos;accepte les CGU et la politique de confidentialité
      </label>
      {e('acceptTerms') && <p role="alert" className="text-xs text-destructive">{e('acceptTerms')}</p>}
      {signup.isError && <p role="alert" className="text-sm text-destructive">Inscription impossible, réessayez dans un instant.</p>}
      <Button size="lg" disabled={signup.isPending}>{signup.isPending ? 'Création…' : 'Créer mon compte'}</Button>
    </form>
  );
}
