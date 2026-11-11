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
  const FACILITY_OPTS = ['일반음식점(1층, 100㎡ 이상)', '물류창고', '직영 판매장'];

  const state = {
    me: null, consults: [], dbMode: 'loading', sb: null, canWrite: true, authReady: false,
    draft: null, step: 1, trackFilter: { q: '', stage: '', ksic: '', product: '' },
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
  function route() { const h = (location.hash || '').slice(1); return ['consult', 'tracking', 'dashboard', 'admin'].includes(h) ? h : 'dashboard'; }
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
      <main class="main">${r === 'consult' ? consultView() : r === 'tracking' ? trackingView() : r === 'admin' ? adminView() : dashboardView()}</main>
      ${state.drawer ? drawerView() : ''}`;
    bindCommon();
    if (r === 'consult') bindConsult();
    if (r === 'tracking') bindTracking();
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
    const tabs = [['dashboard', '실적 대시보드'], ['consult', '새 상담'], ['tracking', '가입 트래킹']];
    if (state.me.role === 'manager') tabs.push(['admin', '규칙·상품']);
    return `<header class="topbar">
      <div class="brand"><span class="mark" aria-hidden="true">헤</span><div><b>소상공인 보험 헤아림</b><small>상담사 콘솔 · 제조업 소기업</small></div></div>
      <nav class="tabs" aria-label="메뉴">${tabs.map(([k, l]) => `<a href="#${k}" class="tab ${r === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <div class="who"><span>${esc(state.me.name)} <small>${esc(state.me.branch)}</small></span><button class="btn ghost sm" id="logout">로그아웃</button></div>
    </header>`;
  }

  /* ---------- 로그인 ---------- */
  function setupView() {
    return `<div class="login-wrap"><div class="login card"><div class="brand lg"><span class="mark" aria-hidden="true">헤</span><div><b>소상공인 보험 헤아림</b><small>설정이 필요해요</small></div></div>
      <p><code>config.js</code>에 Supabase Project URL과 anon key를 입력한 뒤 다시 배포하세요. README의 2단계를 참고하세요.</p></div></div>`;
  }
  function loginView() {
    return `<div class="login-wrap"><form class="login card" id="loginForm">
      <div class="brand lg"><span class="mark" aria-hidden="true">헤</span><div><b>소상공인 보험 헤아림</b><small>제조업 소기업 의무보험 보장분석 · 상담사 콘솔</small></div></div>
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
      if (!location.hash) location.hash = '#dashboard';
    });
  }
  function bindCommon() {
    $('#logout').addEventListener('click', async () => { await state.sb.auth.signOut(); });
  }

  /* ---------- 새 상담 ---------- */
  function newDraft() {
    return {
      customer: { name: '', phone: '', email: '' },
      biz: { bizName: '', bizNo: '', corpType: '법인', sido: '', sigungu: '', addressDetail: '', address: '', ksic: '', isMainBusiness: true, mainProducts: '', smeType: '', employees: null,
        isBuildingOwner: null, buildingArea: null, buildingFloors: null, factoryArea: null, industrialComplex: false,
        hasElevator: false, elevatorCount: null, elevatorManager: null,
        lpg: false, lpgKg: null, cityGas: false, cityGasSpecific: false, hpGasStorage: false, spHpGasUse: false,
        hazardousChem: false, emissionFacility: false, records: null, vehicles: 0, otherFacilities: [], supplyNH: false, exports: false },
      answers: {}, memo: ''
    };
  }
  function consultView() {
    if (!state.draft) state.draft = newDraft();
    const s = state.step;
    const steps = ['고객 정보', '사업장 정보', '보장분석 결과'];
    return `<div class="page-head"><h1>새 상담</h1><p>기준일 ${E.BASIS_DATE} · 사회보험(국민연금·건강·고용·산재)은 분석에서 제외</p></div>
      <ol class="stepper">${steps.map((t, i) => `<li class="${i + 1 === s ? 'on' : i + 1 < s ? 'done' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>
      ${s === 1 ? step1() : s === 2 ? step2() : step3()}`;
  }
  const v = x => x === null || x === undefined ? '' : x;
  function inp(path, label, type = 'text', attrs = '') {
    const val = getPath(state.draft, path);
    const id = 'f_' + path.replace(/\./g, '_');
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-path="${path}" type="${type}" value="${esc(v(val))}" ${attrs}></div>`;
  }
  function chk(path, label) {
    const id = 'f_' + path.replace(/\./g, '_');
    return `<label class="check" for="${id}"><input id="${id}" type="checkbox" data-path="${path}" ${getPath(state.draft, path) ? 'checked' : ''}> ${label}</label>`;
  }
  function tri(path, label, yes = '예', no = '아니오') {
    const val = getPath(state.draft, path); const id = 'f_' + path.replace(/\./g, '_');
    return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-path="${path}" data-type="tri">
      <option value="" ${val === null ? 'selected' : ''}>선택</option><option value="1" ${val === true ? 'selected' : ''}>${yes}</option><option value="0" ${val === false ? 'selected' : ''}>${no}</option></select></div>`;
  }
  function getPath(o, p) { return p.split('.').reduce((a, k) => a == null ? a : a[k], o); }
  function setPath(o, p, val) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = val; }

  function step1() {
    return `<section class="card form">
      <h2>고객 정보</h2>
      <div class="grid3">${inp('customer.name', '고객명 (대표자)')}${inp('customer.phone', '연락처', 'tel', 'placeholder="숫자만 입력 (예: 01012345678)" inputmode="numeric" maxlength="13" autocomplete="off"')}${inp('customer.email', '이메일 <span class="opt">(선택)</span>', 'email', 'placeholder="name@example.com"')}</div>
      <p class="err" id="stepErr" role="alert"></p>
      <div class="actions"><span></span><button class="btn primary" id="next1">다음: 사업장 정보</button></div>
    </section>`;
  }
  function step2() {
    const b = state.draft.biz;
    return `<div class="split">
      <section class="card form">
        <h2>기본</h2>
        <div class="grid3">${inp('biz.bizName', '상호')}${inp('biz.bizNo', '사업자등록번호', 'text', 'placeholder="000-00-00000"')}
          <div class="field"><label for="f_biz_corpType">사업자 구분</label><select id="f_biz_corpType" data-path="biz.corpType">${['법인', '개인'].map(o => `<option ${b.corpType === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div></div>
        <div class="grid3">
          <div class="field"><label for="f_biz_sido">사업장 시·도</label><select id="f_biz_sido" data-path="biz.sido"><option value="">선택</option>${Object.keys(window.REGIONS).map(s => `<option ${b.sido === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label for="f_biz_sigungu">시·군·구</label><select id="f_biz_sigungu" data-path="biz.sigungu" ${b.sido ? '' : 'disabled'}><option value="">${b.sido ? '선택' : '시·도를 먼저 선택'}</option>${(window.REGIONS[b.sido] || []).map(g => `<option ${b.sigungu === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          ${inp('biz.addressDetail', '상세 주소 <span class="opt">(선택)</span>', 'text', 'placeholder="읍·면·동, 도로명, 번지"')}
        </div>
        <div class="grid2">${inp('biz.mainProducts', '주요 생산품', 'text', 'placeholder="예: 김치, 알루미늄 브래킷"')}</div>
        <div class="grid3">
          <div class="field"><label for="f_biz_ksic">주된 업종 (KSIC 중분류)</label><select id="f_biz_ksic" data-path="biz.ksic"><option value="">선택</option>${E.KSIC.map(([c, n]) => `<option value="${c}" ${b.ksic === c ? 'selected' : ''}>${c} ${esc(n)}</option>`).join('')}<option value="X" ${b.ksic === 'X' ? 'selected' : ''}>제조업 외 업종</option></select></div>
          ${tri('biz.isMainBusiness', '제조업이 주된 사업인가요? <i class="tip" data-tip="여러 업종을 함께 하면 평균매출액 비중이 가장 큰 업종이 주된 업종이에요.">?</i>')}
          <div class="field"><label for="f_biz_smeType">중소기업확인서 구분</label><select id="f_biz_smeType" data-path="biz.smeType">${['', '소기업', '소상공인', '중기업', '없음/모름'].map(o => `<option value="${o}" ${b.smeType === o ? 'selected' : ''}>${o || '선택'}</option>`).join('')}</select></div></div>
        <div class="grid3">${inp('biz.employees', '상시근로자 수', 'number', 'min="0"')}</div>

        <h2>건물 <i class="tip" data-tip="건축물대장에서 소유자·연면적·층수를 확인할 수 있어요.">?</i></h2>
        <div class="grid3">${tri('biz.isBuildingOwner', '건물 소유', '자가 소유', '임차')}${inp('biz.buildingArea', '건물 연면적 (㎡)', 'number', 'min="0"')}${inp('biz.buildingFloors', '층수', 'number', 'min="1"')}</div>
        <div class="row-checks">${chk('biz.industrialComplex', '산업단지 입주')}</div>

        <h2>승강기 <i class="tip" data-tip="승강기 안전인증·정기검사 필증에서 관리주체를 확인하세요.">?</i></h2>
        <div class="row-checks">${chk('biz.hasElevator', '승강기 있음 (화물용 포함)')}</div>
        ${b.hasElevator ? `<div class="grid3">${inp('biz.elevatorCount', '대수', 'number', 'min="1"')}${tri('biz.elevatorManager', '고객이 관리주체인가요?')}</div>` : ''}

        <h2>가스 <i class="tip" data-tip="가스 사용시설 완성검사증명서·사용신고서로 확인하세요.">?</i></h2>
        <div class="row-checks">${chk('biz.lpg', 'LPG 사용')}${chk('biz.cityGas', '도시가스 사용')}${chk('biz.hpGasStorage', '고압가스 저장 허가')}${chk('biz.spHpGasUse', '특정고압가스 사용신고')}</div>
        <div class="grid3">${b.lpg ? inp('biz.lpgKg', 'LPG 저장능력 (kg)', 'number', 'min="0"') : ''}${b.cityGas ? `<div class="field"><span class="lbl">도시가스</span>${chk('biz.cityGasSpecific', '특정가스사용시설 해당')}</div>` : ''}</div>

        <h2>환경·기타</h2>
        <div class="row-checks">${chk('biz.hazardousChem', '유해화학물질 취급')}${chk('biz.emissionFacility', '대기·수질 배출시설')}${chk('biz.supplyNH', '농협 계통 납품')}${chk('biz.exports', '수출')}</div>
        <div class="grid3">${inp('biz.records', '보유 고객 개인정보 (건)', 'number', 'min="0"')}${inp('biz.vehicles', '업무용 차량 (대)', 'number', 'min="0"')}</div>
        <fieldset class="field"><legend>사업장 내 별도 시설</legend><div class="row-checks">${FACILITY_OPTS.map((o, i) => `<label class="check" for="fac${i}"><input id="fac${i}" type="checkbox" data-fac="${esc(o)}" ${b.otherFacilities.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></fieldset>
        <div class="actions"><button class="btn ghost" id="prev2">이전</button><button class="btn primary" id="next2">보장분석 실행</button></div>
      </section>
      <aside class="card preview" id="preview">${previewPanel()}</aside>
    </div>`;
  }
  function previewPanel() {
    const b = state.draft.biz; const el = E.eligibility(b); const rs = E.analyze(b);
    const req = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상');
    return `<h3>실시간 미리보기</h3>
      <div class="elig">${badge(el.status)}<ul>${el.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
      <h4>의무보험 해당 ${req.length}건</h4>
      ${req.length ? `<ul class="mini">${req.map(r => `<li>${badge(r.result)} ${esc(r.name)}</li>`).join('')}</ul>` : '<p class="muted">아직 해당하는 의무보험이 없어요. 시설 정보를 입력해 보세요.</p>'}`;
  }

  function step3() {
    const d = state.draft; const b = d.biz; const el = E.eligibility(b); const rs = E.analyze(b);
    const mand = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상');
    const none = rs.filter(r => r.kind === 'mandatory' && r.result === '비대상');
    const rec = rs.filter(r => r.kind === 'recommended' && r.result === '권장');
    return `<section class="card summary-line">
        <div><b>${esc(b.bizName || '(상호 미입력)')}</b> · ${esc(b.ksic ? b.ksic + ' ' + (E.KSIC_NAME[b.ksic] || '제조업 외') : '업종 미선택')} · ${esc(d.customer.name)}</div>
        <div>대상 적격성 ${badge(el.status)} <span class="muted">${esc(el.reasons.join(' · '))}</span></div>
      </section>
      <h2 class="sec">① 법정 의무보험 <span class="count">${mand.length}</span></h2>
      ${mand.length ? mand.map(mandCard).join('') : '<div class="card empty">해당하는 의무보험이 없어요.</div>'}
      ${none.length ? `<details class="card none"><summary>비대상 ${none.length}건 보기</summary><ul>${none.map(r => `<li><b>${esc(r.name)}</b> — ${esc(r.reason)}</li>`).join('')}</ul></details>` : ''}
      <h2 class="sec">② 권장 보험 <span class="sub">의무 아님</span></h2>
      ${rec.map(recCard).join('')}
      <h2 class="sec">③ 분석 제외</h2>
      <div class="card muted">사회보험(국민연금·건강보험·고용보험·산재보험)은 이 분석에서 제외됩니다.</div>
      <div class="field memo"><label for="memo">상담 메모</label><textarea id="memo" rows="3">${esc(d.memo)}</textarea></div>
      <p class="disclaimer">이 결과는 ${E.BASIS_DATE} 법령 기준 초안(미검증 규칙 포함)이며, 최종 가입 의무 여부는 관할 기관 확인이 필요합니다.</p>
      <p class="err" id="stepErr" role="alert"></p>
      <div class="actions"><button class="btn ghost" id="prev3">이전</button><button class="btn primary" id="saveConsult" ${state.canWrite ? '' : 'disabled'}>상담 저장</button></div>`;
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
        <div class="field"><label for="exp_${r.code}">만기일</label><input id="exp_${r.code}" type="date" data-ansf="${r.code}.expiry" value="${esc(a.expiry || '')}"></div></div>` : ''}
      ${a.status === '미가입' ? (prod.length ? prod.map(p => productBox(p, true)).join('') : `<div class="noprod"><span class="pill outline">당사 미취급</span> 관련 기관·타 채널을 안내해 주세요. 트래킹 대상에서 제외됩니다.</div>`) : ''}
    </article>`;
  }
  function productBox(p, auto) {
    return `<div class="prod"><div class="prod-head"><span class="pill accent">당사 추천</span><b>${esc(p.name)}</b><small>${esc(p.line)}</small></div>
      ${p.riders.special.length ? `<p><b>필수 특약</b> ${p.riders.special.map(esc).join(' · ')}</p>` : ''}
      ${p.riders.optional.length ? `<p class="muted"><b>선택 특약</b> ${p.riders.optional.map(esc).join(' · ')}</p>` : ''}
      <p class="muted"><b>설명 의무</b> ${p.checklist.map(esc).join(' / ')}</p>
      ${auto ? '<p class="auto">저장하면 가입 트래킹에 \'추천\' 단계로 등록돼요.</p>' : ''}</div>`;
  }
  function recCard(r) {
    const a = state.draft.answers[r.code] || {};
    const prods = r.products.map(id => E.PRODUCT[id]);
    return `<article class="card ins stripe-info">
      <header><div><h3>${esc(r.name)}</h3><p class="law">${esc(r.reason)}</p></div>${badge('권장')}</header>
      ${prods.length > 1 ? `<p class="muted">Ⅰ은 보험기간 중 <b>사고 발생</b> 기준, Ⅱ는 보험기간 중 <b>최초 손해배상청구</b> 기준(소급보상일자 적용)이에요.</p>` : ''}
      <div class="status-row"><span class="lbl">제안 상품</span>
        <label class="seg ${!a.productId ? 'on' : ''}"><input type="radio" name="rec_${r.code}" value="" data-rec="${r.code}" ${!a.productId ? 'checked' : ''}>제안 안 함</label>
        ${prods.map(p => `<label class="seg ${a.productId === p.id ? 'on' : ''}"><input type="radio" name="rec_${r.code}" value="${p.id}" data-rec="${r.code}" ${a.productId === p.id ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}
      </div>
      ${a.productId ? productBox(E.PRODUCT[a.productId], true) : ''}
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
        const structural = ['biz.hasElevator', 'biz.lpg', 'biz.cityGas', 'biz.sido'].includes(el.dataset.path);
        if (structural) render(); else if ($('#preview')) $('#preview').innerHTML = previewPanel();
      });
    });
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
    const memo = $('#memo'); if (memo) memo.addEventListener('input', () => { d.memo = memo.value; });
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    on('next1', () => {
      const c = d.customer;
      if (!c.name || !c.phone) return void ($('#stepErr').textContent = '고객명과 연락처를 입력하세요.');
      if (!validPhone(c.phone)) return void ($('#stepErr').textContent = '연락처 형식을 확인하세요. 예: 010-1234-5678');
      if (c.email && !validEmail(c.email)) return void ($('#stepErr').textContent = '이메일 형식을 확인하세요. 비워 두어도 괜찮아요.');
      state.step = 2; render(); window.scrollTo(0, 0);
    });
    on('prev2', () => { state.step = 1; render(); });
    on('next2', () => {
      if (!d.biz.bizName || !d.biz.ksic) { toast('상호와 주된 업종을 입력하세요.'); return; }
      if (!d.biz.sido || !d.biz.sigungu) { toast('사업장 시·도와 시·군·구를 선택하세요.'); return; }
      state.step = 3; render(); window.scrollTo(0, 0);
    });
    on('prev3', () => { state.step = 2; render(); });
    on('saveConsult', async () => {
      const rs = E.analyze(d.biz);
      const pending = rs.filter(r => r.kind === 'mandatory' && r.result !== '비대상' && !(d.answers[r.code] || {}).status);
      if (pending.length) { $('#stepErr').textContent = `가입 여부를 선택하지 않은 의무보험이 ${pending.length}건 있어요: ${pending.map(p => p.name).join(', ')}`; return; }
      const now = new Date().toISOString();
      const results = rs.map(r => {
        const a = d.answers[r.code] || {};
        const productId = r.kind === 'recommended' ? (a.productId || null) : (a.status === '미가입' ? (r.products.find(id => E.PRODUCT[id] && E.PRODUCT[id].active) || null) : null);
        return { code: r.code, kind: r.kind, name: r.name, result: r.result, reason: r.reason, status: r.kind === 'mandatory' && r.result !== '비대상' ? a.status : null, insurer: a.insurer || '', expiry: a.expiry || '', productId };
      });
      const enrollments = results.filter(r => r.productId && (r.kind === 'recommended' ? r.result === '권장' : true)).map(r => ({
        id: uid(), code: r.code, productId: r.productId, kind: r.kind, stage: '추천', stageAt: now, checklistDone: false, policyNo: '', premium: null, note: '',
        history: [{ from: null, to: '추천', at: now, by: state.me.id }]
      }));
      const c = { id: uid(), counselorId: state.me.id, consultedAt: now, customer: d.customer, biz: d.biz, eligibility: E.eligibility(d.biz), results, enrollments, memo: d.memo, };
      const btn = $('#saveConsult'); btn.disabled = true; btn.textContent = '저장 중…';
      const ok = await saveConsult(c);
      if (ok) { toast(`저장했어요. 당사 상품 추천 ${enrollments.length}건이 가입 트래킹에 등록됐어요.`); state.draft = null; state.step = 1; location.hash = '#tracking'; render(); }
      else { btn.disabled = false; btn.textContent = '상담 저장'; }
    });
  }

  /* ---------- 가입 트래킹 ---------- */
  function enrollmentRows() {
    const rows = [];
    visibleConsults().forEach(c => (c.enrollments || []).forEach(e => rows.push({ c, e })));
    return rows.sort((a, b) => new Date(b.c.consultedAt) - new Date(a.c.consultedAt));
  }
  function nextAction(e, c) {
    const age = daysBetween(e.stageAt || c.consultedAt, new Date());
    if (e.stage === '계약성립') return '완료';
    if (['거절', '철회'].includes(e.stage)) return '종료';
    if (e.kind === 'mandatory' && E.OPEN_STAGES.includes(e.stage) && daysBetween(c.consultedAt, new Date()) > 14) return 'FOLLOW';
    return { '추천': '상품 설명', '설명완료': '청약서 작성', '청약': '계약 성립 확인' }[e.stage] + (age ? ` · ${age}일째` : '');
  }
  function trackingView() {
    const f = state.trackFilter; const all = enrollmentRows();
    const rows = all.filter(({ c, e }) => {
      if (f.stage && e.stage !== f.stage) return false;
      if (f.ksic && c.biz.ksic !== f.ksic) return false;
      if (f.product && e.productId !== f.product) return false;
      if (f.q) { const q = f.q.toLowerCase(); if (![c.customer.name, c.biz.bizName, c.biz.bizNo].some(x => (x || '').toLowerCase().includes(q))) return false; }
      return true;
    });
    const counts = E.STAGES.map(s => [s, all.filter(r => r.e.stage === s).length]);
    const follow = all.filter(({ c, e }) => nextAction(e, c) === 'FOLLOW').length;
    return `<div class="page-head"><h1>가입 트래킹</h1><p>${state.me.role === 'manager' ? '전체 상담사' : '내'} 추천 ${all.length}건 · 후속 연락 필요 <b class="crit-t">${follow}건</b></p></div>
      <div class="stage-strip">${counts.map(([s, n]) => `<button class="stage-chip ${f.stage === s ? 'on' : ''}" data-stage="${s}">${stageBadge(s)}<b>${n}</b></button>`).join('')}</div>
      <div class="filters card">
        <div class="field"><label for="tq">검색</label><input id="tq" value="${esc(f.q)}" placeholder="고객명·상호·사업자번호"></div>
        <div class="field"><label for="tk">업종</label><select id="tk"><option value="">전체</option>${E.KSIC.map(([c, n]) => `<option value="${c}" ${f.ksic === c ? 'selected' : ''}>${c} ${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label for="tp">상품</label><select id="tp"><option value="">전체</option>${E.PRODUCTS.filter(p => p.active).map(p => `<option value="${p.id}" ${f.product === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <button class="btn ghost sm" id="treset">필터 초기화</button>
      </div>
      ${rows.length ? `<div class="table-wrap card"><table class="tbl">
        <thead><tr><th>상담일</th><th>고객 / 상호</th><th>업종</th><th>추천 상품</th><th>구분</th><th>단계</th>${state.me.role === 'manager' ? '<th>상담사</th>' : ''}<th>다음 액션</th></tr></thead>
        <tbody>${rows.map(({ c, e }) => { const na = nextAction(e, c); return `<tr tabindex="0" data-open="${c.id}|${e.id}">
          <td class="num">${fmtDate(c.consultedAt)}</td>
          <td><b>${esc(c.customer.name)}</b><br><small>${esc(c.biz.bizName)} · ${esc(maskPhone(c.customer.phone))}</small></td>
          <td>${esc(c.biz.ksic)}</td><td>${esc(E.PRODUCT[e.productId]?.name || e.productId)}</td>
          <td>${e.kind === 'mandatory' ? '<span class="pill crit">의무</span>' : '<span class="pill info">권장</span>'}</td>
          <td>${stageBadge(e.stage)}</td>${state.me.role === 'manager' ? `<td>${esc(ACC[c.counselorId]?.name || c.counselorId)}</td>` : ''}
          <td>${na === 'FOLLOW' ? '<span class="pill crit">후속 연락 필요</span>' : esc(na)}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="card empty">${all.length ? '조건에 맞는 추천 건이 없어요.' : '아직 추천 건이 없어요. 새 상담에서 미가입 의무보험을 찾으면 여기에 쌓여요.'}</div>`}`;
  }
  function bindTracking() {
    const f = state.trackFilter;
    const q = $('#tq'); q.addEventListener('input', () => { f.q = q.value; clearTimeout(bindTracking._t); bindTracking._t = setTimeout(() => { render(); const n = $('#tq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    $('#tk').addEventListener('change', e => { f.ksic = e.target.value; render(); });
    $('#tp').addEventListener('change', e => { f.product = e.target.value; render(); });
    $('#treset').addEventListener('click', () => { state.trackFilter = { q: '', stage: '', ksic: '', product: '' }; render(); });
    document.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => { f.stage = f.stage === b.dataset.stage ? '' : b.dataset.stage; render(); }));
    document.querySelectorAll('[data-open]').forEach(tr => {
      const open = () => { const [cid, eid] = tr.dataset.open.split('|'); state.drawer = { cid, eid, to: null, checks: {} }; render(); };
      tr.addEventListener('click', open); tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
    });
  }
  function drawerView() {
    const c = state.consults.find(x => x.id === state.drawer.cid); if (!c) return '';
    const e = c.enrollments.find(x => x.id === state.drawer.eid); if (!e) return '';
    const p = E.PRODUCT[e.productId]; const dr = state.drawer; const to = dr.to || e.stage;
    const needCheck = !e.checklistDone && ['설명완료', '청약', '계약성립'].includes(to);
    const mine = state.me.role === 'manager' || c.counselorId === state.me.id;
    return `<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-label="추천 건 상세">
      <header><div><small>${fmtDate(c.consultedAt)} · ${esc(ACC[c.counselorId]?.name || '')}</small><h2>${esc(c.biz.bizName)}</h2><p>${esc(c.customer.name)} · ${esc(c.customer.phone)}</p></div><button class="btn ghost sm" id="dclose" aria-label="닫기">닫기</button></header>
      <section><h3>${esc(p?.name || '')}</h3><p class="muted">${esc(E.RULE[e.code]?.name || '')} · ${e.kind === 'mandatory' ? '의무보험 미가입' : '권장'} · 현재 ${stageBadge(e.stage)}</p></section>
      <section class="grid2 small"><div><dt>업종</dt><dd>${esc(c.biz.ksic)} ${esc(E.KSIC_NAME[c.biz.ksic] || '')}</dd></div><div><dt>적격성</dt><dd>${badge(c.eligibility?.status || '-')}</dd></div>
        <div><dt>건물</dt><dd>${c.biz.isBuildingOwner ? '자가' : c.biz.isBuildingOwner === false ? '임차' : '-'} · ${c.biz.buildingArea ? E.fmtNum(c.biz.buildingArea) + '㎡' : '-'}</dd></div><div><dt>주요 생산품</dt><dd>${esc(c.biz.mainProducts || '-')}</dd></div><div><dt>소재지</dt><dd>${esc(c.biz.address || [c.biz.sido, c.biz.sigungu].filter(Boolean).join(' ') || '-')}</dd></div></section>
      ${mine ? `<section><h3>단계 변경</h3>
        <div class="field"><label for="dstage">다음 단계</label><select id="dstage">${E.STAGES.map(s => `<option ${to === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${needCheck ? `<div class="checklist"><p><b>설명 의무사항</b>을 모두 확인해야 저장할 수 있어요.</p>${p.checklist.map((t, i) => `<label class="check" for="ck${i}"><input id="ck${i}" type="checkbox" data-ck="${i}" ${dr.checks[i] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>` : ''}
        ${to === '계약성립' ? `<div class="grid2"><div class="field"><label for="dpol">증권번호</label><input id="dpol" value="${esc(e.policyNo)}"></div><div class="field"><label for="dprem">연 보험료 (원)</label><input id="dprem" type="number" min="0" value="${esc(v(e.premium))}"></div></div>` : ''}
        <div class="field"><label for="dnote">메모</label><textarea id="dnote" rows="2">${esc(e.note)}</textarea></div>
        <p class="err" id="derr" role="alert"></p>
        <button class="btn primary block" id="dsave" ${state.canWrite ? '' : 'disabled'}>저장</button></section>` : '<p class="muted">다른 상담사의 건이라 볼 수만 있어요.</p>'}
      <section><h3>단계 이력</h3><ol class="timeline">${[...(e.history || [])].reverse().map(h => `<li><span class="dot"></span><div>${stageBadge(h.to)} <small>${fmtDate(h.at)} · ${esc(ACC[h.by || c.counselorId]?.name || '')}</small>${h.note ? `<p>${esc(h.note)}</p>` : ''}</div></li>`).join('')}</ol></section>
      ${c.memo ? `<section><h3>상담 메모</h3><p>${esc(c.memo)}</p></section>` : ''}
    </aside>`;
  }
  function bindDrawer() {
    const close = () => { state.drawer = null; render(); };
    $('#dclose').addEventListener('click', close); $('#scrim').addEventListener('click', close);
    document.addEventListener("keydown", function onEsc(ev) { if (ev.key === "Escape" && state.drawer) { document.removeEventListener("keydown", onEsc); close(); } });
    const st = $('#dstage'); if (!st) return;
    st.addEventListener('change', () => { state.drawer.to = st.value; render(); });
    document.querySelectorAll('[data-ck]').forEach(el => el.addEventListener('change', () => { state.drawer.checks[el.dataset.ck] = el.checked; }));
    $('#dsave').addEventListener('click', async () => {
      const c = structuredClone(state.consults.find(x => x.id === state.drawer.cid));
      const e = c.enrollments.find(x => x.id === state.drawer.eid); const p = E.PRODUCT[e.productId];
      const to = st.value; const note = $('#dnote').value;
      if (!e.checklistDone && ['설명완료', '청약', '계약성립'].includes(to)) {
        const ok = p.checklist.every((_, i) => state.drawer.checks[i]);
        if (!ok) { $('#derr').textContent = '설명 의무사항을 모두 체크하세요.'; return; }
        e.checklistDone = true;
      }
      if (to === '계약성립') { e.policyNo = $('#dpol').value; e.premium = $('#dprem').value ? Number($('#dprem').value) : null; if (!e.policyNo) { $('#derr').textContent = '증권번호를 입력하세요.'; return; } }
      const now = new Date().toISOString();
      if (to !== e.stage) { e.history = [...(e.history || []), { from: e.stage, to, at: now, by: state.me.id, note }]; e.stage = to; e.stageAt = now; }
      else if (note !== e.note && note) { e.history = [...(e.history || []), { from: e.stage, to: e.stage, at: now, by: state.me.id, note }]; }
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
    const ksics = [...new Set(m.ens.map(e => e.c.biz.ksic))].sort();
    const byK = ksics.map(k => { const es = m.ens.filter(e => e.c.biz.ksic === k); return { k, n: es.length, w: es.filter(e => e.stage === '계약성립').length }; }).sort((x, y) => y.n - x.n).slice(0, 8);
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
        ${tile('상담', m.consults + '건', `제조 소기업 적격 ${m.eligible}건`)}
        ${tile('미가입 의무보험 발견', m.gaps + '건', '당사 미취급 포함')}
        ${tile('평균 소요일', m.avgDays === null ? '–' : m.avgDays + '일', '상담 → 계약성립')}
      </section>
      <div class="charts">
        ${state.me.role === 'manager' && !dsh.counselor ? chartCard('상담사별 추천 건 기준 가입률', byC.map(x => ({ label: x.a.name, value: x.m.recRate, tip: `${x.a.name}: ${x.m.won}/${x.m.recs}건 계약성립 (${pctTxt(x.m.recRate)})` })), true) : ''}
        ${funnelCard(m.funnel)}
        ${chartCard('월별 추천 건 기준 가입률', byM.map(x => ({ label: x.mo.replace('-', '.'), value: pct(x.w, x.n), tip: `${x.mo.replace('-', '.')}: 상담 ${x.c}건, 추천 ${x.n}건 중 계약성립 ${x.w}건` })), true)}
        ${chartCard('업종별 가입률 (추천 건 상위 8개)', byK.map(x => ({ label: x.k, value: pct(x.w, x.n), tip: `${x.k} ${E.KSIC_NAME[x.k]}: ${x.w}/${x.n}건` })), true)}
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
          <td>${r.products.length ? r.products.map(id => esc(E.PRODUCT[id].name)).join(', ') : '<span class="pill outline">당사 미취급</span>'}</td>
          <td>${r.verified ? '<span class="pill good">해당 없음</span>' : '<span class="pill warn">미검증</span>'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card"><h3>당사 상품 (제공 서류 2026.07.01 기준)</h3><div class="table-wrap"><table class="tbl">
        <thead><tr><th>상품</th><th>분류</th><th>상태</th><th>필수 특약</th><th>서류</th></tr></thead>
        <tbody>${E.PRODUCTS.map(p => `<tr><td><b>${esc(p.name)}</b></td><td><small>${esc(p.line)}</small></td><td>${p.active ? '<span class="pill good">추천 사용</span>' : `<span class="pill mute">비활성</span><br><small>${esc(p.note || '')}</small>`}</td>
          <td><small>${p.riders.special.map(esc).join('<br>') || '-'}</small></td>
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
