/**
 * PR/PO System — shared core logic
 * ---------------------------------
 * This exact file runs in two places:
 *   1) Google Apps Script (paste it as Core.gs) — the real backend
 *   2) The browser in DEMO mode (core.js) — so the demo behaves exactly like production
 * It never touches Sheets/Drive/Telegram directly: Code.gs (or demo.js) passes in
 *   db  = { all(table), insert(table, obj), update(table, matchFn, patch), remove(table, matchFn) }
 *   svc = { now(), uuid(), hash(pin, salt), saveFile(), makePdf(), telegram(), push(), telegramUpdates() }
 */
var PRPO = (function () {
  'use strict';

  var SCHEMA = {
    Users: ['username', 'name', 'role', 'department', 'email', 'telegramChatId', 'pinHash', 'salt', 'active', 'createdAt', 'lastLogin'],
    Departments: ['code', 'name', 'monthlyBudgetUSD', 'active'],
    Currencies: ['code', 'rateToUSD', 'updatedAt', 'updatedBy'],
    ApprovalRules: ['level', 'minUSD', 'approverRole', 'label'],
    Settings: ['key', 'value', 'note'],
    Vendors: ['code', 'name', 'contact', 'phone', 'email', 'address', 'taxId', 'paymentTerms', 'currency', 'active'],
    PR: ['id', 'title', 'requester', 'requesterName', 'department', 'neededBy', 'currency', 'rateToUSD', 'totalAmount', 'totalUSD',
      'status', 'requiredLevels', 'currentLevel', 'reason', 'attachments', 'createdAt', 'submittedAt', 'approvedAt',
      'lastActionAt', 'lastRemindedAt', 'updatedAt', 'updatedBy'],
    PRItems: ['prId', 'line', 'item', 'description', 'qty', 'unit', 'unitPrice', 'amount', 'poId'],
    PO: ['id', 'prId', 'title', 'vendorCode', 'vendorName', 'department', 'currency', 'rateToUSD', 'subtotal', 'vatPct', 'vatAmount',
      'total', 'totalUSD', 'paymentTerms', 'deliveryDate', 'deliverTo', 'note', 'status', 'createdBy', 'createdByName',
      'createdAt', 'issuedAt', 'updatedAt', 'pdfUrl'],
    POItems: ['poId', 'line', 'prLine', 'item', 'qty', 'unit', 'unitPrice', 'amount', 'receivedQty'],
    Log: ['time', 'user', 'action', 'docId', 'details'],
    Notifications: ['id', 'username', 'time', 'type', 'title', 'body', 'docId', 'read'],
    PushTokens: ['username', 'token', 'device', 'createdAt'],
    Sessions: ['token', 'username', 'exp'],
    Counters: ['key', 'value'],
    TelegramLinks: ['code', 'username', 'exp'],
  };

  var ROLES = ['Requester', 'DeptHead', 'Manager', 'Executive', 'Purchasing', 'Store', 'Admin'];
  var SEE_ALL = ['Manager', 'Executive', 'Purchasing', 'Store', 'Admin'];
  var PO_APPROVERS = ['Manager', 'Executive', 'Admin'];
  var PR_ST = { DRAFT: 'Draft', PENDING: 'Pending Approval', RETURNED: 'Returned', REJECTED: 'Rejected', APPROVED: 'Approved', ORDERED: 'Ordered', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
  var PO_ST = { DRAFT: 'Draft', PENDING: 'Pending Approval', ISSUED: 'Issued', PARTIAL: 'Partially Received', RECEIVED: 'Received', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
  var PO_LIVE = [PO_ST.ISSUED, PO_ST.PARTIAL, PO_ST.RECEIVED, PO_ST.CLOSED];
  var SESSION_DAYS = 14, MAX_FAILS = 5;

  // ---------- small helpers ----------
  function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function num(v) { var n = Number(str(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function bool(v) { return v === true || str(v).toUpperCase() === 'TRUE'; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function esc(v) { return str(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parseTs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):?(\d{2})?)?/.exec(str(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0;
  }
  function hoursBetween(a, b) { var x = parseTs(a), y = parseTs(b); return x && y ? (y - x) / 3600000 : 0; }
  function fail(msg) { throw new Error(msg); }
  function json(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function money(n, cur) { return (cur ? cur + ' ' : '') + r2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function create(db, svc) {
    function all(t) { return db.all(t); }
    function find(t, f) { var a = db.all(t); for (var i = 0; i < a.length; i++) if (f(a[i])) return a[i]; return null; }
    function now() { return svc.now(); }
    function today() { return now().slice(0, 10); }

    function settings() {
      var o = { companyName: '', companyAddress: '', companyTaxId: '', companyPhone: '', appUrl: '', telegramBotUsername: '',
        reminderHours: '48', poTolerancePct: '0', defaultVatPct: '10', defaultDeliverTo: '' };
      all('Settings').forEach(function (r) { if (r.key) o[r.key] = str(r.value); });
      return o;
    }
    function rates() { var o = {}; all('Currencies').forEach(function (c) { o[c.code] = num(c.rateToUSD); }); return o; }
    function rateOf(code) { var r = rates()[code]; if (!r) fail('Unknown currency: ' + code); return r; }
    function rules() {
      return all('ApprovalRules').map(function (r) { return { level: num(r.level), minUSD: num(r.minUSD), approverRole: str(r.approverRole), label: str(r.label) || str(r.approverRole) }; })
        .filter(function (r) { return r.level > 0; }).sort(function (a, b) { return a.level - b.level; });
    }
    function ruleOf(level) { var l = num(level); return rules().filter(function (r) { return r.level === l; })[0] || null; }
    function nextId(prefix) {
      var key = prefix + now().slice(2, 4) + now().slice(5, 7);
      var row = find('Counters', function (c) { return c.key === key; });
      var n = row ? num(row.value) + 1 : 1;
      if (row) db.update('Counters', function (c) { return c.key === key; }, { value: String(n) });
      else db.insert('Counters', { key: key, value: String(n) });
      return key + '-' + ('000' + n).slice(-4);
    }
    function log(user, action, docId, details) {
      db.insert('Log', { time: now(), user: user, action: action, docId: docId || '', details: str(details).slice(0, 4000) });
    }

    // ---------- users & sessions ----------
    function users() {
      return all('Users').map(function (u) {
        return { username: str(u.username).toLowerCase(), name: str(u.name) || str(u.username), role: str(u.role) || 'Requester',
          department: str(u.department), email: str(u.email), telegramChatId: str(u.telegramChatId),
          pinHash: str(u.pinHash), salt: str(u.salt), active: bool(u.active), lastLogin: str(u.lastLogin) };
      });
    }
    function userOf(un) { un = str(un).toLowerCase(); return users().filter(function (u) { return u.username === un; })[0] || null; }
    function pub(u) { return { username: u.username, name: u.name, role: u.role, department: u.department, email: u.email, telegramLinked: !!u.telegramChatId, active: u.active, lastLogin: u.lastLogin }; }
    function validPin(p) { p = str(p); if (!/^\d{4,8}$/.test(p)) fail('PIN must be 4-8 digits'); return p; }
    function is(u, roles) { return roles.indexOf(u.role) >= 0; }

    function login(p) {
      var un = str(p.username).toLowerCase(), pin = str(p.pin);
      if (!un || !pin) fail('Please enter username and PIN');
      if (svc.failCount && svc.failCount(un) >= MAX_FAILS) fail('Too many wrong attempts. Try again in 10 minutes.');
      var u = userOf(un);
      if (!u || !u.active || svc.hash(pin, u.salt) !== u.pinHash) { if (svc.addFail) svc.addFail(un); fail('Wrong username or PIN'); }
      if (svc.clearFail) svc.clearFail(un);
      var t = Date.now();
      db.remove('Sessions', function (s) { return num(s.exp) < t; });
      var token = svc.uuid() + svc.uuid().slice(0, 8);
      db.insert('Sessions', { token: token, username: un, exp: String(t + SESSION_DAYS * 86400000) });
      db.update('Users', function (x) { return str(x.username).toLowerCase() === un; }, { lastLogin: now() });
      return { token: token, user: pub(u) };
    }
    function session(token) {
      if (!token) fail('SESSION_EXPIRED');
      var s = find('Sessions', function (x) { return x.token === token; });
      if (!s || num(s.exp) < Date.now()) fail('SESSION_EXPIRED');
      var u = userOf(s.username);
      if (!u || !u.active) fail('SESSION_EXPIRED');
      return u;
    }

    // ---------- notifications ----------
    function notify(usernames, n) {
      var st = settings();
      var link = st.appUrl ? st.appUrl.replace(/#.*$/, '') + (n.docId ? '#' + n.docId : '') : '';
      uniq(usernames).forEach(function (un) {
        var u = userOf(un); if (!u || !u.active) return;
        db.insert('Notifications', { id: svc.uuid(), username: un, time: now(), type: n.type || '', title: n.title, body: n.body || '', docId: n.docId || '', read: 'FALSE' });
        try { if (u.telegramChatId && svc.telegram) svc.telegram(u.telegramChatId, n.title + '\n' + (n.body || ''), link); } catch (e) { /* keep going */ }
        try {
          var toks = all('PushTokens').filter(function (t) { return t.username === un; }).map(function (t) { return t.token; });
          if (toks.length && svc.push) {
            var bad = svc.push(toks, { title: n.title, body: n.body || '', url: link, tag: n.docId || '' }) || [];
            bad.forEach(function (b) { db.remove('PushTokens', function (t) { return t.token === b; }); });
          }
        } catch (e) { /* keep going */ }
      });
    }
    function byRole(roles, dept) {
      return users().filter(function (u) { return u.active && roles.indexOf(u.role) >= 0 && (!dept || u.department === dept); }).map(function (u) { return u.username; });
    }

    // ---------- PR helpers ----------
    function prOf(id) { var p = find('PR', function (x) { return x.id === id; }); if (!p) fail('PR not found: ' + id); return p; }
    function prItems(id) { return all('PRItems').filter(function (i) { return i.prId === id; }).sort(function (a, b) { return num(a.line) - num(b.line); }); }
    function poOf(id) { var p = find('PO', function (x) { return x.id === id; }); if (!p) fail('PO not found: ' + id); return p; }
    function poItems(id) { return all('POItems').filter(function (i) { return i.poId === id; }).sort(function (a, b) { return num(a.line) - num(b.line); }); }
    function activePoIds() { var o = {}; all('PO').forEach(function (p) { if (p.status !== PO_ST.CANCELLED) o[p.id] = p; }); return o; }

    function canSeePR(u, pr) { return is(u, SEE_ALL) || pr.requester === u.username || pr.department === u.department; }
    function approversFor(pr, level) {
      var rule = ruleOf(level); if (!rule) return byRole(['Admin']);
      var list = byRole([rule.approverRole], rule.approverRole === 'DeptHead' ? pr.department : '').filter(function (x) { return x !== pr.requester; });
      if (!list.length) list = byRole(['Admin']).filter(function (x) { return x !== pr.requester; });
      if (!list.length) list = byRole(['Admin']);
      return list;
    }
    function canApprovePR(u, pr) {
      if (pr.status !== PR_ST.PENDING) return false;
      if (u.role === 'Admin' && u.username !== pr.requester) return true;
      return approversFor(pr, pr.currentLevel).indexOf(u.username) >= 0;
    }
    function waitingOn(pr) {
      if (pr.status === PR_ST.PENDING) { var r = ruleOf(pr.currentLevel); return r ? r.label : 'Approver'; }
      if (pr.status === PR_ST.APPROVED) return 'Purchasing';
      if (pr.status === PR_ST.RETURNED) return 'Requester';
      if (pr.status === PR_ST.DRAFT) return 'Requester';
      return '';
    }
    function requiredLevels(totalUSD) {
      var lv = rules().filter(function (r) { return totalUSD >= r.minUSD; }).map(function (r) { return r.level; });
      return lv.length ? lv : [1];
    }
    function recomputePR(prId) {
      var pr = prOf(prId);
      if ([PR_ST.APPROVED, PR_ST.ORDERED, PR_ST.CLOSED].indexOf(pr.status) < 0) return;
      var live = activePoIds(), items = prItems(prId);
      var ordered = items.filter(function (i) { return i.poId && live[i.poId]; });
      var st = PR_ST.APPROVED;
      if (items.length && ordered.length === items.length) {
        var pos = uniq(ordered.map(function (i) { return i.poId; })).map(function (id) { return live[id]; });
        st = pos.every(function (p) { return p.status === PO_ST.CLOSED; }) ? PR_ST.CLOSED : PR_ST.ORDERED;
      }
      if (st !== pr.status) db.update('PR', function (x) { return x.id === prId; }, { status: st, updatedAt: now() });
    }

    function prRow(u, p) {
      return { id: p.id, title: p.title, requester: p.requester, requesterName: p.requesterName, department: p.department, neededBy: p.neededBy,
        currency: p.currency, totalAmount: num(p.totalAmount), totalUSD: num(p.totalUSD), status: p.status, currentLevel: p.currentLevel,
        waitingOn: waitingOn(p), createdAt: p.createdAt, submittedAt: p.submittedAt, approvedAt: p.approvedAt, lastActionAt: p.lastActionAt,
        canApprove: canApprovePR(u, p) };
    }
    function poRow(p) {
      var late = [PO_ST.ISSUED, PO_ST.PARTIAL].indexOf(p.status) >= 0 && p.deliveryDate && p.deliveryDate < today();
      return { id: p.id, prId: p.prId, title: p.title, vendorName: p.vendorName, department: p.department, currency: p.currency, total: num(p.total),
        totalUSD: num(p.totalUSD), status: p.status, deliveryDate: p.deliveryDate, issuedAt: p.issuedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
        createdByName: p.createdByName, pdfUrl: p.pdfUrl, late: !!late };
    }

    // ---------- budget ----------
    function budgetInfo(dept, month) {
      month = month || today().slice(0, 7);
      var d = find('Departments', function (x) { return x.code === dept; });
      var budget = d ? num(d.monthlyBudgetUSD) : 0;
      var used = 0, committed = 0, live = activePoIds();
      all('PO').forEach(function (p) { if (p.department === dept && PO_LIVE.indexOf(p.status) >= 0 && str(p.issuedAt).slice(0, 7) === month) used += num(p.totalUSD); });
      var prs = {}; all('PR').forEach(function (p) { prs[p.id] = p; });
      all('PRItems').forEach(function (i) {
        var p = prs[i.prId];
        if (!p || p.department !== dept || [PR_ST.PENDING, PR_ST.APPROVED, PR_ST.ORDERED].indexOf(p.status) < 0) return;
        if (str(p.submittedAt).slice(0, 7) !== month) return;
        var po = i.poId && live[i.poId];
        if (!po || po.status === PO_ST.DRAFT || po.status === PO_ST.PENDING) committed += num(i.amount) * num(p.rateToUSD);
      });
      return { department: dept, month: month, budgetUSD: r2(budget), usedUSD: r2(used), committedUSD: r2(committed),
        pct: budget ? Math.round((used + committed) / budget * 100) : 0 };
    }

    // ---------- actions ----------
    function bootstrap(u) {
      var st = settings();
      return {
        user: pub(u), roles: ROLES, serverTime: now(),
        settings: { companyName: st.companyName, telegramBotUsername: st.telegramBotUsername, defaultVatPct: num(st.defaultVatPct), poTolerancePct: num(st.poTolerancePct), defaultDeliverTo: st.defaultDeliverTo },
        departments: all('Departments').filter(function (d) { return d.active === '' || bool(d.active); }).map(function (d) { return { code: d.code, name: d.name || d.code, monthlyBudgetUSD: num(d.monthlyBudgetUSD) }; }),
        currencies: all('Currencies').map(function (c) { return { code: c.code, rateToUSD: num(c.rateToUSD), updatedAt: c.updatedAt }; }),
        rules: rules(),
        vendors: all('Vendors').filter(function (v) { return v.active === '' || bool(v.active); }).map(function (v) {
          return { code: v.code, name: v.name, contact: v.contact, phone: v.phone, email: v.email, address: v.address, taxId: v.taxId, paymentTerms: v.paymentTerms, currency: v.currency }; }),
        people: users().filter(function (x) { return x.active; }).map(function (x) { return { username: x.username, name: x.name, role: x.role, department: x.department }; }),
        budget: u.department ? budgetInfo(u.department) : null,
        unread: all('Notifications').filter(function (n) { return n.username === u.username && !bool(n.read); }).length,
      };
    }

    function listDocs(u) {
      var prs = all('PR').filter(function (p) { return canSeePR(u, p); });
      var seen = {}; prs.forEach(function (p) { seen[p.id] = 1; });
      var pos = all('PO').filter(function (p) { return is(u, SEE_ALL) || seen[p.prId]; });
      return { prs: prs.map(function (p) { return prRow(u, p); }), pos: pos.map(poRow), serverTime: now(),
        unread: all('Notifications').filter(function (n) { return n.username === u.username && !bool(n.read); }).length,
        budget: u.department ? budgetInfo(u.department) : null };
    }

    function getPR(u, p) {
      var pr = prOf(p.id);
      if (!canSeePR(u, pr)) fail('You cannot view this PR');
      var items = prItems(pr.id).map(function (i) { return { line: num(i.line), item: i.item, description: i.description, qty: num(i.qty), unit: i.unit, unitPrice: num(i.unitPrice), amount: num(i.amount), poId: i.poId }; });
      var pos = all('PO').filter(function (x) { return x.prId === pr.id; }).map(poRow);
      var docIds = [pr.id].concat(pos.map(function (x) { return x.id; }));
      var names = {}; users().forEach(function (x) { names[x.username] = x.name; });
      var history = all('Log').filter(function (l) { return docIds.indexOf(l.docId) >= 0; }).map(function (l) { return { time: l.time, user: names[l.user] || l.user, action: l.action, docId: l.docId, details: l.details }; }).reverse();
      var levels = str(pr.requiredLevels).split(',').filter(Boolean).map(function (lv) {
        var r = ruleOf(lv), done = history.filter(function (h) { return h.docId === pr.id && h.action === 'APPROVE L' + lv && h.time >= str(pr.submittedAt); })[0];
        return { level: num(lv), label: r ? r.label : 'Level ' + lv, done: !!done && pr.status !== PR_ST.DRAFT, by: done ? done.user : '', time: done ? done.time : '',
          current: pr.status === PR_ST.PENDING && str(pr.currentLevel) === str(lv) };
      });
      var live = activePoIds();
      var isOwner = pr.requester === u.username || u.role === 'Admin';
      return {
        pr: prRow(u, pr), reason: pr.reason, rateToUSD: num(pr.rateToUSD), attachments: json(pr.attachments, []), items: items, pos: pos, history: history, levels: levels,
        budget: budgetInfo(pr.department),
        can: {
          edit: isOwner && [PR_ST.DRAFT, PR_ST.RETURNED].indexOf(pr.status) >= 0,
          approve: canApprovePR(u, pr),
          cancel: isOwner && [PR_ST.DRAFT, PR_ST.RETURNED, PR_ST.PENDING, PR_ST.APPROVED].indexOf(pr.status) >= 0 && !prItems(pr.id).some(function (i) { return i.poId && live[i.poId]; }),
          createPO: is(u, ['Purchasing', 'Admin']) && [PR_ST.APPROVED, PR_ST.ORDERED].indexOf(pr.status) >= 0 && items.some(function (i) { return !(i.poId && live[i.poId]); }),
        },
      };
    }

    function savePR(u, p) {
      var d = p.pr || {}, items = (p.items || []).filter(function (i) { return str(i.item); });
      if (!str(d.title)) fail('Title is required');
      if (!items.length) fail('Add at least one item');
      var dept = str(d.department) || u.department;
      if (!find('Departments', function (x) { return x.code === dept; })) fail('Please choose a department');
      if (!is(u, SEE_ALL) && dept !== u.department) fail('You can only request for your own department');
      var cur = str(d.currency) || 'USD', rate = rateOf(cur);
      var lines = items.map(function (i, k) {
        var qty = num(i.qty), price = num(i.unitPrice);
        if (qty <= 0) fail('Quantity must be more than 0 (' + i.item + ')');
        if (price < 0) fail('Price cannot be negative');
        return { line: k + 1, item: str(i.item), description: str(i.description), qty: qty, unit: str(i.unit), unitPrice: price, amount: r2(qty * price) };
      });
      var total = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0));
      var t = now(), id = str(d.id), row = {
        title: str(d.title), department: dept, neededBy: str(d.neededBy), currency: cur, rateToUSD: String(rate), totalAmount: String(total),
        totalUSD: String(r2(total * rate)), reason: str(d.reason), attachments: JSON.stringify(d.attachments || []), updatedAt: t, updatedBy: u.name,
      };
      if (!id) {
        id = nextId('PR');
        row.id = id; row.requester = u.username; row.requesterName = u.name; row.status = PR_ST.DRAFT; row.createdAt = t; row.lastActionAt = t;
        db.insert('PR', row); log(u.username, 'CREATE', id, row.title);
      } else {
        var cur0 = prOf(id);
        if (cur0.requester !== u.username && u.role !== 'Admin') fail('Only the requester can edit this PR');
        if ([PR_ST.DRAFT, PR_ST.RETURNED].indexOf(cur0.status) < 0) fail('This PR can no longer be edited (' + cur0.status + ')');
        db.update('PR', function (x) { return x.id === id; }, row); log(u.username, 'EDIT', id, 'Total ' + money(total, cur));
      }
      db.remove('PRItems', function (x) { return x.prId === id; });
      lines.forEach(function (l) { db.insert('PRItems', { prId: id, line: String(l.line), item: l.item, description: l.description, qty: String(l.qty), unit: l.unit, unitPrice: String(l.unitPrice), amount: String(l.amount), poId: '' }); });

      if (p.submit) {
        var usd = r2(total * rate), lv = requiredLevels(usd);
        db.update('PR', function (x) { return x.id === id; }, { status: PR_ST.PENDING, requiredLevels: lv.join(','), currentLevel: String(lv[0]), submittedAt: t, lastActionAt: t, lastRemindedAt: '' });
        log(u.username, 'SUBMIT', id, money(total, cur) + ' (USD ' + r2(usd) + ') → ' + lv.map(function (x) { var r = ruleOf(x); return r ? r.label : x; }).join(' → '));
        var pr = prOf(id);
        notify(approversFor(pr, lv[0]), { type: 'approval', title: 'Approval needed: ' + id, body: pr.title + ' · ' + money(total, cur) + ' from ' + u.name, docId: id });
      }
      return getPR(u, { id: id });
    }

    function prAction(u, p) {
      var pr = prOf(p.id), act = str(p.action), comment = str(p.comment), t = now();
      if (act === 'approve' || act === 'return' || act === 'reject') {
        if (!canApprovePR(u, pr)) fail('You are not the approver for this step');
        if (act !== 'approve' && !comment) fail('Please write a reason');
      }
      if (act === 'approve') {
        var lv = str(pr.requiredLevels).split(','), idx = lv.indexOf(str(pr.currentLevel));
        log(u.username, 'APPROVE L' + pr.currentLevel, pr.id, comment);
        if (idx >= 0 && idx < lv.length - 1) {
          db.update('PR', function (x) { return x.id === pr.id; }, { currentLevel: lv[idx + 1], lastActionAt: t, lastRemindedAt: '' });
          var pr2 = prOf(pr.id);
          notify(approversFor(pr2, lv[idx + 1]), { type: 'approval', title: 'Approval needed: ' + pr.id, body: pr.title + ' · ' + money(pr.totalAmount, pr.currency) + ' from ' + pr.requesterName, docId: pr.id });
        } else {
          db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.APPROVED, currentLevel: '', approvedAt: t, lastActionAt: t });
          notify([pr.requester], { type: 'approved', title: 'PR approved: ' + pr.id, body: pr.title + ' was approved. Purchasing will issue the PO.', docId: pr.id });
          notify(byRole(['Purchasing']), { type: 'topo', title: 'Ready for PO: ' + pr.id, body: pr.title + ' · ' + money(pr.totalAmount, pr.currency) + ' · ' + pr.department, docId: pr.id });
        }
      } else if (act === 'return') {
        db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.RETURNED, currentLevel: '', lastActionAt: t });
        log(u.username, 'RETURN', pr.id, comment);
        notify([pr.requester], { type: 'returned', title: 'Sent back: ' + pr.id, body: '"' + comment + '" — ' + u.name, docId: pr.id });
      } else if (act === 'reject') {
        db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.REJECTED, currentLevel: '', lastActionAt: t });
        log(u.username, 'REJECT', pr.id, comment);
        notify([pr.requester], { type: 'rejected', title: 'Rejected: ' + pr.id, body: '"' + comment + '" — ' + u.name, docId: pr.id });
      } else if (act === 'cancel') {
        var info = getPR(u, { id: pr.id });
        if (!info.can.cancel) fail('This PR cannot be cancelled');
        db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.CANCELLED, currentLevel: '', lastActionAt: t });
        log(u.username, 'CANCEL', pr.id, comment);
      } else fail('Unknown action');
      return getPR(u, { id: pr.id });
    }

    // ---------- PO ----------
    function getPO(u, p) {
      var po = poOf(p.id), pr = find('PR', function (x) { return x.id === po.prId; });
      if (!is(u, SEE_ALL) && !(pr && canSeePR(u, pr))) fail('You cannot view this PO');
      var buyer = is(u, ['Purchasing', 'Admin']);
      var anyRecv = poItems(po.id).some(function (i) { return num(i.receivedQty) > 0; });
      return {
        po: poRow(po), vendorCode: po.vendorCode, rateToUSD: num(po.rateToUSD), subtotal: num(po.subtotal), vatPct: num(po.vatPct), vatAmount: num(po.vatAmount),
        paymentTerms: po.paymentTerms, deliverTo: po.deliverTo, note: po.note, createdBy: po.createdBy,
        items: poItems(po.id).map(function (i) { return { line: num(i.line), prLine: num(i.prLine), item: i.item, qty: num(i.qty), unit: i.unit, unitPrice: num(i.unitPrice), amount: num(i.amount), receivedQty: num(i.receivedQty) }; }),
        pr: pr ? prRow(u, pr) : null,
        can: {
          edit: buyer && po.status === PO_ST.DRAFT,
          approve: po.status === PO_ST.PENDING && is(u, PO_APPROVERS) && u.username !== po.createdBy,
          receive: is(u, ['Store', 'Purchasing', 'Admin']) && [PO_ST.ISSUED, PO_ST.PARTIAL].indexOf(po.status) >= 0,
          close: buyer && [PO_ST.RECEIVED, PO_ST.PARTIAL].indexOf(po.status) >= 0,
          cancel: buyer && [PO_ST.DRAFT, PO_ST.PENDING, PO_ST.ISSUED].indexOf(po.status) >= 0 && !anyRecv,
          pdf: PO_LIVE.indexOf(po.status) >= 0,
        },
      };
    }

    function savePO(u, p) {
      if (!is(u, ['Purchasing', 'Admin'])) fail('Only Purchasing can create POs');
      var d = p.po || {}, sel = (p.items || []).filter(function (i) { return i.include !== false; });
      var id = str(d.id), existing = id ? poOf(id) : null;
      if (existing && existing.status !== PO_ST.DRAFT) fail('Only draft POs can be edited');
      var prId = existing ? existing.prId : str(d.prId), pr = prOf(prId);
      if ([PR_ST.APPROVED, PR_ST.ORDERED].indexOf(pr.status) < 0) fail('PR must be approved first');
      var vendor = find('Vendors', function (v) { return v.code === str(d.vendorCode); });
      if (!vendor) fail('Please choose a vendor');
      if (!sel.length) fail('Choose at least one item');
      var cur = str(d.currency) || pr.currency, rate = rateOf(cur), vat = num(d.vatPct);
      if (vat < 0 || vat > 100) fail('VAT % must be between 0 and 100');
      var live = activePoIds(), prLines = {}; prItems(prId).forEach(function (i) { prLines[num(i.line)] = i; });
      var lines = sel.map(function (s, k) {
        var pl = prLines[num(s.prLine)]; if (!pl) fail('PR line not found');
        if (pl.poId && live[pl.poId] && pl.poId !== id) fail('"' + pl.item + '" is already on ' + pl.poId);
        var qty = num(s.qty) || num(pl.qty), price = num(s.unitPrice);
        if (qty <= 0 || price < 0) fail('Check qty / price for ' + pl.item);
        return { line: k + 1, prLine: num(pl.line), item: str(s.item) || pl.item, qty: qty, unit: pl.unit, unitPrice: price, amount: r2(qty * price) };
      });
      var sub = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0)), vatAmt = r2(sub * vat / 100), total = r2(sub + vatAmt), t = now();
      var row = { vendorCode: vendor.code, vendorName: vendor.name, currency: cur, rateToUSD: String(rate), subtotal: String(sub), vatPct: String(vat),
        vatAmount: String(vatAmt), total: String(total), totalUSD: String(r2(total * rate)), paymentTerms: str(d.paymentTerms) || vendor.paymentTerms,
        deliveryDate: str(d.deliveryDate), deliverTo: str(d.deliverTo), note: str(d.note), updatedAt: t };
      if (!existing) {
        id = nextId('PO');
        row.id = id; row.prId = prId; row.title = pr.title; row.department = pr.department; row.status = PO_ST.DRAFT;
        row.createdBy = u.username; row.createdByName = u.name; row.createdAt = t; row.issuedAt = ''; row.pdfUrl = '';
        db.insert('PO', row); log(u.username, 'PO CREATE', id, vendor.name + ' · ' + money(total, cur));
      } else {
        db.update('PO', function (x) { return x.id === id; }, row); log(u.username, 'PO EDIT', id, money(total, cur));
      }
      db.remove('POItems', function (x) { return x.poId === id; });
      db.update('PRItems', function (x) { return x.prId === prId && x.poId === id; }, { poId: '' });
      lines.forEach(function (l) {
        db.insert('POItems', { poId: id, line: String(l.line), prLine: String(l.prLine), item: l.item, qty: String(l.qty), unit: l.unit, unitPrice: String(l.unitPrice), amount: String(l.amount), receivedQty: '0' });
        db.update('PRItems', function (x) { return x.prId === prId && num(x.line) === l.prLine; }, { poId: id });
      });
      recomputePR(prId);

      if (p.issue) {
        var base = lines.reduce(function (s, l) { var pl = prLines[l.prLine]; return s + num(pl.amount) / num(pl.qty) * l.qty; }, 0) * num(pr.rateToUSD);
        var tol = num(settings().poTolerancePct), subUSD = sub * rate;
        if (subUSD > base * (1 + tol / 100) + 0.01) {
          db.update('PO', function (x) { return x.id === id; }, { status: PO_ST.PENDING, updatedAt: t });
          log(u.username, 'PO SUBMIT', id, 'Above approved PR amount: USD ' + r2(subUSD) + ' vs ' + r2(base));
          notify(byRole(PO_APPROVERS).filter(function (x) { return x !== u.username; }), { type: 'approval', title: 'PO approval needed: ' + id, body: pr.title + ' · ' + money(total, cur) + ' is above the approved PR amount', docId: id });
        } else issuePO(u, id);
      }
      return getPO(u, { id: id });
    }

    function issuePO(u, id) {
      var t = now();
      db.update('PO', function (x) { return x.id === id; }, { status: PO_ST.ISSUED, issuedAt: t, updatedAt: t });
      log(u.username, 'PO ISSUE', id, '');
      try {
        var url = makePdf(id);
        if (url) db.update('PO', function (x) { return x.id === id; }, { pdfUrl: url });
      } catch (e) { log(u.username, 'PDF ERROR', id, e.message); }
      var po = poOf(id), pr = prOf(po.prId);
      recomputePR(pr.id);
      notify([pr.requester], { type: 'po', title: 'PO issued: ' + id, body: pr.title + ' · ' + po.vendorName + (po.deliveryDate ? ' · delivery ' + po.deliveryDate : ''), docId: id });
      notify(byRole(['Store']), { type: 'po', title: 'Incoming: ' + id, body: po.vendorName + ' · ' + pr.title + (po.deliveryDate ? ' · ' + po.deliveryDate : ''), docId: id });
    }

    function makePdf(id) {
      if (!svc.makePdf) return '';
      var po = poOf(id), v = find('Vendors', function (x) { return x.code === po.vendorCode; }) || {};
      return svc.makePdf(id, poHtml(po, poItems(id), v, settings()));
    }

    function poAction(u, p) {
      var po = poOf(p.id), act = str(p.action), comment = str(p.comment), info = getPO(u, { id: po.id }), t = now();
      if (act === 'approve') {
        if (!info.can.approve) fail('You cannot approve this PO');
        log(u.username, 'PO APPROVE', po.id, comment); issuePO(u, po.id);
      } else if (act === 'reject') {
        if (!info.can.approve) fail('You cannot reject this PO');
        if (!comment) fail('Please write a reason');
        db.update('PO', function (x) { return x.id === po.id; }, { status: PO_ST.DRAFT, updatedAt: t });
        log(u.username, 'PO REJECT', po.id, comment);
        notify([po.createdBy], { type: 'returned', title: 'PO sent back: ' + po.id, body: '"' + comment + '" — ' + u.name, docId: po.id });
      } else if (act === 'cancel') {
        if (!info.can.cancel) fail('This PO cannot be cancelled');
        db.update('PO', function (x) { return x.id === po.id; }, { status: PO_ST.CANCELLED, updatedAt: t });
        db.update('PRItems', function (x) { return x.poId === po.id; }, { poId: '' });
        log(u.username, 'PO CANCEL', po.id, comment); recomputePR(po.prId);
      } else if (act === 'close') {
        if (!info.can.close) fail('This PO cannot be closed yet');
        db.update('PO', function (x) { return x.id === po.id; }, { status: PO_ST.CLOSED, updatedAt: t });
        log(u.username, 'PO CLOSE', po.id, comment); recomputePR(po.prId);
      } else if (act === 'pdf') {
        if (!info.can.pdf) fail('PDF is available after the PO is issued');
        var url = makePdf(po.id);
        db.update('PO', function (x) { return x.id === po.id; }, { pdfUrl: url });
      } else fail('Unknown action');
      return getPO(u, { id: po.id });
    }

    function receive(u, p) {
      var po = poOf(p.id), info = getPO(u, { id: po.id });
      if (!info.can.receive) fail('You cannot receive this PO');
      var items = poItems(po.id), got = [];
      (p.lines || []).forEach(function (l) {
        var it = items.filter(function (i) { return num(i.line) === num(l.line); })[0], q = num(l.qty);
        if (!it || q <= 0) return;
        var nr = Math.min(num(it.qty), num(it.receivedQty) + q);
        db.update('POItems', function (x) { return x.poId === po.id && num(x.line) === num(l.line); }, { receivedQty: String(nr) });
        got.push(it.item + ' +' + q);
      });
      if (!got.length) fail('Enter the quantity received');
      var after = poItems(po.id), full = after.every(function (i) { return num(i.receivedQty) >= num(i.qty); });
      var st = full ? PO_ST.RECEIVED : PO_ST.PARTIAL;
      db.update('PO', function (x) { return x.id === po.id; }, { status: st, updatedAt: now() });
      log(u.username, 'RECEIVE', po.id, got.join(', ') + (p.note ? ' · ' + str(p.note) : ''));
      var pr = find('PR', function (x) { return x.id === po.prId; });
      notify(uniq([pr ? pr.requester : ''].concat(byRole(['Purchasing']))).filter(function (x) { return x !== u.username; }),
        { type: 'received', title: (full ? 'Goods received: ' : 'Partly received: ') + po.id, body: got.join(', '), docId: po.id });
      return getPO(u, { id: po.id });
    }

    // ---------- notifications / profile ----------
    function myNotifications(u) {
      return all('Notifications').filter(function (n) { return n.username === u.username; }).slice(-60).reverse()
        .map(function (n) { return { id: n.id, time: n.time, type: n.type, title: n.title, body: n.body, docId: n.docId, read: bool(n.read) }; });
    }
    function markRead(u, p) {
      var ids = p.ids || null;
      db.update('Notifications', function (n) { return n.username === u.username && !bool(n.read) && (!ids || ids.indexOf(n.id) >= 0); }, { read: 'TRUE' });
      return myNotifications(u);
    }
    function changePin(u, p) {
      if (svc.hash(str(p.oldPin), u.salt) !== u.pinHash) fail('Current PIN is wrong');
      var salt = svc.uuid();
      db.update('Users', function (x) { return str(x.username).toLowerCase() === u.username; }, { pinHash: svc.hash(validPin(p.newPin), salt), salt: salt });
      log(u.username, 'CHANGE PIN', '', ''); return true;
    }
    function telegramLink(u) {
      var bot = settings().telegramBotUsername.replace(/^@/, '');
      if (!bot) fail('Telegram bot is not set up yet (ask Admin)');
      var code = svc.uuid().replace(/-/g, '').slice(0, 10);
      db.remove('TelegramLinks', function (x) { return x.username === u.username || num(x.exp) < Date.now(); });
      db.insert('TelegramLinks', { code: code, username: u.username, exp: String(Date.now() + 30 * 60000) });
      return { url: 'https://t.me/' + bot + '?start=' + code };
    }
    function telegramCheck(u) {
      if (svc.telegramUpdates) {
        (svc.telegramUpdates() || []).forEach(function (m) {
          var mm = /^\/start\s+(\w+)/.exec(str(m.text)); if (!mm) return;
          var link = find('TelegramLinks', function (x) { return x.code === mm[1] && num(x.exp) > Date.now(); });
          if (!link) return;
          db.update('Users', function (x) { return str(x.username).toLowerCase() === link.username; }, { telegramChatId: String(m.chatId) });
          db.remove('TelegramLinks', function (x) { return x.code === mm[1]; });
          try { svc.telegram(String(m.chatId), '✅ Linked to the PR/PO system. You will get approval alerts here.', ''); } catch (e) { /* ignore */ }
        });
      }
      return { linked: !!userOf(u.username).telegramChatId };
    }
    function telegramUnlink(u) { db.update('Users', function (x) { return str(x.username).toLowerCase() === u.username; }, { telegramChatId: '' }); return { linked: false }; }
    function pushRegister(u, p) {
      var tok = str(p.token); if (!tok) fail('Missing token');
      db.remove('PushTokens', function (x) { return x.token === tok; });
      db.insert('PushTokens', { username: u.username, token: tok, device: str(p.device).slice(0, 120), createdAt: now() });
      return { ok: true };
    }
    function pushUnregister(u, p) { db.remove('PushTokens', function (x) { return x.token === str(p.token); }); return { ok: true }; }

    // ---------- admin & master data ----------
    function needAdmin(u) { if (u.role !== 'Admin') fail('Admin only'); }
    function listUsers(u) { needAdmin(u); return users().map(pub); }
    function createUser(u, p) {
      needAdmin(u);
      var un = str(p.username).toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(un)) fail('Username: 3-30 characters, a-z 0-9 . _ -');
      if (userOf(un)) fail('Username already exists');
      if (ROLES.indexOf(p.role) < 0) fail('Choose a role');
      var salt = svc.uuid();
      db.insert('Users', { username: un, name: str(p.name) || un, role: p.role, department: str(p.department), email: str(p.email), telegramChatId: '',
        pinHash: svc.hash(validPin(p.pin), salt), salt: salt, active: 'TRUE', createdAt: now(), lastLogin: '' });
      log(u.username, 'USER CREATE', '', un + ' (' + p.role + ')');
      return listUsers(u);
    }
    function updateUser(u, p) {
      needAdmin(u);
      var t = userOf(p.username); if (!t) fail('User not found');
      var patch = {};
      ['name', 'department', 'email'].forEach(function (k) { if (p[k] !== undefined) patch[k] = str(p[k]); });
      if (p.role !== undefined) { if (ROLES.indexOf(p.role) < 0) fail('Unknown role'); if (t.username === u.username && p.role !== 'Admin') fail('You cannot remove your own Admin role'); patch.role = p.role; }
      if (p.active !== undefined) { if (t.username === u.username && !p.active) fail('You cannot deactivate yourself'); patch.active = p.active ? 'TRUE' : 'FALSE'; }
      if (p.pin) { var salt = svc.uuid(); patch.pinHash = svc.hash(validPin(p.pin), salt); patch.salt = salt; }
      db.update('Users', function (x) { return str(x.username).toLowerCase() === t.username; }, patch);
      if (p.active === false) db.remove('Sessions', function (s) { return s.username === t.username; });
      log(u.username, 'USER UPDATE', '', t.username + ': ' + Object.keys(patch).filter(function (k) { return k !== 'salt'; }).join(', '));
      return listUsers(u);
    }
    function saveVendor(u, p) {
      if (!is(u, ['Purchasing', 'Admin'])) fail('Only Purchasing can edit vendors');
      var v = p.vendor || {}, name = str(v.name); if (!name) fail('Vendor name is required');
      var code = str(v.code);
      var row = { name: name, contact: str(v.contact), phone: str(v.phone), email: str(v.email), address: str(v.address), taxId: str(v.taxId), paymentTerms: str(v.paymentTerms), currency: str(v.currency) || 'USD', active: v.active === false ? 'FALSE' : 'TRUE' };
      if (code && find('Vendors', function (x) { return x.code === code; })) db.update('Vendors', function (x) { return x.code === code; }, row);
      else { row.code = code || nextId('V'); db.insert('Vendors', row); }
      log(u.username, 'VENDOR SAVE', '', row.code || code);
      return bootstrap(u).vendors;
    }
    function saveRates(u, p) {
      if (!is(u, ['Purchasing', 'Admin'])) fail('Only Purchasing / Admin can update rates');
      var r = p.rates || {}, t = now();
      Object.keys(r).forEach(function (code) {
        var v = num(r[code]); if (code === 'USD' || v <= 0) return;
        db.update('Currencies', function (c) { return c.code === code; }, { rateToUSD: String(v), updatedAt: t, updatedBy: u.name });
      });
      log(u.username, 'RATES', '', JSON.stringify(r));
      return bootstrap(u).currencies;
    }
    function saveFile(u, p) {
      if (!svc.saveFile) fail('Uploads are not available');
      var b64 = str(p.base64); if (b64.length > 7000000) fail('File too large (max ~5 MB)');
      return { name: str(p.name).slice(0, 120), url: svc.saveFile(str(p.name), str(p.mime), b64) };
    }

    // ---------- dashboard ----------
    function dashboard(u) {
      if (!is(u, ['Manager', 'Executive', 'Purchasing', 'Admin'])) fail('Dashboard is for managers / purchasing');
      var month = today().slice(0, 7), t = now();
      var pos = all('PO'), prs = all('PR');
      var spend = pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && str(p.issuedAt).slice(0, 7) === month; }).reduce(function (s, p) { return s + num(p.totalUSD); }, 0);
      var approved = prs.filter(function (p) { return p.approvedAt && p.submittedAt; });
      var avg = approved.length ? approved.reduce(function (s, p) { return s + hoursBetween(p.submittedAt, p.approvedAt); }, 0) / approved.length / 24 : 0;
      var late = pos.filter(function (p) { return poRow(p).late; });
      var aging = [];
      prs.filter(function (p) { return p.status === PR_ST.PENDING; }).forEach(function (p) { aging.push({ docId: p.id, title: p.title, waitingOn: waitingOn(p), ageDays: Math.floor(hoursBetween(p.lastActionAt, t) / 24), amountUSD: num(p.totalUSD), kind: 'approval' }); });
      prs.filter(function (p) { return p.status === PR_ST.APPROVED; }).forEach(function (p) { aging.push({ docId: p.id, title: p.title, waitingOn: 'Purchasing (issue PO)', ageDays: Math.floor(hoursBetween(p.approvedAt, t) / 24), amountUSD: num(p.totalUSD), kind: 'po' }); });
      pos.filter(function (p) { return p.status === PO_ST.PENDING; }).forEach(function (p) { aging.push({ docId: p.id, title: p.title, waitingOn: 'PO approval', ageDays: Math.floor(hoursBetween(p.updatedAt, t) / 24), amountUSD: num(p.totalUSD), kind: 'approval' }); });
      late.forEach(function (p) { aging.push({ docId: p.id, title: p.title, waitingOn: 'Vendor delivery (late)', ageDays: Math.floor(hoursBetween(p.deliveryDate, t) / 24), amountUSD: num(p.totalUSD), kind: 'late' }); });
      aging.sort(function (a, b) { return b.ageDays - a.ageDays; });
      var byVendor = {};
      pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && str(p.issuedAt).slice(0, 7) === month; }).forEach(function (p) { byVendor[p.vendorName] = (byVendor[p.vendorName] || 0) + num(p.totalUSD); });
      return {
        month: month,
        kpis: { spendUSD: r2(spend), pendingPR: prs.filter(function (p) { return p.status === PR_ST.PENDING; }).length, waitingPO: prs.filter(function (p) { return p.status === PR_ST.APPROVED; }).length, avgApproveDays: Math.round(avg * 10) / 10, latePO: late.length },
        departments: all('Departments').filter(function (d) { return d.active === '' || bool(d.active); }).map(function (d) { var b = budgetInfo(d.code, month); b.name = d.name || d.code; return b; }),
        vendors: Object.keys(byVendor).map(function (k) { return { name: k, usd: r2(byVendor[k]) }; }).sort(function (a, b) { return b.usd - a.usd; }).slice(0, 8),
        aging: aging.slice(0, 15),
      };
    }

    // ---------- scheduled jobs (called by triggers) ----------
    function reminders() {
      var t = now(), hrs = num(settings().reminderHours) || 48, sent = 0;
      all('PR').filter(function (p) { return p.status === PR_ST.PENDING; }).forEach(function (p) {
        if (hoursBetween(p.lastActionAt, t) < hrs) return;
        if (p.lastRemindedAt && hoursBetween(p.lastRemindedAt, t) < 24) return;
        notify(approversFor(p, p.currentLevel), { type: 'reminder', title: 'Reminder: ' + p.id + ' is waiting', body: p.title + ' · waiting ' + Math.floor(hoursBetween(p.lastActionAt, t) / 24) + ' days', docId: p.id });
        db.update('PR', function (x) { return x.id === p.id; }, { lastRemindedAt: t }); sent++;
      });
      return sent;
    }
    function weeklyDigest() {
      var st = settings(), t = now(), out = [], prs = all('PR'), pos = all('PO');
      var link = st.appUrl ? '<p><a href="' + esc(st.appUrl) + '" style="background:#1f3a5f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open PR/PO app</a></p>' : '';
      function table(rows) {
        if (!rows.length) return '';
        return '<table style="border-collapse:collapse;width:100%;font-size:13px">' + rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td style="padding:6px 8px;border-bottom:1px solid #e2e6ee">' + esc(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table>';
      }
      users().filter(function (u) { return u.active && u.email; }).forEach(function (u) {
        var parts = [];
        var mine = prs.filter(function (p) { return p.requester === u.username && [PR_ST.DRAFT, PR_ST.RETURNED, PR_ST.PENDING, PR_ST.APPROVED].indexOf(p.status) >= 0; });
        if (mine.length) parts.push('<h3>My open requests (' + mine.length + ')</h3>' + table(mine.map(function (p) { return [p.id, p.title, p.status, waitingOn(p)]; })));
        var toApprove = prs.filter(function (p) { return canApprovePR(u, p); });
        if (toApprove.length) parts.push('<h3>Waiting for your approval (' + toApprove.length + ')</h3>' + table(toApprove.map(function (p) { return [p.id, p.title, money(p.totalAmount, p.currency), Math.floor(hoursBetween(p.lastActionAt, t) / 24) + ' days']; })));
        if (is(u, ['Purchasing', 'Admin'])) {
          var toPo = prs.filter(function (p) { return p.status === PR_ST.APPROVED; });
          if (toPo.length) parts.push('<h3>Approved PRs without PO (' + toPo.length + ')</h3>' + table(toPo.map(function (p) { return [p.id, p.title, p.department, money(p.totalAmount, p.currency)]; })));
          var late = pos.filter(function (p) { return poRow(p).late; });
          if (late.length) parts.push('<h3>Late deliveries (' + late.length + ')</h3>' + table(late.map(function (p) { return [p.id, p.vendorName, 'due ' + p.deliveryDate]; })));
        }
        if (is(u, ['Manager', 'Executive', 'Admin'])) {
          var week = pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && p.issuedAt && hoursBetween(p.issuedAt, t) <= 168; });
          var sum = week.reduce(function (s, p) { return s + num(p.totalUSD); }, 0);
          var d = dashboard(u);
          parts.push('<h3>Last 7 days</h3><p>' + week.length + ' POs issued · USD ' + money(sum) + '</p>' +
            table(d.departments.map(function (x) { return [x.name, 'USD ' + money(x.usedUSD + x.committedUSD) + ' / ' + money(x.budgetUSD), x.pct + '%']; })));
          if (d.aging.length) parts.push('<h3>Waiting the longest</h3>' + table(d.aging.slice(0, 5).map(function (a) { return [a.docId, a.title, a.waitingOn, a.ageDays + ' days']; })));
        }
        if (!parts.length) return;
        out.push({ to: u.email, subject: 'PR/PO weekly summary — ' + t.slice(0, 10),
          html: '<div style="font-family:Arial,sans-serif;color:#1c2430;max-width:640px"><h2 style="color:#1f3a5f">Hi ' + esc(u.name) + ', here is your weekly PR/PO summary</h2>' + parts.join('') + link + '</div>' });
      });
      return out;
    }

    // ---------- router ----------
    var ROUTES = {
      bootstrap: bootstrap, list: listDocs, getPR: getPR, savePR: savePR, prAction: prAction, getPO: getPO, savePO: savePO, poAction: poAction,
      receive: receive, notifications: myNotifications, markRead: markRead, changePin: changePin, telegramLink: telegramLink, telegramCheck: telegramCheck,
      telegramUnlink: telegramUnlink, pushRegister: pushRegister, pushUnregister: pushUnregister, listUsers: listUsers, createUser: createUser,
      updateUser: updateUser, saveVendor: saveVendor, saveRates: saveRates, upload: saveFile, dashboard: dashboard,
      budget: function (u, p) { return budgetInfo(str(p.department) || u.department); },
    };
    var READ_ONLY = { bootstrap: 1, list: 1, getPR: 1, getPO: 1, notifications: 1, listUsers: 1, dashboard: 1, budget: 1 };

    function handle(action, payload, token) {
      payload = payload || {};
      if (action === 'login') return login(payload);
      var u = session(token);
      if (action === 'logout') { db.remove('Sessions', function (s) { return s.token === token; }); return true; }
      var fn = ROUTES[action]; if (!fn) fail('Unknown action: ' + action);
      return fn(u, payload);
    }

    return { handle: handle, isReadOnly: function (a) { return !!READ_ONLY[a]; }, reminders: reminders, weeklyDigest: weeklyDigest };
  }

  // ---------- printable PO (used for the PDF and the demo preview) ----------
  function poHtml(po, items, vendor, st) {
    var rows = items.map(function (i, k) {
      return '<tr><td>' + (k + 1) + '</td><td>' + esc(i.item) + '</td><td class="r">' + esc(i.qty) + ' ' + esc(i.unit) + '</td><td class="r">' + money(i.unitPrice) + '</td><td class="r">' + money(i.amount) + '</td></tr>';
    }).join('');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1c2430;font-size:12px;margin:28px}h1{font-size:22px;margin:0;color:#1f3a5f}' +
      '.top{display:flex;justify-content:space-between}.box{border:1px solid #cfd6e1;padding:10px}' +
      'table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1f3a5f;color:#fff;text-align:left;padding:7px}td{padding:7px;border-bottom:1px solid #e2e6ee}.r{text-align:right}' +
      '.tot td{border:0;padding:4px 7px}.sig{margin-top:60px}.sig td{border:0;border-top:1px solid #1c2430;padding-top:6px;text-align:center;width:30%}' +
      '</style></head><body>' +
      '<table style="margin:0"><tr><td style="border:0;padding:0"><b style="font-size:15px">' + esc(st.companyName || '[COMPANY NAME]') + '</b><br>' + esc(st.companyAddress) +
      (st.companyTaxId ? '<br>Tax ID: ' + esc(st.companyTaxId) : '') + (st.companyPhone ? '<br>Tel: ' + esc(st.companyPhone) : '') + '</td>' +
      '<td style="border:0;padding:0;text-align:right"><h1>PURCHASE ORDER</h1><b>' + esc(po.id) + '</b><br>Date: ' + esc(str(po.issuedAt).slice(0, 10)) + '<br>Ref PR: ' + esc(po.prId) + '</td></tr></table>' +
      '<table style="margin-top:16px"><tr><td class="box" style="width:50%;vertical-align:top"><b>Vendor</b><br>' + esc(vendor.name || po.vendorName) + '<br>' + esc(vendor.address) +
      (vendor.taxId ? '<br>Tax ID: ' + esc(vendor.taxId) : '') + (vendor.contact ? '<br>Attn: ' + esc(vendor.contact) : '') + (vendor.phone ? '<br>Tel: ' + esc(vendor.phone) : '') + '</td>' +
      '<td style="width:2%;border:0"></td><td class="box" style="width:48%;vertical-align:top"><b>Deliver to</b><br>' + esc(po.deliverTo) + '<br><br><b>Delivery date:</b> ' + esc(po.deliveryDate) + '<br><b>Payment terms:</b> ' + esc(po.paymentTerms) + '<br><b>Currency:</b> ' + esc(po.currency) + '</td></tr></table>' +
      '<table><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr>' + rows + '</table>' +
      '<table class="tot" style="width:40%;margin-left:60%"><tr><td>Subtotal</td><td class="r">' + money(po.subtotal) + '</td></tr>' +
      '<tr><td>VAT ' + esc(po.vatPct) + '%</td><td class="r">' + money(po.vatAmount) + '</td></tr>' +
      '<tr><td><b>Total ' + esc(po.currency) + '</b></td><td class="r"><b>' + money(po.total) + '</b></td></tr></table>' +
      (po.note ? '<p><b>Note:</b> ' + esc(po.note) + '</p>' : '') +
      '<table class="sig"><tr><td>Prepared by<br>' + esc(po.createdByName) + '</td><td style="border:0;width:5%"></td><td>Approved by<br>&nbsp;</td><td style="border:0;width:5%"></td><td>Vendor acknowledgement<br>&nbsp;</td></tr></table>' +
      '</body></html>';
  }

  // ---------- starter data (used by setup() and the demo) ----------
  var SEED = {
    Departments: [
      { code: 'WH', name: 'Warehouse Ops', monthlyBudgetUSD: '5000', active: 'TRUE' },
      { code: 'TR', name: 'Transport', monthlyBudgetUSD: '4000', active: 'TRUE' },
      { code: 'CR', name: 'Cold Room', monthlyBudgetUSD: '2000', active: 'TRUE' },
      { code: 'AD', name: 'Admin', monthlyBudgetUSD: '1500', active: 'TRUE' },
    ],
    Currencies: [
      { code: 'USD', rateToUSD: '1', updatedAt: '', updatedBy: '' },
      { code: 'KHR', rateToUSD: '0.00025', updatedAt: '', updatedBy: 'starter value — update' },
      { code: 'THB', rateToUSD: '0.029', updatedAt: '', updatedBy: 'starter value — update' },
    ],
    ApprovalRules: [
      { level: '1', minUSD: '0', approverRole: 'DeptHead', label: 'Dept head' },
      { level: '2', minUSD: '500', approverRole: 'Manager', label: 'Manager' },
      { level: '3', minUSD: '5000', approverRole: 'Executive', label: 'Executive' },
    ],
    Settings: [
      { key: 'companyName', value: '', note: 'Shown on the PO PDF' },
      { key: 'companyAddress', value: '', note: 'Shown on the PO PDF' },
      { key: 'companyTaxId', value: '', note: 'Shown on the PO PDF' },
      { key: 'companyPhone', value: '', note: 'Shown on the PO PDF' },
      { key: 'appUrl', value: '', note: 'Your GitHub Pages link — used in Telegram / push / email links' },
      { key: 'telegramBotUsername', value: '', note: 'e.g. MyCompanyPRBot (without @)' },
      { key: 'reminderHours', value: '48', note: 'Remind approvers after this many hours' },
      { key: 'poTolerancePct', value: '0', note: 'PO may exceed the approved PR amount by this % without extra approval' },
      { key: 'defaultVatPct', value: '10', note: 'Pre-filled VAT % on new POs (can change per PO)' },
      { key: 'defaultDeliverTo', value: '', note: 'Pre-filled delivery address on new POs' },
    ],
  };

  return { SCHEMA: SCHEMA, ROLES: ROLES, PR_ST: PR_ST, PO_ST: PO_ST, SEED: SEED, create: create, poHtml: poHtml };
})();
