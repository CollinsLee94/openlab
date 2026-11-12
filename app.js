/* 소상공인 보험 헤아림 — 상담사 콘솔 */
(function () {
  const E = window.Engine;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = iso => { if (!iso) return '-'; const d = new Date(iso); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
  const pctTxt = v => v === null ? '–' : v.toFixed(1) + '%';
  const maskPhone = p => (p || '').replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3');
  const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
  const formatPhone = raw => {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (d.startsWith('02')) {
      if (d.length <= 2) return d;
      if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
      if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
      return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
    }
    if (/^1[5-9]\d{2}/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4, 8)}`;
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  };
  const validPhone = p => /^(01[016789]-\d{3,4}-\d{4}|02-\d{3,4}-\d{4}|0[3-6]\d-\d{3,4}-\d{4}|070-\d{4}-\d{4}|1[5-9]\d{2}-\d{4})$/.test(p);
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let ACCOUNTS = [];
  let ACC = {};
  const CFG = window.HEARIM_CONFIG || {};
  const LOGO_SRC = ['brand/nh-logo.png'];
  const logo = (cls = '') => `<span class="logo ${cls}" role="img" aria-label="NH농협손해보험"><img src="${LOGO_SRC[0]}" alt="" data-try="0" onerror="window.__logoFallback(this)"><b class="logo-txt" hidden>NH농협손해보험</b></span>`;
  window.__logoFallback = img => { const i = Number(img.dataset.try) + 1; if (i < LOGO_SRC.length) { img.dataset.try = i; img.src = LOGO_SRC[i]; } else { img.hidden = true; img.nextElementSibling.hidden = false; } };

  const state = {
    me: null, consults: [], dbMode: 'loading', sb: null, canWrite: true, authReady: false,
    draft: null, step: 2, trackFilter: { q: '', stage: '', ind: '', product: '' }, cardFilter: { q: '', mode: 'all' }, confirmArchive: null, areaUnit: (() => { try { return localStorage.getItem('hearim_area_unit') || 'm2'; } catch (e) { return 'm2'; } })(),
    dash: { period: 'all', counselor: '' }, drawer: null
  };

  /* ---------- 저장소 (Supabase) ---------- */
  const rowToConsult = r => ({ ...(r.data || {}), id: r.id, counselorId: r.counselor_id, consultedAt: r.consulted_at });
  let channel = null;

  async function initDb() {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) { state.dbMode = 'noconfig'; state.authReady = true; render(); return; }
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    state.sb = sb;
    const { data } = await sb.auth.getSession();
    await onSession(data.session);
    sb.auth.onAuthStateChange((_e, session) => {
      const uid = session ? session.user.id : null;
      if (uid !== (state.me ? state.me.id : null)) setTimeout(() => onSession(session), 0);
    });
  }

  async function onSession(session) {
    const sb = state.sb;
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { state.me = null; state.consults = []; state.authReady = true; render(); return; }
    const { data: profs, error } = await sb.from('profiles').select('id,name,branch,role,active').order('name');
    if (error) { state.authReady = true; state.dbMode = 'error'; state.dbError = error.message; state.me = null; render(); return; }
    ACCOUNTS = profs.filter(p => p.active !== false);
    ACC = Object.fromEntries(profs.map(p => [p.id, p]));
    const me = ACC[session.user.id];
    if (!me || me.active === false) {
      state.loginError = '상담사로 등록되지 않았거나 비활성화된 계정이에요. 관리자에게 문의하세요.';
      state.me = null; state.authReady = true; await sb.auth.signOut(); render(); return;
    }
    state.me = me; state.authReady = true; state.loginError = '';
    await loadConsults();
    channel = sb.channel('consults-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consults' }, payload => {
        if (payload.eventType === 'DELETE') state.consults = state.consults.filter(c => c.id !== payload.old.id);
        else {
          const c = rowToConsult(payload.new);
          const i = state.consults.findIndex(x => x.id === c.id);
          if (i >= 0) state.consults[i] = c; else state.consults.push(c);
        }
        if (!state.drawer && route() !== 'consult') render();
      }).subscribe();
  }

  async function loadConsults() {
    state.dbMode = 'loading'; render();
    const timer = setTimeout(() => { if (state.dbMode === 'loading') { state.dbMode = 'slow'; render(); } }, 10000);
    const { data, error } = await state.sb.from('consults').select('id,counselor_id,consulted_at,data').order('consulted_at', { ascending: false }).limit(5000);
    clearTimeout(timer);
    if (error) { state.dbMode = 'error'; state.dbError = error.message; render(); return; }
    state.consults = data.map(rowToConsult); state.dbMode = 'live'; render();
  }

  async function saveConsult(c) {
    const { id, counselorId, consultedAt, ...rest } = structuredClone(c);
    const { error } = await state.sb.from('consults').upsert({ id, counselor_id: counselorId, consulted_at: consultedAt, data: rest });
    if (error) { toast('저장하지 못했어요: ' + error.message); return false; }
    const i = state.consults.findIndex(x => x.id === c.id);
    if (i >= 0) state.consults[i] = structuredClone(c); else state.consults.unshift(structuredClone(c));
    render(); return true;
  }

  /* ---------- 공통 ---------- */
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function visibleConsults() {
    return state.me.role === 'manager' ? state.consults : state.consults.filter(c => c.counselorId === state.me.id);
  }
  function route() { const h = (location.hash || '').slice(1); return ['consult', 'customers', 'tracking', 'dashboard', 'admin'].includes(h) ? h : 'customers'; }
  function badge(result) {
    const map = { '의무대상': 'crit', '확인필요': 'warn', '비대상': 'mute', '권장': 'info', '적격': 'good', '부적격': 'crit' };
    return `<span class="pill ${map[result] || 'mute'}">${esc(result)}</span>`;
  }
  function stageBadge(s) {
    const map = { '추천': 'mute', '설명완료': 'info', '청약': 'warn', '계약성립': 'good', '거절': 'crit', '철회': 'crit' };
    return `<span class="pill ${map[s]}">${esc(s)}</span>`;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    const app = $('#app');
    if (!state.authReady) { app.innerHTML = '<div class="login-wrap"><p class="muted">불러오는 중…</p></div>'; return; }
    if (state.dbMode === 'noconfig') { app.innerHTML = setupView(); return; }
    if (!state.me) { app.innerHTML = loginView(); bindLogin(); return; }
    const r = route();
    app.innerHTML = `
      ${topbar(r)}
      ${dbBanner()}
      <main class="main">${r === 'consult' ? consultView() : r === 'customers' ? customersView() : r === 'tracking' ? trackingView() : r === 'admin' ? adminView() : dashboardView()}</main>
      ${state.drawer ? drawerView() : ''}`;
    bindCommon();
    if (r === 'consult') bindConsult();
    if (r === 'tracking') bindTracking();
    if (r === 'customers') bindCustomers();
    if (r === 'dashboard') bindDashboard();
    if (state.drawer) bindDrawer();
  }

  function dbBanner() {
    const m = state.dbMode;
    if (m === 'live') return '';
    if (m === 'loading') return `<div class="banner">상담 데이터를 불러오는 중이에요…</div>`;
    if (m === 'slow' || m === 'cache') return `<div class="banner warn">저장소 응답이 늦어요. 보이는 데이터가 최신이 아닐 수 있어요.</div>`;
    return `<div class="banner warn">데이터베이스 오류: ${esc(state.dbError || '')} — 새로 고침하거나 관리자에게 알려 주세요.</div>`;
  }

  function topbar(r) {
    const tabs = [['customers', '고객 카드'], ['consult', '새 상담'], ['tracking', '가입 트래킹'], ['dashboard', '실적 대시보드']];
    if (state.me.role === 'manager') tabs.push(['admin', '규칙·상품']);
    return `<header class="topbar">
      <a class="brand" href="#customers">${logo()}<span class="divider" aria-hidden="true"></span><b class="svc">소상공인 보험 헤아림</b></a>
      <nav class="tabs" aria-label="메뉴">${tabs.map(([k, l]) => `<a href="#${k}" class="tab ${r === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <div class="who"><span>${esc(state.me.name)} <small>${esc(state.me.branch)}</small></span><button class="btn ghost sm" id="logout">로그아웃</button></div>
    </header>`;
  }

  /* ---------- 로그인 ---------- */
  function setupView() {
    return `<div class="login-wrap"><div class="login card"><div class="login-brand">${logo('lg')}<h1>소상공인 보험 헤아림</h1><p>설정이 필요해요</p></div>
      <p><code>config.js</code>에 Supabase Project URL과 anon key를 입력한 뒤 다시 배포하세요. README의 2단계를 참고하세요.</p></div></div>`;
  }
  function loginView() {
    return `<div class="login-wrap"><form class="login card" id="loginForm">
      <div class="login-brand">${logo('lg')}<h1>소상공인 보험 헤아림</h1><p>소상공인 의무보험 보장분석 · 상담사 콘솔</p></div>
      <label for="email">이메일</label>
      <input id="email" type="email" autocomplete="username" placeholder="name@example.com">
      <label for="pw">비밀번호</label>
      <input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호">
      <p class="err" id="loginErr" role="alert">${esc(state.loginError || '')}</p>
      <button class="btn primary block" type="submit" id="loginBtn">로그인</button>
      <p class="hint">계정은 관리자가 등록해요. 비밀번호를 잊으면 관리자에게 재설정을 요청하세요.</p>
    </form></div>`;
  }
  function bindLogin() {
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = '로그인 중…'; state.loginError = '';
      const { error } = await state.sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#pw').value });
      if (error) { btn.disabled = false; btn.textContent = '로그인'; $('#loginErr').textContent = '이메일 또는 비밀번호가 맞지 않아요.'; return; }
      if (!location.hash) location.hash = '#customers';
    });
  }
  function bindCommon() {
    $('#logout').addEventListener('click', async () => { await state.sb.auth.signOut(); });
  }

  /* ---------- 새 상담 ---------- */
  const FACILITY_OPTS = ['일반음식점(1층, 100㎡ 이상)', '물류창고', '직영 판매장'];
  function newDraft() {
    return {
      customer: { label: '' },
      biz: { bizName: '', industry: '', sportsType: '', ksic: '', employees: null, smeType: '',
        floorType: '', bizArea: null, capacity: null,
        isBuildingOwner: null, buildingArea: null, buildingFloors: null,
        hasElevator: false, elevatorCount: null, elevatorManager: null,
        lpg: false, lpgKg: null, cityGas: false, cityGasSpecific: false, hpGasStorage: false, spHpGasUse: false,
        hazardousChem: false, emissionFacility: false, kidsPlay: false, droneCommercial: false, mechParking: false, evCharger: false, dangerousDog: false, medDevice: false, lightAircraft: false, distEnergy: false, records: null, vehicles: 0, otherFacilities: [],
        bizNo: '', corpType: '개인', sido: '', sigungu: '', addressDetail: '', address: '', mainProducts: '', industrialComplex: false, exports: false },
      answers: {}, memo: ''
    };
  }
  function consultView() {
    if (!state.draft) state.draft = newDraft();
    const s = state.step;
    const steps = [[2, '사업장 정보'], [3, '보장분석·보험설계']];
    return `<div class="page-head"><h1>새 상담</h1><p>기준일 ${E.BASIS_DATE} · 사회보험(국민연금·건강·고용·산재)은 분석에서 제외</p></div>
      <ol class="stepper">${steps.map(([n, t], i) => `<li class="${n === s ? 'on' : n < s ? 'done' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>
      ${s === 3 ? step3() : step2()}`;
  }
  const v = x => x === null || x === undefined ? '' : x;
  const fid = path => 'f_' + path.replace(/\./g, '_');
  function inp(path, label, type = 'text', attrs = '', cls = '') {
    const val = getPath(state.draft, path);
    return `<div class="field${cls}"><label for="${fid(path)}">${label}</label><input id="${fid(path)}" data-path="${path}" type="${type}" value="${esc(v(val))}" ${attrs}></div>`;
  }
  function chk(path, label) {
    return `<label class="check" for="${fid(path)}"><input id="${fid(path)}" type="checkbox" data-path="${path}" ${getPath(state.draft, path) ? 'checked' : ''}> ${label}</label>`;
  }
  function tri(path, label, yes = '예', no = '아니오', cls = '') {
    const val = getPath(state.draft, path);
    return `<div class="field${cls}"><label for="${fid(path)}">${label}</label><select id="${fid(path)}" data-path="${path}" data-type="tri">
      <option value="" ${val === null ? 'selected' : ''}>선택</option><option value="1" ${val === true ? 'selected' : ''}>${yes}</option><option value="0" ${val === false ? 'selected' : ''}>${no}</option></select></div>`;
  }
  function indSel(cls = '') {
    const val = state.draft.biz.industry; const groups = [...new Set(E.INDUSTRIES.map(i => i.group))];
    return `<div class="field${cls}"><label for="f_biz_industry">업종${REQ}</label><select id="f_biz_industry" data-path="biz.industry"><option value="">선택</option>${groups.map(g => `<optgroup label="${esc(g)}">${E.INDUSTRIES.filter(i => i.group === g).map(i => `<option value="${i.code}" ${val === i.code ? 'selected' : ''}>${esc(i.name + (i.hint ? ` (${i.hint})` : ''))}</option>`).join('')}</optgroup>`).join('')}</select></div>`;
  }
  function sel(path, label, opts, cls = '', placeholder = '선택') {
    const val = getPath(state.draft, path);
    return `<div class="field${cls}"><label for="${fid(path)}">${label}</label><select id="${fid(path)}" data-path="${path}"><option value="">${placeholder}</option>${opts.map(([k, t]) => `<option value="${esc(k)}" ${val === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  }
  const toUnit = m2 => m2 === null || m2 === undefined || m2 === '' ? '' : state.areaUnit === 'py' ? Math.round(m2 / E.PYEONG * 10) / 10 : m2;
  const areaHint = m2 => m2 === null || m2 === undefined || m2 === '' ? '' : state.areaUnit === 'py' ? `= ${E.fmtNum(m2)}㎡` : `= 약 ${E.fmtNum(Math.round(m2 / E.PYEONG * 10) / 10)}평`;
  function areaInp(path, label, cls = '') {
    const m2 = getPath(state.draft, path);
    const u = state.areaUnit === 'py' ? '평' : '㎡';
    const lab = label.includes('<b class="req"') ? label.replace(' <b class="req"', ` (${u}) <b class="req"`) : `${label} (${u})`;
    return `<div class="field${cls}"><label for="${fid(path)}">${lab}</label>
      <div class="area-in"><input id="${fid(path)}" data-area="${path}" type="number" min="0" step="any" value="${esc(toUnit(m2))}"><span class="area-hint" id="${fid(path)}_hint">${esc(areaHint(m2))}</span></div></div>`;
  }
  const unitToggle = () => `<span class="unit-toggle" role="group" aria-label="면적 단위">${[['m2', '㎡'], ['py', '평']].map(([k, t]) => `<button type="button" class="seg sm ${state.areaUnit === k ? 'on' : ''}" data-unit="${k}">${t}</button>`).join('')}</span>`;
  function getPath(o, p) { return p.split('.').reduce((a, k) => a == null ? a : a[k], o); }
  function setPath(o, p, val) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = val; }

  const REQ = ' <b class="req" aria-label="필수">*</b>';
  const USE = t => `<span class="use">판정: ${t}</span>`;
  const needsFloor = b => ['FOOD', 'CAFE'].includes(b.industry);
  const needsCapacity = b => ['ACADEMY', 'BATH'].includes(b.industry);
  function missingRequired(b) {
    const miss = [];
    const empty = p => { const x = getPath(state.draft, p); return x === null || x === undefined || x === ''; };
    [['biz.bizName', '상호'], ['biz.industry', '업종']].forEach(f => empty(f[0]) && miss.push(f));
    if (b.smeType !== '소상공인' && empty('biz.employees')) miss.push(['biz.employees', '상시근로자 수']);
    if (b.industry === 'SPORTS' && empty('biz.sportsType')) miss.push(['biz.sportsType', '체육시설 종류']);
    if (needsFloor(b)) { if (empty('biz.floorType')) miss.push(['biz.floorType', '영업장 층']); if (empty('biz.bizArea')) miss.push(['biz.bizArea', '영업장 면적']); }
    if (empty('biz.isBuildingOwner')) miss.push(['biz.isBuildingOwner', '건물 소유']);
    if (b.isBuildingOwner === true && empty('biz.buildingArea')) miss.push(['biz.buildingArea', '건물 연면적']);
    if (b.industry === 'WAREHOUSE' && empty('biz.buildingArea')) miss.push(['biz.buildingArea', '건물 연면적']);
    if (b.hasElevator && (b.elevatorManager === null || b.elevatorManager === undefined)) miss.push(['biz.elevatorManager', '승강기 관리주체 여부']);
    return miss;
  }
  function step2() {
    const b = state.draft.biz;
    const miss = new Set((state.showMissing ? missingRequired(b) : []).map(([p]) => p));
    const bad = p => miss.has(p) ? ' invalid' : '';
    return `<div class="split">
      <section class="card form">
        <div class="form-intro"><h2 class="first">보장분석에 필요한 정보</h2><p class="muted"><b class="req">*</b> 표시는 필수예요. 체크 항목은 해당할 때만 체크하세요.</p></div>

        <h3 class="grp">업체·업종 ${USE('소상공인 여부, 업종별 의무보험')}</h3>
        <div class="grid2">${inp('biz.bizName', '상호' + REQ, 'text', 'placeholder="가입 트래킹·고객 카드에 표시돼요"', bad('biz.bizName'))}${indSel(bad('biz.industry'))}</div>
        <div class="grid2">${inp('customer.label', '구분용 메모 <span class="opt">(선택 · 같은 상호가 여럿일 때)</span>', 'text', 'placeholder="예: 망원시장 입구 2호점 — 실명·연락처는 적지 마세요" maxlength="40" autocomplete="off"')}</div>
        ${b.industry === 'SPORTS' ? `<div class="grid2">${sel('biz.sportsType', '체육시설 종류' + REQ, E.SPORTS_TYPES.map(([c, n]) => [c, n]), bad('biz.sportsType'))}</div>` : ''}
        ${b.industry === 'MFG' ? `<div class="grid2">${sel('biz.ksic', '제조 품목 <span class="opt">(선택 · 특약 추천에 사용)</span>', E.KSIC.map(([c, n]) => [c, `${n} (${c})`]))}</div>` : ''}
        <div class="grid2">${inp('biz.employees', '상시근로자 수 (대표 제외)' + (b.smeType === '소상공인' ? '' : REQ), 'number', 'min="0" placeholder="0"', bad('biz.employees'))}${sel('biz.smeType', '소상공인 확인서 <span class="opt">(선택)</span>', [['소상공인', '소상공인 확인서 있음'], ['없음/모름', '없음/모름'], ['중기업 이상', '중기업 이상']])}</div>

        <h3 class="grp">영업장 ${USE('다중이용업소 화재배상·재난배상')} ${unitToggle()}</h3>
        <div class="grid3">${sel('biz.floorType', '영업장 층' + (needsFloor(b) ? REQ : ''), E.FLOOR_OPTS, bad('biz.floorType'))}${areaInp('biz.bizArea', '영업장 면적' + (needsFloor(b) ? REQ : ''), bad('biz.bizArea'))}${needsCapacity(b) ? inp('biz.capacity', '수용인원 (명)', 'number', 'min="0"') : ''}</div>

        <h3 class="grp">건물 <i class="tip" data-tip="건축물대장에서 소유자·연면적·층수를 확인할 수 있어요.">?</i> ${USE('특수건물 화재보험')}</h3>
        <div class="grid3">${tri('biz.isBuildingOwner', '건물 소유' + REQ, '자가 소유', '임차', bad('biz.isBuildingOwner'))}${b.isBuildingOwner === true || b.industry === 'WAREHOUSE' ? areaInp('biz.buildingArea', '건물 연면적' + REQ, bad('biz.buildingArea')) + inp('biz.buildingFloors', '건물 층수', 'number', 'min="1"') : ''}</div>

        <h3 class="grp">승강기 <i class="tip" data-tip="승강기 안전인증·정기검사 필증에서 관리주체를 확인하세요.">?</i> ${USE('승강기사고배상책임')}</h3>
        <div class="row-checks">${chk('biz.hasElevator', '승강기 있음 (화물용·에스컬레이터 포함)')}</div>
        ${b.hasElevator ? `<div class="grid2">${tri('biz.elevatorManager', '고객이 관리주체인가요?' + REQ, '예', '아니오', bad('biz.elevatorManager'))}${inp('biz.elevatorCount', '대수', 'number', 'min="1"')}</div>` : ''}

        <h3 class="grp">가스 <i class="tip" data-tip="가스 사용시설 완성검사증명서·사용신고서로 확인하세요.">?</i> ${USE('가스사고배상책임')}</h3>
        <div class="row-checks">${chk('biz.lpg', 'LPG 사용')}${chk('biz.cityGas', '도시가스 사용')}${chk('biz.hpGasStorage', '고압가스 저장 허가')}${chk('biz.spHpGasUse', '특정고압가스 사용신고')}</div>
        ${b.lpg || b.cityGas ? `<div class="grid2">${b.lpg ? inp('biz.lpgKg', 'LPG 저장능력 (kg)', 'number', 'min="0"') : ''}${b.cityGas ? `<div class="field"><span class="lbl">도시가스</span>${chk('biz.cityGasSpecific', '특정가스사용시설 해당')}</div>` : ''}</div>` : ''}

        <h3 class="grp">기타 시설·자산 ${USE('놀이시설·주차장·충전시설·드론·맹견·환경 등')}</h3>
        <div class="row-checks">${b.industry !== 'KIDS' ? chk('biz.kidsPlay', '어린이 놀이공간·놀이기구 운영') : ''}${chk('biz.mechParking', '기계식주차장 관리 (20대 이상)')}${chk('biz.evCharger', '전기차 충전시설 관리')}${b.industry !== 'DRONE' ? chk('biz.droneCommercial', '영리 목적 드론 운용') : ''}${chk('biz.dangerousDog', '맹견 사육 (도사견·핏불 등 5종)')}${chk('biz.hazardousChem', '유해화학물질 취급')}${chk('biz.emissionFacility', '대기·수질 배출시설')}</div>
        <details class="optional rare" ${b.medDevice || b.lightAircraft || b.distEnergy ? 'open' : ''}><summary>드물게 해당 <span class="opt">(의료기기·경량항공기·분산에너지)</span></summary><div class="row-checks">${chk('biz.medDevice', '인체이식형 의료기기 제조·수입·취급')}${chk('biz.lightAircraft', '경량항공기 소유·사용')}${chk('biz.distEnergy', '분산에너지사업자 (특화지역)')}</div></details>
        ${b.industry === 'MFG' ? `<fieldset class="field"><legend>사업장 내 별도 시설</legend><div class="row-checks">${FACILITY_OPTS.map((o, i) => `<label class="check" for="fac${i}"><input id="fac${i}" type="checkbox" data-fac="${esc(o)}" ${b.otherFacilities.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></fieldset>` : ''}
        <div class="grid2">${inp('biz.records', '보유 고객 개인정보 (건)', 'number', 'min="0" placeholder="모르면 비워 두세요"')}${inp('biz.vehicles', '업무용 차량·오토바이 (대)', 'number', 'min="0"')}</div>

        <details class="optional" ${state.optOpen ? 'open' : ''} id="optDetails">
          <summary>추가 정보 <span class="opt">(선택 · 보장분석 결과에는 영향 없음)</span></summary>
          <div class="opt-body">
            <div class="grid2">${inp('biz.bizNo', '사업자등록번호', 'text', 'placeholder="000-00-00000"')}${sel('biz.corpType', '사업자 구분', [['개인', '개인'], ['법인', '법인']])}</div>
            <div class="grid3">
              <div class="field"><label for="f_biz_sido">사업장 시·도</label><select id="f_biz_sido" data-path="biz.sido"><option value="">선택</option>${Object.keys(window.REGIONS).map(s => `<option ${b.sido === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
              <div class="field"><label for="f_biz_sigungu">시·군·구</label><select id="f_biz_sigungu" data-path="biz.sigungu" ${b.sido ? '' : 'disabled'}><option value="">${b.sido ? '선택' : '시·도를 먼저 선택'}</option>${(window.REGIONS[b.sido] || []).map(g => `<option ${b.sigungu === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
              ${inp('biz.addressDetail', '상세 주소', 'text', 'placeholder="읍·면·동, 도로명, 번지"')}
            </div>
            <div class="grid2">${inp('biz.mainProducts', '주요 품목·메뉴', 'text', 'placeholder="예: 국밥, 수제 쿠키, 금속 브래킷"')}</div>
            <div class="row-checks">${chk('biz.industrialComplex', '산업단지 입주')}${chk('biz.exports', '수출')}</div>
          </div>
        </details>
        <p class="err" id="stepErr" role="alert">${state.showMissing && miss.size ? '필수 항목을 입력하세요: ' + missingRequired(b).map(([, n]) => n).join(', ') : ''}</p>
        <div class="actions"><span></span><button class="btn primary" id="next2">보장분석 실행</button></div>
      </section>
      <aside class="card preview" id="preview">${previewPanel()}</aside>
    </div>`;
  }
  function previewPanel() {
    const b = state.draft.biz; const el = E.eligibility(b); const rs = E.analyze(b);
    const req = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상');
    return `<h3>실시간 미리보기</h3>
      <div class="elig">소상공인 ${badge(el.status)}<ul>${el.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
      <h4>의무보험 해당 ${req.length}건</h4>
      ${req.length ? `<ul class="mini">${req.map(r => `<li>${badge(r.result)} ${esc(r.name)}</li>`).join('')}</ul>` : '<p class="muted">아직 해당하는 의무보험이 없어요. 업종과 시설 정보를 입력해 보세요.</p>'}`;
  }

  function step3() {
    const d = state.draft; const b = d.biz; const el = E.eligibility(b); const rs = E.analyze(b);
    const mand = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상');
    const none = rs.filter(r => r.kind === 'mandatory' && r.result === '비대상');
    const rec = rs.filter(r => r.kind === 'recommended' && r.result === '권장');
    return `<section class="card summary-line">
        <div><b>${esc(b.bizName || '(상호 미입력)')}</b> · ${esc(E.IND[b.industry]?.name || '업종 미선택')}${d.customer.label ? ' · ' + esc(d.customer.label) : ''}</div>
        <div>소상공인 ${badge(el.status)} <span class="muted">${esc(el.reasons.join(' · '))}</span></div>
      </section>
      <h2 class="sec">① 법정 의무보험 <span class="count">${mand.length}</span></h2>
      ${mand.length ? mand.map(mandCard).join('') : '<div class="card empty">해당하는 의무보험이 없어요.</div>'}
      ${none.length ? `<details class="card none"><summary>비대상 ${none.length}건 보기</summary><ul>${none.map(r => `<li><b>${esc(r.name)}</b> — ${esc(r.reason)}</li>`).join('')}</ul></details>` : ''}
      <h2 class="sec">② 권장 보험 <span class="sub">의무 아님</span></h2>
      ${rec.length ? rec.map(recCard).join('') : '<div class="card muted">추가로 권장할 보험이 없어요.</div>'}
      <h2 class="sec">③ 분석 제외</h2>
      <div class="card muted">사회보험(국민연금·건강보험·고용보험·산재보험)은 이 분석에서 제외됩니다.</div>
      <div class="field memo"><label for="memo">상담 메모</label><textarea id="memo" rows="3">${esc(d.memo)}</textarea></div>
      <p class="disclaimer">이 결과는 ${E.BASIS_DATE} 법령 기준 초안(미검증 규칙 포함)이며, 최종 가입 의무 여부는 관할 기관 확인이 필요합니다. 보험료는 영업요율서 기준으로 별도 산출하세요.</p>
      <p class="err" id="stepErr" role="alert"></p>
      <div class="actions"><button class="btn ghost" id="prev3">이전</button><button class="btn primary" id="saveConsult" ${state.canWrite ? '' : 'disabled'}>상담 저장</button></div>`;
  }
  function getDesign(code, productId) {
    const a = state.draft.answers[code] || (state.draft.answers[code] = {});
    if (!a.design || a.design.productId !== productId) a.design = E.design(productId, state.draft.biz);
    return a.design;
  }
  function mandCard(r) {
    const rule = E.RULE[r.code]; const a = state.draft.answers[r.code] || {};
    const prod = r.products.map(id => E.PRODUCT[id]).filter(p => p && p.active);
    return `<article class="card ins ${r.result === '의무대상' ? 'stripe-crit' : 'stripe-warn'}">
      <header><div><h3>${esc(r.name)}</h3><p class="law">${esc(rule.law)}</p></div><div class="tags">${badge(r.result)}${rule.verified ? '' : '<span class="pill outline" title="법령 원문 확인 전 초안">미검증</span>'}</div></header>
      <p class="reason">${esc(r.reason)}</p>
      <dl class="facts"><div><dt>미가입 시</dt><dd>${esc(rule.penalty)}</dd></div><div><dt>법정 보상한도</dt><dd>${esc(rule.coverage)}</dd></div></dl>
      <div class="status-row" role="radiogroup" aria-label="${esc(r.name)} 가입 여부">
        <span class="lbl">가입 여부</span>
        ${['가입', '미가입', '확인불가'].map(s => `<label class="seg ${a.status === s ? 'on' : ''}"><input type="radio" name="st_${r.code}" value="${s}" data-ans="${r.code}" ${a.status === s ? 'checked' : ''}>${s}</label>`).join('')}
      </div>
      ${a.status === '가입' ? `<div class="grid2">
        <div class="field"><label for="ins_${r.code}">보험사</label><input id="ins_${r.code}" data-ansf="${r.code}.insurer" value="${esc(a.insurer || '')}" placeholder="예: NH농협손해보험"></div>
        <div class="field"><label for="exp_${r.code}">만기일 <span class="opt">(고객 카드 D-day에 사용)</span></label><input id="exp_${r.code}" type="date" data-ansf="${r.code}.expiry" value="${esc(a.expiry || '')}"></div></div>` : ''}
      ${a.status === '미가입' ? (prod.length ? prod.map(p => designBox(r.code, p)).join('') : `<div class="noprod"><span class="pill outline">당사 미취급</span> 관련 기관·타 채널을 안내해 주세요. 트래킹 대상에서 제외됩니다.</div>`) : ''}
    </article>`;
  }
  function designBox(code, p) {
    const d = getDesign(code, p.id);
    return `<div class="prod">
      <div class="prod-head"><span class="pill accent">당사 추천 설계</span><b>${esc(p.name)}</b><small>${esc(p.line)}</small></div>
      <div class="design">
        <div class="d-main"><span class="d-lbl">메인 보장</span><p>${esc(d.main)}</p>${d.limits.length ? `<ul class="limits">${d.limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>
        ${d.riders.length ? `<div class="d-riders"><span class="d-lbl">특약 구성 <span class="opt">(체크한 특약이 설계에 포함돼요)</span></span>
          ${d.riders.map((rd, i) => `<label class="rider ${rd.kind}" for="rd_${code}_${i}"><input id="rd_${code}_${i}" type="checkbox" data-rider="${code}|${i}" ${rd.selected ? 'checked' : ''} ${rd.kind === 'required' ? 'disabled' : ''}>
            <span class="rk">${E.RIDER_KIND[rd.kind]}</span><span class="rn">${esc(rd.name)}</span><span class="rw">${esc(rd.why)}</span></label>`).join('')}</div>` : ''}
      </div>
      <p class="muted small"><b>설명 의무</b> ${p.checklist.map(esc).join(' / ')}</p>
      <p class="auto">저장하면 이 설계가 가입 트래킹에 '추천' 단계로 등록돼요.</p></div>`;
  }
  function recCard(r) {
    const a = state.draft.answers[r.code] || {};
    const prods = r.products.map(id => E.PRODUCT[id]);
    return `<article class="card ins stripe-info">
      <header><div><h3>${esc(r.name)}</h3><p class="law">${esc(r.reason)}</p></div>${badge('권장')}</header>
      ${prods.length > 1 ? `<p class="muted">Ⅰ은 보험기간 중 <b>사고 발생</b> 기준, Ⅱ는 보험기간 중 <b>최초 손해배상청구</b> 기준(소급보상일자 적용)이에요. 음식점·카페는 보통 Ⅰ을 권해요.</p>` : ''}
      <div class="status-row"><span class="lbl">제안 상품</span>
        <label class="seg ${!a.productId ? 'on' : ''}"><input type="radio" name="rec_${r.code}" value="" data-rec="${r.code}" ${!a.productId ? 'checked' : ''}>제안 안 함</label>
        ${prods.map(p => `<label class="seg ${a.productId === p.id ? 'on' : ''}"><input type="radio" name="rec_${r.code}" value="${p.id}" data-rec="${r.code}" ${a.productId === p.id ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}
      </div>
      ${a.productId ? designBox(r.code, E.PRODUCT[a.productId]) : ''}
    </article>`;
  }

  function bindConsult() {
    const d = state.draft;
    document.querySelectorAll('[data-path]').forEach(el => {
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.dataset.type === 'tri') val = el.value === '' ? null : el.value === '1';
        else if (el.type === 'number') val = el.value === '' ? null : Number(el.value);
        else if (el.dataset.path === 'customer.phone') { val = formatPhone(el.value); el.value = val; }
        else val = el.value;
        setPath(d, el.dataset.path, val);
        if (el.dataset.path === 'biz.sido') d.biz.sigungu = '';
        if (['biz.sido', 'biz.sigungu', 'biz.addressDetail'].includes(el.dataset.path)) d.biz.address = [d.biz.sido, d.biz.sigungu === d.biz.sido ? '' : d.biz.sigungu, d.biz.addressDetail].filter(Boolean).join(' ');
        if (el.dataset.path.startsWith('biz.')) Object.values(d.answers).forEach(a => { delete a.design; });
        const structural = ['biz.hasElevator', 'biz.lpg', 'biz.cityGas', 'biz.sido', 'biz.industry', 'biz.isBuildingOwner', 'biz.smeType'].includes(el.dataset.path) || (state.showMissing && el.tagName === 'SELECT');
        if (structural) render(); else if ($('#preview')) $('#preview').innerHTML = previewPanel();
      });
    });
    document.querySelectorAll('[data-area]').forEach(el => el.addEventListener('input', () => {
      const n = el.value === '' ? null : Number(el.value);
      const m2 = n === null || isNaN(n) ? null : state.areaUnit === 'py' ? Math.round(n * E.PYEONG * 100) / 100 : n;
      setPath(d, el.dataset.area, m2);
      Object.values(d.answers).forEach(x => { delete x.design; });
      const h = document.getElementById(el.id + '_hint'); if (h) h.textContent = areaHint(m2);
      if ($('#preview')) $('#preview').innerHTML = previewPanel();
    }));
    document.querySelectorAll('[data-unit]').forEach(btn => btn.addEventListener('click', () => { state.areaUnit = btn.dataset.unit; try { localStorage.setItem('hearim_area_unit', state.areaUnit); } catch (e) { } render(); }));
    document.querySelectorAll('[data-fac]').forEach(el => el.addEventListener('change', () => {
      const f = d.biz.otherFacilities; const o = el.dataset.fac;
      d.biz.otherFacilities = el.checked ? [...new Set([...f, o])] : f.filter(x => x !== o);
      if ($('#preview')) $('#preview').innerHTML = previewPanel();
    }));
    document.querySelectorAll('[data-ans]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.ans; d.answers[k] = { ...(d.answers[k] || {}), status: el.value }; render();
    }));
    document.querySelectorAll('[data-ansf]').forEach(el => el.addEventListener('input', () => {
      const [k, f] = el.dataset.ansf.split('.'); d.answers[k] = { ...(d.answers[k] || {}), [f]: el.value };
    }));
    document.querySelectorAll('[data-rec]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.rec; d.answers[k] = { ...(d.answers[k] || {}), productId: el.value || null }; render();
    }));
    document.querySelectorAll('[data-rider]').forEach(el => el.addEventListener('change', () => {
      const [k, i] = el.dataset.rider.split('|'); const dz = d.answers[k] && d.answers[k].design;
      if (dz && dz.riders[i]) dz.riders[i].selected = el.checked;
    }));
    const od = $('#optDetails'); if (od) od.addEventListener('toggle', () => { state.optOpen = od.open; });
    const memo = $('#memo'); if (memo) memo.addEventListener('input', () => { d.memo = memo.value; });
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    on('next2', () => {
      if (missingRequired(d.biz).length) { state.showMissing = true; render(); const f = document.querySelector('.field.invalid'); if (f) f.scrollIntoView({ block: 'center' }); return; }
      state.showMissing = false; state.step = 3; render(); window.scrollTo(0, 0);
    });
    on('prev3', () => { state.step = 2; render(); });
    on('saveConsult', async () => {
      const rs = E.analyze(d.biz);
      const pending = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상' && !(d.answers[r.code] || {}).status);
      if (pending.length) { $('#stepErr').textContent = `가입 여부를 선택하지 않은 의무보험이 ${pending.length}건 있어요: ${pending.map(p => p.name).join(', ')}`; return; }
      const now = new Date().toISOString();
      const results = rs.map(r => {
        const a = d.answers[r.code] || {};
        const productId = r.kind === 'recommended' ? (r.result === '권장' ? a.productId || null : null)
          : (a.status === '미가입' ? (r.products.find(id => E.PRODUCT[id] && E.PRODUCT[id].active) || null) : null);
        return { code: r.code, kind: r.kind, name: r.name, result: r.result, reason: r.reason, status: r.kind === 'mandatory' && r.result !== '비대상' ? a.status : null, insurer: a.insurer || '', expiry: a.expiry || '', productId };
      });
      const enrollments = results.filter(r => r.productId).map(r => {
        const dz = (d.answers[r.code] && d.answers[r.code].design && d.answers[r.code].design.productId === r.productId) ? d.answers[r.code].design : E.design(r.productId, d.biz);
        return {
          id: uid(), code: r.code, productId: r.productId, kind: r.kind, stage: '추천', stageAt: now, checklistDone: false, policyNo: '', premium: null, note: '',
          design: { main: dz.main, limits: dz.limits, riders: dz.riders.filter(x => x.selected).map(x => ({ name: x.name, kind: x.kind })) },
          history: [{ from: null, to: '추천', at: now, by: state.me.id }]
        };
      });
      const c = { id: uid(), counselorId: state.me.id, consultedAt: now, customer: d.customer, biz: d.biz, eligibility: E.eligibility(d.biz), results, enrollments, memo: d.memo };
      const btn = $('#saveConsult'); btn.disabled = true; btn.textContent = '저장 중…';
      const ok = await saveConsult(c);
      if (ok) { toast(`저장했어요. 당사 상품 설계 ${enrollments.length}건이 가입 트래킹에 등록됐어요.`); state.draft = null; state.step = 2; location.hash = '#customers'; render(); }
      else { btn.disabled = false; btn.textContent = '상담 저장'; }
    });
  }

  /* ---------- 만기·고객 카드 공통 ---------- */
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addYear = s => { const d = new Date(s + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dday = s => Math.round((new Date(s + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  const ddayTxt = n => n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `만기 D+${-n}`;
  const ddayCls = n => n < 0 ? 'crit' : n <= 30 ? 'crit' : n <= 60 ? 'warn' : 'mute';
  const activeConsults = () => visibleConsults().filter(c => !c.archived);
  function expiriesOf(c) {
    const list = [];
    (c.results || []).forEach(r => {
      if (r.status === '가입' && r.expiry) list.push({ name: E.RULE[r.code]?.name || r.name || r.code, insurer: r.insurer || '타사', date: r.expiry, ours: /농협/.test(r.insurer || '') });
    });
    (c.enrollments || []).forEach(e => {
      if (e.stage === '계약성립' && e.expiry) list.push({ name: E.PRODUCT[e.productId]?.name || e.productId, insurer: 'NH농협손해보험', date: e.expiry, ours: true, policyNo: e.policyNo });
    });
    return list.map(x => ({ ...x, d: dday(x.date) })).sort((a, b) => a.d - b.d);
  }
  const nextExpiry = c => { const l = expiriesOf(c); return l.length ? l[0] : null; };
  async function setArchived(id, archived) {
    const c = structuredClone(state.consults.find(x => x.id === id)); if (!c) return;
    if (archived) { c.archived = true; c.archivedAt = new Date().toISOString(); c.archivedBy = state.me.id; }
    else { delete c.archived; delete c.archivedAt; delete c.archivedBy; }
    const ok = await saveConsult(c);
    if (ok) toast(archived ? `${c.biz.bizName} 고객을 관리 목록에서 삭제했어요. 가입 트래킹 하단에서 복원할 수 있어요.` : `${c.biz.bizName} 고객을 복원했어요.`);
    state.confirmArchive = null; state.drawer = null; render();
  }

  /* ---------- 고객 카드 ---------- */
  function customersView() {
    const f = state.cardFilter;
    let cs = activeConsults().map(c => ({ c, nx: nextExpiry(c), gaps: (c.results || []).filter(r => r.kind === 'mandatory' && r.status === '미가입').length }));
    const all = cs.length;
    const soon = cs.filter(x => x.nx && x.nx.d <= 60).length;
    if (f.q) { const q = f.q.toLowerCase(); cs = cs.filter(({ c }) => [c.customer.label, c.biz.bizName, c.biz.bizNo].some(t => (t || '').toLowerCase().includes(q))); }
    if (f.mode === 'soon') cs = cs.filter(x => x.nx && x.nx.d <= 60);
    if (f.mode === 'gap') cs = cs.filter(x => x.gaps > 0);
    cs.sort((a, b) => (a.nx ? a.nx.d : 1e9) - (b.nx ? b.nx.d : 1e9) || new Date(b.c.consultedAt) - new Date(a.c.consultedAt));
    return `<div class="page-head"><h1>고객 카드</h1><p>${state.me.role === 'manager' ? '전체' : '내'} 고객 ${all}명 · 만기 60일 이내 <b class="crit-t">${soon}명</b> · 만기가 가까운 고객이 위에 표시돼요</p></div>
      <div class="filters card">
        <div class="field"><label for="cq">검색</label><input id="cq" value="${esc(f.q)}" placeholder="상호·메모·사업자번호"></div>
        <div class="seg-group" role="group" aria-label="보기">${[['all', '전체'], ['soon', '만기 60일 이내'], ['gap', '미가입 의무보험 있음']].map(([k, t]) => `<button class="seg ${f.mode === k ? 'on' : ''}" data-cmode="${k}">${t}</button>`).join('')}</div>
      </div>
      ${cs.length ? `<div class="cards">${cs.map(customerCard).join('')}</div>` : `<div class="card empty">${all ? '조건에 맞는 고객이 없어요.' : '아직 등록된 고객이 없어요. 새 상담을 저장하면 여기에 카드로 모여요.'}</div>`}`;
  }
  function customerCard({ c, nx, gaps }) {
    const ex = expiriesOf(c);
    const open = (c.enrollments || []).filter(e => E.OPEN_STAGES.includes(e.stage)).length;
    const conf = state.confirmArchive === c.id;
    return `<article class="ccard ${nx ? 'b-' + ddayCls(nx.d) : ''}">
      <header>
        <div><h3>${esc(c.biz.bizName)}</h3>${c.customer.label ? `<p>${esc(c.customer.label)}</p>` : ''}</div>
        ${nx ? `<span class="dday ${ddayCls(nx.d)}">${ddayTxt(nx.d)}</span>` : '<span class="dday none">만기 정보 없음</span>'}
      </header>
      <div class="cmeta"><span class="pill mute">${esc(E.IND[c.biz.industry]?.name || c.biz.industry || '-')}</span>${gaps ? `<span class="pill crit">미가입 의무보험 ${gaps}</span>` : ''}${open ? `<span class="pill info">진행 중 추천 ${open}</span>` : ''}${state.me.role === 'manager' ? `<span class="pill outline">${esc(ACC[c.counselorId]?.name || '')}</span>` : ''}</div>
      ${ex.length ? `<ul class="exp">${ex.map(x => `<li><span class="en">${esc(x.name)}</span><span class="ei">${x.ours ? '<b class="ours">당사</b>' : esc(x.insurer)}</span><span class="ed num">${x.date.replace(/-/g, '.')}</span><span class="dday sm ${ddayCls(x.d)}">${ddayTxt(x.d)}</span></li>`).join('')}</ul>` : '<p class="muted small">가입 보험의 만기일이 입력되지 않았어요.</p>'}
      <footer>
        <small>상담 ${fmtDate(c.consultedAt)}</small>
        ${conf ? `<span class="confirm">관리 목록에서 삭제할까요? <button class="btn danger sm" data-arch="${c.id}">삭제</button><button class="btn ghost sm" data-arch-cancel>취소</button></span>`
          : `<span><button class="btn ghost sm" data-ctrack="${esc(c.biz.bizName)}">추천 건 보기</button><button class="btn ghost sm" data-arch-ask="${c.id}">관리 종료</button></span>`}
      </footer>
    </article>`;
  }
  function bindCustomers() {
    const f = state.cardFilter;
    const q = $('#cq'); q.addEventListener('input', () => { f.q = q.value; clearTimeout(bindCustomers._t); bindCustomers._t = setTimeout(() => { render(); const n = $('#cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    document.querySelectorAll('[data-cmode]').forEach(b => b.addEventListener('click', () => { f.mode = b.dataset.cmode; render(); }));
    document.querySelectorAll('[data-ctrack]').forEach(b => b.addEventListener('click', () => { state.trackFilter = { q: b.dataset.ctrack, stage: '', ind: '', product: '' }; location.hash = '#tracking'; }));
    document.querySelectorAll('[data-arch-ask]').forEach(b => b.addEventListener('click', () => { state.confirmArchive = b.dataset.archAsk; render(); }));
    document.querySelectorAll('[data-arch-cancel]').forEach(b => b.addEventListener('click', () => { state.confirmArchive = null; render(); }));
    document.querySelectorAll('[data-arch]').forEach(b => b.addEventListener('click', () => setArchived(b.dataset.arch, true)));
  }

  /* ---------- 가입 트래킹 ---------- */
  function enrollmentRows() {
    const rows = [];
    activeConsults().forEach(c => (c.enrollments || []).forEach(e => rows.push({ c, e })));
    return rows.sort((a, b) => new Date(b.c.consultedAt) - new Date(a.c.consultedAt));
  }
  function nextAction(e, c) {
    const age = daysBetween(e.stageAt || c.consultedAt, new Date());
    if (e.stage === '계약성립') return e.expiry ? `만기 ${ddayTxt(dday(e.expiry))}` : '완료';
    if (['거절', '철회'].includes(e.stage)) return '종료';
    if (e.kind === 'mandatory' && E.OPEN_STAGES.includes(e.stage) && daysBetween(c.consultedAt, new Date()) > 14) return 'FOLLOW';
    return { '추천': '상품 설명', '설명완료': '청약서 작성', '청약': '계약 성립 확인' }[e.stage] + (age ? ` · ${age}일째` : '');
  }
  function trackingView() {
    const f = state.trackFilter; const all = enrollmentRows();
    const rows = all.filter(({ c, e }) => {
      if (f.stage && e.stage !== f.stage) return false;
      if (f.ind && c.biz.industry !== f.ind) return false;
      if (f.product && e.productId !== f.product) return false;
      if (f.q) { const q = f.q.toLowerCase(); if (![c.customer.label, c.biz.bizName, c.biz.bizNo].some(x => (x || '').toLowerCase().includes(q))) return false; }
      return true;
    });
    const counts = E.STAGES.map(s => [s, all.filter(r => r.e.stage === s).length]);
    const follow = all.filter(({ c, e }) => nextAction(e, c) === 'FOLLOW').length;
    const archived = visibleConsults().filter(c => c.archived);
    return `<div class="page-head"><h1>가입 트래킹</h1><p>${state.me.role === 'manager' ? '전체 상담사' : '내'} 추천 ${all.length}건 · 후속 연락 필요 <b class="crit-t">${follow}건</b></p></div>
      <div class="stage-strip">${counts.map(([s, n]) => `<button class="stage-chip ${f.stage === s ? 'on' : ''}" data-stage="${s}">${stageBadge(s)}<b>${n}</b></button>`).join('')}</div>
      <div class="filters card">
        <div class="field"><label for="tq">검색</label><input id="tq" value="${esc(f.q)}" placeholder="상호·메모·사업자번호"></div>
        <div class="field"><label for="tk">업종</label><select id="tk"><option value="">전체</option>${E.INDUSTRIES.map(i => `<option value="${i.code}" ${f.ind === i.code ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tp">상품</label><select id="tp"><option value="">전체</option>${E.PRODUCTS.filter(p => p.active).map(p => `<option value="${p.id}" ${f.product === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <button class="btn ghost sm" id="treset">필터 초기화</button>
      </div>
      ${rows.length ? `<div class="table-wrap card"><table class="tbl">
        <thead><tr><th>상담일</th><th>상호</th><th>업종</th><th>추천 상품</th><th>구분</th><th>단계</th>${state.me.role === 'manager' ? '<th>상담사</th>' : ''}<th>다음 액션</th></tr></thead>
        <tbody>${rows.map(({ c, e }) => { const na = nextAction(e, c); return `<tr tabindex="0" data-open="${c.id}|${e.id}">
          <td class="num">${fmtDate(c.consultedAt)}</td>
          <td><b>${esc(c.biz.bizName)}</b>${c.customer.label ? `<br><small>${esc(c.customer.label)}</small>` : ''}</td>
          <td><small>${esc(E.IND[c.biz.industry]?.name || '-')}</small></td><td>${esc(E.PRODUCT[e.productId]?.name || e.productId)}${e.design ? `<br><small>특약 ${e.design.riders.length}개</small>` : ''}</td>
          <td>${e.kind === 'mandatory' ? '<span class="pill crit">의무</span>' : '<span class="pill info">권장</span>'}</td>
          <td>${stageBadge(e.stage)}</td>${state.me.role === 'manager' ? `<td>${esc(ACC[c.counselorId]?.name || '')}</td>` : ''}
          <td>${na === 'FOLLOW' ? '<span class="pill crit">후속 연락 필요</span>' : esc(na)}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="card empty">${all.length ? '조건에 맞는 추천 건이 없어요.' : '아직 추천 건이 없어요. 새 상담에서 미가입 의무보험을 찾으면 여기에 쌓여요.'}</div>`}
      ${archived.length ? `<details class="card archived" ${state.showArchived ? 'open' : ''} id="archDetails"><summary>관리 종료(삭제)한 고객 ${archived.length}명</summary>
        <ul>${archived.map(c => `<li><span><b>${esc(c.biz.bizName)}</b> <small>삭제 ${fmtDate(c.archivedAt)}</small></span><button class="btn ghost sm" data-restore="${c.id}">복원</button></li>`).join('')}</ul>
        <p class="foot">삭제한 고객은 목록·고객 카드에서 빠지고, 실적 대시보드 집계에는 그대로 남아요.</p></details>` : ''}`;
  }
  function bindTracking() {
    const f = state.trackFilter;
    const q = $('#tq'); q.addEventListener('input', () => { f.q = q.value; clearTimeout(bindTracking._t); bindTracking._t = setTimeout(() => { render(); const n = $('#tq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    $('#tk').addEventListener('change', e => { f.ind = e.target.value; render(); });
    $('#tp').addEventListener('change', e => { f.product = e.target.value; render(); });
    $('#treset').addEventListener('click', () => { state.trackFilter = { q: '', stage: '', ind: '', product: '' }; render(); });
    document.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => { f.stage = f.stage === b.dataset.stage ? '' : b.dataset.stage; render(); }));
    document.querySelectorAll('[data-open]').forEach(tr => {
      const open = () => { const [cid, eid] = tr.dataset.open.split('|'); state.drawer = { cid, eid, to: null, checks: {} }; render(); };
      tr.addEventListener('click', open); tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
    });
    const ad = $('#archDetails'); if (ad) ad.addEventListener('toggle', () => { state.showArchived = ad.open; });
    document.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => setArchived(b.dataset.restore, false)));
  }
  function drawerView() {
    const c = state.consults.find(x => x.id === state.drawer.cid); if (!c) return '';
    const e = c.enrollments.find(x => x.id === state.drawer.eid); if (!e) return '';
    const p = E.PRODUCT[e.productId] || { checklist: [] }; const dr = state.drawer; const to = dr.to || e.stage;
    const needCheck = !e.checklistDone && ['설명완료', '청약', '계약성립'].includes(to);
    const mine = state.me.role === 'manager' || c.counselorId === state.me.id;
    const start = e.startDate || todayStr();
    return `<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-label="추천 건 상세">
      <header><div><small>${fmtDate(c.consultedAt)} · ${esc(ACC[c.counselorId]?.name || '')}</small><h2>${esc(c.biz.bizName)}</h2>${c.customer.label ? `<p>${esc(c.customer.label)}</p>` : ''}</div><button class="btn ghost sm" id="dclose" aria-label="닫기">닫기</button></header>
      <section><h3>${esc(p.name || e.productId)}</h3><p class="muted">${esc(E.RULE[e.code]?.name || '')} · ${e.kind === 'mandatory' ? '의무보험 미가입' : '권장'} · 현재 ${stageBadge(e.stage)}</p></section>
      ${e.design ? `<section class="design dz"><span class="d-lbl">메인 보장</span><p>${esc(e.design.main)}</p>${(e.design.limits || []).length ? `<ul class="limits">${e.design.limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <span class="d-lbl">포함 특약 ${e.design.riders.length}개</span>${e.design.riders.length ? `<ul class="rlist">${e.design.riders.map(r => `<li><span class="rk ${r.kind}">${E.RIDER_KIND[r.kind]}</span>${esc(r.name)}</li>`).join('')}</ul>` : '<p class="muted small">특약 없음</p>'}</section>` : ''}
      <section class="grid2 small"><div><dt>업종</dt><dd>${esc(E.IND[c.biz.industry]?.name || '-')}</dd></div><div><dt>소상공인</dt><dd>${badge(c.eligibility?.status || '-')}</dd></div>
        <div><dt>건물</dt><dd>${c.biz.isBuildingOwner ? '자가' : c.biz.isBuildingOwner === false ? '임차' : '-'}${c.biz.bizArea ? ` · 영업장 ${E.fmtArea(c.biz.bizArea)}` : ''}</dd></div><div><dt>소재지</dt><dd>${esc(c.biz.address || '-')}</dd></div></section>
      ${mine ? `<section><h3>단계 변경</h3>
        <div class="field"><label for="dstage">다음 단계</label><select id="dstage">${E.STAGES.map(s => `<option ${to === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${needCheck ? `<div class="checklist"><p><b>설명 의무사항</b>을 모두 확인해야 저장할 수 있어요.</p>${p.checklist.map((t, i) => `<label class="check" for="ck${i}"><input id="ck${i}" type="checkbox" data-ck="${i}" ${dr.checks[i] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>` : ''}
        ${to === '계약성립' ? `<div class="grid2"><div class="field"><label for="dpol">증권번호</label><input id="dpol" value="${esc(e.policyNo)}"></div><div class="field"><label for="dprem">연 보험료 (원)</label><input id="dprem" type="number" min="0" value="${esc(v(e.premium))}"></div>
          <div class="field"><label for="dstart">보험 시작일</label><input id="dstart" type="date" value="${esc(start)}"></div><div class="field"><label for="dexp">만기일 <span class="opt">(고객 카드 D-day)</span></label><input id="dexp" type="date" value="${esc(e.expiry || addYear(start))}"></div></div>` : ''}
        <div class="field"><label for="dnote">메모</label><textarea id="dnote" rows="2">${esc(e.note)}</textarea></div>
        <p class="err" id="derr" role="alert"></p>
        <button class="btn primary block" id="dsave" ${state.canWrite ? '' : 'disabled'}>저장</button></section>` : '<p class="muted">다른 상담사의 건이라 볼 수만 있어요.</p>'}
      <section><h3>단계 이력</h3><ol class="timeline">${[...(e.history || [])].reverse().map(h => `<li><span class="dot"></span><div>${stageBadge(h.to)} <small>${fmtDate(h.at)} · ${esc(ACC[h.by || c.counselorId]?.name || '')}</small>${h.note ? `<p>${esc(h.note)}</p>` : ''}</div></li>`).join('')}</ol></section>
      ${c.memo ? `<section><h3>상담 메모</h3><p>${esc(c.memo)}</p></section>` : ''}
      ${mine ? `<section class="danger-zone">${state.confirmArchive === c.id ? `<p>이 고객(${esc(c.biz.bizName)})을 관리 목록에서 삭제할까요? 추천 건 ${c.enrollments.length}개가 함께 숨겨지고, 언제든 복원할 수 있어요.</p><div class="row"><button class="btn danger sm" data-arch="${c.id}">삭제</button><button class="btn ghost sm" data-arch-cancel>취소</button></div>`
        : `<button class="btn ghost sm" data-arch-ask="${c.id}">이 고객 관리 종료(삭제)</button>`}</section>` : ''}
    </aside>`;
  }
  function bindDrawer() {
    const close = () => { state.drawer = null; state.confirmArchive = null; render(); };
    $('#dclose').addEventListener('click', close); $('#scrim').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(ev) { if (ev.key === 'Escape' && state.drawer) { document.removeEventListener('keydown', onEsc); close(); } });
    document.querySelectorAll('.drawer [data-arch-ask]').forEach(b => b.addEventListener('click', () => { state.confirmArchive = b.dataset.archAsk; render(); }));
    document.querySelectorAll('.drawer [data-arch-cancel]').forEach(b => b.addEventListener('click', () => { state.confirmArchive = null; render(); }));
    document.querySelectorAll('.drawer [data-arch]').forEach(b => b.addEventListener('click', () => setArchived(b.dataset.arch, true)));
    const st = $('#dstage'); if (!st) return;
    st.addEventListener('change', () => { state.drawer.to = st.value; render(); });
    document.querySelectorAll('[data-ck]').forEach(el => el.addEventListener('change', () => { state.drawer.checks[el.dataset.ck] = el.checked; }));
    const ds = $('#dstart'); if (ds) ds.addEventListener('change', () => { const de = $('#dexp'); if (de && ds.value) de.value = addYear(ds.value); });
    $('#dsave').addEventListener('click', async () => {
      const c = structuredClone(state.consults.find(x => x.id === state.drawer.cid));
      const e = c.enrollments.find(x => x.id === state.drawer.eid); const p = E.PRODUCT[e.productId] || { checklist: [] };
      const to = st.value; const note = $('#dnote').value;
      if (!e.checklistDone && ['설명완료', '청약', '계약성립'].includes(to)) {
        if (!p.checklist.every((_, i) => state.drawer.checks[i])) { $('#derr').textContent = '설명 의무사항을 모두 체크하세요.'; return; }
        e.checklistDone = true;
      }
      if (to === '계약성립') {
        e.policyNo = $('#dpol').value; e.premium = $('#dprem').value ? Number($('#dprem').value) : null;
        e.startDate = $('#dstart').value; e.expiry = $('#dexp').value;
        if (!e.policyNo) { $('#derr').textContent = '증권번호를 입력하세요.'; return; }
        if (!e.expiry) { $('#derr').textContent = '만기일을 입력하세요.'; return; }
      }
      const now = new Date().toISOString();
      if (to !== e.stage) { e.history = [...(e.history || []), { from: e.stage, to, at: now, by: state.me.id, note }]; e.stage = to; e.stageAt = now; }
      else if (note && note !== e.note) { e.history = [...(e.history || []), { from: e.stage, to: e.stage, at: now, by: state.me.id, note }]; }
      e.note = note;
      const ok = await saveConsult(c);
      if (ok) { toast('저장했어요.'); state.drawer = null; render(); }
    });
  }

  /* ---------- 대시보드 ---------- */
  function periodRange(p) {
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
    if (p === 'this') return [new Date(y, m, 1), new Date(y, m + 1, 1)];
    if (p === 'last') return [new Date(y, m - 1, 1), new Date(y, m, 1)];
    if (p === 'q') return [new Date(y, m - 2, 1), new Date(y, m + 1, 1)];
    return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
  }
  const reached = (e, s) => { const order = ['추천', '설명완료', '청약', '계약성립']; const i = order.indexOf(s); return (e.history || []).some(h => order.indexOf(h.to) >= i) || order.indexOf(e.stage) >= i; };
  function metrics(cs) {
    const ens = cs.flatMap(c => (c.enrollments || []).map(e => ({ ...e, c })));
    const won = ens.filter(e => e.stage === '계약성립');
    const custWith = cs.filter(c => (c.enrollments || []).length);
    const custWon = cs.filter(c => (c.enrollments || []).some(e => e.stage === '계약성립'));
    const gaps = cs.reduce((n, c) => n + (c.results || []).filter(r => r.kind === 'mandatory' && r.status === '미가입').length, 0);
    const days = won.map(e => { const h = (e.history || []).find(x => x.to === '계약성립'); return h ? daysBetween(e.c.consultedAt, h.at) : null; }).filter(x => x !== null);
    return {
      consults: cs.length, eligible: cs.filter(c => c.eligibility?.status === '적격').length, gaps,
      recs: ens.length, won: won.length, rejected: ens.filter(e => ['거절', '철회'].includes(e.stage)).length,
      open: ens.filter(e => E.OPEN_STAGES.includes(e.stage)).length, applied: ens.filter(e => reached(e, '청약')).length,
      custRate: pct(custWon.length, custWith.length), recRate: pct(won.length, ens.length),
      avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : null,
      funnel: ['추천', '설명완료', '청약', '계약성립'].map(s => [s, ens.filter(e => reached(e, s)).length]), ens
    };
  }
  function dashboardView() {
    const dsh = state.dash; const [from, to] = periodRange(dsh.period);
    let cs = visibleConsults().filter(c => { const d = new Date(c.consultedAt); return d >= from && d < to; });
    if (state.me.role === 'manager' && dsh.counselor) cs = cs.filter(c => c.counselorId === dsh.counselor);
    const m = metrics(cs);
    const counselors = ACCOUNTS.filter(a => a.role === 'counselor');
    const byC = counselors.map(a => ({ a, m: metrics(cs.filter(c => c.counselorId === a.id)) }));
    const ksics = [...new Set(m.ens.map(e => e.c.biz.industry))].filter(Boolean);
    const byK = ksics.map(k => { const es = m.ens.filter(e => e.c.biz.industry === k); return { k, n: es.length, w: es.filter(e => e.stage === '계약성립').length }; }).sort((x, y) => y.n - x.n).slice(0, 8);
    const byP = E.PRODUCTS.filter(p => p.active).map(p => { const es = m.ens.filter(e => e.productId === p.id); return { p, n: es.length, w: es.filter(e => e.stage === '계약성립').length }; }).filter(x => x.n);
    const months = [...new Set(cs.map(c => c.consultedAt.slice(0, 7)))].sort();
    const byM = months.map(mo => { const es = m.ens.filter(e => e.c.consultedAt.startsWith(mo)); return { mo, n: es.length, w: es.filter(e => e.stage === '계약성립').length, c: cs.filter(c => c.consultedAt.startsWith(mo)).length }; });
    const tile = (label, val, sub, tip) => `<div class="tile" ${tip ? `data-tip="${esc(tip)}"` : ''}><span>${label}${tip ? ' <i class="tip-i">?</i>' : ''}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `<div class="page-head row"><div><h1>${state.me.role === 'manager' ? '상담사 실적' : '내 실적'}</h1><p>추천 건 ${m.recs}건 중 계약성립 ${m.won}건 · 진행 중 ${m.open}건</p></div>
      <div class="filters inline">
        <div class="field"><label for="dp">기간</label><select id="dp">${[['all', '전체'], ['this', '이번 달'], ['last', '지난달'], ['q', '최근 3개월']].map(([k, l]) => `<option value="${k}" ${dsh.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${state.me.role === 'manager' ? `<div class="field"><label for="dc">상담사</label><select id="dc"><option value="">전체</option>${counselors.map(a => `<option value="${a.id}" ${dsh.counselor === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      </div></div>
      ${cs.length ? `
      <section class="tiles">
        ${tile('고객 기준 가입률', pctTxt(m.custRate), `${cs.filter(c => (c.enrollments || []).some(e => e.stage === '계약성립')).length} / ${cs.filter(c => (c.enrollments || []).length).length} 고객`, '계약성립 1건 이상인 고객 수 ÷ 당사 상품을 추천받은 고객 수')}
        ${tile('추천 건 기준 가입률', pctTxt(m.recRate), `${m.won} / ${m.recs} 건`, '계약성립 건수 ÷ 전체 추천 건수 (진행 중 포함)')}
        ${tile('상담', m.consults + '건', `소상공인 적격 ${m.eligible}건`)}
        ${tile('미가입 의무보험 발견', m.gaps + '건', '당사 미취급 포함')}
        ${tile('평균 소요일', m.avgDays === null ? '–' : m.avgDays + '일', '상담 → 계약성립')}
      </section>
      <div class="charts">
        ${state.me.role === 'manager' && !dsh.counselor ? chartCard('상담사별 추천 건 기준 가입률', byC.map(x => ({ label: x.a.name, value: x.m.recRate, tip: `${x.a.name}: ${x.m.won}/${x.m.recs}건 계약성립 (${pctTxt(x.m.recRate)})` })), true) : ''}
        ${funnelCard(m.funnel)}
        ${chartCard('월별 추천 건 기준 가입률', byM.map(x => ({ label: x.mo.replace('-', '.'), value: pct(x.w, x.n), tip: `${x.mo.replace('-', '.')}: 상담 ${x.c}건, 추천 ${x.n}건 중 계약성립 ${x.w}건` })), true)}
        ${chartCard('업종별 가입률 (추천 건 상위 8개)', byK.map(x => ({ label: E.IND[x.k]?.name || x.k, value: pct(x.w, x.n), tip: `${E.IND[x.k]?.name || x.k}: ${x.w}/${x.n}건` })), true)}
        ${chartCard('상품별 가입률', byP.map(x => ({ label: x.p.name.replace('배상책임보험', '배상'), value: pct(x.w, x.n), tip: `${x.p.name}: ${x.w}/${x.n}건` })), true)}
      </div>
      ${state.me.role === 'manager' ? counselorTable(byC) : ''}`
      : `<div class="card empty">이 기간에 상담이 없어요. ${state.dbMode === 'loading' ? '데이터를 불러오는 중이에요.' : '새 상담을 등록하거나 기간을 바꿔 보세요.'}</div>`}`;
  }
  function chartCard(title, items, isPct) {
    if (!items.length) return '';
    return `<section class="card chart"><h3>${title}</h3><div class="bars">${items.map(it => {
      const w = it.value === null ? 0 : Math.max(0, Math.min(100, it.value));
      return `<div class="bar-row" data-tip="${esc(it.tip)}"><span class="bl">${esc(it.label)}</span><span class="track"><span class="fill" style="width:${w}%"></span></span><span class="bv">${isPct ? pctTxt(it.value) : it.value}</span></div>`;
    }).join('')}</div><div class="axis"><span>0%</span><span>50%</span><span>100%</span></div></section>`;
  }
  function funnelCard(f) {
    const max = Math.max(1, f[0][1]);
    return `<section class="card chart"><h3>단계별 퍼널</h3><div class="bars">${f.map(([s, n], i) => `<div class="bar-row" data-tip="${s} 단계 이상 도달 ${n}건${i ? ` (추천 대비 ${pctTxt(pct(n, max))})` : ''}"><span class="bl">${s}</span><span class="track"><span class="fill" style="width:${n / max * 100}%"></span></span><span class="bv">${n}건</span></div>`).join('')}</div><p class="foot">각 단계에 한 번이라도 도달한 추천 건 수</p></section>`;
  }
  function counselorTable(byC) {
    const rows = byC.map(({ a, m }) => [a.name, a.branch, m.consults, m.recs, m.applied, m.won, m.rejected, pctTxt(m.custRate), pctTxt(m.recRate)]);
    const head = ['상담사', '소속', '상담', '추천', '청약 도달', '계약성립', '거절·철회', '고객 기준', '추천 건 기준'];
    state._csv = [head, ...rows].map(r => r.join(',')).join('\n');
    return `<section class="card"><div class="row"><h3>상담사별 실적</h3><button class="btn ghost sm" id="copyCsv">CSV 복사</button></div>
      <div class="table-wrap"><table class="tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 1 ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function bindDashboard() {
    $('#dp').addEventListener('change', e => { state.dash.period = e.target.value; render(); });
    const dc = $('#dc'); if (dc) dc.addEventListener('change', e => { state.dash.counselor = e.target.value; render(); });
    const cc = $('#copyCsv'); if (cc) cc.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state._csv); toast('CSV를 복사했어요. 엑셀에 붙여넣으세요.'); } catch (e) { toast('복사가 막혀 있어요.'); } });
  }

  /* ---------- 관리자 ---------- */
  function adminView() {
    return `<div class="page-head"><h1>규칙·상품</h1><p>판정 규칙은 법령 원문 확인 전 초안이에요. 운영 전에 국가법령정보센터 원문과 대조해 검증 처리하세요.</p></div>
      <section class="card"><h3>의무·권장 보험 규칙</h3><div class="table-wrap"><table class="tbl">
        <thead><tr><th>코드</th><th>보험</th><th>구분</th><th>근거</th><th>연결 상품</th><th>검증</th></tr></thead>
        <tbody>${E.RULES.map(r => `<tr><td><code>${r.code}</code></td><td>${esc(r.name)}</td><td>${r.kind === 'mandatory' ? '의무' : '권장'}</td><td><small>${esc(r.law)}</small></td>
          <td>${r.productBy ? '일반화재보험 / 공장화재보험(제조업)' : r.products.length ? r.products.map(id => esc(E.PRODUCT[id].name)).join(', ') : '<span class="pill outline">당사 미취급</span>'}</td>
          <td>${r.verified ? '<span class="pill good">해당 없음</span>' : '<span class="pill warn">미검증</span>'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card"><h3>당사 상품 (제공 서류 2026.07.01 기준)</h3><div class="table-wrap"><table class="tbl">
        <thead><tr><th>상품</th><th>분류</th><th>상태</th><th>설계 특약</th><th>서류</th></tr></thead>
        <tbody>${E.PRODUCTS.map(p => `<tr><td><b>${esc(p.name)}</b></td><td><small>${esc(p.line)}</small></td><td>${p.active ? '<span class="pill good">추천 사용</span>' : `<span class="pill mute">비활성</span><br><small>${esc(p.note || '')}</small>`}</td>
          <td><small>${p.riders.length ? p.riders.map(r => `${E.RIDER_KIND[r.kind]} · ${esc(r.name)}`).join('<br>') : '-'}</small></td>
          <td><small>${p.docs.map(d => d.endsWith('*') ? `${esc(d.slice(0, -1))} <span class="pill outline">내부</span>` : esc(d)).join('<br>') || '-'}</small></td></tr>`).join('')}</tbody></table></div>
        <p class="foot">'내부' 표시 서류(영업요율서·변경대비표)는 관리자 전용으로 다룹니다. 원본 파일은 사내 문서함에서 관리해요.</p></section>
      <section class="card"><h3>상담사 계정</h3><p class="foot">계정 추가·역할 변경은 README의 '계정 관리'를 따라 Supabase에서 해요.</p><div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>이름</th><th>소속</th><th>역할</th><th>상담 수</th></tr></thead>
        <tbody>${ACCOUNTS.map(a => `<tr><td><small>${esc(a.id.slice(0, 8))}</small></td><td>${esc(a.name)}</td><td>${esc(a.branch)}</td><td>${a.role === 'manager' ? '관리자' : '상담사'}</td><td class="num">${state.consults.filter(c => c.counselorId === a.id).length}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- 툴팁 ---------- */
  function initTooltip() {
    const tt = $('#tt');
    document.addEventListener('mouseover', ev => { const t = ev.target.closest('[data-tip]'); if (!t) { tt.hidden = true; return; } tt.textContent = t.dataset.tip; tt.hidden = false; });
    document.addEventListener('mousemove', ev => { if (tt.hidden) return; const x = Math.min(ev.clientX + 14, window.innerWidth - tt.offsetWidth - 8); tt.style.left = x + 'px'; tt.style.top = (ev.clientY + 16) + 'px'; });
    document.addEventListener('focusin', ev => { const t = ev.target.closest('[data-tip]'); if (t) { tt.textContent = t.dataset.tip; tt.hidden = false; const r = t.getBoundingClientRect(); tt.style.left = r.left + 'px'; tt.style.top = (r.bottom + 6) + 'px'; } });
    document.addEventListener('focusout', () => { tt.hidden = true; });
  }

  window.addEventListener('hashchange', () => { state.drawer = null; render(); });
  initTooltip(); render(); initDb();
})();
