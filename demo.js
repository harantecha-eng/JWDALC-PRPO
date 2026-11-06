// ===== DEMO backend: runs core.js in the browser with data in localStorage =====
const Demo = (() => {
  const KEY = 'prpo_demo_db_v1';
  let T = null, offsetMs = 0;
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ls = { get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }, set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } } };
  const save = () => ls.set(T);
  const S = v => (v === undefined || v === null ? '' : String(v));
  const db = {
    all: t => (T[t] = T[t] || []).map(r => ({ ...r })),
    insert: (t, o) => { const r = {}; Object.keys(o).forEach(k => { r[k] = S(o[k]); }); (T[t] = T[t] || []).push(r); },
    update: (t, f, p) => { let n = 0; (T[t] || []).forEach(r => { if (f({ ...r })) { Object.keys(p).forEach(k => { r[k] = S(p[k]); }); n++; } }); return n; },
    remove: (t, f) => { T[t] = (T[t] || []).filter(r => !f({ ...r })); },
  };
  function hash(p, s) { let h = 2166136261; const x = s + '|' + p; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return 'demo' + (h >>> 0).toString(16); }
  const files = {};
  const svc = {
    now: () => fmt(new Date(Date.now() + offsetMs)),
    uuid: () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(16).slice(2) + Date.now().toString(16)),
    hash,
    saveFile: (name, mime, b64) => { const id = 'f' + Math.random().toString(36).slice(2); files[id] = `data:${mime};base64,${b64}`; return 'demo-file:' + id; },
    makePdf: id => 'demo-pdf:' + id,
    telegram: () => {}, push: () => [], telegramUpdates: () => [],
  };
  let core = null;

  function seed() {
    T = {};
    Object.keys(PRPO.SEED).forEach(t => PRPO.SEED[t].forEach(r => db.insert(t, r)));
    db.update('Settings', r => r.key === 'companyName', { value: 'Demo Logistics Co., Ltd.' });
    db.update('Settings', r => r.key === 'companyAddress', { value: '[COMPANY ADDRESS]' });
    db.update('Settings', r => r.key === 'defaultDeliverTo', { value: 'Main DC — Gate 2' });
    const people = [
      ['admin', 'Administrator', 'Admin', 'AD', '1234'], ['sokha', 'Sokha Chan', 'Requester', 'WH', '1111'], ['dara', 'Dara Kim', 'DeptHead', 'WH', '2222'],
      ['vanna', 'Vanna Lim', 'Manager', '', '3333'], ['chan', 'Chan Sok', 'Executive', '', '4444'], ['mony', 'Mony Ros', 'Purchasing', '', '5555'],
      ['rith', 'Rith Meas', 'Store', '', '6666'], ['pisey', 'Pisey Long', 'DeptHead', 'TR', '7777'],
    ];
    people.forEach(([u, n, r, d, pin]) => db.insert('Users', { username: u, name: n, role: r, department: d, email: '', telegramChatId: '', pinHash: hash(pin, 's-' + u), salt: 's-' + u, active: 'TRUE', createdAt: svc.now(), lastLogin: '' }));
    core = PRPO.create(db, svc);
    const tok = {}; const as = u => { if (!tok[u]) tok[u] = core.handle('login', { username: u, pin: people.find(p => p[0] === u)[4] }).token; return (a, p) => core.handle(a, p, tok[u]); };
    const at = days => { offsetMs = -days * 86400000; };
    const B = as('mony');
    [['Siam Pack Supply', 'Net 30', 'THB'], ['Phnom Penh Industrial', 'Net 15', 'USD'], ['Mekong Safety Gear', 'COD', 'USD']].forEach(([n, t, c]) => B('saveVendor', { vendor: { name: n, paymentTerms: t, currency: c, address: '[VENDOR ADDRESS]' } }));
    const V = core.handle('bootstrap', {}, tok.mony).vendors.map(v => v.code);
    const S = as('sokha'), D = as('dara'), M = as('vanna'), R = as('rith');
    // 1) closed cycle
    at(12); let pr = S('savePR', { pr: { title: 'Safety shoes (12 pairs)', department: 'WH', currency: 'USD', reason: 'Replace worn shoes for picking team' }, items: [{ item: 'Safety shoes size 40-44', qty: 12, unit: 'pair', unitPrice: 45 }], submit: true }).pr.id;
    at(11); D('prAction', { id: pr, action: 'approve' }); M('prAction', { id: pr, action: 'approve', comment: 'OK' });
    at(10); let po = B('savePO', { po: { prId: pr, vendorCode: V[2], currency: 'USD', vatPct: 10, deliveryDate: svc.now().slice(0, 10), deliverTo: 'Main DC — Gate 2' }, items: [{ prLine: 1, qty: 12, unitPrice: 40 }], issue: true }).po.id;
    at(6); R('receive', { id: po, lines: [{ line: 1, qty: 12 }] });
    // 2) PO issued, late
    at(9); pr = S('savePR', { pr: { title: 'Pallet racking parts', department: 'WH', currency: 'USD' }, items: [{ item: 'Beam 2.7m', qty: 20, unit: 'pc', unitPrice: 85 }, { item: 'Safety pins', qty: 200, unit: 'pc', unitPrice: 0.5 }], submit: true }).pr.id;
    at(8); D('prAction', { id: pr, action: 'approve' }); M('prAction', { id: pr, action: 'approve' });
    at(7); po = B('savePO', { po: { prId: pr, vendorCode: V[1], currency: 'USD', vatPct: 10, deliveryDate: fmt(new Date(Date.now() - 2 * 86400000)).slice(0, 10), deliverTo: 'Main DC — Gate 2' }, items: [{ prLine: 1, qty: 20, unitPrice: 82 }, { prLine: 2, qty: 200, unitPrice: 0.5 }], issue: true }).po.id;
    // 3) approved, waiting for PO (THB)
    at(2); pr = S('savePR', { pr: { title: 'Thermometer probes', department: 'WH', currency: 'THB' }, items: [{ item: 'Probe thermometer', qty: 6, unit: 'pc', unitPrice: 1200 }], submit: true }).pr.id;
    at(1); D('prAction', { id: pr, action: 'approve' });
    // 4) waiting manager (2 levels)
    at(3); pr = S('savePR', { pr: { title: 'Forklift tyre replacement', department: 'WH', currency: 'USD', reason: 'Front tyres worn out on FL-03' }, items: [{ item: 'Solid tyre 6.50-10', qty: 2, unit: 'pc', unitPrice: 640 }], submit: true }).pr.id;
    at(3); D('prAction', { id: pr, action: 'approve' });
    // 5) waiting dept head (Dara) — visible as "Waiting for you" when logged in as dara
    at(1); S('savePR', { pr: { title: 'Stretch film & pallet labels', department: 'WH', currency: 'USD' }, items: [{ item: 'Stretch film 500mm', qty: 20, unit: 'roll', unitPrice: 12 }, { item: 'Pallet labels A6', qty: 10, unit: 'box', unitPrice: 15 }, { item: 'Marker pens', qty: 5, unit: 'box', unitPrice: 6 }], submit: true });
    // 6) draft (KHR)
    at(0); S('savePR', { pr: { title: 'Cleaning supplies', department: 'WH', currency: 'KHR' }, items: [{ item: 'Floor cleaner 5L', qty: 4, unit: 'can', unitPrice: 48000 }] });
    offsetMs = 0;
    db.remove('Sessions', () => true);
    save();
  }

  function init() {
    T = ls.get();
    if (!T || !T.Users) seed();
    core = PRPO.create(db, svc);
  }
  function handle(action, payload, token) {
    if (!core) init();
    const snapshot = JSON.stringify(T);
    try { const r = core.handle(action, payload, token); save(); return JSON.parse(JSON.stringify(r)); }
    catch (e) { T = JSON.parse(snapshot); throw e; } // roll back like a transaction
  }
  function poHtml(id) {
    if (!core) init();
    const po = T.PO.find(p => p.id === id); if (!po) return '';
    const st = {}; T.Settings.forEach(r => { st[r.key] = r.value; });
    return PRPO.poHtml(po, T.POItems.filter(i => i.poId === id), T.Vendors.find(v => v.code === po.vendorCode) || {}, st);
  }
  const fileUrl = u => (String(u).startsWith('demo-file:') ? files[u.slice(10)] || '' : u);
  return { handle, poHtml, fileUrl, reset: () => { localStorage.removeItem(KEY); T = null; core = null; } };
})();
