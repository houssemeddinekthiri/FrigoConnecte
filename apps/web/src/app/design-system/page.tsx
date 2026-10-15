import { notFound } from 'next/navigation';
import { Badge, RequestStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme-toggle';
import { GmvChart } from '@/components/admin/gmv-chart';

// données fictives déterministes pour contrôler le rendu du graphique
const DEMO = Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10), cents: i % 7 === 6 ? 0 : Math.round((90_000 + ((i * 7919) % 160_000)) * (i > 22 ? 1.5 : 1)) }));
const TOKENS = ['background', 'foreground', 'card', 'primary', 'secondary', 'muted', 'accent', 'destructive', 'success', 'warning', 'border'];

// Page de référence pour les devs : absente en production
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="mx-auto grid max-w-4xl gap-10 p-4 md:p-8">
      <div className="flex items-center justify-between"><h1 className="text-3xl font-bold">Design system</h1><ThemeToggle /></div>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Couleurs</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {TOKENS.map((t) => (
            <div key={t} className="grid gap-1 text-xs"><div className="h-12 rounded-md border" style={{ background: `var(--${t})` }} />{t}</div>
          ))}
        </div>
      </section>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Graphique (volume d'affaires)</h2><Card className="p-4"><GmvChart data={DEMO} /></Card></section>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Boutons</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Principal</Button><Button variant="secondary">Secondaire</Button><Button variant="outline">Contour</Button>
          <Button variant="ghost">Discret</Button><Button variant="destructive">Supprimer</Button><Button variant="link">Lien</Button>
          <Button size="sm">Petit</Button><Button size="lg">Grand</Button><Button disabled>Désactivé</Button>
        </div>
      </section>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>Défaut</Badge><Badge variant="success">Succès</Badge><Badge variant="warning">Attention</Badge><Badge variant="destructive">Erreur</Badge><Badge variant="outline">Contour</Badge>
          {['open', 'quoted', 'awarded', 'in_progress', 'completed', 'cancelled'].map((s) => <RequestStatusBadge key={s} status={s} />)}
        </div>
      </section>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Formulaire</h2>
        <Card><CardContent className="grid gap-4 pt-4 md:pt-6">
          <Field label="Texte" hint="Texte d'aide"><Input placeholder="Saisie" /></Field>
          <Field label="Avec erreur" error="Ce champ est obligatoire"><Input aria-invalid /></Field>
          <Field label="Liste"><Select><option>Dépannage</option><option>Maintenance</option></Select></Field>
          <Field label="Zone de texte"><Textarea /></Field>
        </CardContent></Card>
      </section>

      <section className="grid gap-3"><h2 className="text-xl font-semibold">Cartes et panneau</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card><CardHeader><CardTitle>Froid Express Lyon</CardTitle><CardDescription>★ 4,8 · 12 km · répond en 20 min</CardDescription></CardHeader></Card>
          <Sheet>
            <SheetTrigger asChild><Button variant="outline" className="h-full min-h-20">Ouvrir le panneau (filtres)</Button></SheetTrigger>
            <SheetContent title="Filtres"><p className="text-sm text-muted-foreground">Tiroir du bas sur mobile.</p></SheetContent>
          </Sheet>
        </div>
      </section>
    </main>
  );
}
