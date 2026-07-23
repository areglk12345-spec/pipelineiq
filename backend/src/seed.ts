import 'dotenv/config';
import { pool } from './db';
import { hashPassword, recordPasswordHistory } from './auth/password';

// Mirrors the `users` array in the decoded prototype (Enterprise CRM Pipeline
// Tracking.html) so seeded accounts behave identically to the mock on day one.
// two_fa_enabled starts false for every account (no real TOTP secret exists
// yet) — each user must enroll via POST /users/me/2fa/enroll + /confirm.
const SEED_USERS = [
  { name: 'Super Administrator', email: 'root@company.co.th', role: 'superadmin', perms: { addDeal: true, editDeal: true, delDeal: true, addUser: true, grantAdmin: true } },
  { name: 'เจมส์ สุริยง', email: 'james@company.co.th', role: 'manager', perms: { addDeal: true, editDeal: true, delDeal: true, addUser: true, grantAdmin: false } },
  { name: 'ธีรเดช อินทรกุล', email: 'theeradej@company.co.th', role: 'itadmin', perms: { addDeal: true, editDeal: true, delDeal: true, addUser: true, grantAdmin: true } },
  { name: 'สมชาย วงศ์ไพศาล', email: 'somchai@company.co.th', role: 'sales', perms: { addDeal: true, editDeal: true, delDeal: false, addUser: false, grantAdmin: false } },
  { name: 'ณัฐพร ศรีสุข', email: 'nattaporn@company.co.th', role: 'sales', perms: { addDeal: true, editDeal: true, delDeal: false, addUser: false, grantAdmin: false } },
  { name: 'กมลชนก ทองดี', email: 'kamonchanok@company.co.th', role: 'sales', perms: { addDeal: true, editDeal: true, delDeal: false, addUser: false, grantAdmin: false } },
  { name: 'พีรพล จันทรา', email: 'peerapol@company.co.th', role: 'sales', perms: { addDeal: true, editDeal: false, delDeal: false, addUser: false, grantAdmin: false } },
  { name: 'วิชัย มหากิจ', email: 'ceo@company.co.th', role: 'executive', perms: { addDeal: false, editDeal: false, delDeal: false, addUser: false, grantAdmin: false } },
];

const SEED_PASSWORD = 'ChangeMe123!'; // meets policy; must_change_password forces rotation on first login

async function main() {
  for (const u of SEED_USERS) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const { rows } = await pool.query(
      `insert into users (name, email, password_hash, role, perms, must_change_password)
       values ($1, $2, $3, $4, $5, true)
       on conflict (email) do update set
         name = excluded.name, role = excluded.role, perms = excluded.perms
       returning id`,
      [u.name, u.email, passwordHash, u.role, u.perms]
    );
    await recordPasswordHistory(rows[0].id, passwordHash);
    console.log(`seeded ${u.email} (${u.role})`);
  }
  console.log(`\nAll seeded accounts use password: ${SEED_PASSWORD} (must change on first login)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
