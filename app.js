// ===== PR/PO System — PWA user interface =====
(() => {
  const C = window.APP_CONFIG;
  const $ = s => document.querySelector(s);
  const V = () => $('#view');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { boot: null, prs: [], pos: [], serverTime: '', unread: 0, budget: null, installEvt: null, timer: null, route: '' };

  // ---------- icons ----------
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
    po: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    ok: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>', clip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  };
  const ic = n => `<svg aria-hidden="true" viewBox="0 0 24 24">${ICON[n] || ''}</svg>`;

  // ---------- formatting ----------
  const dec = cur => (cur === 'KHR' ? 0 : 2);
  const money = (n, cur) => (cur ? cur + ' ' : '') + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec(cur), maximumFractionDigits: dec(cur) });
  const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ts = s => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
  const fmtD = s => (s ? new Date(ts(s)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const fmtDT = s => (s ? new Date(ts(s)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + s.slice(11, 16) : '');
  const ageDays = s => (s && S.serverTime ? Math.max(0, Math.floor((ts(S.serverTime) - ts(s)) / 86400000)) : 0);
  const ageTxt = d => (d === 0 ? 'today' : d + 'd');
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const AV = ['#2c5282', '#1d7a52', '#9c4221', '#6b46c1', '#b83280', '#2b6cb0', '#4a5568', '#0f766e'];
  const avColor = u => AV[[...String(u)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
  const deptName = code => ((S.boot.departments.find(d => d.code === code) || {}).name || code || '—');
  const rateOf = code => ((S.boot.currencies.find(c => c.code === code) || {}).rateToUSD || 0);
  const fileHref = u => (Api.demo ? Demo.fileUrl(u) : u);

  // ---------- roles ----------
  const me = () => S.boot.user;
  const isRole = (...r) => r.includes(me().role);
  const isApprover = () => isRole('DeptHead', 'Manager', 'Executive', 'Admin');
  const isPOApprover = () => isRole('Manager', 'Executive', 'Admin');
  const isBuyer = () => isRole('Purchasing', 'Admin');
  const seeAll = () => isRole('Manager', 'Executive', 'Purchasing', 'Store', 'Admin');
  const seeDash = () => isRole('Manager', 'Executive', 'Purchasing', 'Admin');
  const seePOs = () => isRole('Purchasing', 'Store', 'Admin', 'Manager', 'Executive');

  // ---------- chips ----------
  const chip = (t, cls = '') => `<span class="chip ${cls}">${esc(t)}</span>`;
  const PR_CLS = { 'Pending Approval': 'amber', Returned: 'red', Rejected: 'red', Approved: 'green', Ordered: 'blue' };
  const PO_CLS = { 'Pending Approval': 'amber', Issued: 'blue', 'Partially Received': 'amber', Received: 'green' };
  function prChip(p) {
    let t = p.status;
    if (p.status === 'Pending Approval') t = 'Waiting · ' + p.waitingOn;
    if (p.status === 'Approved') t = 'Approved · waiting PO';
    if (p.status === 'Ordered') t = 'PO issued';
    const cls = p.status === 'Pending Approval' && ageDays(p.lastActionAt) >= 2 ? 'red' : PR_CLS[p.status] || '';
    return chip(t + (p.status === 'Pending Approval' ? ' · ' + ageTxt(ageDays(p.lastActionAt)) : ''), cls);
  }
  const poChip = p => (p.late ? chip('Late · due ' + fmtD(p.deliveryDate), 'red') : chip(p.status, PO_CLS[p.status] || ''));

  // ---------- ui helpers ----------
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 3200);
  }
  function banner(html) { $('#banner').innerHTML = html || ''; $('#banner').classList.toggle('hidden', !html); }
  const loading = () => { V().innerHTML = '<div class="loading"><span class="spin" aria-label="Loading"></span></div>'; };
  async function api(action, payload) {
    try { return await Api.call(action, payload); }
    catch (e) {
      if (e.message === 'SESSION_EXPIRED') { signOutLocal(); toast('Please sign in again', true); }
      throw e;
    }
  }
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { if (e.message !== 'SESSION_EXPIRED') toast(e.message, true); return undefined; } finally { if (btn) btn.disabled = false; }
  }
  function openModal(title, body, foot, wide) {
    $('#mTitle').textContent = title; $('#mBody').innerHTML = body; $('#mFoot').innerHTML = foot || '';
    $('#modal .sheet').classList.toggle('wide', !!wide); $('#modal').classList.remove('hidden');
    const f = $('#mBody').querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 50);
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#mBody').innerHTML = ''; }
  $('#mClose').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });
  function ask(title, { label = 'Comment', required = false, btn = 'Confirm', cls = 'primary', text = '' } = {}) {
    return new Promise(resolve => {
      openModal(title, `${text ? `<p style="margin-top:0">${text}</p>` : ''}<label class="field">${esc(label)}${required ? ' *' : ''}<textarea id="askTxt" rows="3"></textarea></label>`,
        `<button class="btn" id="askNo">Back</button><button class="btn ${cls}" id="askYes">${esc(btn)}</button>`);
      $('#askNo').onclick = () => { closeModal(); resolve(null); };
      $('#askYes').onclick = () => { const v = $('#askTxt').value.trim(); if (required && !v) { toast('Please write a reason', true); return; } closeModal(); resolve(v); };
    });
  }

  // ---------- auth ----------
  const DEMO_USERS = [['admin', '1234', 'Admin'], ['sokha', '1111', 'Requester · Warehouse'], ['dara', '2222', 'Dept head · Warehouse'], ['vanna', '3333', 'Manager'],
    ['chan', '4444', 'Executive'], ['mony', '5555', 'Purchasing'], ['rith', '6666', 'Store']];
  function showLogin() {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    if (Api.demo) {
      $('#demoHint').classList.remove('hidden');
      $('#demoHint').innerHTML = '<b>DEMO mode</b> — tap a user to fill in:<table>' + DEMO_USERS.map(([u, p, r]) => `<tr><td><button type="button" data-u="${u}" data-p="${p}">${u}</button></td><td>${p}</td><td class="muted">${r}</td></tr>`).join('') + '</table>';
      $('#demoHint').onclick = e => { const b = e.target.closest('button[data-u]'); if (b) { $('#loginUser').value = b.dataset.u; $('#loginPin').value = b.dataset.p; } };
    }
    $('#loginUser').value = Store.get('lastUser', '');
    setTimeout(() => ($('#loginUser').value ? $('#loginPin') : $('#loginUser')).focus(), 50);
  }
  function signOutLocal() { Store.del('token'); clearInterval(S.timer); S.boot = null; closeModal(); showLogin(); }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.target.querySelector('button[type=submit]'); b.disabled = true; $('#loginErr').textContent = '';
    try {
      const r = await Api.call('login', { username: $('#loginUser').value, pin: $('#loginPin').value });
      Store.set('token', r.token); Store.set('lastUser', r.user.username); $('#loginPin').value = '';
      await boot();
    } catch (err) { $('#loginErr').textContent = err.message; } finally { b.disabled = false; }
  });
  async function logout() {
    const tok = Store.get('pushToken');
    try { if (tok) await Api.call('pushUnregister', { token: tok }); await Api.call('logout'); } catch (e) { /* ignore */ }
    Store.del('pushToken'); signOutLocal();
  }

  async function boot() {
    try { S.boot = await api('bootstrap'); } catch (e) { if (e.message !== 'SESSION_EXPIRED') { toast(e.message, true); showLogin(); } return; }
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    banner(Api.demo ? '🧪 <b>DEMO mode</b> — data is saved only in this browser. Set API_URL in config.js to go live.' : '');
    S.budget = S.boot.budget; S.unread = S.boot.unread;
    await refresh(true, true);
    route();
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!document.hidden) refresh(true); }, (C.REFRESH_SECONDS || 60) * 1000);
  }
  async function refresh(silent, noRender) {
    try {
      const d = await api('list');
      Object.assign(S, { prs: d.prs, pos: d.pos, serverTime: d.serverTime, unread: d.unread, budget: d.budget });
      $('#sync').textContent = 'Synced ' + d.serverTime.slice(11, 16);
      buildNav();
      const live = ['home', 'prs', 'approvals', 'board', 'pos'];
      if (!noRender && live.includes(S.route) && $('#modal').classList.contains('hidden') && !V().contains(document.activeElement)) route(true);
    } catch (e) { if (!silent && e.message !== 'SESSION_EXPIRED') toast(e.message, true); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.boot) refresh(true); });

  // ---------- navigation ----------
  function counts() {
    return {
      approvals: S.prs.filter(p => p.canApprove).length + (isPOApprover() ? S.pos.filter(p => p.status === 'Pending Approval').length : 0),
      topo: S.prs.filter(p => p.status === 'Approved').length,
    };
  }
  function navItems() {
    const n = counts(), items = [['home', 'Home', 'home'], ['prs', 'Requests', 'list']];
    if (isApprover()) items.push(['approvals', 'Approvals', 'check', n.approvals]);
    items.push(['board', 'Board', 'board']);
    if (seePOs()) items.push(['pos', 'Purchase orders', 'po', isBuyer() ? n.topo : 0]);
    if (seeDash()) items.push(['dashboard', 'Dashboard', 'chart']);
    items.push(['sep']);
    if (isBuyer()) items.push(['vendors', 'Vendors & rates', 'tag']);
    if (isRole('Admin')) items.push(['users', 'Users', 'users']);
    items.push(['notifications', 'Notifications', 'bell', S.unread], ['me', 'My account', 'user']);
    return items;
  }
  function buildNav() {
    if (!S.boot) return;
    const cur = S.route, u = me();
    $('#side').innerHTML = `<div class="brand"><img src="icons/icon-192.png" alt="">${esc(C.APP_NAME || 'PR / PO')}</div>` +
      navItems().map(([k, l, i, c]) => (k === 'sep' ? '<div class="sep"></div>' : `<a href="#${k}" class="${cur === k ? 'on' : ''}">${ic(i)}${l}${c ? `<span class="count">${c}</span>` : ''}</a>`)).join('') +
      `<a href="#new-pr" style="margin-top:10px;background:#fff;color:#1f3a5f;font-weight:600;justify-content:center">${ic('plus')}New PR</a>` +
      `<div class="me">${esc(u.name)}<br>${esc(u.role)}${u.department ? ' · ' + esc(deptName(u.department)) : ''}</div>`;
    const n = counts();
    const slot4 = isApprover() ? ['approvals', 'Approvals', 'check', n.approvals] : seePOs() ? ['pos', 'POs', 'po', isBuyer() ? n.topo : 0] : ['board', 'Board', 'board'];
    const slots = [['home', 'Home', 'home'], ['prs', 'Requests', 'list'], ['new-pr', 'New PR', 'plus'], slot4, ['me', 'More', 'user']];
    $('#bottom').innerHTML = slots.map(([k, l, i, c]) => (k === 'new-pr'
      ? `<a href="#new-pr" class="plus" aria-label="New PR"><span class="circle">${ic('plus')}</span></a>`
      : `<a href="#${k}" class="${cur === k ? 'on' : ''}">${ic(i)}${l}${c ? `<span class="count">${c}</span>` : ''}</a>`)).join('');
    $('#bellDot').textContent = S.unread; $('#bellDot').classList.toggle('hidden', !S.unread);
  }
  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#home'; };
  window.addEventListener('hashchange', () => { if (S.boot) route(); });

  const TITLES = { home: 'Home', prs: 'Requests', approvals: 'Approvals', board: 'Board', pos: 'Purchase orders', dashboard: 'Dashboard', vendors: 'Vendors & rates', users: 'Users', notifications: 'Notifications', me: 'My account', 'new-pr': 'New purchase request' };
  async function route(quiet) {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'home';
    let key = h, fn, arg;
    if (/^edit-PR/.test(h)) { key = 'edit-pr'; fn = prForm; arg = h.slice(5); }
    else if (/^newpo-PR/.test(h)) { key = 'po-form'; fn = poForm; arg = { prId: h.slice(6) }; }
    else if (/^editpo-PO/.test(h)) { key = 'po-form'; fn = poForm; arg = { poId: h.slice(7) }; }
    else if (/^PR\d{4}-\d+$/.test(h)) { key = 'pr'; fn = prDetail; arg = h; }
    else if (/^PO\d{4}-\d+$/.test(h)) { key = 'po'; fn = poDetail; arg = h; }
    else fn = { home, prs: prList, approvals, board, pos: poList, dashboard, vendors, users: usersView, notifications, me: account, 'new-pr': () => prForm('') }[h];
    if (!fn) { location.hash = '#home'; return; }
    S.route = key;
    $('#pageTitle').textContent = TITLES[h] || h.replace(/^(edit-|newpo-|editpo-)/, '');
    $('#backBtn').style.visibility = ['home', 'prs', 'approvals', 'me', 'board', 'pos'].includes(key) ? 'hidden' : 'visible';
    buildNav();
    V().onclick = V().onchange = V().oninput = null;
    if (!quiet) { loading(); window.scrollTo(0, 0); }
    try { await fn(arg); } catch (e) { if (e.message !== 'SESSION_EXPIRED') V().innerHTML = `<div class="empty">${esc(e.message)}<br><br><a class="btn" href="#home">Go home</a></div>`; }
  }

  // ---------- shared renderers ----------
  function prCard(p) {
    return `<a class="doc" href="#${esc(p.id)}">
      <div class="top"><span>${esc(p.id)} · ${fmtD(p.submittedAt || p.createdAt)}</span><span>${esc(deptName(p.department))}</span></div>
      <div class="t">${esc(p.title)}</div>
      <div class="bottom-line">${prChip(p)}<span class="amt">${money(p.totalAmount, p.currency)}</span></div>
      ${p.currency !== 'USD' || seeAll() ? `<div class="top"><span>${esc(p.requesterName)}</span><span>${p.currency !== 'USD' ? '≈ ' + usd(p.totalUSD) : ''}</span></div>` : ''}
    </a>`;
  }
  function poCard(p) {
    return `<a class="doc" href="#${esc(p.id)}">
      <div class="top"><span>${esc(p.id)} · ${esc(p.prId)}</span><span>${esc(p.vendorName)}</span></div>
      <div class="t">${esc(p.title)}</div>
      <div class="bottom-line">${poChip(p)}<span class="amt">${money(p.total, p.currency)}</span></div>
    </a>`;
  }
  const listOrEmpty = (arr, fn, msg) => (arr.length ? `<div class="list">${arr.map(fn).join('')}</div>` : `<div class="empty">${msg}</div>`);
  function budgetCard(b) {
    if (!b || !b.budgetUSD) return '';
    const used = Math.min(100, b.usedUSD / b.budgetUSD * 100), com = Math.min(100 - used, b.committedUSD / b.budgetUSD * 100);
    const left = b.budgetUSD - b.usedUSD - b.committedUSD;
    return `<div class="card"><div class="row between"><h2 style="margin:0">Budget · ${esc(deptName(b.department))} · ${esc(b.month)}</h2><span class="muted" style="font-size:12px">${left >= 0 ? usd(left) + ' left' : usd(-left) + ' over'}</span></div>
      <div class="bar stacked" style="margin:10px 0 6px"><i style="width:${used}%" class="${b.pct > 85 ? 'warn' : ''}"></i><i class="ghost" style="width:${com}%"></i></div>
      <div class="row between muted" style="font-size:12px"><span>Spent ${usd(b.usedUSD)} · In approval ${usd(b.committedUSD)}</span><span>Budget ${usd(b.budgetUSD)}</span></div></div>`;
  }

  // ---------- HOME ----------
  async function home() {
    const u = me(), mine = S.prs.filter(p => p.requester === u.username);
    const waitMe = S.prs.filter(p => p.canApprove).sort((a, b) => a.lastActionAt.localeCompare(b.lastActionAt));
    const poWait = isPOApprover() ? S.pos.filter(p => p.status === 'Pending Approval') : [];
    const toPO = isBuyer() ? S.prs.filter(p => p.status === 'Approved') : [];
    const incoming = isRole('Store', 'Purchasing', 'Admin') ? S.pos.filter(p => ['Issued', 'Partially Received'].includes(p.status)).sort((a, b) => (a.deliveryDate || '9').localeCompare(b.deliveryDate || '9')) : [];
    const k = { pending: mine.filter(p => p.status === 'Pending Approval').length, approved: mine.filter(p => p.status === 'Approved').length,
      ordered: mine.filter(p => p.status === 'Ordered').length, action: mine.filter(p => ['Draft', 'Returned'].includes(p.status)).length };
    const hr = new Date().getHours();
    V().innerHTML = `<div class="stack">
      <div class="hero"><span class="avatar" style="background:${avColor(u.username)}">${initials(u.name)}</span>
        <div style="flex:1;min-width:0"><div class="sub">${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}</div><div class="big">${esc(u.name)}</div>
        <div class="sub">${esc(u.role)}${u.department ? ' · ' + esc(deptName(u.department)) : ''}</div></div>
        <a class="btn" href="#new-pr" style="background:#fff;border:0;color:#1f3a5f">${ic('plus')}New PR</a></div>
      <div class="kpis">
        <a class="kpi" href="#prs"><b style="color:#b45309">${k.pending}</b><span>My PRs waiting approval</span></a>
        <a class="kpi" href="#prs"><b style="color:var(--green)">${k.approved}</b><span>Approved · waiting PO</span></a>
        <a class="kpi" href="#prs"><b style="color:var(--blue)">${k.ordered}</b><span>PO issued</span></a>
        <a class="kpi" href="#prs"><b style="color:var(--red)">${k.action}</b><span>Drafts / sent back</span></a>
      </div>
      ${waitMe.length || poWait.length ? `<div><div class="section-title"><h2>Waiting for you (${waitMe.length + poWait.length})</h2><a href="#approvals">See all</a></div>${listOrEmpty(waitMe.slice(0, 4), prCard, '')}${poWait.length ? '<div style="height:8px"></div>' + listOrEmpty(poWait.slice(0, 3), poCard, '') : ''}</div>` : ''}
      ${toPO.length ? `<div><div class="section-title"><h2>Ready for PO (${toPO.length})</h2><a href="#board">Board</a></div>${listOrEmpty(toPO.slice(0, 4), prCard, '')}</div>` : ''}
      ${incoming.length ? `<div><div class="section-title"><h2>Incoming deliveries (${incoming.length})</h2><a href="#pos">All POs</a></div>${listOrEmpty(incoming.slice(0, 4), poCard, '')}</div>` : ''}
      ${budgetCard(S.budget)}
      <div><div class="section-title"><h2>My requests</h2><a href="#prs">See all</a></div>
        ${listOrEmpty(mine.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), prCard, 'No requests yet — tap <b>New PR</b> to start.')}</div>
    </div>`;
  }

  // ---------- PR LIST ----------
  const listState = { q: '', status: 'open', scope: 'mine', dept: '' };
  async function prList() {
    const sts = ['Draft', 'Pending Approval', 'Returned', 'Approved', 'Ordered', 'Closed', 'Rejected', 'Cancelled'];
    if (seeAll() && listState.scope === 'mine' && !listState._init) { listState.scope = 'all'; }
    listState._init = true;
    V().innerHTML = `<div class="filters">
        <input type="search" id="fq" placeholder="Search PR, title, item owner…" value="${esc(listState.q)}" aria-label="Search">
        <select id="fs" aria-label="Status"><option value="open">Open</option><option value="">All statuses</option>${sts.map(s => `<option>${s}</option>`).join('')}</select>
        ${seeAll() ? `<select id="fd" aria-label="Department"><option value="">All departments</option>${S.boot.departments.map(d => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}</select>` : ''}
        <div class="seg" id="fscope"><button data-v="mine">Mine</button><button data-v="all">${seeAll() ? 'All' : 'My department'}</button></div>
      </div><div id="fl"></div>`;
    $('#fs').value = listState.status; if ($('#fd')) $('#fd').value = listState.dept;
    const draw = () => {
      [...$('#fscope').children].forEach(b => b.classList.toggle('on', b.dataset.v === listState.scope));
      const q = listState.q.toLowerCase();
      const rows = S.prs.filter(p => (listState.scope === 'all' || p.requester === me().username)
        && (!listState.status || (listState.status === 'open' ? !['Closed', 'Rejected', 'Cancelled'].includes(p.status) : p.status === listState.status))
        && (!listState.dept || p.department === listState.dept)
        && (!q || [p.id, p.title, p.requesterName, p.department].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      $('#fl').innerHTML = listOrEmpty(rows, prCard, 'No requests match these filters');
    };
    $('#fq').oninput = e => { listState.q = e.target.value; draw(); };
    $('#fs').onchange = e => { listState.status = e.target.value; draw(); };
    if ($('#fd')) $('#fd').onchange = e => { listState.dept = e.target.value; draw(); };
    $('#fscope').onclick = e => { const b = e.target.closest('button'); if (b) { listState.scope = b.dataset.v; draw(); } };
    draw();
  }

  // ---------- APPROVALS ----------
  async function approvals() {
    const prs = S.prs.filter(p => p.canApprove).sort((a, b) => a.lastActionAt.localeCompare(b.lastActionAt));
    const pos = isPOApprover() ? S.pos.filter(p => p.status === 'Pending Approval') : [];
    const recent = S.prs.filter(p => !p.canApprove && p.status === 'Pending Approval').slice(0, 8);
    V().innerHTML = `<div class="stack">
      <div><div class="section-title"><h2>PRs waiting for you (${prs.length})</h2></div>${listOrEmpty(prs, prCard, 'Nothing waiting for you 🎉')}</div>
      ${isPOApprover() ? `<div><div class="section-title"><h2>POs above the approved amount (${pos.length})</h2></div>${listOrEmpty(pos, poCard, 'No POs waiting')}</div>` : ''}
      ${recent.length ? `<div><div class="section-title"><h2>Other PRs in approval</h2></div>${listOrEmpty(recent, prCard, '')}</div>` : ''}
    </div>`;
  }

  // ---------- BOARD ----------
  const boardState = { dept: '', q: '' };
  async function board() {
    V().innerHTML = `<div class="filters"><input type="search" id="bq" placeholder="Search…" value="${esc(boardState.q)}" aria-label="Search">
      ${seeAll() ? `<select id="bd" aria-label="Department"><option value="">All departments</option>${S.boot.departments.map(d => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="board"><div class="board-in" id="bcols"></div></div>`;
    if ($('#bd')) $('#bd').value = boardState.dept;
    const draw = () => {
      const q = boardState.q.toLowerCase(), okD = x => !boardState.dept || x.department === boardState.dept;
      const okQ = x => !q || [x.id, x.title, x.vendorName, x.requesterName].join(' ').toLowerCase().includes(q);
      const recent = p => ageDays(p.updatedAt || p.issuedAt) <= 30;
      const cols = [
        ['Waiting approval', '#b45309', S.prs.filter(p => p.status === 'Pending Approval'), prCard],
        ['Approved · waiting PO', '#2f9e8f', S.prs.filter(p => p.status === 'Approved'), prCard],
        ['PO approval', '#c2410c', S.pos.filter(p => p.status === 'Pending Approval'), poCard],
        ['PO issued', '#2c5282', S.pos.filter(p => p.status === 'Issued'), poCard],
        ['Partially received', '#8a5a00', S.pos.filter(p => p.status === 'Partially Received'), poCard],
        ['Received (30 days)', '#1d7a52', S.pos.filter(p => p.status === 'Received' && recent(p)), poCard],
      ];
      $('#bcols').innerHTML = cols.map(([t, c, rows, fn]) => { const r = rows.filter(x => okD(x) && okQ(x)); return `<section class="col"><div class="col-head"><i style="background:${c}"></i>${t}<span class="n">${r.length}</span></div>${r.map(fn).join('') || '<div class="muted" style="text-align:center;padding:10px">—</div>'}</section>`; }).join('');
    };
    $('#bq').oninput = e => { boardState.q = e.target.value; draw(); };
    if ($('#bd')) $('#bd').onchange = e => { boardState.dept = e.target.value; draw(); };
    draw();
  }

  // ---------- PO LIST ----------
  const poState = { q: '', status: 'open' };
  async function poList() {
    const sts = ['Draft', 'Pending Approval', 'Issued', 'Partially Received', 'Received', 'Closed', 'Cancelled'];
    V().innerHTML = `<div class="filters"><input type="search" id="pq" placeholder="Search PO, PR, vendor…" value="${esc(poState.q)}" aria-label="Search">
      <select id="ps" aria-label="Status"><option value="open">Open</option><option value="late">Late only</option><option value="">All statuses</option>${sts.map(s => `<option>${s}</option>`).join('')}</select></div>
      ${isBuyer() && S.prs.some(p => p.status === 'Approved') ? `<div class="note warn" style="margin-bottom:12px">${S.prs.filter(p => p.status === 'Approved').length} approved PR(s) are waiting for a PO — see <a href="#board">Board</a>.</div>` : ''}
      <div class="card" style="padding:6px 10px"><div class="tbl-wrap"><table class="tbl" id="pt"></table></div></div>`;
    $('#ps').value = poState.status;
    const draw = () => {
      const q = poState.q.toLowerCase();
      const rows = S.pos.filter(p => (!poState.status || (poState.status === 'open' ? !['Closed', 'Cancelled'].includes(p.status) : poState.status === 'late' ? p.late : p.status === poState.status))
        && (!q || [p.id, p.prId, p.vendorName, p.title].join(' ').toLowerCase().includes(q))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      $('#pt').innerHTML = `<thead><tr><th>PO</th><th>Title</th><th>Vendor</th><th>Status</th><th>Delivery</th><th class="r">Total</th></tr></thead><tbody>` +
        (rows.map(p => `<tr class="click" data-id="${esc(p.id)}"><td><b>${esc(p.id)}</b><br><span class="muted" style="font-size:12px">${esc(p.prId)}</span></td><td>${esc(p.title)}</td><td>${esc(p.vendorName)}</td><td>${poChip(p)}</td><td>${fmtD(p.deliveryDate)}</td><td class="r"><b>${money(p.total, p.currency)}</b>${p.currency !== 'USD' ? `<br><span class="muted" style="font-size:12px">≈ ${usd(p.totalUSD)}</span>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No purchase orders</td></tr>') + '</tbody>';
    };
    $('#pq').oninput = e => { poState.q = e.target.value; draw(); };
    $('#ps').onchange = e => { poState.status = e.target.value; draw(); };
    $('#pt').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#' + tr.dataset.id; };
    draw();
  }

  // ---------- PR FORM ----------
  function levelsFor(totalUSD) {
    const lv = S.boot.rules.filter(r => totalUSD >= r.minUSD);
    return lv.length ? lv : S.boot.rules.slice(0, 1);
  }
  async function prForm(id) {
    let d = { title: '', department: me().department || (S.boot.departments[0] || {}).code, neededBy: '', currency: 'USD', reason: '', attachments: [] };
    let items = [{ item: '', description: '', qty: 1, unit: '', unitPrice: '' }];
    if (id) {
      const r = await api('getPR', { id });
      if (!r.can.edit) { location.hash = '#' + id; return; }
      d = { id, title: r.pr.title, department: r.pr.department, neededBy: r.pr.neededBy, currency: r.pr.currency, reason: r.reason, attachments: r.attachments };
      items = r.items.map(i => ({ item: i.item, description: i.description, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice }));
      $('#pageTitle').textContent = 'Edit ' + id;
    } else {
      const draft = Store.get('prDraft'); if (draft && draft.items && draft.items.length) { d = { ...d, ...draft.d, id: '', attachments: (draft.d && draft.d.attachments) || [] }; items = draft.items; }
    }
    let budget = S.budget && S.budget.department === d.department ? S.budget : null;
    V().innerHTML = `<form id="prf" class="stack" onsubmit="return false">
      <div class="card"><div class="grid2">
        <label class="field full">Title / purpose *<input name="title" value="${esc(d.title)}" placeholder="e.g. Stretch film & pallet labels" required></label>
        <label class="field">Department<select name="department" ${seeAll() ? '' : 'disabled'}>${S.boot.departments.map(x => `<option value="${esc(x.code)}" ${x.code === d.department ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field">Needed by<input name="neededBy" type="date" value="${esc(d.neededBy)}"></label>
        <label class="field">Currency<select name="currency">${S.boot.currencies.map(c => `<option ${c.code === d.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
        <div class="field">Rate to USD<div id="rateTxt" style="padding:10px 0;color:var(--text);font-weight:500"></div></div>
        <label class="field full">Reason / note<textarea name="reason" rows="2" placeholder="Why is this needed?">${esc(d.reason)}</textarea></label>
      </div></div>
      <div class="card"><div class="row between"><h2 style="margin:0">Items</h2><button type="button" class="btn small" id="addItem">${ic('plus')}Add item</button></div><div id="items"></div></div>
      <div class="card"><h2>Quotation / attachments</h2><div class="attach" id="att"></div><p class="muted" style="font-size:12px;margin:8px 0 0">Photos or PDF, up to ~5 MB each.</p></div>
      <div id="budgetBox"></div>
      <div class="actionbar">
        <div class="total grow"><small>Estimated total</small><b id="tot"></b> <span class="muted" id="totUsd"></span><div class="muted" style="font-size:12px" id="chain"></div></div>
        <button type="button" class="btn" id="saveDraft">Save draft</button>
        <button type="button" class="btn primary" id="submitPr">${ic('send')}Submit for approval</button>
      </div></form>`;
    const f = $('#prf');
    const cur = () => f.currency.value;
    const drawItems = () => {
      $('#items').innerHTML = items.map((it, i) => `<div class="item-row" data-i="${i}">
        <label class="field f-item">Item *<input data-k="item" value="${esc(it.item)}" placeholder="What to buy"></label>
        <label class="field">Qty<input data-k="qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(it.qty)}"></label>
        <label class="field">Unit<input data-k="unit" value="${esc(it.unit)}" placeholder="pc"></label>
        <label class="field">Unit price<input data-k="unitPrice" type="number" min="0" step="any" inputmode="decimal" value="${esc(it.unitPrice)}" placeholder="0.00"></label>
        <div class="amt" data-amt>${money((+it.qty || 0) * (+it.unitPrice || 0), cur())}</div>
        <button type="button" class="icon-btn" data-del="${i}" aria-label="Remove item" ${items.length < 2 ? 'disabled' : ''}>${ic('trash')}</button>
        <label class="field desc">Details (size, spec, suggested vendor)<input data-k="description" value="${esc(it.description)}"></label></div>`).join('');
    };
    const drawAtt = () => {
      $('#att').innerHTML = d.attachments.map((a, i) => `<span class="file">${ic('clip')}<a href="${esc(fileHref(a.url))}" target="_blank" rel="noopener" style="padding:0;background:none">${esc(a.name)}</a><button type="button" class="icon-btn" style="width:28px;height:28px" data-rm="${i}" aria-label="Remove ${esc(a.name)}">${ic('x')}</button></span>`).join('') +
        `<label class="add">${ic('clip')}Add photo / file<input type="file" id="fileIn" accept="image/*,application/pdf" multiple></label>`;
      $('#fileIn').onchange = async e => {
        for (const file of e.target.files) {
          if (file.size > 12e6) { toast(file.name + ' is too large', true); continue; }
          toast('Uploading ' + file.name + '…');
          const fb = await fileToB64(file);
          const r = await run(null, () => api('upload', { name: fb.name, mime: fb.mime, base64: fb.b64 }));
          if (r) { d.attachments.push(r); drawAtt(); }
        }
      };
    };
    const totals = () => {
      const total = items.reduce((s, it) => s + (+it.qty || 0) * (+it.unitPrice || 0), 0), rate = rateOf(cur()), u = total * rate;
      $('#tot').textContent = money(total, cur());
      $('#totUsd').textContent = cur() !== 'USD' ? '≈ ' + usd(u) : '';
      $('#rateTxt').textContent = cur() === 'USD' ? '1 USD = 1 USD' : `1 ${cur()} = ${rate} USD  (1 USD ≈ ${rate ? Math.round(1 / rate).toLocaleString() : '?'} ${cur()})`;
      $('#chain').textContent = 'Approval: ' + levelsFor(u).map(r => r.label).join(' → ');
      if (budget && budget.budgetUSD) {
        const after = budget.usedUSD + budget.committedUSD + u, pct = Math.round(after / budget.budgetUSD * 100);
        $('#budgetBox').innerHTML = `<div class="note ${pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok'}">Budget ${esc(deptName(budget.department))}: after this PR ${pct}% of ${usd(budget.budgetUSD)} (${pct > 100 ? 'over budget — approver will see this' : 'within budget'})</div>`;
      } else $('#budgetBox').innerHTML = '';
      items.forEach((it, i) => { const el = $(`#items [data-i="${i}"] [data-amt]`); if (el) el.textContent = money((+it.qty || 0) * (+it.unitPrice || 0), cur()); });
      if (!id) Store.set('prDraft', { d: { ...collect(), attachments: d.attachments }, items });
    };
    const collect = () => ({ id: d.id || '', title: f.title.value, department: f.department.value, neededBy: f.neededBy.value, currency: cur(), reason: f.reason.value, attachments: d.attachments });
    $('#items').addEventListener('input', e => { const row = e.target.closest('[data-i]'); if (!row) return; items[+row.dataset.i][e.target.dataset.k] = e.target.value; totals(); });
    $('#items').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b && items.length > 1) { items.splice(+b.dataset.del, 1); drawItems(); totals(); } });
    $('#att').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { d.attachments.splice(+b.dataset.rm, 1); drawAtt(); totals(); } });
    $('#addItem').onclick = () => { items.push({ item: '', description: '', qty: 1, unit: '', unitPrice: '' }); drawItems(); totals(); const r = $('#items').lastElementChild; if (r) r.querySelector('input').focus(); };
    f.addEventListener('input', e => { if (!e.target.closest('#items')) totals(); });
    f.department.onchange = async () => { budget = null; totals(); const b = await run(null, () => api('budget', { department: f.department.value })); if (b) { budget = b; totals(); } };
    const save = async (btn, submit) => {
      const r = await run(btn, () => api('savePR', { pr: collect(), items: items.filter(i => String(i.item).trim()), submit }));
      if (r) { Store.del('prDraft'); toast(submit ? 'Submitted for approval' : 'Draft saved'); await refresh(true, true); location.hash = '#' + r.pr.id; }
    };
    $('#saveDraft').onclick = e => save(e.currentTarget, false);
    $('#submitPr').onclick = e => save(e.currentTarget, true);
    drawItems(); drawAtt(); totals();
    if (!budget && d.department) { const b = await run(null, () => api('budget', { department: d.department })); if (b) { budget = b; totals(); } }
  }
  async function fileToB64(file) {
    if (/^image\//.test(file.type) && file.size > 700000 && window.createImageBitmap) {
      try {
        const img = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return { b64: c.toDataURL('image/jpeg', 0.82).split(',')[1], mime: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg' };
      } catch (e) { /* fall through */ }
    }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    return { b64: String(url).split(',')[1], mime: file.type || 'application/octet-stream', name: file.name };
  }

  // ---------- PR DETAIL ----------
  async function prDetail(id) {
    const r = await api('getPR', { id }), p = r.pr;
    $('#pageTitle').textContent = p.id;
    const hist = r.history;
    const last = a => hist.find(h => h.docId === p.id && h.action === a);
    const steps = [];
    const sub = p.submittedAt ? hist.find(h => h.docId === p.id && h.action === 'SUBMIT') : null;
    steps.push({ cls: p.submittedAt ? 'done' : 'now', t: p.submittedAt ? 'Submitted · ' + p.requesterName : 'Draft — not submitted yet', s: p.submittedAt ? fmtDT(p.submittedAt) : '' });
    r.levels.forEach(l => steps.push({ cls: l.done ? 'done' : l.current ? 'now' : '', t: l.label + (l.done ? ' · ' + l.by : l.current ? ' · waiting' : ''), s: l.done ? fmtDT(l.time) : l.current ? 'Waiting ' + ageTxt(ageDays(p.lastActionAt)) : '' }));
    if (['Returned', 'Rejected'].includes(p.status)) { const h = last(p.status === 'Returned' ? 'RETURN' : 'REJECT'); steps.push({ cls: 'bad', t: (p.status === 'Returned' ? 'Sent back by ' : 'Rejected by ') + (h ? h.user : ''), s: h ? '"' + h.details + '" · ' + fmtDT(h.time) : '' }); }
    if (!['Returned', 'Rejected', 'Cancelled'].includes(p.status)) steps.push({ cls: ['Ordered', 'Closed'].includes(p.status) ? 'done' : p.status === 'Approved' ? 'now' : '', t: 'Purchasing issues PO', s: r.pos.filter(x => x.status !== 'Cancelled').map(x => x.id + ' · ' + x.status).join(', ') || (p.status === 'Approved' ? 'Waiting ' + ageTxt(ageDays(p.approvedAt)) : '') });
    const ballIc = c => (c === 'done' ? ic('ok') : c === 'bad' ? ic('x') : '');
    const poById = Object.fromEntries(r.pos.map(x => [x.id, x]));
    V().innerHTML = `<div class="cols">
      <div class="wide stack">
        <div class="card"><div class="row between" style="align-items:flex-start"><div><div class="muted" style="font-size:12px">${esc(p.id)}</div><h2 style="font-size:18px;margin:2px 0 6px">${esc(p.title)}</h2></div>${prChip(p)}</div>
          <div class="grid3" style="margin-top:6px">
            <div class="kv"><span>Requested by</span><b>${esc(p.requesterName)}</b></div><div class="kv"><span>Department</span><b>${esc(deptName(p.department))}</b></div>
            <div class="kv"><span>Needed by</span><b>${fmtD(p.neededBy) || '—'}</b></div>
            <div class="kv"><span>Total</span><b style="font-size:16px">${money(p.totalAmount, p.currency)}</b></div>
            ${p.currency !== 'USD' ? `<div class="kv"><span>In USD (rate ${r.rateToUSD})</span><b>≈ ${usd(p.totalUSD)}</b></div>` : ''}
            <div class="kv"><span>Created</span><b>${fmtDT(p.createdAt)}</b></div></div>
          ${r.reason ? `<p style="margin:12px 0 0;white-space:pre-line">${esc(r.reason)}</p>` : ''}</div>
        <div class="card"><h2>Items (${r.items.length})</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th>PO</th></tr></thead><tbody>
          ${r.items.map(i => { const po = i.poId && poById[i.poId] && poById[i.poId].status !== 'Cancelled' ? poById[i.poId] : null; return `<tr><td><b>${esc(i.item)}</b>${i.description ? `<br><span class="muted" style="font-size:12px">${esc(i.description)}</span>` : ''}</td><td class="r">${esc(i.qty)} ${esc(i.unit)}</td><td class="r">${money(i.unitPrice, p.currency)}</td><td class="r"><b>${money(i.amount, p.currency)}</b></td><td>${po ? `<a href="#${esc(po.id)}">${esc(po.id)}</a>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
          </tbody><tfoot><tr><td colspan="3" class="r">Total</td><td class="r">${money(p.totalAmount, p.currency)}</td><td></td></tr></tfoot></table></div></div>
        ${r.attachments.length ? `<div class="card"><h2>Attachments</h2><div class="attach">${r.attachments.map(a => `<a href="${esc(fileHref(a.url))}" target="_blank" rel="noopener">${ic('clip')}${esc(a.name)}</a>`).join('')}</div></div>` : ''}
        ${r.pos.length ? `<div><div class="section-title"><h2>Purchase orders</h2></div>${listOrEmpty(r.pos, poCard, '')}</div>` : ''}
      </div>
      <div class="narrow stack">
        <div class="card"><h2>Approval</h2><div class="tl">${steps.map(s => `<div class="step"><span class="ball ${s.cls}">${ballIc(s.cls)}</span><div><b>${esc(s.t)}</b><span>${esc(s.s)}</span></div></div>`).join('')}</div></div>
        ${r.can.approve && r.budget && r.budget.budgetUSD ? `<div class="note ${r.budget.pct > 100 ? 'bad' : r.budget.pct > 85 ? 'warn' : 'ok'}">Department budget this month: ${r.budget.pct}% used incl. requests in approval (${usd(r.budget.usedUSD + r.budget.committedUSD)} of ${usd(r.budget.budgetUSD)})</div>` : ''}
        <div class="card"><h2>History</h2><div class="hist">${hist.map(h => `<div><b>${esc(h.user)}</b> · ${esc(h.action)}${h.docId !== p.id ? ' · ' + esc(h.docId) : ''}<br><span>${fmtDT(h.time)}${h.details ? ' · ' + esc(h.details) : ''}</span></div>`).join('') || '<span class="muted">No history</span>'}</div></div>
      </div></div>
      <div class="actionbar" id="prActs"></div>`;
    const a = [];
    if (r.can.approve) a.push('<div class="grow muted" style="font-size:13px">Your approval is needed</div><button class="btn danger" data-a="reject">Reject</button><button class="btn" data-a="return">Send back</button><button class="btn good" data-a="approve">' + ic('ok') + 'Approve</button>');
    if (r.can.edit) a.push(`<a class="btn" href="#edit-${esc(p.id)}">Edit</a>`);
    if (r.can.edit && p.status !== 'Pending Approval') a.push('<button class="btn primary" data-a="submit">' + ic('send') + 'Submit for approval</button>');
    if (r.can.createPO) a.push(`<a class="btn primary" href="#newpo-${esc(p.id)}">${ic('po')}Create PO</a>`);
    if (r.can.cancel) a.push('<button class="btn danger" data-a="cancel">Cancel PR</button>');
    if (!a.length) $('#prActs').remove(); else $('#prActs').innerHTML = a.join('');
    const acts = $('#prActs');
    if (acts) acts.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const act = b.dataset.a;
      if (act === 'submit') {
        const res = await run(b, () => api('savePR', { pr: { id: p.id, title: p.title, department: p.department, neededBy: p.neededBy, currency: p.currency, reason: r.reason, attachments: r.attachments }, items: r.items, submit: true }));
        if (res) { toast('Submitted for approval'); await refresh(true, true); route(); }
        return;
      }
      let comment = '';
      if (act === 'approve') comment = await ask('Approve ' + p.id + '?', { label: 'Comment (optional)', btn: 'Approve', cls: 'good', text: esc(p.title) + ' · <b>' + money(p.totalAmount, p.currency) + '</b>' });
      if (act === 'return') comment = await ask('Send back for changes', { label: 'What should be changed?', required: true, btn: 'Send back' });
      if (act === 'reject') comment = await ask('Reject ' + p.id, { label: 'Reason', required: true, btn: 'Reject', cls: 'danger' });
      if (act === 'cancel') comment = await ask('Cancel ' + p.id + '?', { label: 'Reason (optional)', btn: 'Cancel PR', cls: 'danger' });
      if (comment === null) return;
      const res = await run(b, () => api('prAction', { id: p.id, action: act, comment }));
      if (res) { toast({ approve: 'Approved', return: 'Sent back', reject: 'Rejected', cancel: 'Cancelled' }[act]); await refresh(true, true); route(); }
    };
  }

  // ---------- PO FORM ----------
  async function poForm({ prId, poId }) {
    let po = null;
    if (poId) { po = await api('getPO', { id: poId }); if (!po.can.edit) { location.hash = '#' + poId; return; } prId = po.po.prId; }
    const pr = await api('getPR', { id: prId });
    $('#pageTitle').textContent = poId ? 'Edit ' + poId : 'New PO · ' + prId;
    const livePO = Object.fromEntries(pr.pos.filter(x => x.status !== 'Cancelled').map(x => [x.id, x]));
    const onThis = po ? Object.fromEntries(po.items.map(i => [i.prLine, i])) : {};
    const lines = pr.items.filter(i => !i.poId || !livePO[i.poId] || i.poId === poId).map(i => {
      const t = onThis[i.line];
      return { prLine: i.line, item: i.item, unit: i.unit, prQty: i.qty, prPrice: i.unitPrice, include: po ? !!t : true, qty: t ? t.qty : i.qty, unitPrice: t ? t.unitPrice : null };
    });
    if (!lines.length) { V().innerHTML = '<div class="empty">All items of this PR are already on a PO.</div>'; return; }
    const st = S.boot.settings;
    const d = po ? { vendorCode: po.vendorCode, currency: po.po.currency, vatPct: po.vatPct, paymentTerms: po.paymentTerms, deliveryDate: po.po.deliveryDate, deliverTo: po.deliverTo, note: po.note }
      : { vendorCode: '', currency: pr.pr.currency, vatPct: st.defaultVatPct, paymentTerms: '', deliveryDate: pr.pr.neededBy || '', deliverTo: st.defaultDeliverTo || '', note: '' };
    const prRate = pr.rateToUSD;
    V().innerHTML = `<form id="pof" onsubmit="return false"><div class="cols">
      <div class="wide stack">
        <div class="note">From <a href="#${esc(prId)}">${esc(prId)}</a> · ${esc(pr.pr.title)} · ${esc(deptName(pr.pr.department))} · approved ${fmtD(pr.pr.approvedAt)}</div>
        <div class="card"><div class="grid3">
          <label class="field" style="grid-column:span 2">Vendor *<div class="row" style="flex-wrap:nowrap"><select name="vendorCode" style="flex:1"><option value="">— choose vendor —</option>${S.boot.vendors.map(v => `<option value="${esc(v.code)}" ${v.code === d.vendorCode ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select><button type="button" class="btn small" id="newVendor">+ New</button></div></label>
          <label class="field">Payment terms<input name="paymentTerms" value="${esc(d.paymentTerms)}" placeholder="e.g. Net 30"></label>
          <label class="field">Delivery date<input name="deliveryDate" type="date" value="${esc(d.deliveryDate)}"></label>
          <label class="field">Deliver to<input name="deliverTo" value="${esc(d.deliverTo)}"></label>
          <label class="field">Currency<select name="currency">${S.boot.currencies.map(c => `<option ${c.code === d.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
          <label class="field">VAT %<input name="vatPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${esc(d.vatPct)}"></label>
          <label class="field" style="grid-column:span 2">Note on PO<input name="note" value="${esc(d.note)}" placeholder="Optional"></label>
        </div></div>
        <div class="card"><h2>Items — final price from vendor</h2><div class="tbl-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th>Include</th><th>Item</th><th>Qty</th><th class="r">PR estimate</th><th>Unit price (<span class="curLbl"></span>)</th><th class="r">Amount</th></tr></thead><tbody id="poLines"></tbody></table></div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">Untick an item to leave it for another PO (e.g. a different vendor).</p></div>
      </div>
      <div class="narrow stack"><div class="card"><h2>Summary</h2>
        <div class="row between"><span class="muted">Subtotal</span><span id="sSub"></span></div>
        <div class="row between" style="margin-top:6px"><span class="muted">VAT <span id="sVatP"></span>%</span><span id="sVat"></span></div>
        <div class="row between" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:18px"><b>Total</b><b id="sTot"></b></div>
        <div class="muted" style="text-align:right;font-size:12px" id="sUsd"></div>
        <div id="sCmp" style="margin-top:10px"></div>
        <div class="stack" style="margin-top:12px;gap:8px"><button type="button" class="btn primary block" id="issue">${ic('po')}Issue PO</button><button type="button" class="btn block" id="draft">Save as draft</button></div>
      </div></div></div></form>`;
    const f = $('#pof');
    const cur = () => f.currency.value, rate = () => rateOf(cur());
    const defPrice = l => Math.round(l.prPrice * prRate / (rate() || 1) * 100) / 100;
    const drawLines = () => {
      document.querySelectorAll('.curLbl').forEach(x => { x.textContent = cur(); });
      $('#poLines').innerHTML = lines.map((l, i) => `<tr data-i="${i}">
        <td><input type="checkbox" data-k="include" ${l.include ? 'checked' : ''} aria-label="Include ${esc(l.item)}" style="width:20px;min-height:20px"></td>
        <td><b>${esc(l.item)}</b></td>
        <td><input data-k="qty" type="number" min="0" step="any" value="${esc(l.qty)}" style="width:80px"> ${esc(l.unit)}</td>
        <td class="r muted">${money(l.prPrice, pr.pr.currency)}</td>
        <td><input data-k="unitPrice" type="number" min="0" step="any" value="${esc(l.unitPrice === null ? defPrice(l) : l.unitPrice)}" style="width:120px"></td>
        <td class="r"><b data-amt></b></td></tr>`).join('');
    };
    const calc = () => {
      let sub = 0, base = 0;
      lines.forEach((l, i) => {
        const price = l.unitPrice === null ? defPrice(l) : +l.unitPrice || 0, amt = l.include ? (+l.qty || 0) * price : 0;
        sub += amt; if (l.include) base += l.prPrice * (+l.qty || 0) * prRate;
        const el = $(`#poLines tr[data-i="${i}"] [data-amt]`); if (el) el.textContent = l.include ? money(amt, cur()) : '—';
      });
      const vat = +f.vatPct.value || 0, vatAmt = sub * vat / 100, tot = sub + vatAmt, subUSD = sub * rate(), tol = st.poTolerancePct || 0;
      $('#sSub').textContent = money(sub, cur()); $('#sVatP').textContent = vat; $('#sVat').textContent = money(vatAmt, cur()); $('#sTot').textContent = money(tot, cur());
      $('#sUsd').textContent = cur() !== 'USD' ? '≈ ' + usd(tot * rate()) : '';
      const over = subUSD > base * (1 + tol / 100) + 0.01, diff = Math.abs(subUSD - base);
      $('#sCmp').innerHTML = `<div class="note ${over ? 'warn' : 'ok'}">${over ? `${usd(diff)} above the approved PR amount (before VAT) — needs Manager approval before it is issued.` : `${usd(diff)} ${subUSD < base ? 'below' : 'at'} the approved PR amount (before VAT) — no extra approval needed.`}</div>`;
      $('#issue').innerHTML = ic('po') + (over ? 'Submit for PO approval' : 'Issue PO');
    };
    $('#poLines').addEventListener('input', e => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; const l = lines[+tr.dataset.i], k = e.target.dataset.k; l[k] = k === 'include' ? e.target.checked : e.target.value; calc(); });
    f.currency.onchange = () => { lines.forEach(l => { l.unitPrice = null; }); drawLines(); calc(); };
    f.vatPct.oninput = calc;
    f.vendorCode.onchange = () => { const v = S.boot.vendors.find(x => x.code === f.vendorCode.value); if (v) { if (v.paymentTerms && !f.paymentTerms.value) f.paymentTerms.value = v.paymentTerms; } };
    $('#newVendor').onclick = () => vendorModal(null, v => { f.vendorCode.innerHTML = '<option value="">— choose vendor —</option>' + S.boot.vendors.map(x => `<option value="${esc(x.code)}">${esc(x.name)}</option>`).join(''); const nv = S.boot.vendors.find(x => x.name === v.name); if (nv) f.vendorCode.value = nv.code; f.vendorCode.onchange(); });
    const save = async (btn, issue) => {
      const items = lines.filter(l => l.include).map(l => ({ prLine: l.prLine, qty: +l.qty, unitPrice: l.unitPrice === null ? defPrice(l) : +l.unitPrice }));
      const payload = { po: { id: poId || '', prId, vendorCode: f.vendorCode.value, currency: cur(), vatPct: f.vatPct.value, paymentTerms: f.paymentTerms.value, deliveryDate: f.deliveryDate.value, deliverTo: f.deliverTo.value, note: f.note.value }, items, issue };
      const r = await run(btn, () => api('savePO', payload));
      if (r) { toast(issue ? (r.po.status === 'Issued' ? 'PO issued' : 'Sent for PO approval') : 'Draft saved'); await refresh(true, true); location.hash = '#' + r.po.id; }
    };
    $('#issue').onclick = e => save(e.currentTarget, true);
    $('#draft').onclick = e => save(e.currentTarget, false);
    drawLines(); calc();
  }

  // ---------- PO DETAIL ----------
  async function poDetail(id) {
    const r = await api('getPO', { id }), p = r.po;
    $('#pageTitle').textContent = p.id;
    const v = S.boot.vendors.find(x => x.code === r.vendorCode) || {};
    V().innerHTML = `<div class="cols"><div class="wide stack">
      <div class="card"><div class="row between" style="align-items:flex-start"><div><div class="muted" style="font-size:12px">${esc(p.id)} · from <a href="#${esc(p.prId)}">${esc(p.prId)}</a></div><h2 style="font-size:18px;margin:2px 0 6px">${esc(p.title)}</h2></div>${poChip(p)}</div>
        <div class="grid3" style="margin-top:6px">
          <div class="kv"><span>Vendor</span><b>${esc(p.vendorName)}</b></div><div class="kv"><span>Delivery date</span><b>${fmtD(p.deliveryDate) || '—'}</b></div>
          <div class="kv"><span>Deliver to</span><b>${esc(r.deliverTo) || '—'}</b></div><div class="kv"><span>Payment terms</span><b>${esc(r.paymentTerms) || '—'}</b></div>
          <div class="kv"><span>Department</span><b>${esc(deptName(p.department))}</b></div><div class="kv"><span>Created by</span><b>${esc(p.createdByName)}</b></div>
          <div class="kv"><span>Issued</span><b>${fmtDT(p.issuedAt) || '—'}</b></div>${v.phone || v.email ? `<div class="kv"><span>Vendor contact</span><b>${esc([v.contact, v.phone, v.email].filter(Boolean).join(' · '))}</b></div>` : ''}
        </div>${r.note ? `<p style="margin:12px 0 0">${esc(r.note)}</p>` : ''}</div>
      <div class="card"><h2>Items</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th class="r">Received</th></tr></thead><tbody>
        ${r.items.map(i => `<tr><td><b>${esc(i.item)}</b></td><td class="r">${esc(i.qty)} ${esc(i.unit)}</td><td class="r">${money(i.unitPrice, p.currency)}</td><td class="r">${money(i.amount, p.currency)}</td><td class="r">${i.receivedQty >= i.qty ? chip(i.receivedQty + ' / ' + i.qty, 'green') : i.receivedQty ? chip(i.receivedQty + ' / ' + i.qty, 'amber') : '<span class="muted">0 / ' + esc(i.qty) + '</span>'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(r.subtotal, p.currency)}</td><td></td></tr><tr><td colspan="3" class="r">VAT ${esc(r.vatPct)}%</td><td class="r">${money(r.vatAmount, p.currency)}</td><td></td></tr>
      <tr><td colspan="3" class="r" style="font-size:16px">Total</td><td class="r" style="font-size:16px">${money(p.total, p.currency)}</td><td class="muted" style="font-weight:400">${p.currency !== 'USD' ? '≈ ' + usd(p.totalUSD) : ''}</td></tr></tfoot></table></div></div>
    </div><div class="narrow stack">
      ${r.can.pdf ? `<div class="card"><h2>PO document</h2><div class="stack" style="gap:8px">${Api.demo ? '<button class="btn primary block" data-a="preview">' + ic('file') + 'View PO</button>' : (p.pdfUrl ? `<a class="btn primary block" href="${esc(p.pdfUrl)}" target="_blank" rel="noopener">${ic('file')}Open / download PDF</a>` : '<div class="note warn">PDF not created yet</div>')}${isBuyer() ? '<button class="btn block" data-a="pdf">Re-create PDF</button>' : ''}</div></div>` : ''}
      ${r.pr ? `<div><div class="section-title"><h2>Purchase request</h2></div>${prCard(r.pr)}</div>` : ''}
    </div></div><div class="actionbar" id="poActs"></div>`;
    const a = [];
    if (r.can.approve) a.push('<div class="grow muted" style="font-size:13px">This PO is above the approved PR amount</div><button class="btn danger" data-a="reject">Send back</button><button class="btn good" data-a="approve">' + ic('ok') + 'Approve PO</button>');
    if (r.can.edit) a.push(`<a class="btn primary" href="#editpo-${esc(p.id)}">Edit / issue</a>`);
    if (r.can.receive) a.push('<button class="btn primary" data-a="receive">' + ic('box') + 'Receive goods</button>');
    if (r.can.close) a.push('<button class="btn" data-a="close">Close PO</button>');
    if (r.can.cancel) a.push('<button class="btn danger" data-a="cancel">Cancel PO</button>');
    if (!a.length) $('#poActs').remove(); else $('#poActs').innerHTML = a.join('');
    V().onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b || !V().contains(b)) return;
      const act = b.dataset.a;
      if (act === 'preview') { openModal(p.id, `<iframe title="PO preview" srcdoc="${esc(Demo.poHtml(p.id))}"></iframe>`, '<span class="muted" style="margin-right:auto;font-size:12px">In the live app this is a PDF saved in Google Drive.</span>', true); return; }
      if (act === 'receive') { receiveModal(r); return; }
      let comment = '';
      if (act === 'approve') comment = await ask('Approve ' + p.id + '?', { label: 'Comment (optional)', btn: 'Approve & issue', cls: 'good' });
      if (act === 'reject') comment = await ask('Send PO back to Purchasing', { label: 'Reason', required: true, btn: 'Send back', cls: 'danger' });
      if (act === 'cancel') comment = await ask('Cancel ' + p.id + '?', { label: 'Reason (optional)', btn: 'Cancel PO', cls: 'danger', text: 'The PR items will become available for a new PO.' });
      if (act === 'close') comment = await ask('Close ' + p.id + '?', { label: 'Comment (optional)', btn: 'Close PO', text: p.status === 'Partially Received' ? 'Not everything was received. Close anyway?' : '' });
      if (comment === null) return;
      const res = await run(b, () => api('poAction', { id: p.id, action: act, comment }));
      if (res) { toast({ approve: 'PO approved & issued', reject: 'Sent back', cancel: 'PO cancelled', close: 'PO closed', pdf: 'PDF re-created' }[act]); await refresh(true, true); route(); }
    };
  }
  function receiveModal(r) {
    const open = r.items.filter(i => i.receivedQty < i.qty);
    openModal('Receive goods · ' + r.po.id, `<p class="muted" style="margin-top:0">Enter what arrived now. You can receive the rest later.</p>
      <table class="tbl"><thead><tr><th>Item</th><th class="r">Remaining</th><th>Received now</th></tr></thead><tbody>
      ${open.map(i => `<tr><td>${esc(i.item)}</td><td class="r">${i.qty - i.receivedQty} ${esc(i.unit)}</td><td><input type="number" min="0" step="any" data-line="${i.line}" value="${i.qty - i.receivedQty}" style="width:100px"></td></tr>`).join('')}
      </tbody></table><label class="field" style="margin-top:12px">Note (delivery note no., condition…)<input id="rcvNote"></label>`,
    '<button class="btn" id="rcvNo">Back</button><button class="btn primary" id="rcvYes">Confirm receipt</button>');
    $('#rcvNo').onclick = closeModal;
    $('#rcvYes').onclick = async e => {
      const lines = [...$('#mBody').querySelectorAll('[data-line]')].map(x => ({ line: +x.dataset.line, qty: +x.value || 0 })).filter(l => l.qty > 0);
      const res = await run(e.currentTarget, () => api('receive', { id: r.po.id, lines, note: $('#rcvNote').value }));
      if (res) { closeModal(); toast(res.po.status === 'Received' ? 'All goods received' : 'Partial receipt saved'); await refresh(true, true); route(); }
    };
  }

  // ---------- DASHBOARD ----------
  async function dashboard() {
    const d = await api('dashboard');
    const maxV = Math.max(1, ...d.vendors.map(v => v.usd));
    V().innerHTML = `<div class="stack">
      <div class="row between"><span class="muted">${esc(d.month)} · all amounts in USD</span></div>
      <div class="kpis">
        <div class="kpi"><span>Spend this month (POs issued)</span><b>${usd(d.kpis.spendUSD)}</b></div>
        <a class="kpi" href="#approvals"><span>PRs waiting approval</span><b style="color:#b45309">${d.kpis.pendingPR}</b></a>
        <a class="kpi" href="#board"><span>Approved · waiting PO</span><b style="color:var(--green)">${d.kpis.waitingPO}</b></a>
        <div class="kpi"><span>Avg. submit → approved</span><b>${d.kpis.avgApproveDays} days</b></div>
        <a class="kpi" href="#pos"><span>Late deliveries</span><b style="color:var(--red)">${d.kpis.latePO}</b></a>
      </div>
      <div class="cols">
        <div class="narrow card"><h2>Budget by department</h2><div class="stack" style="gap:12px">
          ${d.departments.map(b => { const u = b.budgetUSD ? Math.min(100, b.usedUSD / b.budgetUSD * 100) : 0, c = b.budgetUSD ? Math.min(100 - u, b.committedUSD / b.budgetUSD * 100) : 0; return `<div><div class="row between" style="font-size:13px"><span>${esc(b.name)}</span><b style="${b.pct > 85 ? 'color:#c2410c' : ''}">${b.pct}%</b></div><div class="bar stacked" style="margin-top:4px"><i style="width:${u}%" class="${b.pct > 85 ? 'warn' : ''}"></i><i class="ghost" style="width:${c}%"></i></div><div class="muted" style="font-size:11.5px;margin-top:2px">${usd(b.usedUSD)} spent · ${usd(b.committedUSD)} in approval · of ${usd(b.budgetUSD)}</div></div>`; }).join('')}
          <div class="muted" style="font-size:12px">Dark = spent (PO issued) · light = PRs in approval · orange above 85%</div></div></div>
        <div class="wide card"><h2>Waiting the longest</h2><div class="tbl-wrap"><table class="tbl" id="agingT"><thead><tr><th>Document</th><th>Title</th><th>Waiting on</th><th>Age</th><th class="r">USD</th></tr></thead><tbody>
          ${d.aging.map(a => `<tr class="click" data-id="${esc(a.docId)}"><td><b>${esc(a.docId)}</b></td><td>${esc(a.title)}</td><td>${esc(a.waitingOn)}</td><td>${chip(ageTxt(a.ageDays), a.ageDays >= 3 || a.kind === 'late' ? 'red' : a.ageDays >= 1 ? 'amber' : '')}</td><td class="r">${usd(a.amountUSD)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">Nothing waiting 🎉</td></tr>'}
        </tbody></table></div></div>
      </div>
      <div class="card"><h2>Spend by vendor · this month</h2>${d.vendors.length ? d.vendors.map(v => `<div style="margin-bottom:10px"><div class="row between" style="font-size:13px"><span>${esc(v.name)}</span><b>${usd(v.usd)}</b></div><div class="bar" style="margin-top:4px"><i style="width:${v.usd / maxV * 100}%"></i></div></div>`).join('') : '<div class="muted">No POs issued this month yet</div>'}</div>
    </div>`;
    $('#agingT').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#' + tr.dataset.id; };
  }

  // ---------- VENDORS & RATES ----------
  function vendorModal(v, after) {
    v = v || { code: '', name: '', contact: '', phone: '', email: '', address: '', taxId: '', paymentTerms: '', currency: 'USD' };
    openModal(v.code ? 'Edit vendor' : 'New vendor', `<form id="vf" class="grid2" onsubmit="return false">
      <label class="field full">Name *<input name="name" value="${esc(v.name)}"></label>
      <label class="field">Contact person<input name="contact" value="${esc(v.contact)}"></label><label class="field">Phone<input name="phone" value="${esc(v.phone)}"></label>
      <label class="field">Email<input name="email" type="email" value="${esc(v.email)}"></label><label class="field">Tax ID / VAT no.<input name="taxId" value="${esc(v.taxId)}"></label>
      <label class="field full">Address (printed on PO)<textarea name="address" rows="2">${esc(v.address)}</textarea></label>
      <label class="field">Payment terms<input name="paymentTerms" value="${esc(v.paymentTerms)}" placeholder="Net 30"></label>
      <label class="field">Usual currency<select name="currency">${S.boot.currencies.map(c => `<option ${c.code === v.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label></form>`,
    `${v.code ? '<button class="btn danger" id="vOff" style="margin-right:auto">Deactivate</button>' : ''}<button class="btn" id="vNo">Cancel</button><button class="btn primary" id="vYes">Save vendor</button>`);
    $('#vNo').onclick = closeModal;
    const save = async (btn, extra) => {
      const data = { code: v.code, ...Object.fromEntries(new FormData($('#vf')).entries()), ...extra };
      const list = await run(btn, () => api('saveVendor', { vendor: data }));
      if (list) { S.boot.vendors = list; closeModal(); toast('Vendor saved'); if (after) after(data); }
    };
    $('#vYes').onclick = e => save(e.currentTarget, {});
    if ($('#vOff')) $('#vOff').onclick = e => save(e.currentTarget, { active: false });
  }
  async function vendors() {
    V().innerHTML = `<div class="stack">
      <div class="card"><div class="row between"><h2 style="margin:0">Exchange rates to USD</h2><button class="btn small primary" id="saveRates">Save rates</button></div>
        <div class="grid3" style="margin-top:12px">${S.boot.currencies.map(c => `<label class="field">1 ${esc(c.code)} = ? USD<input data-cur="${esc(c.code)}" type="number" step="any" min="0" value="${esc(c.rateToUSD)}" ${c.code === 'USD' ? 'disabled' : ''}><span style="font-weight:400" data-inv="${esc(c.code)}"></span></label>`).join('')}</div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Used to convert PR / PO amounts to USD for approval limits and budgets. Each PR keeps the rate from the day it was saved.</p></div>
      <div class="card"><div class="row between"><h2 style="margin:0">Vendors (${S.boot.vendors.length})</h2><button class="btn small" id="addV">${ic('plus')}Add vendor</button></div>
        <div class="tbl-wrap" style="margin-top:8px"><table class="tbl" id="vt"><thead><tr><th>Name</th><th>Contact</th><th>Terms</th><th>Currency</th></tr></thead><tbody>
        ${S.boot.vendors.map(v => `<tr class="click" data-c="${esc(v.code)}"><td><b>${esc(v.name)}</b><br><span class="muted" style="font-size:12px">${esc(v.code)}</span></td><td>${esc([v.contact, v.phone].filter(Boolean).join(' · ')) || '—'}</td><td>${esc(v.paymentTerms) || '—'}</td><td>${esc(v.currency)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No vendors yet</td></tr>'}
        </tbody></table></div></div></div>`;
    const inv = () => document.querySelectorAll('[data-cur]').forEach(i => { const v = +i.value, s = document.querySelector(`[data-inv="${i.dataset.cur}"]`); if (s) s.textContent = v ? `1 USD ≈ ${(1 / v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${i.dataset.cur}` : ''; });
    V().oninput = e => { if (e.target.dataset.cur) inv(); };
    inv();
    $('#saveRates').onclick = async e => {
      const rates = {}; document.querySelectorAll('[data-cur]').forEach(i => { rates[i.dataset.cur] = i.value; });
      const list = await run(e.currentTarget, () => api('saveRates', { rates })); if (list) { S.boot.currencies = list; toast('Rates saved'); }
    };
    $('#addV').onclick = () => vendorModal(null, () => vendors());
    $('#vt').onclick = e => { const tr = e.target.closest('tr[data-c]'); if (tr) vendorModal(S.boot.vendors.find(v => v.code === tr.dataset.c), () => vendors()); };
  }

  // ---------- USERS (admin) ----------
  async function usersView() {
    const list = await api('listUsers');
    const roles = S.boot.roles, deps = S.boot.departments;
    const draw = users => {
      V().innerHTML = `<div class="stack"><div class="card"><h2>Users (${users.length})</h2><div class="tbl-wrap"><table class="tbl" style="min-width:760px"><thead><tr><th>User</th><th>Role</th><th>Department</th><th>Email (weekly summary)</th><th>Telegram</th><th>Active</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr data-u="${esc(u.username)}" style="${u.active ? '' : 'opacity:.5'}"><td><b>${esc(u.name)}</b><br><span class="muted" style="font-size:12px">${esc(u.username)} · last login ${esc(u.lastLogin ? fmtDT(u.lastLogin) : '—')}</span></td>
          <td><select data-f="role">${roles.map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
          <td><select data-f="department"><option value="">—</option>${deps.map(d => `<option value="${esc(d.code)}" ${d.code === u.department ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></td>
          <td><input data-f="email" type="email" value="${esc(u.email)}" placeholder="name@company.com"></td>
          <td>${u.telegramLinked ? chip('Linked', 'green') : '<span class="muted">—</span>'}</td>
          <td><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''} aria-label="Active" style="width:20px;min-height:20px"></td>
          <td data-pin><button class="btn small" data-resetpin>Reset PIN</button></td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Roles: <b>Requester</b> opens PRs · <b>DeptHead</b> approves step 1 for their department · <b>Manager</b> step 2 (≥ $500) and PO over-amount · <b>Executive</b> step 3 (≥ $5,000) · <b>Purchasing</b> issues POs · <b>Store</b> receives goods · <b>Admin</b> everything. Limits are in the ApprovalRules sheet.</p></div>
        <div class="card"><h2>Add user</h2><form id="nu" class="grid3" onsubmit="return false">
          <label class="field">Username (login)<input name="username" autocapitalize="none" placeholder="e.g. sokha"></label><label class="field">Display name<input name="name" placeholder="Sokha Chan"></label>
          <label class="field">Starting PIN (4-8 digits)<input name="pin" inputmode="numeric"></label>
          <label class="field">Role<select name="role">${roles.map(r => `<option>${r}</option>`).join('')}</select></label>
          <label class="field">Department<select name="department"><option value="">—</option>${deps.map(d => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}</select></label>
          <label class="field">Email<input name="email" type="email"></label>
          <div class="field full"><button class="btn primary" id="addU" style="justify-self:start">${ic('plus')}Add user</button></div></form></div></div>`;
      $('#addU').onclick = async e => { const r = await run(e.currentTarget, () => api('createUser', Object.fromEntries(new FormData($('#nu')).entries()))); if (r) { toast('User added — share the username and PIN with them'); draw(r); } };
    };
    draw(list);
    V().onchange = async e => {
      const tr = e.target.closest('tr[data-u]'); if (!tr || !e.target.dataset.f) return;
      const k = e.target.dataset.f, val = k === 'active' ? e.target.checked : e.target.value;
      const r = await run(null, () => api('updateUser', { username: tr.dataset.u, [k]: val }));
      if (r) { toast('Saved'); if (k === 'active') draw(r); } else usersView();
    };
    V().onclick = async e => {
      if (e.target.closest('[data-resetpin]')) { e.target.closest('[data-pin]').innerHTML = '<div class="row" style="flex-wrap:nowrap"><input data-newpin inputmode="numeric" placeholder="New PIN" style="width:100px"><button class="btn small primary" data-setpin>OK</button></div>'; return; }
      const sp = e.target.closest('[data-setpin]');
      if (sp) { const tr = sp.closest('tr'); const pin = tr.querySelector('[data-newpin]').value.trim(); const r = await run(sp, () => api('updateUser', { username: tr.dataset.u, pin })); if (r) { toast('PIN reset'); draw(r); } }
    };
  }

  // ---------- NOTIFICATIONS ----------
  const N_IC = { approval: ['clock', 'amber'], reminder: ['clock', 'red'], approved: ['ok', 'green'], topo: ['po', 'blue'], po: ['po', 'blue'], returned: ['back', 'red'], rejected: ['x', 'red'], received: ['box', 'green'] };
  const N_BG = { amber: '#fff2cc;color:#8a5a00', red: '#fde4e4;color:#b42318', green: '#e3f4ec;color:#1d7a52', blue: '#e3ecf8;color:#1f4f8a' };
  async function notifications() {
    const list = await api('notifications');
    const u = me(), pushOn = !!Store.get('pushToken');
    V().innerHTML = `<div class="cols"><div class="wide stack">
      <div class="row between"><h2 style="font-size:15px">Latest</h2>${list.some(n => !n.read) ? '<button class="btn small" id="readAll">Mark all read</button>' : ''}</div>
      ${list.length ? `<div class="list">${list.map(n => { const [i, c] = N_IC[n.type] || ['bell', 'blue']; return `<a class="notif ${n.read ? 'read' : ''}" href="#${esc(n.docId)}" data-id="${esc(n.id)}"><span class="ic" style="background:${N_BG[c]}">${ic(i)}</span><span class="tx"><span class="row between" style="gap:6px"><b>${esc(n.title)}</b><span class="muted" style="font-size:11px">${fmtDT(n.time)}</span></span><span>${esc(n.body)}</span></span>${n.read ? '' : '<span class="unread" aria-label="Unread"></span>'}</a>`; }).join('')}</div>` : '<div class="empty">No notifications yet</div>'}
    </div><div class="narrow stack"><div class="card"><h2>Get alerts outside the app</h2>
      <div class="setting"><div><b>Telegram</b><div class="muted" style="font-size:12px">Message with a button to open the PR</div></div><div id="tgBox">${u.telegramLinked ? chip('Linked', 'green') + ' <button class="btn small" id="tgUn">Unlink</button>' : '<button class="btn small primary" id="tgLink">Link Telegram</button>'}</div></div>
      <div class="setting"><div><b>Phone push</b><div class="muted" style="font-size:12px">${C.FIREBASE ? 'Pop-up on this device, even when the app is closed' : 'Not set up yet (Admin: SETUP.md Part E)'}</div></div>${C.FIREBASE ? (pushOn ? chip('On', 'green') + ' <button class="btn small" id="pushOff">Turn off</button>' : '<button class="btn small primary" id="pushOn">Turn on</button>') : ''}</div>
      <div class="setting"><div><b>Weekly email</b><div class="muted" style="font-size:12px">Every Monday 08:00 · ${u.email ? esc(u.email) : 'no email on your account — ask Admin'}</div></div>${u.email ? chip('On', 'green') : ''}</div>
    </div></div></div>`;
    if (list.some(n => !n.read)) { api('markRead', {}).then(() => { S.unread = 0; buildNav(); }).catch(() => {}); }
    if ($('#readAll')) $('#readAll').onclick = async () => { await run(null, () => api('markRead', {})); S.unread = 0; route(); };
    if ($('#tgLink')) $('#tgLink').onclick = async e => {
      const r = await run(e.currentTarget, () => api('telegramLink')); if (!r) return;
      $('#tgBox').innerHTML = `<div class="stack" style="gap:6px;align-items:flex-end"><a class="btn small primary" href="${esc(r.url)}" target="_blank" rel="noopener">1. Open Telegram → Start</a><button class="btn small" id="tgCheck">2. I pressed Start</button></div>`;
      $('#tgCheck').onclick = async ev => { const c = await run(ev.currentTarget, () => api('telegramCheck')); if (c && c.linked) { S.boot.user.telegramLinked = true; toast('Telegram linked ✅'); route(); } else if (c) toast('Not linked yet — press Start in Telegram, then try again', true); };
    };
    if ($('#tgUn')) $('#tgUn').onclick = async e => { const r = await run(e.currentTarget, () => api('telegramUnlink')); if (r) { S.boot.user.telegramLinked = false; route(); } };
    if ($('#pushOn')) $('#pushOn').onclick = e => run(e.currentTarget, enablePush).then(() => route());
    if ($('#pushOff')) $('#pushOff').onclick = async e => { const t = Store.get('pushToken'); await run(e.currentTarget, () => api('pushUnregister', { token: t })); Store.del('pushToken'); route(); };
  }
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const loadScript = src => new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  async function enablePush() {
    const F = C.FIREBASE;
    if (isIOS() && !standalone()) throw new Error('On iPhone: open this page in Safari → Share → Add to Home Screen, then open the app from the icon and turn on push there.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support push notifications');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked — allow them in your browser / phone settings');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
    if (!window.firebase.apps.length) window.firebase.initializeApp(F);
    const reg = await navigator.serviceWorker.ready;
    const token = await window.firebase.messaging().getToken({ vapidKey: F.vapidKey, serviceWorkerRegistration: reg });
    if (!token) throw new Error('Could not get a push token');
    await api('pushRegister', { token, device: navigator.userAgent.slice(0, 100) });
    Store.set('pushToken', token); toast('Push notifications are on for this device');
  }

  // ---------- MY ACCOUNT ----------
  async function account() {
    const u = me();
    const links = navItems().filter(([k]) => !['sep', 'home', 'me'].includes(k));
    V().innerHTML = `<div class="cols"><div class="wide stack">
      <div class="hero"><span class="avatar" style="background:${avColor(u.username)}">${initials(u.name)}</span><div><div class="big">${esc(u.name)}</div><div class="sub">${esc(u.username)} · ${esc(u.role)}${u.department ? ' · ' + esc(deptName(u.department)) : ''}</div></div></div>
      <div class="card only-mobile-block"><h2>Go to</h2><div class="list">${links.map(([k, l, i, c]) => `<a class="doc" href="#${k}" style="flex-direction:row;align-items:center;gap:12px">${ic(i)}<span class="t" style="flex:1">${l}</span>${c ? chip(c, 'red') : ''}</a>`).join('')}</div></div>
    </div><div class="narrow stack">
      <div class="card"><h2>Change my PIN</h2><form id="pinF" class="stack" style="gap:10px" onsubmit="return false">
        <label class="field">Current PIN<input name="o" type="password" inputmode="numeric" autocomplete="current-password"></label>
        <label class="field">New PIN (4-8 digits)<input name="n1" type="password" inputmode="numeric" autocomplete="new-password"></label>
        <label class="field">Repeat new PIN<input name="n2" type="password" inputmode="numeric" autocomplete="new-password"></label>
        <button class="btn primary" id="pinBtn">Change PIN</button></form></div>
      <div class="card"><h2>App</h2><div class="stack" style="gap:8px">
        ${S.installEvt ? '<button class="btn block" id="install">📲 Install app on this device</button>' : isIOS() && !standalone() ? '<div class="note">Install on iPhone: Safari → Share → <b>Add to Home Screen</b></div>' : ''}
        <a class="btn block" href="#notifications">${ic('bell')}Notification settings</a>
        ${Api.demo ? '<button class="btn block" id="resetDemo">♻️ Reset demo data</button>' : ''}
        <button class="btn danger block" id="logout">Sign out</button></div></div>
    </div></div>`;
    $('#pinBtn').onclick = async e => {
      const f = $('#pinF'); if (f.n1.value !== f.n2.value) { toast('New PINs do not match', true); return; }
      const r = await run(e.currentTarget, () => api('changePin', { oldPin: f.o.value, newPin: f.n1.value })); if (r) { f.reset(); toast('PIN changed'); }
    };
    $('#logout').onclick = logout;
    if ($('#install')) $('#install').onclick = () => { S.installEvt.prompt(); S.installEvt = null; route(); };
    if ($('#resetDemo')) $('#resetDemo').onclick = () => { Demo.reset(); Store.del('prDraft'); signOutLocal(); toast('Demo data reset'); };
  }

  // ---------- PWA ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* not available here */ }); });
  const st = document.createElement('style'); st.textContent = '@media (min-width:900px){.only-mobile-block{display:none}}'; document.head.appendChild(st);

  if (Store.get('token')) boot(); else showLogin();
})();
