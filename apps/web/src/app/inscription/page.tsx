import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, FileText, Snowflake, Wallet } from 'lucide-react';
import { SignupSwitch } from './signup-switch';

export const metadata: Metadata = { title: 'Inscription' };

const BENEFITS = [
  { icon: FileText, text: 'Demandes, devis et contrats au même endroit' },
  { icon: BadgeCheck, text: 'Professionnels vérifiés (SIRET, attestations)' },
  { icon: Wallet, text: 'Paiement sécurisé, solde libéré après validation' },
];

export default function RegisterPage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-8 px-4 py-6 lg:grid-cols-[0.7fr_1.3fr]">
      <aside className="hidden self-stretch rounded-3xl bg-primary p-10 text-primary-foreground lg:block">
        <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold"><Snowflake className="size-6" /> FrigoConnect</Link>
        <h2 className="mt-8 text-3xl font-bold leading-tight">Rejoignez le réseau du froid et du chauffage.</h2>
        <ul className="mt-8 space-y-4">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3"><Icon className="size-5 shrink-0 opacity-90" />{text}</li>
          ))}
        </ul>
      </aside>

      <section className="mx-auto w-full max-w-2xl">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 font-bold text-primary lg:hidden"><Snowflake className="size-5" /> FrigoConnect</Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Créer un compte</h1>
        <p className="mt-1 text-muted-foreground">Gratuit et sans engagement.</p>
        <div className="mt-4 rounded-2xl border bg-card p-5 shadow-sm">
          <SignupSwitch />
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Déjà un compte ? <Link href="/connexion" className="font-semibold text-primary hover:underline">Se connecter</Link>
        </p>
      </section>
    </main>
  );
}
