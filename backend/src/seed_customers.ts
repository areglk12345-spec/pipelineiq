import 'dotenv/config';
import { pool } from './db';

// Mirrors the `customers` array in the decoded prototype, including
// caretaker history resolved to real seeded user IDs (same email-lookup
// pattern as seed_deals.ts).
const NAME_TO_EMAIL: Record<string, string> = {
  'สมชาย วงศ์ไพศาล': 'somchai@company.co.th',
  'ณัฐพร ศรีสุข': 'nattaporn@company.co.th',
  'กมลชนก ทองดี': 'kamonchanok@company.co.th',
  'พีรพล จันทรา': 'peerapol@company.co.th',
};

const CUSTOMERS = [
  { code:'001', name:'การไฟฟ้าส่วนภูมิภาค (PEA)', type:'รัฐวิสาหกิจ', poc:'คุณสุรชัย ธนวัฒน์', address:'200 ถ.งามวงศ์วาน แขวงลาดยาว เขตจตุจักร กรุงเทพฯ 10900', phone:'02-590-9100', email:'contact@pea.co.th', note:'ลูกค้าหลักภาครัฐ มีการจัดซื้อผ่าน e-bidding เป็นหลัก',
    caretakers:[{name:'พีรพล จันทรา', period:'2565–2567', current:false},{name:'สมชาย วงศ์ไพศาล', period:'2567–ปัจจุบัน', current:true}] },
  { code:'002', name:'บมจ. ปตท.', type:'เอกชน', poc:'คุณธีรพงษ์ วัฒนกุล', phone:'02-537-2000', email: null,
    caretakers:[{name:'ณัฐพร ศรีสุข', period:'2566–ปัจจุบัน', current:true}] },
  { code:'003', name:'ธนาคารกรุงไทย', type:'รัฐวิสาหกิจ', poc:'คุณพิมพ์ชนก อินทร์', phone:'02-111-1111', email: null,
    caretakers:[{name:'กมลชนก ทองดี', period:'2564–2566', current:false},{name:'สมชาย วงศ์ไพศาล', period:'2566–ปัจจุบัน', current:true}] },
  { code:'004', name:'การท่าอากาศยานฯ (AOT)', type:'รัฐวิสาหกิจ', poc:'คุณกฤษณะ พูนสิน', phone:'02-535-1111', email: null,
    caretakers:[{name:'สมชาย วงศ์ไพศาล', period:'2568–ปัจจุบัน', current:true}] },
  { code:'005', name:'การประปานครหลวง (MWA)', type:'รัฐวิสาหกิจ', poc:'คุณวิไลวรรณ ภักดี', phone:'02-504-0123', email:'wilaiwan.p@mwa.co.th',
    caretakers:[{name:'กมลชนก ทองดี', period:'2567–ปัจจุบัน', current:true}] },
  { code:'006', name:'บมจ. ซีพี ออลล์', type:'เอกชน', poc:'คุณจารุวรรณ พาณิชย์', phone:'02-071-9000', email: null,
    caretakers:[{name:'ณัฐพร ศรีสุข', period:'2565–2567', current:false},{name:'กมลชนก ทองดี', period:'2567–ปัจจุบัน', current:true}] },
  { code:'007', name:'โรงพยาบาลศิริราช', type:'โรงพยาบาล', poc:'นพ.ประเสริฐ วงศ์ทอง', phone:'02-419-7000', email: null,
    caretakers:[{name:'ณัฐพร ศรีสุข', period:'2568–ปัจจุบัน', current:true}] },
  { code:'008', name:'มหาวิทยาลัยเชียงใหม่', type:'สถาบันการศึกษา', poc:'รศ.ดร.กิตติ พรหมมา', phone:'053-943-000', email: null,
    caretakers:[{name:'ณัฐพร ศรีสุข', period:'2566–ปัจจุบัน', current:true}] },
  { code:'009', name:'กรมสรรพากร', type:'ราชการ', poc:'คุณสมหมาย ใจดี', phone:'02-272-8000', email: null,
    caretakers:[{name:'สมชาย วงศ์ไพศาล', period:'2567–ปัจจุบัน', current:true}] },
];

async function main() {
  const { rows: users } = await pool.query('select id, email from users');
  const emailToId = new Map(users.map((u) => [u.email, u.id]));

  for (const c of CUSTOMERS) {
    const { rows } = await pool.query(
      `insert into customers (code, name, type, poc, address, note)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do update set name = excluded.name
       returning id`,
      [c.code, c.name, c.type, c.poc, (c as any).address ?? null, c.note ?? null]
    );
    const customerId = rows[0].id;

    if (c.phone) {
      await pool.query('insert into customer_contacts (customer_id, kind, value) values ($1, $2, $3)', [customerId, 'phone', c.phone]);
    }
    if (c.email) {
      await pool.query('insert into customer_contacts (customer_id, kind, value) values ($1, $2, $3)', [customerId, 'email', c.email]);
    }

    for (const ct of c.caretakers) {
      const userId = emailToId.get(NAME_TO_EMAIL[ct.name]);
      if (!userId) {
        console.warn(`skip caretaker "${ct.name}" for ${c.name} — no seeded user`);
        continue;
      }
      await pool.query(
        'insert into customer_caretakers (customer_id, user_id, period, current) values ($1, $2, $3, $4)',
        [customerId, userId, ct.period, ct.current]
      );
    }

    // Backfill customer_id on any already-seeded deal whose company name matches.
    await pool.query('update deals set customer_id = $1 where company = $2 and customer_id is null', [customerId, c.name]);

    console.log(`seeded customer: ${c.name}`);
  }

  console.log('done');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
