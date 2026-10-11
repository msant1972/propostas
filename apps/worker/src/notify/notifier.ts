import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import type { WorkerConfig } from '../config.js';

/** Cabeçalhos de uma só linha: remove quebras de linha (injeção de cabeçalhos). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

export interface Message {
  to: Array<{ name: string; email: string }>;
  subject: string;
  text: string;
  /** Ligação direta para a página da aplicação (decisão, proposta…). */
  link?: string;
}

/**
 * Envia por email (SMTP) e, se configurado, para um canal do Teams por *webhook* de entrada.
 * Sem SMTP, grava as mensagens como ficheiros .eml em `MAIL_OUTBOX_DIR` (desenvolvimento e testes).
 */
export class Notifier {
  private readonly smtp?: Transporter;
  private readonly sent: Message[] = [];

  constructor(private readonly cfg: WorkerConfig) {
    if (cfg.SMTP_URL) this.smtp = createTransport(cfg.SMTP_URL);
  }

  async send(m: Message): Promise<void> {
    if (m.to.length === 0) return;
    const body = m.link ? `${m.text}\n\n${m.link}` : m.text;
    const mail = { from: oneLine(this.cfg.MAIL_FROM), to: m.to.map((t) => `"${oneLine(t.name).replace(/"/g, '')}" <${oneLine(t.email)}>`).join(', '), subject: oneLine(m.subject), text: body };

    if (this.smtp) {
      await this.smtp.sendMail(mail);
    } else {
      await mkdir(this.cfg.MAIL_OUTBOX_DIR, { recursive: true });
      const eml = `From: ${mail.from}\nTo: ${mail.to}\nSubject: ${mail.subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`;
      await writeFile(join(this.cfg.MAIL_OUTBOX_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.eml`), eml, 'utf8');
    }
    this.sent.push(m);

    if (this.cfg.TEAMS_WEBHOOK_URL) {
      const res = await fetch(this.cfg.TEAMS_WEBHOOK_URL, {
        method: 'POST',
        redirect: 'error', // o webhook configurado não pode redirecionar para outro destino
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard', '@context': 'https://schema.org/extensions', summary: m.subject, themeColor: '1D4ED8', title: m.subject, text: m.text,
          ...(m.link ? { potentialAction: [{ '@type': 'OpenUri', name: 'Abrir na aplicação', targets: [{ os: 'default', uri: m.link }] }] } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Teams respondeu ${res.status}`);
    }
  }

  /** Mensagens enviadas por esta instância (testes). */
  get history(): readonly Message[] {
    return this.sent;
  }
}
