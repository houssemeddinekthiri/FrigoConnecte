import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Envoi transactionnel via Resend (API HTTP, sans SDK). Sans clé en développement : le message est journalisé. */
@Injectable()
export class EmailSender {
  private readonly log = new Logger(EmailSender.name);

  async send(m: { to: string; subject: string; text: string }): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY manquant');
      this.log.warn(`[DEV, email non envoyé] à ${m.to} — ${m.subject}\n${m.text}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM ?? 'FrigoConnect <no-reply@localhost>', to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  }
}

@Global()
@Module({ providers: [EmailSender], exports: [EmailSender] })
export class EmailModule {}
