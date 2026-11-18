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
      'lastActionAt', 'lastRemindedAt', 'updatedAt', 'updatedBy', 'priority', 'costCenter'],
    PRItems: ['prId', 'line', 'item', 'description', 'qty', 'unit', 'unitPrice', 'amount', 'poId'],
    PO: ['id', 'prId', 'title', 'vendorCode', 'vendorName', 'department', 'currency', 'rateToUSD', 'subtotal', 'vatPct', 'vatAmount',
      'total', 'totalUSD', 'paymentTerms', 'deliveryDate', 'deliverTo', 'note', 'status', 'createdBy', 'createdByName',
      'createdAt', 'issuedAt', 'updatedAt', 'pdfUrl', 'costCenter'],
    POItems: ['poId', 'line', 'prLine', 'item', 'qty', 'unit', 'unitPrice', 'amount', 'receivedQty'],
    Log: ['time', 'user', 'action', 'docId', 'details'],
    Notifications: ['id', 'username', 'time', 'type', 'title', 'body', 'docId', 'read'],
    PushTokens: ['username', 'token', 'device', 'createdAt'],
    Sessions: ['token', 'username', 'exp'],
    Counters: ['key', 'value'],
    TelegramLinks: ['code', 'username', 'exp'],
    CostCenters: ['code', 'name', 'active'],
  };
  var DEFAULT_UNITS = 'pc,box,carton,pallet,set,roll,ream,kg,liter,pack,lot,trip,month';

  var ROLES = ['Requester', 'DeptHead', 'Manager', 'MD', 'Purchasing', 'Store', 'Admin'];
  var SEE_ALL = ['Manager', 'MD', 'Purchasing', 'Store', 'Admin'];
  var PO_APPROVERS = ['Manager', 'MD', 'Admin'];
  var PR_ST = { DRAFT: 'Draft', PENDING: 'Pending Approval', RETURNED: 'Returned', REJECTED: 'Rejected', APPROVED: 'Approved', ORDERED: 'Ordered', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
  var PO_ST = { DRAFT: 'Draft', PENDING: 'Pending Approval', ISSUED: 'Issued', PARTIAL: 'Partially Received', RECEIVED: 'Received', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
  var PO_LIVE = [PO_ST.ISSUED, PO_ST.PARTIAL, PO_ST.RECEIVED, PO_ST.CLOSED];
  var SESSION_DAYS = 14, MAX_FAILS = 5;

  // ---------- small helpers ----------
  function roleOf(r) { r = str(r); return r === 'Executive' ? 'MD' : (r || 'Requester'); } // 'Executive' = old name of MD
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
        reminderHours: '48', urgentReminderHours: '24', poTolerancePct: '0', defaultVatPct: '10', defaultDeliverTo: '', units: DEFAULT_UNITS };
      all('Settings').forEach(function (r) { if (r.key) o[r.key] = str(r.value); });
      return o;
    }
    function rates() { var o = {}; all('Currencies').forEach(function (c) { o[c.code] = num(c.rateToUSD); }); return o; }
    function rateOf(code) { var r = rates()[code]; if (!r) fail('Unknown currency: ' + code); return r; }
    function rules() {
      return all('ApprovalRules').map(function (r) { return { level: num(r.level), minUSD: num(r.minUSD), approverRole: roleOf(r.approverRole), label: str(r.label) || roleOf(r.approverRole) }; })
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
        return { username: str(u.username).toLowerCase(), name: str(u.name) || str(u.username), role: roleOf(u.role),
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
        try {
          if (n.email && u.email && svc.email) { var m = n.email(u); if (m) svc.email(u.email, m.subject, m.html); }
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
        priority: p.priority === 'Urgent' ? 'Urgent' : 'Normal', costCenter: p.costCenter || '', canApprove: canApprovePR(u, p) };
    }
    function poRow(p) {
      var late = [PO_ST.ISSUED, PO_ST.PARTIAL].indexOf(p.status) >= 0 && p.deliveryDate && p.deliveryDate < today();
      return { id: p.id, prId: p.prId, title: p.title, vendorName: p.vendorName, department: p.department, currency: p.currency, total: num(p.total),
        totalUSD: num(p.totalUSD), status: p.status, deliveryDate: p.deliveryDate, issuedAt: p.issuedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
        createdByName: p.createdByName, pdfUrl: p.pdfUrl, costCenter: p.costCenter || '', late: !!late };
    }

    // ---------- emails (approval requests, results) ----------
    function urgentTag(pr) { return pr.priority === 'Urgent' ? '[URGENT] ' : ''; }
    function ccName(code) { var c = find('CostCenters', function (x) { return x.code === code; }); return c ? (c.name ? c.code + ' · ' + c.name : c.code) : code; }
    function deptName(code) { var d = find('Departments', function (x) { return x.code === code; }); return d ? (d.name || d.code) : code; }
    function appLink(hash) { var a = settings().appUrl.replace(/#.*$/, ''); return a ? a + (hash ? '#' + hash : '') : ''; }
    function chainOf(pr) {
      var logs = all('Log').filter(function (l) { return l.docId === pr.id && l.time >= str(pr.submittedAt); });
      var names = {}; users().forEach(function (x) { names[x.username] = x.name; });
      return str(pr.requiredLevels).split(',').filter(Boolean).map(function (lv) {
        var r = ruleOf(lv), d = logs.filter(function (l) { return l.action === 'APPROVE L' + lv; })[0];
        return { label: r ? r.label : 'Level ' + lv, state: d ? 'done' : (pr.status === PR_ST.PENDING && str(pr.currentLevel) === str(lv) ? 'now' : 'next'), by: d ? (names[d.user] || d.user) : '', time: d ? d.time : '' };
      });
    }
    function prEmail(pr, o) {
      var items = prItems(pr.id), b = o.budget ? budgetInfo(pr.department) : null;
      var row = function (k, v, style) { return '<tr><td style="padding:4px 0;color:#5b6676;width:38%">' + esc(k) + '</td><td style="padding:4px 0;' + (style || '') + '">' + v + '</td></tr>'; };
      var link = appLink(o.hash || pr.id);
      var h = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2430;max-width:620px;font-size:14px">' +
        (o.banner ? '<div style="background:' + o.bannerBg + ';color:' + o.bannerFg + ';padding:12px 14px;border-radius:8px;font-weight:bold;margin-bottom:12px">' + esc(o.banner) + '</div>' : '') +
        '<p style="margin:0 0 12px">Hi ' + esc(o.name) + ', ' + esc(o.intro) + '</p>' +
        (o.comment ? '<div style="border-left:4px solid ' + (o.commentColor || '#b42318') + ';background:#f6f7f9;padding:10px 12px;margin:0 0 12px"><b>' + esc(o.commentBy) + ':</b> "' + esc(o.comment) + '"</div>' : '') +
        '<div style="border:1px solid #e2e6ee;border-radius:8px;padding:12px 14px">' +
        '<div style="font-size:12px;color:#5b6676">' + esc(pr.id) + (pr.priority === 'Urgent' ? ' &nbsp;<span style="background:#fde4e4;color:#b42318;padding:1px 8px;border-radius:10px;font-weight:bold">URGENT</span>' : '') + '</div>' +
        '<div style="font-size:17px;font-weight:bold;margin:2px 0 8px">' + esc(pr.title) + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        row('Requested by', esc(pr.requesterName) + ' · ' + esc(deptName(pr.department))) +
        row('Total', '<b>' + esc(money(pr.totalAmount, pr.currency)) + '</b>' + (pr.currency !== 'USD' ? ' <span style="color:#5b6676">(≈ USD ' + money(pr.totalUSD) + ')</span>' : '')) +
        (pr.neededBy ? row('Needed by', esc(pr.neededBy)) : '') +
        (pr.costCenter ? row('Cost center', esc(ccName(pr.costCenter))) : '') +
        (pr.reason ? row('Reason', esc(pr.reason)) : '') +
        (b && b.budgetUSD ? row('Department budget', b.pct + '% used incl. requests in approval', b.pct > 85 ? 'color:#c2410c;font-weight:bold' : '') : '') +
        '</table>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:10px"><tr style="color:#5b6676"><td style="padding:4px 0;border-bottom:1px solid #e2e6ee">Item</td><td style="border-bottom:1px solid #e2e6ee;text-align:right">Qty</td><td style="border-bottom:1px solid #e2e6ee;padding-left:8px">Unit</td><td style="border-bottom:1px solid #e2e6ee;text-align:right">Amount</td></tr>' +
        items.map(function (i) { return '<tr><td style="padding:5px 0;border-bottom:1px solid #f0f2f5">' + esc(i.item) + '</td><td style="text-align:right;border-bottom:1px solid #f0f2f5">' + esc(i.qty) + '</td><td style="padding-left:8px;border-bottom:1px solid #f0f2f5">' + esc(i.unit) + '</td><td style="text-align:right;border-bottom:1px solid #f0f2f5">' + money(i.amount) + '</td></tr>'; }).join('') +
        '</table></div>';
      if (o.chain) {
        h += '<p style="margin:14px 0 6px;font-weight:bold;font-size:13px">Approval chain</p>' + chainOf(pr).map(function (c, k) {
          var col = c.state === 'done' ? '#1d7a52' : c.state === 'now' ? '#8a5a00' : '#8a94a3';
          var txt = c.state === 'done' ? 'approved by ' + c.by + ' · ' + c.time.slice(0, 16) : c.state === 'now' ? (o.nowIsYou ? 'you · waiting' : 'waiting') : 'next';
          return '<div style="font-size:13px;color:' + col + ';margin:2px 0">' + (c.state === 'done' ? '✔' : c.state === 'now' ? '●' : '○') + ' ' + (k + 1) + '. ' + esc(c.label) + ' · ' + esc(txt) + '</div>';
        }).join('');
      }
      if (link) h += '<p style="margin:16px 0 6px"><a href="' + esc(link) + '" style="background:' + (o.color || '#1f3a5f') + ';color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">' + esc(o.button || 'Open in app') + '</a></p>';
      if (o.footer) h += '<p style="font-size:11px;color:#8a94a3;margin-top:14px">' + esc(o.footer) + '</p>';
      return h + '</div>';
    }
    function notifyApprovers(pr, level, reminderDays) {
      var lv = str(pr.requiredLevels).split(','), idx = lv.indexOf(str(level)), r = ruleOf(level);
      var title = urgentTag(pr) + (reminderDays ? 'Reminder: ' + pr.id + ' is still waiting (' + reminderDays + (reminderDays > 1 ? ' days)' : ' day)') : 'Approval needed: ' + pr.id);
      notify(approversFor(pr, level), {
        type: reminderDays ? 'reminder' : 'approval', title: title, docId: pr.id,
        body: pr.title + ' · ' + money(pr.totalAmount, pr.currency) + ' from ' + pr.requesterName,
        email: function (u) {
          return { subject: title + ' · ' + pr.title + ' · ' + money(pr.totalAmount, pr.currency),
            html: prEmail(pr, { name: u.name, chain: true, budget: true, nowIsYou: true, button: 'Review and approve', color: '#1d7a52',
              intro: (reminderDays ? 'this purchase request has been waiting ' + reminderDays + (reminderDays > 1 ? ' days' : ' day') + ' for your approval' : 'a purchase request is waiting for your approval') + ' (step ' + (idx + 1) + ' of ' + lv.length + ').',
              footer: 'You are receiving this because you approve step ' + (idx + 1) + (r ? ' (' + r.label + ')' : '') + ' for purchase requests. Open the app to approve, send back or reject.' }) };
        },
      });
    }
    function notifyResult(pr, kind, comment, by) {
      var K = {
        approved: { type: 'approved', title: 'PR approved: ', body: pr.title + ' was approved. Purchasing will issue the PO.', banner: 'Approved — all approval steps are complete', bg: '#e3f4ec', fg: '#1d7a52',
          intro: 'your purchase request was fully approved. Purchasing will now issue the PO.', button: 'View PR', color: '#1f3a5f' },
        returned: { type: 'returned', title: 'Sent back for changes: ', body: '"' + comment + '" — ' + by, banner: 'Sent back for changes', bg: '#fff2cc', fg: '#8a5a00',
          intro: by + ' sent your purchase request back. Please update it and submit again.', button: 'Edit and resubmit', color: '#1f3a5f', hash: 'edit-' + pr.id, cc: '#b45309' },
        rejected: { type: 'rejected', title: 'Rejected: ', body: '"' + comment + '" — ' + by, banner: 'Rejected', bg: '#fde4e4', fg: '#b42318',
          intro: by + ' rejected your purchase request.', button: 'View PR', color: '#1f3a5f', cc: '#b42318' },
      }[kind];
      var title = urgentTag(pr) + K.title + pr.id;
      notify([pr.requester], { type: K.type, title: title, body: K.body, docId: pr.id,
        email: function (u) {
          return { subject: title + ' · ' + pr.title,
            html: prEmail(pr, { name: u.name, intro: K.intro, banner: K.banner, bannerBg: K.bg, bannerFg: K.fg, comment: comment, commentBy: by, commentColor: K.cc,
              chain: kind === 'approved', button: K.button, color: K.color, hash: K.hash, footer: 'You are receiving this because you opened this purchase request.' }) };
        } });
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
        units: str(st.units || DEFAULT_UNITS).split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        costCenters: all('CostCenters').filter(function (c) { return c.code && (c.active === '' || bool(c.active)); }).map(function (c) { return { code: c.code, name: c.name || c.code }; }),
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
        pr: prRow(u, pr), reason: pr.reason, costCenterName: pr.costCenter ? ccName(pr.costCenter) : '', rateToUSD: num(pr.rateToUSD), attachments: json(pr.attachments, []), items: items, pos: pos, history: history, levels: levels,
        budget: budgetInfo(pr.department),
        can: {
          edit: isOwner && [PR_ST.DRAFT, PR_ST.RETURNED].indexOf(pr.status) >= 0,
          copy: u.role === 'Admin' || (!!u.department && (pr.requester === u.username || pr.department === u.department)),
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
      if (u.role !== 'Admin' && !u.department) fail('Your account has no department yet — ask Admin to set it in Users');
      var dept = u.role === 'Admin' ? (str(d.department) || u.department) : u.department;
      if (!find('Departments', function (x) { return x.code === dept; })) fail('Please choose a department');
      var cc = str(d.costCenter);
      if (cc && !find('CostCenters', function (x) { return x.code === cc; })) fail('Unknown cost center: ' + cc);
      var cur = str(d.currency) || 'USD', rate = rateOf(cur);
      var lines = items.map(function (i, k) {
        var qty = num(i.qty), price = num(i.unitPrice);
        if (qty <= 0) fail('Quantity must be more than 0 (' + i.item + ')');
        if (price < 0) fail('Price cannot be negative');
        var unit = str(i.unit) || 'pc';
        if (/^[\d.,\s]+$/.test(unit)) fail('Unit for "' + str(i.item) + '" should be a unit like pc, box or kg — not a number');
        return { line: k + 1, item: str(i.item), description: str(i.description), qty: qty, unit: unit, unitPrice: price, amount: r2(qty * price) };
      });
      var total = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0));
      var t = now(), id = str(d.id), row = {
        title: str(d.title), department: dept, neededBy: str(d.neededBy), currency: cur, rateToUSD: String(rate), totalAmount: String(total),
        totalUSD: String(r2(total * rate)), reason: str(d.reason), attachments: JSON.stringify(d.attachments || []), updatedAt: t, updatedBy: u.name,
        priority: d.priority === 'Urgent' ? 'Urgent' : 'Normal', costCenter: cc,
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
        notifyApprovers(prOf(id), lv[0], 0);
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
          notifyApprovers(prOf(pr.id), lv[idx + 1], 0);
        } else {
          db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.APPROVED, currentLevel: '', approvedAt: t, lastActionAt: t });
          notifyResult(prOf(pr.id), 'approved', comment, u.name);
          notify(byRole(['Purchasing']), { type: 'topo', title: urgentTag(pr) + 'Ready for PO: ' + pr.id, body: pr.title + ' · ' + money(pr.totalAmount, pr.currency) + ' · ' + pr.department, docId: pr.id });
        }
      } else if (act === 'return') {
        db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.RETURNED, currentLevel: '', lastActionAt: t });
        log(u.username, 'RETURN', pr.id, comment);
        notifyResult(prOf(pr.id), 'returned', comment, u.name);
      } else if (act === 'reject') {
        db.update('PR', function (x) { return x.id === pr.id; }, { status: PR_ST.REJECTED, currentLevel: '', lastActionAt: t });
        log(u.username, 'REJECT', pr.id, comment);
        notifyResult(prOf(pr.id), 'rejected', comment, u.name);
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
        row.id = id; row.prId = prId; row.title = pr.title; row.department = pr.department; row.costCenter = pr.costCenter || ''; row.status = PO_ST.DRAFT;
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

    function spendBy(pos, keyFn) {
      var o = {}; pos.forEach(function (p) { var k = keyFn(p); o[k] = (o[k] || 0) + num(p.totalUSD); });
      return Object.keys(o).map(function (k) { return { name: k, usd: r2(o[k]) }; }).sort(function (a, b) { return b.usd - a.usd; });
    }
    // ---------- dashboard ----------
    function dashboard(u) {
      if (!is(u, ['Manager', 'MD', 'Purchasing', 'Admin'])) fail('Dashboard is for managers / purchasing');
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
        costCenters: spendBy(pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && str(p.issuedAt).slice(0, 7) === month; }), function (p) { return p.costCenter ? ccName(p.costCenter) : 'Unassigned'; }),
        aging: aging.slice(0, 15),
      };
    }

    // ---------- scheduled jobs (called by triggers) ----------
    function reminders() {
      var st = settings(), t = now(), sent = 0;
      all('PR').filter(function (p) { return p.status === PR_ST.PENDING; }).forEach(function (p) {
        var urgent = p.priority === 'Urgent', hrs = urgent ? (num(st.urgentReminderHours) || 24) : (num(st.reminderHours) || 48);
        if (hoursBetween(p.lastActionAt, t) < hrs) return;
        if (p.lastRemindedAt && hoursBetween(p.lastRemindedAt, t) < 24) return;
        notifyApprovers(p, p.currentLevel, Math.max(1, Math.floor(hoursBetween(p.lastActionAt, t) / 24)));
        db.update('PR', function (x) { return x.id === p.id; }, { lastRemindedAt: t }); sent++;
      });
      return sent;
    }
    // ---------- summary emails ----------
    function shift(ts, days) {
      var d = new Date(parseTs(ts) + days * 86400000), p2 = function (n) { return ('0' + n).slice(-2); };
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    }
    function prevMonth(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; if (!mo) { y--; mo = 12; } return y + '-' + ('0' + mo).slice(-2); }
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function monthName(m) { return MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
    var E = {
      wrap: function (title, sub, body, link) {
        return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2430;max-width:660px;font-size:14px">' +
          '<div style="background:#1f3a5f;color:#ffffff;border-radius:8px;padding:14px 16px"><div style="font-size:17px;font-weight:bold">' + esc(title) + '</div><div style="font-size:12px;color:#c9d6e8">' + esc(sub) + '</div></div>' +
          body + (link ? '<p style="margin:16px 0 6px"><a href="' + esc(link) + '" style="background:#1f3a5f;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Open PR/PO app</a></p>' : '') +
          '<p style="font-size:11px;color:#8a94a3;margin-top:14px">Sent automatically by the PR/PO system.</p></div>';
      },
      kpis: function (list) {
        return '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:8px -6px"><tr>' + list.map(function (k) {
          return '<td style="background:' + (k[2] || '#f3f5f9') + ';border-radius:8px;padding:10px;vertical-align:top"><div style="font-size:11px;color:' + (k[3] || '#5b6676') + '">' + esc(k[0]) + '</div><div style="font-size:19px;font-weight:bold;color:' + (k[3] || '#1c2430') + '">' + esc(k[1]) + '</div></td>';
        }).join('') + '</tr></table>';
      },
      table: function (head, rows, right) {
        right = right || [];
        var td = function (c, i, h) { return '<td style="padding:5px 6px;border-bottom:1px solid ' + (h ? '#d5dbe5;color:#5b6676;font-size:11px' : '#eef0f4') + ';' + (right.indexOf(i) >= 0 ? 'text-align:right;' : '') + (c && c.s ? c.s : '') + '">' + esc(c && c.v !== undefined ? c.v : c) + '</td>'; };
        return '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px"><tr>' + head.map(function (c, i) { return td(c, i, true); }).join('') + '</tr>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return td(c, i, false); }).join('') + '</tr>'; }).join('') + '</table>';
      },
      bar: function (b) {
        if (!b.budgetUSD) return '<div style="font-size:12px;color:#5b6676">No monthly budget set</div>';
        var u = Math.min(100, Math.round(b.usedUSD / b.budgetUSD * 100)), c = Math.max(0, Math.min(100 - u, Math.round(b.committedUSD / b.budgetUSD * 100)));
        var warn = b.pct > 85;
        return '<table style="width:100%;border-collapse:collapse;margin:6px 0 3px"><tr>' + (u ? '<td style="height:8px;width:' + u + '%;background:' + (warn ? '#c2410c' : '#2c5282') + '"></td>' : '') +
          (c ? '<td style="height:8px;width:' + c + '%;background:' + (warn ? '#f0997b' : '#9db8e0') + '"></td>' : '') + '<td style="height:8px;background:#e9edf3"></td></tr></table>' +
          '<div style="font-size:12px;color:#5b6676">Spent USD ' + money(b.usedUSD) + ' · In approval USD ' + money(b.committedUSD) + ' · Budget USD ' + money(b.budgetUSD) + '</div>';
      },
    };
    function between(ts, from, to) { ts = str(ts); return ts && ts >= from && ts <= to; }
    function depts() { return all('Departments').filter(function (d) { return d.active === '' || bool(d.active); }); }

    function adminWeekly(from, to) {
      var prs = all('PR'), pos = all('PO'), logs = all('Log'), t = to;
      var prDept = {}; prs.forEach(function (p) { prDept[p.id] = p.department; });
      var poDept = {}; pos.forEach(function (p) { poDept[p.id] = p.department; });
      var weekPO = pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && between(p.issuedAt, from, to); });
      var pending = prs.filter(function (p) { return p.status === PR_ST.PENDING; });
      var late = pos.filter(function (p) { return poRow(p).late; });
      var totals = [];
      var sections = depts().map(function (d) {
        var c = d.code, b = budgetInfo(c);
        var st = {
          newPR: prs.filter(function (p) { return p.department === c && between(p.submittedAt, from, to); }).length,
          approved: prs.filter(function (p) { return p.department === c && between(p.approvedAt, from, to); }).length,
          back: logs.filter(function (l) { return (l.action === 'RETURN' || l.action === 'REJECT') && prDept[l.docId] === c && between(l.time, from, to); }).length,
          po: weekPO.filter(function (p) { return p.department === c; }),
          recv: uniq(logs.filter(function (l) { return l.action === 'RECEIVE' && poDept[l.docId] === c && between(l.time, from, to); }).map(function (l) { return l.docId; })).length,
        };
        var waits = [];
        pending.filter(function (p) { return p.department === c; }).forEach(function (p) { var a = Math.floor(hoursBetween(p.lastActionAt, t) / 24); waits.push([p.id, (p.priority === 'Urgent' ? '[URGENT] ' : '') + p.title, waitingOn(p), { v: a + ' days', s: a >= 2 ? 'color:#b42318;font-weight:bold' : '' }, a]); });
        prs.filter(function (p) { return p.department === c && p.status === PR_ST.APPROVED; }).forEach(function (p) { var a = Math.floor(hoursBetween(p.approvedAt, t) / 24); waits.push([p.id, p.title, 'Purchasing (issue PO)', a + ' days', a]); });
        late.filter(function (p) { return p.department === c; }).forEach(function (p) { var a = Math.floor(hoursBetween(p.deliveryDate, t) / 24); waits.push([p.id, p.title + ' · ' + p.vendorName, 'Vendor (late)', { v: a + ' days late', s: 'color:#b42318;font-weight:bold' }, a + 100]); });
        waits.sort(function (x, y) { return y[4] - x[4]; });
        var poUSD = st.po.reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
        totals.push([d.name || c, st.newPR, waits.filter(function (w) { return w[2] !== 'Vendor (late)'; }).length, st.po.length, { v: b.budgetUSD ? b.pct + '%' : '—', s: b.pct > 85 ? 'color:#c2410c;font-weight:bold' : '' }, poUSD]);
        return '<div style="border:1px solid #e2e6ee;border-radius:8px;padding:12px 14px;margin:10px 0">' +
          '<table style="width:100%"><tr><td style="font-size:15px;font-weight:bold">' + esc(d.name || c) + ' (' + esc(c) + ')</td><td style="text-align:right;font-size:12px;' + (b.pct > 85 ? 'color:#c2410c;font-weight:bold' : 'color:#5b6676') + '">' + (b.budgetUSD ? 'Budget ' + b.pct + '% used' : '') + '</td></tr></table>' +
          E.bar(b) +
          '<div style="font-size:13px;margin-top:8px">This week: ' + st.newPR + ' new PRs · ' + st.approved + ' approved · ' + st.back + ' sent back / rejected · ' + st.po.length + ' POs issued (USD ' + money(poUSD) + ') · ' + st.recv + ' deliveries received</div>' +
          (waits.length ? E.table(['Document', 'Title', 'Waiting on', 'Age'], waits.map(function (w) { return w.slice(0, 4); }), [3]) : '<div style="font-size:12px;color:#1d7a52;margin-top:6px">Nothing waiting — all clear</div>') +
          '</div>';
      });
      var spend = weekPO.reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
      var sumRow = totals.reduce(function (a, r) { return [a[0] + r[1], a[1] + r[2], a[2] + r[3]]; }, [0, 0, 0]);
      var body = E.kpis([['New PRs', String(prs.filter(function (p) { return between(p.submittedAt, from, to); }).length)], ['POs issued', weekPO.length + ' · USD ' + money(spend)],
        ['Waiting approval', String(pending.length), '#fff2cc', '#8a5a00'], ['Late deliveries', String(late.length), '#fde4e4', '#b42318']]) +
        sections.join('') +
        '<div style="font-size:14px;font-weight:bold;margin:14px 0 2px">All departments</div>' +
        E.table(['Department', 'New PR', 'Waiting', 'PO issued', 'Budget used'], totals.map(function (r) { return r.slice(0, 5); }).concat([[{ v: 'Total', s: 'font-weight:bold' }, { v: sumRow[0], s: 'font-weight:bold' }, { v: sumRow[1], s: 'font-weight:bold' }, { v: sumRow[2], s: 'font-weight:bold' }, { v: 'USD ' + money(spend) + ' spent', s: 'font-weight:bold' }]]), [4]);
      return body;
    }

    function weeklyDigest() {
      var st = settings(), t = now(), from = shift(t, -7), out = [], prs = all('PR'), pos = all('PO');
      var weekPO = pos.filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0 && between(p.issuedAt, from, t); });
      if (!weekPO.length) return out; // no PO issued this week → no summary emails at all
      var link = appLink(''), period = from.slice(0, 10) + ' to ' + t.slice(0, 10);
      var adminBody = null;
      users().filter(function (u) { return u.active && u.email; }).forEach(function (u) {
        if (is(u, ['Admin', 'MD'])) {
          if (adminBody === null) adminBody = adminWeekly(from, t);
          out.push({ to: u.email, subject: 'PR/PO weekly summary · ' + period + ' · all departments',
            html: E.wrap('Weekly summary — all departments', 'Hi ' + u.name + ' · ' + period + ' · amounts in USD', adminBody, link) });
          return;
        }
        var parts = [];
        var mine = prs.filter(function (p) { return p.requester === u.username && [PR_ST.DRAFT, PR_ST.RETURNED, PR_ST.PENDING, PR_ST.APPROVED].indexOf(p.status) >= 0; });
        if (mine.length) parts.push('<h3 style="font-size:15px;margin:16px 0 4px">Your open requests (' + mine.length + ')</h3>' + E.table(['PR', 'Title', 'Status', 'Waiting on'], mine.map(function (p) { return [p.id, p.title, p.status, waitingOn(p)]; })));
        var toApprove = prs.filter(function (p) { return canApprovePR(u, p); });
        if (toApprove.length) parts.push('<h3 style="font-size:15px;margin:16px 0 4px">Waiting for your approval (' + toApprove.length + ')</h3>' + E.table(['PR', 'Title', 'Amount', 'Waiting'], toApprove.map(function (p) { return [p.id, urgentTag(p) + p.title, money(p.totalAmount, p.currency), Math.floor(hoursBetween(p.lastActionAt, t) / 24) + ' days']; }), [2, 3]));
        if (is(u, ['Purchasing'])) {
          var toPo = prs.filter(function (p) { return p.status === PR_ST.APPROVED; });
          if (toPo.length) parts.push('<h3 style="font-size:15px;margin:16px 0 4px">Approved PRs without PO (' + toPo.length + ')</h3>' + E.table(['PR', 'Title', 'Department', 'Amount'], toPo.map(function (p) { return [p.id, p.title, deptName(p.department), money(p.totalAmount, p.currency)]; }), [3]));
          var late = pos.filter(function (p) { return poRow(p).late; });
          if (late.length) parts.push('<h3 style="font-size:15px;margin:16px 0 4px">Late deliveries (' + late.length + ')</h3>' + E.table(['PO', 'Vendor', 'Due'], late.map(function (p) { return [p.id, p.vendorName, p.deliveryDate]; })));
        }
        if (is(u, ['Manager'])) {
          var sum = weekPO.reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
          parts.push('<h3 style="font-size:15px;margin:16px 0 4px">Last 7 days</h3><p style="margin:0">' + weekPO.length + ' POs issued · USD ' + money(sum) + '</p>' +
            E.table(['Department', 'Spent + in approval / budget', 'Used'], depts().map(function (d) { var b = budgetInfo(d.code); return [d.name || d.code, 'USD ' + money(b.usedUSD + b.committedUSD) + ' / ' + money(b.budgetUSD), b.pct + '%']; }), [2]));
        }
        if (!parts.length) return;
        out.push({ to: u.email, subject: 'PR/PO weekly summary · ' + period, html: E.wrap('Your weekly PR/PO summary', 'Hi ' + u.name + ' · ' + period, parts.join(''), link) });
      });
      return out;
    }

    function monthlyDigest() {
      var t = now(), m = prevMonth(t.slice(0, 7)), m0 = prevMonth(m), out = [];
      var pos = all('PO').filter(function (p) { return PO_LIVE.indexOf(p.status) >= 0; }), prs = all('PR');
      var inM = pos.filter(function (p) { return str(p.issuedAt).slice(0, 7) === m; });
      if (!inM.length) return out; // no PO issued last month → no monthly email
      var spend = inM.reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
      var prevSpend = pos.filter(function (p) { return str(p.issuedAt).slice(0, 7) === m0; }).reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
      var chg = prevSpend ? Math.round((spend - prevSpend) / prevSpend * 100) : null;
      var sub = prs.filter(function (p) { return str(p.submittedAt).slice(0, 7) === m; });
      var appr = prs.filter(function (p) { return str(p.approvedAt).slice(0, 7) === m; });
      var rej = all('Log').filter(function (l) { return l.action === 'REJECT' && str(l.time).slice(0, 7) === m; }).length;
      var avg = appr.length ? appr.reduce(function (s2, p) { return s2 + hoursBetween(p.submittedAt, p.approvedAt); }, 0) / appr.length / 24 : 0;
      var deptRows = depts().map(function (d) {
        var b = budgetInfo(d.code, m), sp = inM.filter(function (p) { return p.department === d.code; }).reduce(function (s2, p) { return s2 + num(p.totalUSD); }, 0);
        var pct = b.budgetUSD ? Math.round(sp / b.budgetUSD * 100) : 0;
        return [d.name || d.code, inM.filter(function (p) { return p.department === d.code; }).length, money(sp), b.budgetUSD ? money(b.budgetUSD) : '—', { v: b.budgetUSD ? pct + '%' : '—', s: pct > 100 ? 'color:#b42318;font-weight:bold' : pct > 85 ? 'color:#c2410c;font-weight:bold' : '' }];
      });
      var vend = spendBy(inM, function (p) { return p.vendorName; }).slice(0, 10);
      var ccs = spendBy(inM, function (p) { return p.costCenter ? ccName(p.costCenter) : 'Unassigned'; });
      var body = E.kpis([['Spend (POs issued)', 'USD ' + money(spend)], ['vs ' + monthName(m0), chg === null ? '—' : (chg >= 0 ? '+' : '') + chg + '%', chg > 0 ? '#fff2cc' : '#e3f4ec', chg > 0 ? '#8a5a00' : '#1d7a52'],
        ['POs issued', String(inM.length)], ['Avg. submit → approved', (Math.round(avg * 10) / 10) + ' days']]) +
        '<div style="font-size:13px;margin:4px 0 10px">PRs submitted: <b>' + sub.length + '</b> · approved: <b>' + appr.length + '</b> · rejected: <b>' + rej + '</b></div>' +
        '<div style="font-size:14px;font-weight:bold;margin:14px 0 2px">Spend by department</div>' + E.table(['Department', 'POs', 'Spent (USD)', 'Budget (USD)', 'Used'], deptRows, [1, 2, 3, 4]) +
        '<div style="font-size:14px;font-weight:bold;margin:14px 0 2px">Top vendors</div>' + E.table(['Vendor', 'Spent (USD)', 'Share'], vend.map(function (v) { return [v.name, money(v.usd), Math.round(v.usd / spend * 100) + '%']; }), [1, 2]) +
        '<div style="font-size:14px;font-weight:bold;margin:14px 0 2px">Spend by cost center</div>' + E.table(['Cost center', 'Spent (USD)', 'Share'], ccs.map(function (v) { return [v.name, money(v.usd), Math.round(v.usd / spend * 100) + '%']; }), [1, 2]);
      users().filter(function (u) { return u.active && u.email && is(u, ['Admin', 'MD']); }).forEach(function (u) {
        out.push({ to: u.email, subject: 'PR/PO monthly summary · ' + monthName(m), html: E.wrap('Monthly summary — ' + monthName(m), 'Hi ' + u.name + ' · all departments · amounts in USD', body, appLink('')) });
      });
      return out;
    }

    // ---------- export (Excel) ----------
    function exportDocs(u, p) {
      var from = str(p.from) || '0000', to = str(p.to) || '9999', kind = p.kind === 'po' ? 'po' : 'pr';
      var inRange = function (ts) { var d = str(ts).slice(0, 10); return d >= from && d <= to; };
      var vis = listDocs(u), ids = {};
      if (kind === 'pr') {
        var prs = all('PR').filter(function (x) { return vis.prs.some(function (v) { return v.id === x.id; }) && inRange(x.createdAt); });
        prs.forEach(function (x) { ids[x.id] = 1; });
        return { kind: 'pr',
          head: ['PR', 'Title', 'Status', 'Priority', 'Department', 'Cost center', 'Requested by', 'Needed by', 'Currency', 'Total', 'Rate to USD', 'Total USD', 'Created', 'Submitted', 'Approved'],
          rows: prs.map(function (x) { return [x.id, x.title, x.status, x.priority || 'Normal', deptName(x.department), x.costCenter ? ccName(x.costCenter) : '', x.requesterName, x.neededBy, x.currency, num(x.totalAmount), num(x.rateToUSD), num(x.totalUSD), x.createdAt, x.submittedAt, x.approvedAt]; }),
          lineHead: ['PR', 'Line', 'Item', 'Details', 'Qty', 'Unit', 'Unit price', 'Amount', 'PO'],
          lines: all('PRItems').filter(function (i) { return ids[i.prId]; }).map(function (i) { return [i.prId, num(i.line), i.item, i.description, num(i.qty), i.unit, num(i.unitPrice), num(i.amount), i.poId]; }) };
      }
      var pos = all('PO').filter(function (x) { return vis.pos.some(function (v) { return v.id === x.id; }) && inRange(x.issuedAt || x.createdAt); });
      pos.forEach(function (x) { ids[x.id] = 1; });
      return { kind: 'po',
        head: ['PO', 'PR', 'Title', 'Status', 'Department', 'Cost center', 'Vendor', 'Currency', 'Subtotal', 'VAT %', 'VAT', 'Total', 'Total USD', 'Delivery date', 'Issued', 'Created by'],
        rows: pos.map(function (x) { return [x.id, x.prId, x.title, x.status, deptName(x.department), x.costCenter ? ccName(x.costCenter) : '', x.vendorName, x.currency, num(x.subtotal), num(x.vatPct), num(x.vatAmount), num(x.total), num(x.totalUSD), x.deliveryDate, x.issuedAt, x.createdByName]; }),
        lineHead: ['PO', 'Line', 'Item', 'Qty', 'Unit', 'Unit price', 'Amount', 'Received qty'],
        lines: all('POItems').filter(function (i) { return ids[i.poId]; }).map(function (i) { return [i.poId, num(i.line), i.item, num(i.qty), i.unit, num(i.unitPrice), num(i.amount), num(i.receivedQty)]; }) };
    }

    // ---------- router ----------
    var ROUTES = {
      bootstrap: bootstrap, list: listDocs, getPR: getPR, savePR: savePR, prAction: prAction, getPO: getPO, savePO: savePO, poAction: poAction,
      receive: receive, notifications: myNotifications, markRead: markRead, changePin: changePin, telegramLink: telegramLink, telegramCheck: telegramCheck,
      telegramUnlink: telegramUnlink, pushRegister: pushRegister, pushUnregister: pushUnregister, listUsers: listUsers, createUser: createUser,
      updateUser: updateUser, saveVendor: saveVendor, saveRates: saveRates, upload: saveFile, dashboard: dashboard, export: exportDocs,
      budget: function (u, p) { return budgetInfo(str(p.department) || u.department); },
    };
    var READ_ONLY = { bootstrap: 1, list: 1, getPR: 1, getPO: 1, notifications: 1, listUsers: 1, dashboard: 1, budget: 1, export: 1 };

    function handle(action, payload, token) {
      payload = payload || {};
      if (action === 'login') return login(payload);
      var u = session(token);
      if (action === 'logout') { db.remove('Sessions', function (s) { return s.token === token; }); return true; }
      var fn = ROUTES[action]; if (!fn) fail('Unknown action: ' + action);
      return fn(u, payload);
    }

    return { handle: handle, isReadOnly: function (a) { return !!READ_ONLY[a]; }, reminders: reminders, weeklyDigest: weeklyDigest, monthlyDigest: monthlyDigest };
  }

  // ---------- printable PO (used for the PDF and the demo preview) ----------
  function poHtml(po, items, vendor, st) {
    var rows = items.map(function (i, k) {
      return '<tr><td>' + (k + 1) + '</td><td>' + esc(i.item) + '</td><td class="r">' + esc(i.qty) + '</td><td>' + esc(i.unit) + '</td><td class="r">' + money(i.unitPrice) + '</td><td class="r">' + money(i.amount) + '</td></tr>';
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
      '<table><tr><th>#</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price</th><th class="r">Amount</th></tr>' + rows + '</table>' +
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
      { level: '3', minUSD: '5000', approverRole: 'MD', label: 'MD' },
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
      { key: 'urgentReminderHours', value: '24', note: 'Remind approvers of URGENT PRs after this many hours' },
      { key: 'units', value: DEFAULT_UNITS, note: 'Units offered in the PR form (comma separated) — people can still type their own' },
    ],
    CostCenters: [
      { code: 'GEN', name: 'General', active: 'TRUE' },
    ],
  };

  return { SCHEMA: SCHEMA, ROLES: ROLES, PR_ST: PR_ST, PO_ST: PO_ST, SEED: SEED, create: create, poHtml: poHtml };
})();
