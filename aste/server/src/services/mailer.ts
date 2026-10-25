import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(smtpUrl: string | undefined, from: string, log: FastifyBaseLogger): Mailer {
  if (!smtpUrl) {
    // Sviluppo: l'email finisce nel log (con i link di verifica, utili per i test manuali).
    return { send: async (mail) => log.info({ mail }, 'email (sviluppo, non inviata)') };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return { send: async (mail) => void (await transport.sendMail({ from, ...mail })) };
}

// Mailer per i test: conserva i messaggi inviati.
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}
