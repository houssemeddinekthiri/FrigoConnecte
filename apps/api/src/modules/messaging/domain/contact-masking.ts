/**
 * Avant l'acceptation d'un devis, on masque téléphones, emails et IBAN : la commission repose sur le paiement via la plateforme.
 * Limites assumées : un contournement volontaire ("zéro six douze…", espaces exotiques) passe. C'est un frein, pas un mur.
 */
export const MASK = '[coordonnées masquées]';

const EMAIL = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[A-Z]{2,}/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/gi;
// Numéro qui commence par 0, 00xx ou +xx : évite de masquer des montants ("1500 2000") ou des dates
const PHONE = /(?<!\d)(?:\+\d{1,3}|00\d{1,3}|0)[\d\s.\-()]{7,}\d(?!\d)/g;

export function maskContacts(text: string): { text: string; masked: boolean } {
  let masked = false;
  const hit = () => ((masked = true), MASK);
  let out = text.replace(EMAIL, hit).replace(IBAN, hit);
  out = out.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? hit() : m));
  return { text: out, masked };
}
