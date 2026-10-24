/* TERRA LIVE — 工具函数 */
window.TL = window.TL || {};

TL.util = (function () {
  const pad = (n) => String(n).padStart(2, '0');

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function round(v, d) { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  function fmtUTC(d) {
    const t = d instanceof Date ? d : new Date(d);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  }
  function fmtUTCDate(d) {
    const t = d instanceof Date ? d : new Date(d);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  function fmtLocal(d) {
    const t = d instanceof Date ? d : new Date(d);
    return `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }
  function fmtNum(v, d) {
    if (v === null || v === undefined || Number.isNaN(v)) return '--';
    return Number(v).toFixed(d === undefined ? 1 : d);
  }
  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return `${Math.floor(s)} 秒前`;
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
  }
  function fmtCoord(lat, lon) {
    const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
    const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    return `${la} ${lo}`;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function throttle(fn, wait) {
    let last = 0, timer = null, lastArgs = null;
    return function (...args) {
      lastArgs = args;
      const now = Date.now();
      if (now - last >= wait) { last = now; fn.apply(this, lastArgs); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, lastArgs); }, wait - (now - last));
      }
    };
  }
  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  function fetchJSON(url, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 25000);
    return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then((r) => readJSON(r))
      .finally(() => clearTimeout(timer));
  }
  function fetchText(url, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 25000);
    return fetch(url, { signal: ctl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .finally(() => clearTimeout(timer));
  }
  function chunks(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /* POST 表单请求：格网格点较多时 URL 会超出服务端上限（nginx 414），改用请求体承载参数 */
  function fetchJSONPost(url, body, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 25000);
    return fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then((r) => readJSON(r)).finally(() => clearTimeout(timer));
  }

  /* 统一解析响应：把 429 / “limit exceeded” 标记为 quota，供上层做长冷却 */
  function readJSON(r) {
    return r.text().then((txt) => {
      let data = null;
      try { data = JSON.parse(txt); } catch (e) { data = null; }
      if (r.ok) {
        if (data === null) throw new Error('响应不是 JSON');
        return data;
      }
      const reason = data && (data.reason || data.message) ? (data.reason || data.message) : ('HTTP ' + r.status);
      const err = new Error(reason);
      err.status = r.status;
      err.quota = r.status === 429 || /limit exceeded/i.test(reason);
      throw err;
    });
  }

  /* 带退避重试的请求：主要应对 Open-Meteo 的分钟级限流（返回“请等一分钟”）
     配额类错误（429 / limit exceeded）立即上抛，避免重试把小时额度打光 */
  function fetchJSONRetry(url, opt) {
    const o = Object.assign({ timeout: 25000, retries: 3, base: 9000, factor: 2 }, opt || {});
    let attempt = 0;
    function run() {
      const req = o.body ? fetchJSONPost(url, o.body, o.timeout) : fetchJSON(url, o.timeout);
      return req.catch((err) => {
        if (err.quota || attempt >= o.retries) throw err;
        const delay = o.base * Math.pow(o.factor, attempt) + Math.random() * 600;
        attempt++;
        return new Promise((r) => setTimeout(r, delay)).then(run);
      });
    }
    return run();
  }

  /* 配额冷却：限流后等到下一个整点再试，最多 45 分钟 */
  function nextQuotaReset() {
    const now = Date.now();
    const nextHour = Math.ceil((now + 60000) / 3600000) * 3600000;
    return Math.min(nextHour + 90000, now + 45 * 60000);
  }

  /* Open-Meteo 两个端点共享同一份额度，故冷却状态由全站共享：
     任一格网请求被限流，其余请求在冷却期内直接跳过，不再浪费额度 */
  const meteoCooldown = {
    until: 0,
    active() { return Date.now() < this.until; },
    trip() { this.until = nextQuotaReset(); },
    mins() { return Math.max(1, Math.ceil((this.until - Date.now()) / 60000)); },
    note(label) { return label + ' · 免费额度冷却中，' + this.mins() + ' 分钟后自动重试'; }
  };

  /* 请求节流闸：保证同类外部接口调用之间至少间隔 minGap 毫秒 */
  function pacer(minGap) {
    let chain = Promise.resolve();
    let last = 0;
    return function (task) {
      const run = chain.then(() => {
        const wait = Math.max(0, minGap - (Date.now() - last));
        return new Promise((r) => setTimeout(r, wait)).then(() => {
          last = Date.now();
          return task();
        });
      });
      chain = run.catch(() => {});
      return run;
    };
  }

  /* Open-Meteo 免费额度按“格点数 × 天数 × 变量数”计权（600/分、5000/时），
     故全站串行且任意两次调用间隔 ≥65 秒，保证同一分钟内最多 1 次请求 */
  const meteoGate = pacer(65000);

  /* 本地快照：额度冷却或离线时用最近一次成功的格网数据兜底，界面上明确标注数据时刻 */
  function cacheSet(key, payload) {
    try { localStorage.setItem('tl.' + key, JSON.stringify({ at: Date.now(), data: payload })); }
    catch (e) { /* 配额满则忽略 */ }
  }

  function cacheGet(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem('tl.' + key);
      if (!raw) return null;
      const box = JSON.parse(raw);
      if (!box || !box.at || !box.data) return null;
      if (maxAgeMs && Date.now() - box.at > maxAgeMs) return null;
      return box;
    } catch (e) { return null; }
  }

  function fmtAgo(ms) {
    const d = Math.max(0, Date.now() - ms);
    const m = Math.floor(d / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }

  /* 为整幅格网的拉取设置墙钟截止时间，避免重试链拖住界面状态 */
  function withDeadline(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(fallback);
      }, ms);
      promise.then((v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      }).catch(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      });
    });
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function normLon(lon) { return ((lon + 540) % 360) - 180; }

  return {
    clamp, lerp, round, pad,
    fmtUTC, fmtUTCDate, fmtLocal, fmtNum, timeAgo, fmtCoord,
    esc, throttle, debounce, fetchJSON, fetchText, fetchJSONPost, fetchJSONRetry, pacer, meteoGate,
    withDeadline, nextQuotaReset, meteoCooldown, cacheSet, cacheGet, fmtAgo, chunks, hash, normLon
  };
})();