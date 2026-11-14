import { Global, Injectable, Logger, Module } from '@nestjs/common';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Email aux couleurs de la marque : un titre, un texte, un bouton vers la page où agir.
 * Tableaux et styles en ligne : seule mise en page fiable dans les messageries (Outlook, Gmail). Le texte brut reste envoyé en parallèle.
 */
export function renderEmail(m: { title: string; body?: string | null; cta: { label: string; url: string } }): { text: string; html: string } {
  const footer = 'Vous recevez cet email car il concerne votre compte FrigoConnect. Vous pouvez choisir les emails reçus depuis vos préférences de notification.';
  const text = `${m.title}${m.body ? `\n\n${m.body}` : ''}\n\n${m.cta.label} : ${m.cta.url}\n\n${footer}`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e2e8f0;font-size:18px;font-weight:700;color:#0369a1">FrigoConnect</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(m.title)}</h1>
${m.body ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155">${esc(m.body).replace(/\n/g, '<br>')}</p>` : ''}
<a href="${esc(m.cta.url)}" style="display:inline-block;background:#0369a1;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">${esc(m.cta.label)}</a>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Envoi transactionnel via Resend (API HTTP, sans SDK). Sans clé en développement : le message est journalisé. */
@Injectable()
export class EmailSender {
  private readonly log = new Logger(EmailSender.name);

  async send(m: { to: string; subject: string; text: string; html?: string }): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY manquant');
      this.log.warn(`[DEV, email non envoyé] à ${m.to} — ${m.subject}\n${m.text}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? 'FrigoConnect <no-reply@localhost>', to: [m.to], subject: m.subject, text: m.text, ...(m.html && { html: m.html }) }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  }
}

@Global()
@Module({ providers: [EmailSender], exports: [EmailSender] })
export class EmailModule {}
