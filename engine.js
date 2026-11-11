/* 소상공인 보험 헤아림 — 판정 엔진 (소상공인 전 업종, 2026.11 기준 초안 / 사회보험 제외) */
(function (root) {
  const BASIS_DATE = '2026.11.11';

  /* 상담사용 업종 분류 — 판정에 필요한 만큼만 나눔 */
  const INDUSTRIES = [
    { code: 'FOOD', name: '일반음식점', hint: '식당·고깃집·주점 등', group: '음식', empLimit: 5, multiUse: 'area' },
    { code: 'CAFE', name: '휴게음식점·카페·제과점', hint: '카페·분식·베이커리', group: '음식', empLimit: 5, multiUse: 'area' },
    { code: 'KARAOKE', name: '노래연습장', group: '다중이용', empLimit: 5, multiUse: 'always' },
    { code: 'PCROOM', name: 'PC방·게임방', group: '다중이용', empLimit: 5, multiUse: 'always' },
    { code: 'KIDS', name: '키즈카페·실내놀이터', group: '다중이용', empLimit: 5, multiUse: 'always' },
    { code: 'GOSIWON', name: '고시원', group: '다중이용', empLimit: 5, multiUse: 'always' },
    { code: 'POSTPARTUM', name: '산후조리원', group: '다중이용', empLimit: 5, multiUse: 'always' },
    { code: 'BATH', name: '목욕장·찜질방', group: '다중이용', empLimit: 5, multiUse: 'capacity100' },
    { code: 'ACADEMY', name: '학원·교습소', group: '교육', empLimit: 5, multiUse: 'capacity300' },
    { code: 'SPORTS', name: '체육시설', hint: '헬스·필라테스·골프연습장·수영장 등', group: '레저', empLimit: 5 },
    { code: 'LODGING', name: '숙박업', hint: '모텔·펜션·게스트하우스', group: '숙박', empLimit: 5 },
    { code: 'BEAUTY', name: '미용·네일·피부관리', group: '서비스', empLimit: 5 },
    { code: 'RETAIL', name: '소매·편의점·판매점', group: '판매', empLimit: 5 },
    { code: 'MFG', name: '제조업(소공인)', hint: '식품·금속·섬유 등 공장', group: '제조', empLimit: 10 },
    { code: 'WAREHOUSE', name: '물류창고·창고업', group: '물류', empLimit: 10 },
    { code: 'TRANSPORT', name: '운송업(화물·택배·퀵)', group: '물류', empLimit: 10 },
    { code: 'GAS_STATION', name: '주유소·충전소', group: '판매', empLimit: 5 },
    { code: 'OFFICE', name: '사무실·전문서비스', hint: '세무·디자인·IT 등', group: '서비스', empLimit: 5 },
    { code: 'OTHER', name: '기타 서비스업', group: '서비스', empLimit: 5 }
  ];
  const IND = Object.fromEntries(INDUSTRIES.map(i => [i.code, i]));
  const SPORTS_TYPES = [
    ['GYM', '헬스장·필라테스·요가', false], ['DOJANG', '태권도·주짓수 등 체육도장', false], ['GOLF_RANGE', '골프연습장·스크린골프', false],
    ['BILLIARD', '당구장', false], ['POOL', '수영장', true], ['ICE', '빙상장', true], ['HORSE', '승마장', true],
    ['SLED', '썰매장', true], ['MULTI', '종합체육시설', true], ['GOLF', '골프장', true]
  ];
  const SPORTS_MANDATORY = Object.fromEntries(SPORTS_TYPES.map(([c, , m]) => [c, m]));
  const FLOOR_OPTS = [['B', '지하층'], ['1', '지상 1층'], ['2', '지상 2층 이상']];

  /* KSIC 중분류 — 제조업일 때만 선택 입력 */
  const KSIC = [
    ['C10', '식료품'], ['C11', '음료'], ['C13', '섬유제품'], ['C14', '의복'], ['C15', '가죽·가방·신발'], ['C16', '목재'],
    ['C17', '펄프·종이'], ['C18', '인쇄'], ['C20', '화학제품'], ['C21', '의약품'], ['C22', '고무·플라스틱'], ['C23', '비금속광물'],
    ['C24', '1차 금속'], ['C25', '금속가공'], ['C26', '전자부품'], ['C27', '의료·정밀기기'], ['C28', '전기장비'], ['C29', '기계장비'],
    ['C30', '자동차부품'], ['C31', '기타 운송장비'], ['C32', '가구'], ['C33', '기타 제품'], ['C34', '산업용 기계 수리']
  ];
  const KSIC_NAME = Object.fromEntries(KSIC);

  /* ---------- 당사 상품과 보험설계 (제공 서류 2026.07.01 기준) ----------
     riders[].kind: 'required'(필수·해제 불가) / 'recommended'(권장·기본 선택) / 'optional'(선택)
     riders[].when(b) 가 false 면 그 특약은 표시하지 않음, why(b) 는 추천 사유 */
  const has = v => v !== undefined && v !== null && v !== '';
  const staff = b => (b.employees || 0) > 0;
  const tenant = b => b.isBuildingOwner === false;
  const PRODUCTS = [
    {
      id: 'MULTI_FIRE', name: '다중이용업소화재배상책임보험', line: '특종 / 배상책임', active: true,
      main: '화재·폭발로 손님 등 타인이 입은 신체·재산 손해를 영업주의 과실이 없어도 배상',
      limits: ['사망·후유장애 1인당 최대 1억5천만원 (사망 최저 2천만원)', '부상 1인당 등급별 최대 3천만원', '재산 1사고당 10억원'],
      riders: [
        { name: '임차자 특약', kind: 'recommended', when: tenant, why: () => '영업장을 임차해 쓰는 경우' },
        { name: '초과손해액보장 특약', kind: 'recommended', when: b => (b.bizArea || 0) >= 300, why: () => '영업장이 넓어 법정 한도를 넘는 사고에 대비' },
        { name: '종업원배상책임보장제외 특약', kind: 'optional', when: staff, why: () => '직원 피해를 산재보험으로 처리해 보험료를 낮출 때' },
        { name: '보험료분납 특약', kind: 'optional', when: () => true, why: () => '보험료를 나눠 낼 때' }
      ],
      checklist: ['법정 의무보험으로 보상한도 이상 가입되는지 확인', '영업주(사업자등록증상 대표자) 명의로 가입'],
      docs: ['2.다중이용업소화재배상책임보험_사업방법서별지', '3.다중이용업소화재배상책임보험_약관', '5.다중이용업소화재배상책임보험_영업요율서*']
    },
    {
      id: 'DISASTER_LIAB', name: '재난배상책임보험', line: '특종 / 배상책임', active: true,
      main: '화재·붕괴·폭발로 타인이 입은 신체·재산 손해를 과실이 없어도 배상',
      limits: ['사망 1인당 최대 1억5천만원 (사망자 수 제한 없음)', '부상·후유장애 등급별', '재산 1사고당 10억원'],
      riders: [
        { name: '임차자 특약', kind: 'required', when: tenant, why: () => '점유자(임차인)가 가입하는 경우 필수' },
        { name: '대위권포기 특약', kind: 'optional', when: tenant, why: () => '임대차계약서에 대위권 포기 요구가 있을 때' },
        { name: '종업원배상책임보장제외 특약', kind: 'optional', when: staff, why: () => '직원 피해를 산재보험으로 처리할 때' },
        { name: '보험료분납 특약', kind: 'optional', when: () => true, why: () => '보험료를 나눠 낼 때' }
      ],
      checklist: ['가입 주체 확인: 소유자=점유자면 소유자, 다르면 점유자'],
      docs: ['2.재난배상책임보험_사업방법서별지', '3.재난배상책임보험_약관', '5.재난배상책임보험_영업요율서*']
    },
    {
      id: 'GAS_LIAB', name: '가스사고배상책임보험', line: '특종 / 가스사고', active: true,
      main: '가스 사용시설의 사고로 타인이 입은 신체·재산 손해 배상',
      limits: ['사망 1인당 1억5천만원 (실손 2천만원 미만 시 2천만원)', '부상·후유장애 등급별', '재산 법정 한도'],
      riders: [
        { name: '종업원(근로자) 신체장해 보장 특약', kind: 'recommended', when: staff, why: b => `직원 ${b.employees}명 — 가스사고 시 직원 피해 보장` },
        { name: '교차배상책임 특약', kind: 'optional', when: () => true, why: () => '피보험자가 여럿일 때 서로 간 배상' },
        { name: '보험료분납 특약', kind: 'optional', when: () => true, why: () => '보험료를 나눠 낼 때' }
      ],
      checklist: ['「종업원(근로자) 신체장해 보장 특약」 설명', '중복가입 시 비례보상 안내를 청약서에 기재'],
      docs: ['2.가스사고배상책임보험_사업방법서별지', '3.가스사고배상책임보험_약관', '5.가스사고배상책임보험_영업요율서*', '6.가스사고배상책임보험_변경대비표*']
    },
    {
      id: 'ELEVATOR_LIAB', name: '승강기사고배상책임보험', line: '특종 / 영업배상', active: true,
      main: '관리하는 승강기 사고로 이용자 등 타인이 입은 신체·재산 손해 배상',
      limits: ['대인 1인당 8천만원 이상 (사망 실손 2천만원 미만 시 2천만원)', '대물 1사고당 1천만원 이상'],
      riders: [
        { name: '구내치료비 특약', kind: 'recommended', when: b => !['MFG', 'WAREHOUSE', 'OFFICE'].includes(b.industry), why: () => '손님 출입이 많아 법률상 책임이 없어도 치료비로 원만히 해결' },
        { name: '종업원(근로자) 신체장해 보장 특약', kind: 'recommended', when: staff, why: b => `직원 ${b.employees}명 — 승강기 사고 시 직원 피해 보장` },
        { name: '대위권포기 특약', kind: 'optional', when: tenant, why: () => '임대인과 계약상 요구가 있을 때' }
      ],
      checklist: ['「종업원(근로자) 신체장해 보장 특약」 설명', '중복가입 시 비례보상 안내를 청약서에 기재'],
      docs: ['2.승강기사고배상책임보험_사업방법서별지', '3.승강기사고배상책임보험_약관', '5.승강기사고배상책임보험_영업요율서*', '6.승강기사고배상책임보험_변경대비표*']
    },
    {
      id: 'GENERAL_FIRE', name: '일반화재보험', line: '화재 / 일반화재', active: true,
      main: '매장 건물·시설·집기·재고의 화재(벼락 포함) 손해 보상',
      limits: ['보험가액 기준 (재조달가액·협정보험가액 중 선택)'],
      riders: [
        { name: '특수건물 신체손해배상책임 특약', kind: 'required', when: b => b._special, why: () => '특수건물 의무보험 요건' },
        { name: '화재대물배상책임 특약(특수건물)', kind: 'required', when: b => b._special, why: () => '특수건물 의무보험 요건' },
        { name: '특수건물 항공기 및 낙하물위험 특약', kind: 'required', when: b => b._special, why: () => '사업방법서상 특수건물 의무부가' },
        { name: '화재대물배상책임 특약', kind: 'recommended', when: b => !b._special, why: () => '불이 이웃 점포·건물로 번졌을 때의 배상 — 상가 소상공인 필수 권장' },
        { name: '전기위험 특약', kind: 'recommended', when: () => true, why: () => '누전·합선으로 인한 전기설비 손해' },
        { name: '도난위험 특약', kind: 'recommended', when: b => ['RETAIL', 'GAS_STATION', 'BEAUTY', 'PCROOM'].includes(b.industry), why: () => '현금·재고·고가 장비 도난 대비' },
        { name: '유리손해 특약', kind: 'recommended', when: b => ['FOOD', 'CAFE', 'RETAIL', 'BEAUTY'].includes(b.industry) && b.floorType === '1', why: () => '1층 통유리 매장' },
        { name: '냉동(냉장) 위험 특약', kind: 'recommended', when: b => ['FOOD', 'CAFE', 'RETAIL'].includes(b.industry), why: () => '정전·고장 시 냉장·냉동 식재료 손해' },
        { name: '풍수재위험담보 특약', kind: 'recommended', when: b => b.floorType === 'B', why: () => '지하 매장 침수 대비' },
        { name: '급배수설비누출 손해 특약', kind: 'optional', when: () => true, why: () => '배관 누수로 인한 손해' },
        { name: '기업휴지손해 특약', kind: 'optional', when: () => true, why: () => '화재 후 영업 중단 기간의 손실' }
      ],
      checklist: ['보험가액(재조달가액/협정보험가액) 기준 설명', '특수건물이면 신체손해배상·대물배상·항공기낙하물 특약 3종 부가 확인'],
      docs: ['2.일반화재보험_사업방법서', '3.일반화재보험_약관', '5.일반화재보험_변경대비표*', '6.일반화재보험_영업요율서*']
    },
    {
      id: 'FACTORY_FIRE', name: '공장화재보험', line: '화재 / 공장화재', active: true,
      main: '공장 건물·기계·원자재·재고의 화재(벼락 포함) 손해 보상',
      limits: ['보험가액 기준 (재조달가액·협정보험가액 중 선택)'],
      riders: [
        { name: '특수건물 신체손해배상책임 특약', kind: 'required', when: b => b._special, why: () => '특수건물 의무보험 요건' },
        { name: '화재대물배상책임 특약(특수건물)', kind: 'required', when: b => b._special, why: () => '특수건물 의무보험 요건' },
        { name: '특수건물 항공기 및 낙하물위험 특약', kind: 'required', when: b => b._special, why: () => '사업방법서상 특수건물 의무부가' },
        { name: '화재대물배상책임 특약', kind: 'recommended', when: b => !b._special, why: () => '이웃 공장·건물로 번진 화재 배상' },
        { name: '구내폭발위험 특약', kind: 'recommended', when: b => b.lpg || b.cityGas || b.hpGasStorage || b.spHpGasUse || b.hazardousChem, why: () => '가스·화학물질 사용 공장' },
        { name: '전기위험 특약', kind: 'recommended', when: () => true, why: () => '생산설비 누전·합선 손해' },
        { name: '냉동(냉장) 위험 특약', kind: 'recommended', when: b => b.ksic === 'C10' || b.ksic === 'C11', why: () => '식품·음료 냉장 원재료 손해' },
        { name: '기업휴지손해 특약', kind: 'recommended', when: () => true, why: () => '화재 후 생산 중단 기간의 손실' },
        { name: '도난위험 특약', kind: 'optional', when: () => true, why: () => '원자재·완제품 도난' }
      ],
      checklist: ['보험가액(재조달가액/협정보험가액) 기준 설명', '특수건물이면 신체손해배상·대물배상·항공기낙하물 특약 3종 부가 확인'],
      docs: ['2.공장화재보험_사업방법서별지', '3.공장화재보험_약관', '5.공장화재보험_변경대비표*', '6.공장화재보험_영업요율서*']
    },
    {
      id: 'PL_1', name: '생산물배상책임보험(Ⅰ)', line: '특종 / 생산물 · 손해사고기준', active: true,
      main: '판매·제조·제공한 음식·제품으로 타인이 입은 신체·재산 손해 배상 (보험기간 중 사고 발생 기준)',
      limits: ['대인·대물 사고당 보상한도 협의 (소상공인 1억원 이상 권장)'],
      riders: [
        { name: '농협 납품분 한정특약', kind: 'recommended', when: b => b.supplyNH, why: () => '농협 계통 납품 물량에 맞춰 보장' },
        { name: '판매인 특약', kind: 'recommended', when: b => b.industry === 'RETAIL', why: () => '직접 만들지 않은 제품을 판매' },
        { name: '품질저하 부담보 특약', kind: 'optional', when: () => true, why: () => '보험료 절감이 필요할 때' }
      ],
      checklist: ['손해사고기준: 보험기간 중 발생한 사고를 보상함을 설명'],
      docs: ['2.생산물배상책임보험(Ⅰ)_사업방법서별지', '3.생산물배상책임보험(Ⅰ)_약관', '5.생산물배상책임보험(Ⅰ)_영업요율서*']
    },
    {
      id: 'PL_2', name: '생산물배상책임보험(Ⅱ)', line: '특종 / 생산물 · 배상청구기준', active: true,
      main: '판매·제조한 제품으로 타인이 입은 손해 배상 (보험기간 중 최초 손해배상청구 기준, 소급보상일자 적용)',
      limits: ['대인·대물 사고당 보상한도 협의'],
      riders: [
        { name: '농협 납품분 한정특약', kind: 'recommended', when: b => b.supplyNH, why: () => '농협 계통 납품 물량에 맞춰 보장' },
        { name: '판매인 특약', kind: 'recommended', when: b => b.industry === 'RETAIL', why: () => '직접 만들지 않은 제품을 판매' },
        { name: '품질저하 부담보 특약', kind: 'optional', when: () => true, why: () => '보험료 절감이 필요할 때' }
      ],
      checklist: ['배상청구기준: 보험기간 중 최초 손해배상청구를 보상함을 설명', '소급보상일자 설명'],
      docs: ['2.생산물배상책임보험(Ⅱ)_사업방법서별지', '3.생산물배상책임보험(Ⅱ)_약관', '5.생산물배상책임보험(Ⅱ)_영업요율서*']
    },
    { id: 'APT_FIRE', name: '아파트단체화재보험', line: '화재', active: false, note: '소상공인 대상 아님', riders: [], limits: [], checklist: [], docs: [] },
    { id: 'HOME_FIRE', name: '주택화재보험', line: '화재', active: false, note: '소상공인 대상 아님', riders: [], limits: [], checklist: [], docs: [] }
  ];
  const PRODUCT = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

  const R = (result, reason, missing) => ({ result, reason, missing: missing || [] });
  const fmtNum = n => Number(n).toLocaleString('ko-KR');
  const ind = b => IND[b.industry] || {};
  const isSpecial = b => {
    if (b.isBuildingOwner !== true || !has(b.buildingArea)) return false;
    if ((b.buildingFloors || 0) >= 11) return true;
    if (b.industry === 'MFG') return b.buildingArea >= 3000;
    if (b.industry === 'RETAIL') return b.buildingArea >= 3000;
    if (['FOOD', 'CAFE', 'KARAOKE', 'PCROOM', 'KIDS', 'GOSIWON', 'POSTPARTUM', 'BATH', 'ACADEMY', 'LODGING', 'SPORTS'].includes(b.industry)) return b.buildingArea >= 2000;
    return false;
  };

  /* ---------- 의무보험 규칙 (모두 미검증 초안) ---------- */
  const RULES = [
    {
      code: 'MULTI_FIRE_LIAB', kind: 'mandatory', name: '다중이용업소 화재배상책임보험',
      law: '다중이용업소의 안전관리에 관한 특별법 제13조의2', penalty: '과태료 최대 200만원 (미가입 기간별)',
      coverage: '사망 1인당 1억5천만원, 재산 1사고당 10억원', products: ['MULTI_FIRE'], verified: false,
      evaluate(b) {
        const m = ind(b).multiUse;
        if (!m) return R('비대상', '다중이용업소 업종이 아닙니다.');
        if (m === 'always') return R('의무대상', `${ind(b).name}은 다중이용업소입니다.`);
        if (m === 'area') {
          if (!b.floorType || !has(b.bizArea)) return R('확인필요', '영업장 층과 면적이 있어야 판단할 수 있어요.', ['영업장 층', '영업장 면적']);
          if (b.floorType === '1') return R('비대상', '지상 1층 음식점은 다중이용업소에서 제외돼요 (재난배상책임보험 확인).');
          if (b.floorType === 'B' && b.bizArea >= 66) return R('의무대상', `지하 영업장 ${fmtNum(b.bizArea)}㎡ ≥ 66㎡`);
          if (b.floorType === '2' && b.bizArea >= 100) return R('의무대상', `지상 2층 이상 영업장 ${fmtNum(b.bizArea)}㎡ ≥ 100㎡`);
          return R('비대상', `영업장 면적 ${fmtNum(b.bizArea)}㎡로 기준 미만입니다.`);
        }
        const need = m === 'capacity300' ? 300 : 100;
        if (!has(b.capacity)) return R('확인필요', `수용인원 ${need}명 이상이면 의무 대상이에요.`, ['수용인원']);
        return b.capacity >= need ? R('의무대상', `수용인원 ${fmtNum(b.capacity)}명 ≥ ${need}명`) : R('비대상', `수용인원 ${fmtNum(b.capacity)}명으로 기준(${need}명) 미만입니다.`);
      }
    },
    {
      code: 'DISASTER_LIAB', kind: 'mandatory', name: '재난배상책임보험',
      law: '재난 및 안전관리 기본법 제76조의5, 시행령 제84조의6', penalty: '과태료 최대 300만원 (미가입 기간별)',
      coverage: '사망 1인당 1억5천만원, 재산 1사고당 10억원', products: ['DISASTER_LIAB'], verified: false,
      evaluate(b) {
        if (['FOOD', 'CAFE'].includes(b.industry)) {
          if (!b.floorType || !has(b.bizArea)) return R('확인필요', '영업장 층과 면적이 있어야 판단할 수 있어요.', ['영업장 층', '영업장 면적']);
          if (b.floorType === '1' && b.bizArea >= 100) return R('의무대상', `1층 음식점, 바닥면적 ${fmtNum(b.bizArea)}㎡ ≥ 100㎡`);
          return R('비대상', b.floorType === '1' ? `1층 바닥면적 ${fmtNum(b.bizArea)}㎡로 100㎡ 미만입니다.` : '1층이 아닌 음식점은 다중이용업소 화재배상책임보험으로 확인해요.');
        }
        if (b.industry === 'LODGING') return R('의무대상', '숙박업은 재난취약시설입니다.');
        if (b.industry === 'GAS_STATION') return R('의무대상', '주유소는 재난취약시설입니다.');
        if (b.industry === 'WAREHOUSE') {
          if (!has(b.buildingArea)) return R('확인필요', '창고 연면적 1,000㎡ 이상이면 의무 대상이에요.', ['건물 연면적']);
          return b.buildingArea >= 1000 ? R('의무대상', `물류창고 연면적 ${fmtNum(b.buildingArea)}㎡ ≥ 1,000㎡`) : R('비대상', '연면적 1,000㎡ 미만 창고입니다.');
        }
        if ((b.otherFacilities || []).length) return R('확인필요', `사업장 내 ${b.otherFacilities.join(', ')} — 재난취약시설 해당 여부를 확인하세요.`);
        return R('비대상', '재난배상책임보험 의무 대상 시설이 아닙니다.');
      }
    },
    {
      code: 'SPECIAL_BLDG_FIRE', kind: 'mandatory', name: '특수건물 화재보험 (신체·대물배상책임)',
      law: '화재로 인한 재해보상과 보험가입에 관한 법률 제5조, 시행령 제2조', penalty: '500만원 이하 벌금',
      coverage: '사망 1인당 1억5천만원, 대물 사고당 10억원', products: [], productBy: b => b.industry === 'MFG' ? 'FACTORY_FIRE' : 'GENERAL_FIRE', verified: false,
      evaluate(b) {
        if (b.isBuildingOwner === false) return R('비대상', '건물을 임차해 사용 중이라 가입 의무자(건물 소유자)가 아닙니다.');
        if (!has(b.isBuildingOwner) || !has(b.buildingArea)) return R('확인필요', '건물 소유 여부와 연면적이 필요해요.', ['건물 소유', '건물 연면적']);
        if (isSpecial(b)) return R('의무대상', `자가 소유 건물, 연면적 ${fmtNum(b.buildingArea)}㎡${(b.buildingFloors || 0) >= 11 ? `, ${b.buildingFloors}층` : ''} — 특수건물 기준 해당`);
        return R('비대상', `연면적 ${fmtNum(b.buildingArea)}㎡로 업종별 특수건물 기준 미만입니다.`);
      }
    },
    {
      code: 'GAS_LIAB', kind: 'mandatory', name: '가스사고배상책임보험',
      law: '고압가스 안전관리법, 액화석유가스의 안전관리 및 사업법, 도시가스사업법 제43조', penalty: '과태료 (금액 확인 필요)',
      coverage: '사망 1인당 1억5천만원', products: ['GAS_LIAB'], verified: false,
      evaluate(b) {
        const hits = [];
        if (b.hpGasStorage) hits.push('고압가스 저장 허가');
        if (b.spHpGasUse) hits.push('특정고압가스 사용신고');
        if (b.cityGasSpecific) hits.push('도시가스 특정가스사용시설');
        if (hits.length) return R('의무대상', hits.join(', ') + ' 해당');
        if (b.lpg) return R('확인필요', `LPG 사용${has(b.lpgKg) ? ` (저장능력 ${fmtNum(b.lpgKg)}kg)` : ''} — 액화석유가스 특정사용자 해당 여부를 완성검사증명서로 확인하세요.`);
        if (b.cityGas) return R('확인필요', '도시가스 사용 — 특정가스사용시설 해당 여부를 확인하세요.');
        return R('비대상', '가스 저장·특정 사용시설에 해당하지 않습니다.');
      }
    },
    {
      code: 'ELEVATOR_LIAB', kind: 'mandatory', name: '승강기사고배상책임보험',
      law: '승강기 안전관리법 제30조', penalty: '과태료 1차 100만원, 2차 200만원, 3차 300만원',
      coverage: '대인 1인당 8천만원 이상, 대물 1천만원 이상', products: ['ELEVATOR_LIAB'], verified: false,
      evaluate(b) {
        if (!b.hasElevator) return R('비대상', '관리하는 승강기가 없습니다.');
        if (b.elevatorManager === false) return R('비대상', '승강기 관리주체가 건물주 등 다른 사람입니다.');
        if (!has(b.elevatorManager)) return R('확인필요', '고객이 승강기 관리주체인지 확인하세요.', ['관리주체 여부']);
        return R('의무대상', `승강기 ${b.elevatorCount || 1}대의 관리주체`);
      }
    },
    {
      code: 'KIDS_PLAY_LIAB', kind: 'mandatory', name: '어린이놀이시설 사고배상책임보험',
      law: '어린이놀이시설 안전관리법 제21조', penalty: '과태료 (금액 확인 필요)',
      coverage: '사망 1인당 최대 1억원 (개정 기준 확인 필요)', products: [], verified: false,
      evaluate(b) {
        if (b.industry === 'KIDS' || b.kidsPlay) return R('의무대상', '어린이놀이기구·놀이공간 운영 (2027.2.28부터 무인 키즈카페 포함)');
        return R('비대상', '어린이놀이시설을 운영하지 않습니다.');
      }
    },
    {
      code: 'SPORTS_LIAB', kind: 'mandatory', name: '체육시설업자 배상책임보험',
      law: '체육시설의 설치·이용에 관한 법률 제26조', penalty: '과태료 1차 25만원, 2차 50만원, 3차 100만원',
      coverage: '대인 1인당 1억5천만원', products: [], verified: false,
      evaluate(b) {
        if (b.industry !== 'SPORTS') return R('비대상', '체육시설업이 아닙니다.');
        if (!b.sportsType) return R('확인필요', '체육시설 종류를 선택하세요.', ['체육시설 종류']);
        const nm = (SPORTS_TYPES.find(t => t[0] === b.sportsType) || [])[1];
        return SPORTS_MANDATORY[b.sportsType] ? R('의무대상', `${nm}은 보험 의무가입 체육시설입니다.`) : R('비대상', `${nm}은 의무가입 대상이 아니에요 (임의 가입 권장).`);
      }
    },
    {
      code: 'ACADEMY_LIAB', kind: 'mandatory', name: '학원 배상책임보험',
      law: '학원의 설립·운영 및 과외교습에 관한 법률 제4조, 시·도 조례', penalty: '과태료 (시·도 조례별)',
      coverage: '시·도 조례 기준', products: [], verified: false,
      evaluate(b) { return b.industry === 'ACADEMY' ? R('의무대상', '학원·교습소는 수강생 배상 보험 가입 대상입니다.') : R('비대상', '학원이 아닙니다.'); }
    },
    {
      code: 'ENV_LIAB', kind: 'mandatory', name: '환경책임보험',
      law: '환경오염피해 배상책임 및 구제에 관한 법률 제17조', penalty: '1년 이하 징역 또는 1천만원 이하 벌금, 영업정지',
      coverage: '시설 분류별', products: [], verified: false,
      evaluate(b) {
        const hits = [];
        if (b.hazardousChem) hits.push('유해화학물질 취급');
        if (b.emissionFacility) hits.push('대기·수질 배출시설');
        return hits.length ? R('확인필요', hits.join(', ') + ' — 법정 대상시설 목록과 대조하세요.') : R('비대상', '유해화학물질·배출시설에 해당하지 않습니다.');
      }
    },
    {
      code: 'PRIVACY_LIAB', kind: 'mandatory', name: '개인정보 손해배상책임보험',
      law: '개인정보 보호법 제39조의7, 시행령 제48조의7', penalty: '과태료 (금액 확인 필요)',
      coverage: '매출·정보주체 수 구간별 최저가입금액', products: [], verified: false,
      evaluate(b) {
        if (!has(b.records) || b.records < 10000) return R('비대상', '보유 고객 개인정보가 1만 건 미만입니다.');
        return R('확인필요', `정보주체 ${fmtNum(b.records)}명 — 매출 기준(10억원, 상향 개정 여부 확인)을 확인하세요.`);
      }
    },
    {
      code: 'AUTO_LIAB', kind: 'mandatory', name: '자동차 책임보험',
      law: '자동차손해배상 보장법 제5조', penalty: '과태료 최대 100만원(사업용), 무보험 운행 시 형사처벌',
      coverage: '대인Ⅰ·대물 법정한도', products: [], verified: false,
      evaluate(b) { return (b.vehicles || 0) >= 1 ? R('의무대상', `업무용 차량 ${b.vehicles}대`) : R('비대상', '업무용 차량이 없습니다.'); }
    },
    /* 권장 */
    {
      code: 'REC_PROPERTY_FIRE', kind: 'recommended', name: '매장·공장 화재(재물) 보장', law: '의무 아님', products: [],
      productBy: b => b.industry === 'MFG' ? 'FACTORY_FIRE' : 'GENERAL_FIRE', verified: true,
      evaluate(b) {
        if (isSpecial(b)) return R('비대상', '특수건물 화재보험으로 함께 설계합니다.');
        return R('권장', b.industry === 'MFG' ? '공장 건물·기계·재고 화재 손해와 이웃 피해 배상 대비' : '매장 시설·집기·재고 화재 손해와 이웃 점포 피해 배상 대비');
      }
    },
    {
      code: 'REC_PL', kind: 'recommended', name: '음식물·생산물 배상책임', law: '의무 아님', products: ['PL_1', 'PL_2'], verified: true,
      evaluate(b) {
        if (['FOOD', 'CAFE'].includes(b.industry)) return R('권장', '식중독·이물질 사고로 손님이 입은 피해 배상');
        if (b.industry === 'MFG') return R('권장', b.supplyNH ? '농협 계통 납품 중 — 「농협 납품분 한정특약」 검토' : `${b.mainProducts || '생산품'}으로 인한 제3자 피해 대비`);
        if (b.industry === 'RETAIL') return R('권장', '판매한 제품의 결함으로 인한 피해 배상 (판매인 특약)');
        return R('비대상', '생산·판매 제품이 없는 업종입니다.');
      }
    }
  ];
  const RULE = Object.fromEntries(RULES.map(r => [r.code, r]));

  function productsFor(rule, b) {
    if (rule.productBy) return [rule.productBy(b)];
    return rule.products;
  }

  function eligibility(b) {
    const reasons = []; let status = '적격';
    const i = IND[b.industry];
    if (!i) return { status: '확인필요', reasons: ['업종을 선택하세요.'] };
    reasons.push(i.name);
    if (b.smeType === '소상공인') { reasons.push('소상공인 확인서 보유'); return { status, reasons }; }
    if (b.smeType === '중기업 이상') return { status: '부적격', reasons: [...reasons, '소상공인 규모를 넘습니다.'] };
    if (!has(b.employees)) return { status: '확인필요', reasons: [...reasons, '상시근로자 수를 입력하세요.'] };
    if (b.employees < i.empLimit) reasons.push(`상시근로자 ${b.employees}명 < ${i.empLimit}명`);
    else { status = '부적격'; reasons.push(`상시근로자 ${b.employees}명 — 소상공인 기준(${i.empLimit}명 미만) 초과`); }
    return { status, reasons };
  }

  function analyze(b) {
    const bb = { ...b, _special: isSpecial(b) };
    return RULES.map(r => {
      const out = r.evaluate(bb);
      return { code: r.code, kind: r.kind, name: r.name, result: out.result, reason: out.reason, missing: out.missing, products: productsFor(r, bb) };
    });
  }

  /* 보험설계: 상품 + 사업장 정보 → 메인보장·특약 목록 */
  function design(productId, b) {
    const p = PRODUCT[productId]; if (!p) return null;
    const bb = { ...b, _special: isSpecial(b) };
    const riders = p.riders.filter(r => r.when(bb)).map(r => ({ name: r.name, kind: r.kind, why: r.why(bb), selected: r.kind !== 'optional' }));
    return { productId, main: p.main, limits: p.limits, riders };
  }

  function fmtWon(n) {
    if (!has(n)) return '-';
    if (n >= 100_000_000) return (Math.round(n / 10_000_000) / 10).toLocaleString('ko-KR') + '억 원';
    return fmtNum(Math.round(n / 10000)) + '만 원';
  }

  const STAGES = ['추천', '설명완료', '청약', '계약성립', '거절', '철회'];
  const OPEN_STAGES = ['추천', '설명완료', '청약'];
  const RIDER_KIND = { required: '필수', recommended: '권장', optional: '선택' };

  const api = { BASIS_DATE, INDUSTRIES, IND, SPORTS_TYPES, FLOOR_OPTS, KSIC, KSIC_NAME, PRODUCTS, PRODUCT, RULES, RULE, STAGES, OPEN_STAGES, RIDER_KIND,
    eligibility, analyze, design, isSpecial, fmtNum, fmtWon };
  if (typeof module !== 'undefined') module.exports = api; else root.Engine = api;
})(this);
