/* 소상공인 보험 헤아림 — 판정 엔진 (제조업 소기업, 2026년 기준 초안 / 사회보험 제외) */
(function (root) {
  const BASIS_DATE = '2026.11.11';

  const KSIC = [
    ['C10', '식료품'], ['C11', '음료'], ['C12', '담배'], ['C13', '섬유제품(의복 제외)'],
    ['C14', '의복·의복액세서리·모피제품'], ['C15', '가죽·가방·신발'], ['C16', '목재·나무제품(가구 제외)'],
    ['C17', '펄프·종이·종이제품'], ['C18', '인쇄·기록매체 복제'], ['C19', '코크스·연탄·석유정제품'],
    ['C20', '화학물질·화학제품(의약품 제외)'], ['C21', '의료용 물질·의약품'], ['C22', '고무·플라스틱제품'],
    ['C23', '비금속 광물제품'], ['C24', '1차 금속'], ['C25', '금속가공제품(기계·가구 제외)'],
    ['C26', '전자부품·컴퓨터·영상·음향·통신장비'], ['C27', '의료·정밀·광학기기·시계'], ['C28', '전기장비'],
    ['C29', '기타 기계·장비'], ['C30', '자동차·트레일러'], ['C31', '기타 운송장비'], ['C32', '가구'],
    ['C33', '기타 제품'], ['C34', '산업용 기계·장비 수리업']
  ];
  const KSIC_NAME = Object.fromEntries(KSIC);

  /* 당사 상품 — 제공 서류(2026.07.01) 기준 */
  const PRODUCTS = [
    {
      id: 'FACTORY_FIRE', name: '공장화재보험', line: '화재 / 공장화재', active: true,
      riders: {
        special: ['특수건물 신체손해배상책임 특약', '화재대물배상책임 특약(특수건물)', '특수건물 항공기 및 낙하물위험 특약 (의무부가)'],
        optional: ['기업휴지손해 특약', '전기위험 특약', '구내폭발위험 특약', '풍수재위험담보 특약', '지진위험 특약']
      },
      checklist: ['특수건물이면 신체손해배상책임·대물배상책임·항공기 및 낙하물위험 특약 3종 부가 확인', '보험가액(재조달가액/협정보험가액) 기준 설명'],
      docs: ['2.공장화재보험_사업방법서별지(20260701)', '3.공장화재보험_약관(20260701)', '5.공장화재보험_변경대비표(20260701)*', '6.공장화재보험_영업요율서(20260701)*']
    },
    {
      id: 'GAS_LIAB', name: '가스사고배상책임보험', line: '특종 / 책임 / 가스사고', active: true,
      riders: { special: [], optional: ['종업원(근로자) 신체장해 보장 특약', '교차배상책임 특약', '보험료분납 특약'] },
      checklist: ['「종업원(근로자) 신체장해 보장 특약」 설명', '중복가입 시 비례보상 안내를 청약서에 기재'],
      docs: ['2.가스사고배상책임보험_사업방법서별지(20260701)', '3.가스사고배상책임보험_약관(20260701)', '5.가스사고배상책임보험_영업요율서(20260701)*', '6.가스사고배상책임보험_변경대비표(20260701)*']
    },
    {
      id: 'ELEVATOR_LIAB', name: '승강기사고배상책임보험', line: '특종 / 책임 / 영업배상', active: true,
      riders: { special: [], optional: ['구내치료비 특약', '종업원(근로자) 신체장해 보장 특약', '대위권포기 특약'] },
      checklist: ['「종업원(근로자) 신체장해 보장 특약」 설명', '중복가입 시 비례보상 안내를 청약서에 기재'],
      docs: ['2.승강기사고배상책임보험_사업방법서별지(20260701)', '3.승강기사고배상책임보험_약관(20260701)', '5.승강기사고배상책임보험_영업요율서(20260701)*', '6.승강기사고배상책임보험_변경대비표(20260701)*']
    },
    {
      id: 'DISASTER_LIAB', name: '재난배상책임보험', line: '특종 / 책임 / 일반배상', active: true,
      riders: { special: [], optional: ['임차자 특약(점유자가 가입할 때)', '대위권포기 특약'] },
      checklist: ['가입 주체(소유자=점유자면 소유자, 다르면 점유자) 확인'],
      docs: ['2.재난배상책임보험_사업방법서별지(20260701)', '3.재난배상책임보험_약관(20260701)', '5.재난배상책임보험_영업요율서(20260701)*']
    },
    {
      id: 'PL_1', name: '생산물배상책임보험(Ⅰ)', line: '특종 / 책임 / 생산물 · 손해사고기준', active: true,
      riders: { special: [], optional: ['농협 납품분 한정특약', '판매인 특약', '품질저하 부담보 특약'] },
      checklist: ['손해사고기준: 보험기간 중 발생한 사고를 보상함을 설명'],
      docs: ['2.생산물배상책임보험(Ⅰ)_사업방법서별지(20260701)', '3.생산물배상책임보험(Ⅰ)_약관(20260701)', '5.생산물배상책임보험(Ⅰ)_영업요율서(20260701)*', '6.생산물배상책임보험(Ⅰ)_변경대비표(20260701)*']
    },
    {
      id: 'PL_2', name: '생산물배상책임보험(Ⅱ)', line: '특종 / 책임 / 생산물 · 배상청구기준', active: true,
      riders: { special: [], optional: ['농협 납품분 한정특약', '판매인 특약', '품질저하 부담보 특약'] },
      checklist: ['배상청구기준: 보험기간 중 최초 손해배상청구를 보상함을 설명', '소급보상일자 설명'],
      docs: ['2.생산물배상책임보험(Ⅱ)_사업방법서별지(20260701)', '3.생산물배상책임보험(Ⅱ)_약관(20260701)', '5.생산물배상책임보험(Ⅱ)_영업요율서(20260701)*', '6.생산물배상책임보험(Ⅱ)_변경대비표(20260701)*']
    },
    { id: 'GENERAL_FIRE', name: '일반화재보험', line: '화재 / 일반화재', active: false, note: '공장은 공장화재보험 사용', riders: { special: [], optional: [] }, checklist: [], docs: [] },
    { id: 'MULTI_FIRE', name: '다중이용업소화재배상책임보험', line: '특종', active: false, note: '제조업 대상 아님', riders: { special: [], optional: [] }, checklist: [], docs: [] },
    { id: 'APT_FIRE', name: '아파트단체화재보험', line: '화재', active: false, note: '제조업 대상 아님', riders: { special: [], optional: [] }, checklist: [], docs: [] },
    { id: 'HOME_FIRE', name: '주택화재보험', line: '화재', active: false, note: '제조업 대상 아님', riders: { special: [], optional: [] }, checklist: [], docs: [] }
  ];
  const PRODUCT = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

  const R = (result, reason, missing) => ({ result, reason, missing: missing || [] });
  const has = v => v !== undefined && v !== null && v !== '';

  /* 의무보험 규칙 — 모두 미검증 초안 */
  const RULES = [
    {
      code: 'SPECIAL_BLDG_FIRE', kind: 'mandatory', name: '특수건물 화재보험 (신체·대물배상책임)',
      law: '화재로 인한 재해보상과 보험가입에 관한 법률 제4조·제5조, 시행령 제2조',
      penalty: '500만 원 이하 벌금 [확인 필요]', coverage: '사망 1인당 1억5천만 원, 대물 사고당 10억 원',
      products: ['FACTORY_FIRE'], verified: false,
      evaluate(b) {
        if (b.isBuildingOwner === false) return R('비대상', '건물을 임차해 사용 중이라 가입 의무자(건물 소유자)가 아닙니다.');
        if (!has(b.isBuildingOwner) || !has(b.buildingArea)) return R('확인필요', '건물 소유 여부와 연면적이 있어야 판단할 수 있어요.', ['건물 소유 여부', '건물 연면적']);
        if (b.buildingArea >= 3000) return R('의무대상', `자가 소유 공장, 연면적 ${fmtNum(b.buildingArea)}㎡ ≥ 3,000㎡ (특수건물)`);
        return R('비대상', `연면적 ${fmtNum(b.buildingArea)}㎡로 특수건물 기준(3,000㎡) 미만입니다.`);
      }
    },
    {
      code: 'GAS_LIAB', kind: 'mandatory', name: '가스사고배상책임보험',
      law: '고압가스 안전관리법, 액화석유가스의 안전관리 및 사업법, 도시가스사업법 제43조',
      penalty: '과태료 [확인 필요]', coverage: '사망 1인당 1억5천만 원 (실손 2천만 원 미만 시 2천만 원)',
      products: ['GAS_LIAB'], verified: false,
      evaluate(b) {
        const hits = [];
        if (b.hpGasStorage) hits.push('고압가스 저장 허가');
        if (b.spHpGasUse) hits.push('특정고압가스 사용신고');
        if (b.cityGasSpecific) hits.push('도시가스 특정가스사용시설');
        if (hits.length) return R('의무대상', hits.join(', ') + ' 해당');
        if (b.lpg) return R('확인필요', `LPG 사용${has(b.lpgKg) ? ` (저장능력 ${fmtNum(b.lpgKg)}kg)` : ''} — 액화석유가스 특정사용자 해당 여부를 완성검사증명서로 확인하세요.`, has(b.lpgKg) ? [] : ['LPG 저장능력']);
        if (b.cityGas) return R('확인필요', '도시가스 사용 — 특정가스사용시설 해당 여부를 확인하세요.', ['특정가스사용시설 여부']);
        return R('비대상', '가스 저장·특정 사용시설에 해당하지 않습니다.');
      }
    },
    {
      code: 'ELEVATOR_LIAB', kind: 'mandatory', name: '승강기사고배상책임보험',
      law: '승강기 안전관리법 제30조',
      penalty: '1,000만 원 이하 과태료 [확인 필요]', coverage: '사망 1인당 8천만 원 이상 [확인 필요]',
      products: ['ELEVATOR_LIAB'], verified: false,
      evaluate(b) {
        if (!b.hasElevator) return R('비대상', '사업장에 승강기가 없습니다.');
        if (b.elevatorManager === false) return R('비대상', '승강기 관리주체가 건물주 등 다른 사람입니다.');
        if (!has(b.elevatorManager)) return R('확인필요', `승강기${b.elevatorCount ? ' ' + b.elevatorCount + '대' : ''} — 고객이 관리주체인지 확인하세요.`, ['관리주체 여부']);
        return R('의무대상', `승강기 ${b.elevatorCount || 1}대의 관리주체`);
      }
    },
    {
      code: 'DISASTER_LIAB', kind: 'mandatory', name: '재난배상책임보험',
      law: '재난 및 안전관리 기본법 제76조의5, 시행령 제84조의6',
      penalty: '최대 300만 원 과태료', coverage: '대인 1인당 1억5천만 원, 대물 사고당 10억 원',
      products: ['DISASTER_LIAB'], verified: false,
      evaluate(b) {
        const f = b.otherFacilities || [];
        if (f.length) return R('확인필요', `사업장 내 ${f.join(', ')} 운영 — 재난취약시설(20종) 해당 여부를 확인하세요.`);
        return R('비대상', '제조공장은 재난배상책임보험 의무 대상 시설에 해당하지 않습니다.');
      }
    },
    {
      code: 'ENV_LIAB', kind: 'mandatory', name: '환경책임보험',
      law: '환경오염피해 배상책임 및 구제에 관한 법률 제17조',
      penalty: '영업정지·과태료 [확인 필요]', coverage: '시설 분류별 [확인 필요]',
      products: [], verified: false,
      evaluate(b) {
        const hits = [];
        if (b.hazardousChem) hits.push('유해화학물질 취급');
        if (b.emissionFacility) hits.push('대기·수질 배출시설');
        if (hits.length) return R('확인필요', hits.join(', ') + ' — 법정 대상시설 목록과 대조하세요.');
        return R('비대상', '유해화학물질·배출시설에 해당하지 않습니다.');
      }
    },
    {
      code: 'PRIVACY_LIAB', kind: 'mandatory', name: '개인정보 손해배상책임보험',
      law: '개인정보 보호법 제39조의7, 시행령 제48조의7',
      penalty: '과태료 [확인 필요]', coverage: '매출·정보주체 수 구간별 최저가입금액',
      products: [], verified: false,
      evaluate(b) {
        if (!has(b.records)) return R('비대상', '보유 개인정보 건수가 입력되지 않았어요. 고객 정보를 1만 건 이상 보유하면 다시 확인하세요.');
        if (b.records >= 10000) return R('확인필요', `정보주체 ${fmtNum(b.records)}명 — 전년도 매출 10억 원 이상이면 의무 대상이에요.`);
        return R('비대상', '보유 개인정보가 1만 건 미만입니다.');
      }
    },
    {
      code: 'AUTO_LIAB', kind: 'mandatory', name: '자동차 책임보험',
      law: '자동차손해배상 보장법 제5조',
      penalty: '최대 300만 원 과태료', coverage: '대인Ⅰ·대물 법정한도',
      products: [], verified: false,
      evaluate(b) {
        if ((b.vehicles || 0) >= 1) return R('의무대상', `업무용 차량 ${b.vehicles}대`);
        return R('비대상', '업무용 차량이 없습니다.');
      }
    },
    {
      code: 'REC_FACTORY_FIRE', kind: 'recommended', name: '공장 화재(재물) 보장',
      law: '의무 아님', products: ['FACTORY_FIRE'], verified: true,
      evaluate(b) {
        if (b.isBuildingOwner && b.buildingArea >= 3000) return R('비대상', '특수건물 화재보험으로 함께 설계합니다.');
        return R('권장', '공장 건물·기계·재고의 화재 손해 대비 (기업휴지손해 특약 검토)');
      }
    },
    {
      code: 'REC_PL', kind: 'recommended', name: '생산물배상책임',
      law: '의무 아님', products: ['PL_1', 'PL_2'], verified: true,
      evaluate(b) {
        return R('권장', b.supplyNH ? '농협 계통 납품 중 — 「농협 납품분 한정특약」 검토' : `${b.mainProducts || '생산품'}으로 인한 제3자 피해 대비`);
      }
    }
  ];
  const RULE = Object.fromEntries(RULES.map(r => [r.code, r]));

  function eligibility(b) {
    const reasons = [];
    let status = '적격';
    const n = parseInt((b.ksic || '').slice(1), 10);
    if (!b.ksic) { status = '확인필요'; reasons.push('업종을 선택하세요.'); }
    else if (!(b.ksic[0] === 'C' && n >= 10 && n <= 34)) { status = '부적격'; reasons.push('주된 업종이 C10~C34가 아닙니다.'); }
    else reasons.push(`${b.ksic} ${KSIC_NAME[b.ksic]} 제조업`);
    if (b.isMainBusiness === false) { status = '부적격'; reasons.push('제조업이 주된 사업이 아닙니다.'); }
    if (b.smeType === '소기업' || b.smeType === '소상공인') reasons.push(`중소기업확인서 ${b.smeType}`);
    else if (b.smeType === '중기업') { status = '부적격'; reasons.push('중기업으로 소기업이 아닙니다.'); }
    else { if (status === '적격') status = '확인필요'; reasons.push('중소기업확인서로 소기업 여부를 확인하세요.'); }
    return { status, reasons };
  }

  function analyze(b) {
    return RULES.map(r => {
      const out = r.evaluate(b);
      return { code: r.code, kind: r.kind, name: r.name, result: out.result, reason: out.reason, missing: out.missing, products: r.products };
    });
  }

  function fmtNum(n) { return Number(n).toLocaleString('ko-KR'); }
  function fmtWon(n) {
    if (!has(n)) return '-';
    if (n >= 100_000_000) return (Math.round(n / 10_000_000) / 10).toLocaleString('ko-KR') + '억 원';
    return fmtNum(Math.round(n / 10000)) + '만 원';
  }

  const STAGES = ['추천', '설명완료', '청약', '계약성립', '거절', '철회'];
  const OPEN_STAGES = ['추천', '설명완료', '청약'];

  const api = { BASIS_DATE, KSIC, KSIC_NAME, PRODUCTS, PRODUCT, RULES, RULE, STAGES, OPEN_STAGES, eligibility, analyze, fmtNum, fmtWon };
  if (typeof module !== 'undefined') module.exports = api; else root.Engine = api;
})(this);
