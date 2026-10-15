'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Send, Snowflake } from 'lucide-react';
import { registerSchema, type RegisterInput } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { api } from '@/lib/api';

// Mêmes règles que le formulaire : chaque réponse est validée par le schéma Zod partagé avec l'API
const shape = registerSchema.innerType().shape;

type Answers = Partial<Record<'accountType' | 'firstName' | 'lastName' | 'clientType' | 'companyName' | 'email' | 'phone' | 'password' | 'acceptTerms', unknown>>;
interface Step {
  key: keyof Answers;
  ask: (a: Answers) => string;
  skip?: (a: Answers) => boolean;
  choices?: { value: unknown; label: string }[];
  input?: 'text' | 'email' | 'tel' | 'password';
  optional?: boolean;
  placeholder?: string;
}

const CLIENT_CHOICES = [
  ['individual', 'Particulier'], ['company', 'Entreprise'], ['shop', 'Commerce'], ['hotel', 'Hôtel'],
  ['restaurant', 'Restaurant'], ['syndic', 'Syndic / copropriété'], ['public_body', 'Collectivité'],
].map(([value, label]) => ({ value, label }));

const STEPS: Step[] = [
  { key: 'accountType', ask: () => 'Bonjour 👋 Vous cherchez un pro, ou vous êtes un pro ?', choices: [{ value: 'client', label: 'Je cherche un pro' }, { value: 'provider', label: 'Je suis un pro' }] },
  { key: 'firstName', ask: () => 'Parfait ! Quel est votre prénom ?', input: 'text' },
  { key: 'lastName', ask: (a) => `Enchanté ${a.firstName} ! Et votre nom ?`, input: 'text' },
  { key: 'clientType', ask: () => 'Vous êtes plutôt…', skip: (a) => a.accountType !== 'client', choices: CLIENT_CHOICES },
  { key: 'companyName', ask: () => 'Quel est le nom de votre structure ?', skip: (a) => a.accountType !== 'client' || a.clientType === 'individual', input: 'text' },
  { key: 'email', ask: () => 'Votre adresse email ?', input: 'email', placeholder: 'nom@exemple.fr' },
  { key: 'phone', ask: () => 'Un numéro de téléphone ? (facultatif)', input: 'tel', optional: true, placeholder: '+33612345678' },
  { key: 'password', ask: () => 'Choisissez un mot de passe (10 caractères minimum).', input: 'password' },
  { key: 'acceptTerms', ask: () => 'Dernière question : acceptez-vous les CGU et la politique de confidentialité ?', choices: [{ value: true, label: "Oui, j'accepte" }] },
];

interface Msg { from: 'bot' | 'me'; text: string }

export function ChatRegister() {
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: STEPS[0].ask({}) }]);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const signup = useMutation({ mutationFn: (v: RegisterInput) => api('auth/register', { method: 'POST', body: JSON.stringify(v) }) });
  const step = STEPS[index];
  const finished = index >= STEPS.length;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs, signup.isSuccess, signup.isError]);

  function submit(raw: unknown, label: string) {
    let v = raw;
    if (typeof v === 'string') { v = v.trim(); if (v === '') v = undefined; }
    if (v === undefined && !step.optional) { setError('Cette réponse est requise.'); return; }
    if (v !== undefined) {
      const parsed = shape[step.key as keyof typeof shape].safeParse(v);
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      v = parsed.data;
    }
    setError('');
    const next = { ...answers, [step.key]: v };
    let i = index + 1;
    while (i < STEPS.length && STEPS[i].skip?.(next)) i++;
    setAnswers(next);
    setIndex(i);
    setValue('');
    const added: Msg[] = [{ from: 'me', text: label }];
    if (i < STEPS.length) added.push({ from: 'bot', text: STEPS[i].ask(next) });
    else added.push({ from: 'bot', text: 'Merci ! Je crée votre compte…' });
    setMsgs((m) => [...m, ...added]);
    if (i >= STEPS.length) {
      const full = registerSchema.safeParse(next);
      if (full.success) signup.mutate(full.data);
      else setError('Certaines réponses sont invalides, rechargez la page pour recommencer.');
    }
  }

  return (
    <div className="flex h-[min(460px,60dvh)] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={m.from === 'me' ? 'flex justify-end' : 'flex items-end gap-2'}>
            {m.from === 'bot' && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Snowflake className="size-4" /></span>}
            <p className={m.from === 'me' ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground' : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-secondary px-4 py-2 text-sm'}>{m.text}</p>
          </div>
        ))}
        {signup.isSuccess && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">Compte créé ! Si cette adresse est valide, un email de vérification vient d&apos;être envoyé. Vérifiez-le puis connectez-vous.</p>}
        {signup.isError && <p role="alert" className="text-sm text-destructive">Inscription impossible, réessayez dans un instant.</p>}
        <div ref={endRef} />
      </div>

      {!finished && (
        <div className="mt-3 border-t pt-3">
          {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
          {step.choices ? (
            <div className="flex flex-wrap gap-2">
              {step.choices.map((c) => <Button key={String(c.value)} type="button" variant="outline" onClick={() => submit(c.value, c.label)}>{c.label}</Button>)}
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(value, step.input === 'password' ? '••••••••••' : value || 'Passer'); }}>
              <Input key={step.key} autoFocus value={value} onChange={(e) => setValue(e.target.value)} type={step.input} placeholder={step.placeholder ?? 'Votre réponse…'} aria-label="Votre réponse" autoComplete={step.input === 'password' ? 'new-password' : step.input === 'email' ? 'email' : 'off'} />
              {step.optional && !value && <Button type="submit" variant="ghost">Passer</Button>}
              <Button type="submit" size="icon" aria-label="Envoyer"><Send /></Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
