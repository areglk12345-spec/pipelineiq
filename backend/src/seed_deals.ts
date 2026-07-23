import 'dotenv/config';
import { pool } from './db';

// Mirrors the `deals` array in the decoded prototype. crm/turnkey/ma are
// free-text names in the mock with no corresponding seeded accounts (they
// represent other departments — CRM specialists, turnkey engineers,
// maintenance) so they're left unassigned (null) here; only `sales` maps to
// a real seeded user, since that's the field the app's scoping logic
// (`sales_user_id`) actually depends on.
const SALES_EMAIL: Record<string, string> = {
  'สมชาย วงศ์ไพศาล': 'somchai@company.co.th',
  'ณัฐพร ศรีสุข': 'nattaporn@company.co.th',
  'กมลชนก ทองดี': 'kamonchanok@company.co.th',
  'พีรพล จันทรา': 'peerapol@company.co.th',
};

const DEALS = [
  { company:'การไฟฟ้าส่วนภูมิภาค (PEA)', poc:'คุณสุรชัย ธนวัฒน์', position:'ผู้อำนวยการฝ่ายดิจิทัล', email:'surachai.t@pea.co.th', phone:'02-590-9100', project:'ระบบมิเตอร์อัจฉริยะ IoT Smart Metering', service:'IoT Platform · Smart Grid', value:45000000, tor:'PEA_SmartMeter_TOR.pdf', competitor:'Siemens, Itron', other:'ต้องการระบบรองรับมิเตอร์ 200,000 จุด พร้อม Dashboard วิเคราะห์การใช้ไฟฟ้าเรียลไทม์', sales:'สมชาย วงศ์ไพศาล', status:'won', reason:'ชนะด้วยความครบวงจรของโซลูชันและทีม MA ในพื้นที่' },
  { company:'บมจ. ปตท.', poc:'คุณธีรพงษ์ วัฒนกุล', position:'VP, IT Infrastructure', email:'teerapong.w@ptt.com', phone:'02-537-2000', project:'ปรับปรุง Data Center และ Cloud', service:'Data Center · Hybrid Cloud', value:38500000, tor:'PTT_DC_Modernize_TOR.pdf', competitor:'HPE, Dell Technologies', other:'ต้องการย้าย Workload หลักขึ้น Private Cloud ภายใน 12 เดือน', sales:'ณัฐพร ศรีสุข', status:'won', reason:'ชนะด้วย SLA และแผน Migration ที่ชัดเจน' },
  { company:'ธนาคารกรุงไทย', poc:'คุณพิมพ์ชนก อินทร์', position:'ผู้ช่วยกรรมการผู้จัดการ', email:'pimchanok.i@ktb.co.th', phone:'02-111-1111', project:'แพลตฟอร์มความปลอดภัยไซเบอร์', service:'Cybersecurity · SOC', value:28000000, tor:'KTB_CyberSec_TOR.pdf', competitor:'Palo Alto, Fortinet', other:'เน้นการตรวจจับภัยคุกคามเชิงรุกและมาตรฐาน ธปท.', sales:'สมชาย วงศ์ไพศาล', status:'won', reason:'ชนะด้วยทีมผู้เชี่ยวชาญและใบรับรองด้านความปลอดภัย' },
  { company:'บมจ. ทรู คอร์ปอเรชั่น', poc:'คุณอนุชา เกียรติกุล', position:'Head of Cloud', email:'anucha.k@truecorp.co.th', phone:'02-700-8000', project:'โครงการย้ายระบบขึ้นคลาวด์', service:'Cloud Migration', value:22000000, tor:'True_CloudMig_TOR.pdf', competitor:'AWS Partner, Accenture', other:'ต้องการ Migration แบบ Zero-downtime สำหรับระบบ Billing', sales:'พีรพล จันทรา', status:'bidding', reason:'อยู่ระหว่างเสนอราคารอบสุดท้าย' },
  { company:'การท่าอากาศยานฯ (AOT)', poc:'คุณกฤษณะ พูนสิน', position:'ผู้อำนวยการฝ่ายรักษาความปลอดภัย', email:'krisana.p@airportthai.co.th', phone:'02-535-1111', project:'ระบบวิเคราะห์ภาพ CCTV ด้วย AI', service:'AI Video Analytics', value:31000000, tor:'AOT_VideoAI_TOR.pdf', competitor:'Hikvision, Bosch', other:'ต้องการตรวจจับวัตถุต้องสงสัยและนับจำนวนผู้โดยสารแบบเรียลไทม์', sales:'สมชาย วงศ์ไพศาล', status:'bidding', reason:'ผ่านคุณสมบัติทางเทคนิค รอเปิดซองราคา' },
  { company:'การประปานครหลวง (MWA)', poc:'คุณวิไลวรรณ ภักดี', position:'ผู้อำนวยการฝ่ายเทคโนโลยีสารสนเทศ', email:'wilaiwan.p@mwa.co.th', phone:'02-504-0123', project:'ระบบบริหารจัดการเอกสาร ECM', service:'Enterprise Software · ECM', value:12500000, tor:'MWA_ECM_TOR.pdf', competitor:'Fabrico Systems, DocuTech', other:'ต้องการ e-Signature และเชื่อมต่อระบบสารบรรณเดิม', sales:'กมลชนก ทองดี', status:'proposal', reason:'ยื่นข้อเสนอทางเทคนิคแล้ว รอนัดนำเสนอ' },
  { company:'โรงพยาบาลศิริราช', poc:'นพ.ประเสริฐ วงศ์ทอง', position:'รองผู้อำนวยการฝ่ายสารสนเทศ', email:'prasert.w@si.mahidol.ac.th', phone:'02-419-7000', project:'โครงสร้างเครือข่ายระบบ HIS', service:'Network Infrastructure', value:18000000, tor:'Siriraj_HIS_TOR.pdf', competitor:'Cisco Partner', other:'ต้องการเครือข่ายสำรองสำหรับระบบผู้ป่วยฉุกเฉิน', sales:'ณัฐพร ศรีสุข', status:'proposal', reason:'อยู่ระหว่างจัดทำข้อเสนอทางเทคนิค' },
  { company:'มหาวิทยาลัยมหิดล', poc:'ผศ.ดร.นภา ศรีเมือง', position:'ผู้อำนวยการสำนักคอมพิวเตอร์', email:'napa.s@mahidol.ac.th', phone:'02-849-6000', project:'แพลตฟอร์ม E-Learning', service:'EdTech Platform', value:6800000, tor:'Mahidol_ELearn_TOR.pdf', competitor:'Blackboard, Moodle Partner', other:'รองรับผู้ใช้พร้อมกัน 20,000 คน', sales:'พีรพล จันทรา', status:'lead', reason:'เพิ่งได้รับการติดต่อ อยู่ระหว่างประเมินความต้องการ' },
  { company:'กรมสรรพากร', poc:'คุณสมหมาย ใจดี', position:'ผู้อำนวยการศูนย์เทคโนโลยีสารสนเทศ', email:'sommai.j@rd.go.th', phone:'02-272-8000', project:'AI Chatbot บริการประชาชน', service:'AI · Conversational', value:9200000, tor:'RD_Chatbot_TOR.pdf', competitor:'Google Dialogflow Partner', other:'รองรับภาษาไทยและคำถามภาษีที่ซับซ้อน', sales:'สมชาย วงศ์ไพศาล', status:'proposal', reason:'ยื่นข้อเสนอแล้ว รอผลการพิจารณา' },
  { company:'บมจ. ซีพี ออลล์', poc:'คุณจารุวรรณ พาณิชย์', position:'ผู้จัดการทั่วไป ฝ่ายดิจิทัล', email:'jaruwan.p@cpall.co.th', phone:'02-071-9000', project:'ระบบ CRM & Loyalty ค้าปลีก', service:'Retail CRM', value:26000000, tor:'CPAll_CRM_TOR.pdf', competitor:'Salesforce Partner', other:'เชื่อมต่อ POS 14,000 สาขา และแอป All Member', sales:'กมลชนก ทองดี', status:'bidding', reason:'เข้ารอบสุดท้าย 2 ราย' },
  { company:'บมจ. ปูนซิเมนต์ไทย (SCG)', poc:'คุณวรเดช อุตสาหะ', position:'Digital Transformation Director', email:'woradej.u@scg.com', phone:'02-586-3333', project:'ยกระดับระบบ ERP', service:'ERP · SAP S/4HANA', value:42000000, tor:'SCG_ERP_TOR.pdf', competitor:'Accenture, Deloitte', other:'ต้องการ Roadmap 3 ปี และทีม Support ในประเทศ', sales:'ณัฐพร ศรีสุข', status:'lead', reason:'อยู่ระหว่างศึกษาความเป็นไปได้ร่วมกับลูกค้า' },
  { company:'การรถไฟฟ้าขนส่งมวลชนฯ (MRTA)', poc:'คุณเอกชัย รุ่งเรือง', position:'ผู้อำนวยการฝ่ายระบบ', email:'ekachai.r@mrta.co.th', phone:'02-716-4000', project:'บริการดูแลระบบ Managed Service (MA)', service:'Managed Service', value:15000000, tor:'MRTA_MA_TOR.pdf', competitor:'IBM, Fujitsu', other:'สัญญา MA 3 ปี ครอบคลุมระบบตั๋วโดยสาร', sales:'พีรพล จันทรา', status:'lost', reason:'แพ้ด้านราคา ต่างจากผู้ชนะ 8%' },
  { company:'สำนักงานตำรวจแห่งชาติ', poc:'พ.ต.อ.ชัยวัฒน์ มั่นคง', position:'ผู้กำกับการฝ่ายเทคโนโลยี', email:'chaiwat.m@police.go.th', phone:'02-205-1000', project:'ระบบจัดเก็บหลักฐานดิจิทัล', service:'Digital Evidence · Storage', value:33000000, tor:'RTP_Evidence_TOR.pdf', competitor:'NetApp, Dell', other:'ต้องการระบบ Chain-of-custody และการเข้ารหัสระดับสูง', sales:'สมชาย วงศ์ไพศาล', status:'lead', reason:'อยู่ระหว่างศึกษาความต้องการและงบประมาณ' },
  { company:'กรุงเทพมหานคร (กทม.)', poc:'คุณศิริพร บุญมี', position:'ผู้อำนวยการสำนักดิจิทัล', email:'siriporn.b@bangkok.go.th', phone:'02-221-2141', project:'แดชบอร์ดเมืองอัจฉริยะ Smart City', service:'Smart City · Data Platform', value:21500000, tor:'BMA_SmartCity_TOR.pdf', competitor:'Microsoft Partner', other:'รวมข้อมูลจราจร น้ำท่วม และมลพิษในหน้าเดียว', sales:'กมลชนก ทองดี', status:'lost', reason:'เลื่อนโครงการออกไปเนื่องจากการจัดสรรงบประมาณ' },
  { company:'มหาวิทยาลัยเชียงใหม่', poc:'รศ.ดร.กิตติ พรหมมา', position:'ผู้อำนวยการสำนักบริการเทคโนโลยี', email:'kitti.p@cmu.ac.th', phone:'053-943-000', project:'ยกระดับเครือข่าย Wi-Fi ทั้งวิทยาเขต', service:'Network · Wi-Fi 6', value:8500000, tor:'CMU_WiFi_TOR.pdf', competitor:'Aruba, Ruckus', other:'ครอบคลุมอาคารเรียน 40 หลัง', sales:'ณัฐพร ศรีสุข', status:'won', reason:'ชนะด้วยราคาและการรับประกันครอบคลุม' },
];

async function main() {
  const { rows: users } = await pool.query('select id, email from users');
  const emailToId = new Map(users.map((u) => [u.email, u.id]));

  for (const d of DEALS) {
    const salesEmail = SALES_EMAIL[d.sales];
    const salesUserId = salesEmail && emailToId.get(salesEmail);
    if (!salesUserId) {
      console.warn(`skip "${d.project}" — no seeded user for sales rep "${d.sales}"`);
      continue;
    }
    const { rows } = await pool.query(
      `insert into deals (company, poc, position, email, phone, project, service, value, tor_filename, competitor, other, reason, status, sales_user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning id`,
      [d.company, d.poc, d.position, d.email, d.phone, d.project, d.service, d.value, d.tor, d.competitor, d.other, d.reason, d.status, salesUserId]
    );
    console.log(`seeded deal: ${d.project} (${d.company})`);
  }

  console.log('done');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
