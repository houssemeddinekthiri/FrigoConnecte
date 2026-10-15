export const eur = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' });

/** Libellés métier partagés par les écrans (une seule source). */
export const SERVICE_LABELS: Record<string, string> = {
  breakdown: 'Dépannage', maintenance: 'Maintenance', installation: 'Installation',
  audit: 'Audit', compliance: 'Mise en conformité', annual_contract: 'Contrat annuel',
};
export const TRADE_LABELS: Record<string, string> = {
  refrigeration: 'Froid commercial', heating: 'Chauffage', air_conditioning: 'Climatisation',
  ventilation: 'Ventilation', heat_pump: 'Pompe à chaleur', maintenance_company: 'Maintenance multi-techniques',
};
/** Entretien à prévoir : dernière intervention (ou, à défaut, ajout de l'équipement) il y a 11 mois ou plus. */
export function maintenanceDue(e: { createdAt: string; lastServiceAt: string | null }) {
  const since = new Date(e.lastServiceAt ?? e.createdAt);
  const months = Math.floor((Date.now() - since.getTime()) / (30.44 * 86_400_000));
  return { due: months >= 11, months, known: !!e.lastServiceAt };
}
export const URGENCY_LABELS: Record<string, string> = { low: 'Pas pressé', normal: 'Quelques jours', high: 'Sous 24 h', emergency: 'Urgence' };

export const QUOTE_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  draft: { label: 'Brouillon', variant: 'secondary' },
  sent: { label: 'Envoyé', variant: 'default' },
  accepted: { label: 'Accepté', variant: 'success' },
  rejected: { label: 'Refusé', variant: 'destructive' },
  expired: { label: 'Expiré', variant: 'secondary' },
  withdrawn: { label: 'Retiré', variant: 'secondary' },
};

export const pct = (ratio: number | null) => (ratio === null ? '—' : `${Math.round(ratio * 100)} %`);
export const compactEur = (cents: number) => {
  const e = cents / 100;
  return e >= 1000 ? `${(e / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€` : `${Math.round(e)} €`;
};
export const duration = (minutes: number | null) => (minutes === null ? '—' : minutes < 60 ? `${minutes} min` : `${(minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`);
export const dateTimeFr = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// ----- Administration : libellés partagés (jamais de code technique à l'écran) -----
type Tone = 'default' | 'secondary' | 'success' | 'warning' | 'destructive';
export const PAYMENT_STATUS: Record<string, { label: string; variant: Tone }> = {
  pending: { label: 'En attente', variant: 'secondary' }, authorized: { label: 'Autorisé', variant: 'default' }, held: { label: 'Sous séquestre', variant: 'warning' },
  released: { label: 'Versé', variant: 'success' }, failed: { label: 'Échoué', variant: 'destructive' }, refunded: { label: 'Remboursé', variant: 'secondary' }, partially_refunded: { label: 'Remboursé en partie', variant: 'secondary' },
};
export const CONTRACT_STATUS: Record<string, { label: string; variant: Tone }> = {
  pending_signature: { label: 'À signer', variant: 'secondary' }, active: { label: 'En cours', variant: 'default' }, completed: { label: 'Terminé', variant: 'success' },
  cancelled: { label: 'Annulé', variant: 'secondary' }, disputed: { label: 'En litige', variant: 'destructive' },
};
export const AUDIT_ENTITY: Record<string, string> = { provider: 'Prestataire', certification: 'Certification', user: 'Utilisateur', review: 'Avis', contract: 'Contrat', payment: 'Paiement', commission_rule: 'Commission' };
export const AUDIT_ACTION: Record<string, string> = {
  'provider.approved': 'Prestataire validé', 'provider.rejected': 'Prestataire refusé', 'provider.suspended': 'Prestataire suspendu', 'provider.reinstated': 'Prestataire réactivé',
  'certification.approved': 'Document approuvé', 'certification.rejected': 'Document refusé', 'user.suspended': 'Utilisateur suspendu', 'user.reactivated': 'Utilisateur réactivé',
  'review.published': 'Avis publié', 'review.hidden': 'Avis masqué', 'dispute.resolved.complete': 'Litige : fonds versés', 'dispute.resolved.cancel': 'Litige : contrat annulé',
  'commission.changed': 'Commission modifiée', 'payment.refunded': 'Paiement remboursé',
};
/** « il y a 3 jours » : l'ancienneté d'un dossier compte autant que sa date. */
export const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} jours`;
};
