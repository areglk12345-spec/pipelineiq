import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db';
import { getSettings } from '../security/settings';

const SALT_ROUNDS = 12;

// Mirrors passwordPolicy in the prototype's Component class — thresholds now
// come from security_settings (an IT Admin's toggle actually does something),
// seeded with these same values so behavior is unchanged until edited.
export async function policyErrors(password: string): Promise<string[]> {
  const settings = await getSettings();
  const errors: string[] = [];
  if (password.length < settings.pw_min_length) {
    errors.push(`ความยาวขั้นต่ำ ${settings.pw_min_length} ตัวอักษร`);
  }
  if (settings.pw_require_complexity &&
      (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))) {
    errors.push('ต้องมีตัวพิมพ์ใหญ่ พิมพ์เล็ก ตัวเลข และอักขระพิเศษ');
  }
  if (settings.pw_check_hibp && await isPwned(password)) {
    errors.push('รหัสผ่านนี้เคยรั่วไหลในฐานข้อมูลสาธารณะ (HIBP) กรุณาใช้รหัสผ่านอื่น');
  }
  return errors;
}

// k-anonymity model: only the first 5 hex chars of the SHA1 hash ever leave
// this server — the full password/hash never crosses the network.
async function isPwned(password: string): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return false; // fail open — availability of a third-party API shouldn't block signup/reset
    const body = await res.text();
    return body.split('\n').some((line) => line.split(':')[0].trim() === suffix);
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function wasRecentlyUsed(userId: string, password: string): Promise<boolean> {
  const settings = await getSettings();
  const { rows } = await pool.query(
    'select password_hash from password_history where user_id = $1 order by created_at desc limit $2',
    [userId, settings.pw_history_count]
  );
  for (const row of rows) {
    if (await bcrypt.compare(password, row.password_hash)) return true;
  }
  return false;
}

export async function recordPasswordHistory(userId: string, passwordHash: string): Promise<void> {
  const settings = await getSettings();
  await pool.query('insert into password_history (user_id, password_hash) values ($1, $2)', [userId, passwordHash]);
  await pool.query(
    `delete from password_history where user_id = $1 and id not in (
       select id from password_history where user_id = $1 order by created_at desc limit $2
     )`,
    [userId, settings.pw_history_count]
  );
}

export async function isPasswordExpired(passwordChangedAt: Date): Promise<boolean> {
  const settings = await getSettings();
  const ageMs = Date.now() - passwordChangedAt.getTime();
  return ageMs > settings.pw_max_age_days * 24 * 60 * 60 * 1000;
}

export async function passwordAgeDays(passwordChangedAt: Date): Promise<number> {
  return Math.floor((Date.now() - passwordChangedAt.getTime()) / (24 * 60 * 60 * 1000));
}
