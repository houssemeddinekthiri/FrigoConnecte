import Link from 'next/link';
import { ArrowRight, BadgeCheck, ClipboardList, FileText, MapPin, Search, ShieldCheck, Siren, Snowflake, Star, Wallet, Wrench } from 'lucide-react';
import { SERVICE_TYPES } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';

const SERVICE_LABELS: Record<(typeof SERVICE_TYPES)[number], string> = {
  breakdown: 'Dépannage',
  maintenance: 'Maintenance',
  installation: 'Installation',
  audit: 'Audit',
  compliance: 'Mise en conformité',
  annual_contract: 'Contrat annuel',
};

const SERVICE_META: Record<(typeof SERVICE_TYPES)[number], { icon: typeof Wrench; text: string }> = {
  breakdown: { icon: Siren, text: 'Une panne ? Un pro disponible près de chez vous.' },
  maintenance: { icon: Wrench, text: 'Entretien régulier pour éviter les pannes.' },
  installation: { icon: Snowflake, text: 'Pose de froid, clim, PAC et ventilation.' },
  audit: { icon: ClipboardList, text: 'Diagnostic complet de vos installations.' },
  compliance: { icon: ShieldCheck, text: 'Contrôles réglementaires et fluides.' },
  annual_contract: { icon: FileText, text: 'Un contrat clair, un prix maîtrisé.' },
};

const STEPS = [
  { icon: ClipboardList, title: 'Décrivez votre besoin', text: 'Panne, entretien, installation : 2 minutes suffisent.' },
  { icon: FileText, title: 'Comparez les devis', text: 'Recevez des devis détaillés de pros certifiés autour de vous.' },
  { icon: Wallet, title: 'Payez en sécurité', text: 'Acompte protégé, solde libéré après validation des travaux.' },
];

const TRUST = [
  { icon: BadgeCheck, label: 'Pros vérifiés (SIRET, attestations)' },
  { icon: Wallet, label: 'Paiement séquestre sécurisé' },
  { icon: Star, label: 'Avis clients authentiques' },
];

export default function HomePage() {
  return (
    <main>
      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:pb-24 sm:pt-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_srgb,var(--primary)_18%,transparent),transparent)]" />
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Snowflake className="size-3.5 text-primary" /> Froid · Clim · Chauffage · Ventilation · PAC
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">
            Le bon frigoriste, <span className="text-primary">au bon moment.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Trouvez des professionnels certifiés près de chez vous, comparez des devis clairs et payez en toute sécurité.
          </p>

          <form action="/prestataires" className="mx-auto mt-10 max-w-2xl rounded-2xl border-2 border-primary/20 bg-card p-3 text-left shadow-xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Wrench className="size-3.5" /> Service</span>
                <Select name="service" defaultValue="" className="h-12 bg-background text-base">
                  <option value="">Tous les services</option>
                  {SERVICE_TYPES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><MapPin className="size-3.5" /> Où ?</span>
                <Input name="ville" placeholder="Ville ou code postal" className="h-12 bg-background text-base" />
              </label>
            </div>
            <Button size="lg" className="mt-3 h-12 w-full text-base"><Search /> Rechercher un pro</Button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-2">
            <span className="text-sm text-muted-foreground">Une panne qui ne peut pas attendre ?</span>
            <Button asChild variant="outline" className="h-auto whitespace-normal border-destructive/40 py-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Link href="/client/demandes/urgence"><Siren /> Déposer une demande urgente en 2 minutes <ArrowRight /></Link>
            </Button>
          </div>

          <ul className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-2"><Icon className="size-4 text-primary" />{label}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Nos services</h2>
        <p className="mt-2 text-muted-foreground">Pour les particuliers comme pour les professionnels.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_TYPES.map((s) => {
            const { icon: Icon, text } = SERVICE_META[s];
            return (
              <Link
                key={s}
                href={`/prestataires?service=${s}`}
                className="group rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" /></span>
                <h3 className="mt-4 font-semibold">{SERVICE_LABELS[s]}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Voir les pros <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="bg-secondary/60 px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Comment ça marche</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-2xl border bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"><Icon className="size-5" /></span>
                  <span className="text-4xl font-bold text-muted-foreground/30">{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 rounded-3xl bg-primary px-6 py-12 text-center text-primary-foreground">
          <h2 className="text-2xl font-bold sm:text-3xl">Vous êtes frigoriste ou chauffagiste ?</h2>
          <p className="max-w-lg opacity-90">Recevez des demandes qualifiées dans votre zone, envoyez vos devis en ligne et soyez payé en sécurité.</p>
          <Button asChild size="lg" variant="secondary"><Link href="/inscription">Rejoindre FrigoConnect</Link></Button>
        </div>
      </section>
    </main>
  );
}
