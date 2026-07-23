import { authenticator } from 'otplib';
import crypto from 'crypto';

if (!process.env.TOTP_ENCRYPTION_KEY || process.env.TOTP_ENCRYPTION_KEY.length !== 64) {
  throw new Error('TOTP_ENCRYPTION_KEY is not set (need a 64-char hex string, e.g. `openssl rand -hex 32`)');
}
const KEY = Buffer.from(process.env.TOTP_ENCRYPTION_KEY, 'hex');

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function otpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, 'PipelineIQ', secret);
}

// TOTP secrets are long-lived credentials equivalent to a password — encrypt
// before they ever touch a `two_fa_secret` column. Format: iv:authTag:ciphertext (hex).
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSecret(encrypted: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function verifyToken(token: string, encryptedSecret: string): boolean {
  try {
    return authenticator.check(token, decryptSecret(encryptedSecret));
  } catch {
    return false;
  }
}
