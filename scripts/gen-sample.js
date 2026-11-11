/* 샘플 상담사용 더미 상담 10건 → supabase/sample_counselor.sql
   실행: node scripts/gen-sample.js */
const E = require('../engine.js');
const fs = require('fs');
const EMAIL = 'sample.counselor@hearim.test';
const D = (s) => new Date(s + 'T10:00:00+09:00').toISOString();

const cases = [
  { id: 'sample01', at: '2026-09-03', cust: ['김도윤', '010-3101-2201'], biz: { bizName: '도윤이네 국밥', industry: 'FOOD', employees: 3, floorType: '1', bizArea: 132, isBuildingOwner: false, lpg: true, lpgKg: 250, vehicles: 1, sido: '서울특별시', sigungu: '마포구', mainProducts: '돼지국밥' },
    ans: { DISASTER_LIAB: { status: '가입', insurer: 'A손해보험', expiry: '2026-11-25' }, GAS_LIAB: { status: '미가입' }, AUTO_LIAB: { status: '가입', insurer: 'B화재', expiry: '2027-03-14' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' }, REC_PL: { productId: 'PL_1' } },
    stages: { GAS_LIAB: ['계약성립', '2026-09-20'], REC_PROPERTY_FIRE: ['계약성립', '2026-09-20'], REC_PL: ['청약'] } },
  { id: 'sample02', at: '2026-09-10', cust: ['이하린', '010-3202-4402'], biz: { bizName: '하린 베이커리카페', industry: 'CAFE', employees: 2, floorType: 'B', bizArea: 95, isBuildingOwner: false, cityGas: true, sido: '경기도', sigungu: '성남시 분당구', mainProducts: '빵·커피' },
    ans: { MULTI_FIRE_LIAB: { status: '미가입' }, GAS_LIAB: { status: '확인불가' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' }, REC_PL: { productId: 'PL_1' } },
    stages: { MULTI_FIRE_LIAB: ['계약성립', '2026-09-15'], REC_PROPERTY_FIRE: ['거절'], REC_PL: ['설명완료'] } },
  { id: 'sample03', at: '2026-09-18', cust: ['박서준', '010-3303-6603'], biz: { bizName: '스타코인노래방', industry: 'KARAOKE', employees: 1, floorType: 'B', bizArea: 180, isBuildingOwner: false, sido: '인천광역시', sigungu: '부평구' },
    ans: { MULTI_FIRE_LIAB: { status: '가입', insurer: 'C손해보험', expiry: '2026-12-05' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { REC_PROPERTY_FIRE: ['추천'] } },
  { id: 'sample04', at: '2026-09-25', cust: ['최유나', '010-3404-8804'], biz: { bizName: '유나 필라테스', industry: 'SPORTS', sportsType: 'GYM', employees: 2, floorType: '2', bizArea: 160, isBuildingOwner: false, hasElevator: true, elevatorManager: false, sido: '서울특별시', sigungu: '송파구' },
    ans: { REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { REC_PROPERTY_FIRE: ['계약성립', '2026-10-02'] } },
  { id: 'sample05', at: '2026-10-02', cust: ['정민호', '010-3505-1105'], biz: { bizName: '바다뷰 펜션', industry: 'LODGING', employees: 1, floorType: '1', bizArea: 420, isBuildingOwner: true, buildingArea: 640, buildingFloors: 3, lpg: true, lpgKg: 500, vehicles: 1, sido: '강원특별자치도', sigungu: '강릉시' },
    ans: { DISASTER_LIAB: { status: '미가입' }, GAS_LIAB: { status: '가입', insurer: 'NH농협손해보험', expiry: '2027-01-08' }, AUTO_LIAB: { status: '가입', insurer: 'A손해보험', expiry: '2026-11-19' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { DISASTER_LIAB: ['계약성립', '2026-10-06'], REC_PROPERTY_FIRE: ['설명완료'] } },
  { id: 'sample06', at: '2026-10-14', cust: ['한지민', '010-3606-3306'], biz: { bizName: '꿈나무 영어학원', industry: 'ACADEMY', employees: 4, floorType: '2', bizArea: 230, capacity: 90, isBuildingOwner: false, vehicles: 1, sido: '대전광역시', sigungu: '유성구' },
    ans: { ACADEMY_LIAB: { status: '가입', insurer: 'B화재', expiry: '2027-02-28' }, AUTO_LIAB: { status: '가입', insurer: 'C손해보험', expiry: '2027-05-30' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { REC_PROPERTY_FIRE: ['청약'] } },
  { id: 'sample07', at: '2026-10-20', cust: ['오세훈', '010-3707-5507'], biz: { bizName: '세훈정밀', industry: 'MFG', ksic: 'C25', employees: 7, isBuildingOwner: true, buildingArea: 3300, buildingFloors: 2, spHpGasUse: true, hasElevator: true, elevatorManager: true, elevatorCount: 1, vehicles: 2, sido: '경기도', sigungu: '화성시 동탄구', mainProducts: '금속 브래킷' },
    ans: { SPECIAL_BLDG_FIRE: { status: '미가입' }, GAS_LIAB: { status: '미가입' }, ELEVATOR_LIAB: { status: '가입', insurer: 'A손해보험', expiry: '2026-12-22' }, AUTO_LIAB: { status: '가입', insurer: 'B화재', expiry: '2027-04-11' }, REC_PL: { productId: 'PL_1' } },
    stages: { SPECIAL_BLDG_FIRE: ['계약성립', '2026-11-01'], GAS_LIAB: ['청약'], REC_PL: ['추천'] } },
  { id: 'sample08', at: '2026-10-28', cust: ['윤채원', '010-3808-7708'], biz: { bizName: '채원 네일', industry: 'BEAUTY', employees: 1, floorType: '1', bizArea: 40, isBuildingOwner: false, sido: '부산광역시', sigungu: '해운대구' },
    ans: { REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { REC_PROPERTY_FIRE: ['추천'] } },
  { id: 'sample09', at: '2026-11-04', cust: ['강태오', '010-3909-9909'], biz: { bizName: '태오마트', industry: 'RETAIL', employees: 3, floorType: '1', bizArea: 210, isBuildingOwner: false, records: 3200, vehicles: 1, supplyNH: true, sido: '전남광주통합특별시', sigungu: '진도군' },
    ans: { AUTO_LIAB: { status: '가입', insurer: 'NH농협손해보험', expiry: '2027-08-17' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' }, REC_PL: { productId: 'PL_1' } },
    stages: { REC_PROPERTY_FIRE: ['설명완료'], REC_PL: ['추천'] } },
  { id: 'sample10', at: '2026-11-09', cust: ['송지아', '010-4010-1210'], biz: { bizName: '구름 키즈카페', industry: 'KIDS', employees: 3, floorType: '2', bizArea: 330, isBuildingOwner: false, hasElevator: true, elevatorManager: false, sido: '대구광역시', sigungu: '수성구' },
    ans: { MULTI_FIRE_LIAB: { status: '미가입' }, KIDS_PLAY_LIAB: { status: '가입', insurer: 'C손해보험', expiry: '2026-11-30' }, REC_PROPERTY_FIRE: { productId: 'GENERAL_FIRE' } },
    stages: { MULTI_FIRE_LIAB: ['설명완료'], REC_PROPERTY_FIRE: ['추천'] } }
];

const order = ['추천', '설명완료', '청약', '계약성립'];
const addYear = s => { const d = new Date(s + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
let pol = 510000;
const rows = cases.map(k => {
  const b = { corpType: '개인', otherFacilities: [], ...k.biz };
  b.address = [b.sido, b.sigungu].join(' ');
  const rs = E.analyze(b);
  const at = D(k.at);
  const results = rs.map(r => {
    const a = k.ans[r.code] || {};
    const productId = r.kind === 'recommended' ? (r.result === '권장' ? a.productId || null : null)
      : (a.status === '미가입' ? (r.products.find(id => E.PRODUCT[id] && E.PRODUCT[id].active) || null) : null);
    return { code: r.code, kind: r.kind, name: r.name, result: r.result, reason: r.reason, status: r.kind === 'mandatory' && r.result !== '비대상' ? (a.status || '확인불가') : null, insurer: a.insurer || '', expiry: a.expiry || '', productId };
  });
  const enrollments = results.filter(r => r.productId).map((r, j) => {
    const dz = E.design(r.productId, b);
    const [target, doneDate] = k.stages[r.code] || ['추천'];
    const hist = [{ from: null, to: '추천', at, by: null }];
    let t = new Date(at).getTime(); let cur = '추천';
    const path = ['거절', '철회'].includes(target) ? ['설명완료', target] : order.slice(1, order.indexOf(target) + 1);
    path.forEach((st, i) => { t += (i + 2) * 86400000; const when = st === '계약성립' && doneDate ? D(doneDate) : new Date(Math.min(t, Date.parse('2026-11-10T09:00:00Z'))).toISOString(); hist.push({ from: cur, to: st, at: when, by: null, note: st === '거절' ? '보험료 부담으로 다음에 결정' : st === '계약성립' ? '증권 발급 완료' : '' }); cur = st; });
    const e = { id: `${k.id}_e${j}`, code: r.code, productId: r.productId, kind: r.kind, stage: cur, stageAt: hist[hist.length - 1].at, checklistDone: cur !== '추천', policyNo: '', premium: null, note: '',
      design: { main: dz.main, limits: dz.limits, riders: dz.riders.filter(x => x.selected).map(x => ({ name: x.name, kind: x.kind })) }, history: hist };
    if (cur === '계약성립') { e.policyNo = `NH26-${pol++}`; e.premium = [98000, 180000, 320000, 450000][j % 4]; e.startDate = (doneDate || k.at); e.expiry = addYear(e.startDate); }
    return e;
  });
  return { id: k.id, at, data: { customer: { name: k.cust[0], phone: k.cust[1], email: '' }, biz: b, eligibility: E.eligibility(b), results, enrollments, memo: '샘플 데이터', sample: true } };
});

const q = s => "'" + s.replace(/'/g, "''") + "'";
let sql = `-- 샘플 상담사(${EMAIL})용 더미 상담 10건\n-- 1) Authentication → Users → Add user 로 위 이메일 계정을 먼저 만든 뒤\n-- 2) 이 파일 전체를 SQL Editor에 붙여넣고 Run 하세요. 여러 번 실행해도 같은 10건으로 덮어써요.\n\n`;
sql += `update public.profiles set name = '샘플 상담사', branch = '시연용', role = 'counselor', active = true\nwhere id = (select id from auth.users where email = ${q(EMAIL)});\n\n`;
sql += `insert into public.consults (id, counselor_id, consulted_at, data)\nselect v.id, u.id, v.at::timestamptz,\n  -- 단계 이력의 작성자를 샘플 상담사로 채움\n  jsonb_set(v.data::jsonb, '{enrollments}', coalesce((select jsonb_agg(jsonb_set(e, '{history}', (select jsonb_agg(h || jsonb_build_object('by', u.id)) from jsonb_array_elements(e->'history') h))) from jsonb_array_elements(v.data::jsonb->'enrollments') e), '[]'::jsonb))\nfrom auth.users u, (values\n`;
sql += rows.map(r => `  (${q(r.id)}, ${q(r.at)}, ${q(JSON.stringify(r.data))})`).join(',\n');
sql += `\n) as v(id, at, data)\nwhere u.email = ${q(EMAIL)}\non conflict (id) do update set counselor_id = excluded.counselor_id, consulted_at = excluded.consulted_at, data = excluded.data;\n\n`;
sql += `-- 확인: 10이 나오면 성공\nselect count(*) from public.consults where id like 'sample%';\n`;
fs.mkdirSync(__dirname + '/../supabase', { recursive: true });
fs.writeFileSync(__dirname + '/../supabase/sample_counselor.sql', sql);
fs.writeFileSync('/tmp/sample_rows.json', JSON.stringify(rows));
console.log('rows', rows.length, 'enrollments', rows.reduce((n, r) => n + r.data.enrollments.length, 0), 'sql bytes', sql.length);
