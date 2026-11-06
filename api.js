// ===== API layer: Apps Script backend, or the in-browser demo =====
const Store = {
  get(k, d = null) { try { const v = localStorage.getItem('prpo_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('prpo_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('prpo_' + k); } catch (e) { /* ignore */ } },
};

const Api = (() => {
  const demo = !window.APP_CONFIG.API_URL;
  async function call(action, payload = {}) {
    const token = Store.get('token');
    if (demo) {
      await new Promise(r => setTimeout(r, 120));
      return Demo.handle(action, payload, token);
    }
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token, payload }),
      });
    } catch (e) { const err = new Error('No internet connection'); err.offline = true; throw err; }
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Server error');
    return j.data;
  }
  return { call, demo };
})();
