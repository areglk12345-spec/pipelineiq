import { pool } from '../db';

export interface SecuritySettings {
  enforce_2fa_org: boolean;
  enforce_2fa_sales: boolean;
  enforce_2fa_executive: boolean;
  pw_min_length: number;
  pw_require_complexity: boolean;
  pw_history_count: number;
  pw_max_age_days: number;
  pw_lockout_attempts: number;
  pw_lockout_minutes: number;
  pw_check_hibp: boolean;
}

export async function getSettings(): Promise<SecuritySettings> {
  const { rows } = await pool.query('select * from security_settings where id = true');
  return rows[0];
}

export async function updateSettings(partial: Partial<SecuritySettings>, userId: string): Promise<SecuritySettings> {
  const cols = Object.keys(partial);
  if (cols.length === 0) return getSettings();
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const vals = cols.map((c) => (partial as any)[c]);
  await pool.query(
    `update security_settings set ${sets}, updated_at = now(), updated_by = $${cols.length + 1} where id = true`,
    [...vals, userId]
  );
  return getSettings();
}
