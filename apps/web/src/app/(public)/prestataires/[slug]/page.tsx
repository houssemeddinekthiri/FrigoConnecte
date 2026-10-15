import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProviderAvatar, publicImageSrc, Stars } from '@/components/provider-bits';
import { dateFr, duration, SERVICE_LABELS, TRADE_LABELS } from '@/lib/format';

interface PublicProvider {
  providerId: string; slug: string; companyName: string; headline: string | null; bio: string | null; city: string | null; trades: string[]; services: string[];
  yearsExperience: number; avgRating: number; reviewsCount: number; completedMissions: number; avgResponseMinutes: number | null; emergencyAvailable: boolean;
  availableNow: boolean; logoFileId: string | null; photoFileIds: string[];
  certifications: { type: string; label: string | null }[];
  reviews: { rating: number; comment: string | null; response: string | null; createdAt: string; author: string }[];
}
const CERT: Record<string, string> = {
  fluid_handling_cat1: 'Attestation de capacité (cat. I)', fluid_handling_cat2: 'Attestation de capacité (cat. II)', fluid_handling_cat3: 'Attestation de capacité (cat. III)', fluid_handling_cat4: 'Attestation de capacité (cat. IV)',
  qualipac: 'QualiPAC', rge: 'RGE', qualibat: 'Qualibat', electrical_habilitation: 'Habilitation électrique', insurance_decennale: 'Assurance décennale', other: 'Document vérifié',
};

async function load(slug: string): Promise<PublicProvider | null> {
  const res = await fetch(`${process.env.API_URL}/api/v1/providers/by-slug/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
  return res.ok ? ((await res.json()) as PublicProvider) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: 'Prestataire introuvable' };
  return { title: `${p.companyName}${p.city ? ` à ${p.city}` : ''}`, description: p.headline ?? `${p.companyName} : ${p.trades.map((t) => TRADE_LABELS[t] ?? t).join(', ')}` };
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card className="p-5"><h2 className="mb-3 text-lg font-semibold">{title}</h2>{children}</Card>
);
const Stat = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <Card className="p-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd><dd className="text-xs text-muted-foreground">{hint}</dd></Card>
);

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const photos = p.photoFileIds ?? []; // réponse en cache d'une ancienne version de l'API (déploiement du site avant l'API)

  // Données structurées pour Google (étoiles dans les résultats) : uniquement s'il existe de vrais avis publiés
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: p.companyName, description: p.headline ?? undefined,
    ...(p.city && { address: { '@type': 'PostalAddress', addressLocality: p.city, addressCountry: 'FR' } }),
    ...(p.reviewsCount > 0 && { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.avgRating, reviewCount: p.reviewsCount } }),
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
        <ProviderAvatar name={p.companyName} fileId={p.logoFileId} className="size-16 text-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold sm:text-3xl">{p.companyName}</h1>
          {p.headline && <p className="mt-1 text-muted-foreground">{p.headline}</p>}
          {p.city && <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-4" />{p.city}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.availableNow && <Badge variant="success">● Disponible maintenant</Badge>}
            {p.trades.map((t) => <Badge key={t}>{TRADE_LABELS[t] ?? t}</Badge>)}
            {p.emergencyAvailable && <Badge variant="warning">Urgences acceptées</Badge>}
          </div>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto"><Link href={`/client/demandes/nouvelle?provider=${p.providerId}&name=${encodeURIComponent(p.companyName)}`}>Demander un devis</Link></Button>
      </Card>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Note" value={p.reviewsCount > 0 ? `★ ${p.avgRating.toFixed(1)}` : 'Nouveau'} hint={p.reviewsCount > 0 ? `${p.reviewsCount} avis` : "Pas encore d'avis"} />
        <Stat label="Interventions" value={String(p.completedMissions)} hint="réalisées sur la plateforme" />
        <Stat label="Expérience" value={`${p.yearsExperience} an${p.yearsExperience > 1 ? 's' : ''}`} hint="dans le métier" />
        <Stat label="Délai de réponse" value={duration(p.avgResponseMinutes)} hint={p.avgResponseMinutes === null ? 'Pas encore mesuré' : 'en moyenne'} />
      </dl>

      <div className="mt-6 grid gap-4">
        {p.bio && <Section title="Présentation"><p className="whitespace-pre-wrap">{p.bio}</p></Section>}

        {photos.length > 0 && (
          <Section title="Réalisations">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((id) => (
                <li key={id}>
                  <a href={publicImageSrc(id)} target="_blank" rel="noopener" aria-label="Voir la photo en grand">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicImageSrc(id)} alt={`Réalisation de ${p.companyName}`} loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Certifications vérifiées">
          {p.certifications.length === 0 ? <p className="text-sm text-muted-foreground">Aucune certification affichée.</p> : (
            <ul className="flex flex-wrap gap-2">{p.certifications.map((c, i) => <li key={i}><Badge variant="success">✓ {c.label ?? CERT[c.type] ?? c.type}</Badge></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Chaque document est examiné par notre équipe avant d&apos;être affiché.</p>
        </Section>

        {p.services.length > 0 && (
          <Section title="Services">
            <ul className="flex flex-wrap gap-2">{p.services.map((s) => <li key={s}><Badge variant="secondary" className="px-3 py-1 text-sm">{SERVICE_LABELS[s] ?? s}</Badge></li>)}</ul>
          </Section>
        )}

        <Section title="Avis clients">
          {p.reviews.length === 0 && <p className="text-sm text-muted-foreground">Aucun avis publié pour le moment.</p>}
          <ul className="grid gap-3">
            {p.reviews.map((r, i) => (
              <li key={i} className="grid gap-1 rounded-md bg-muted/50 p-4 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground"><Stars rating={r.rating} /><b className="text-foreground">{r.author}</b> · {dateFr(r.createdAt)}</p>
                {r.comment && <p className="whitespace-pre-wrap">{r.comment}</p>}
                {r.response && <p className="mt-2 border-l-2 pl-3 text-muted-foreground"><b>Réponse du prestataire :</b> {r.response}</p>}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
