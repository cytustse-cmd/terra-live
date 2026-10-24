/* TERRA LIVE — 反向地理编码（Nominatim）— 仅用于极值格点命名，节流 + 缓存 */
window.TL = window.TL || {};

TL.geocode = (function () {
  const U = TL.util;
  const KEY = 'terra-live.geocache.v1';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { cache = {}; }
  let queue = [];
  let running = false;

  function cellKey(lat, lon) { return lat.toFixed(2) + ',' + lon.toFixed(2); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* 配额满则忽略 */ }
  }

  function splitLocal(name) {
    const parts = String(name || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return { region: '', country: '' };
    const country = parts[parts.length - 1];
    const region = parts.slice(0, Math.max(1, parts.length - 1)).slice(-2).join(' · ');
    return { region, country };
  }

  function drain() {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift();
    const key = cellKey(job.lat, job.lon);
    if (cache[key]) {
      job.apply(cache[key]);
      running = false;
      return setTimeout(drain, 0);
    }
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5'
      + '&accept-language=zh&lat=' + job.lat.toFixed(3) + '&lon=' + job.lon.toFixed(3);
    U.fetchJSON(url, 20000).then((d) => {
      const info = splitLocal(d.display_name);
      const name = info.region || info.country || '未知区域';
      cache[key] = { region: name, country: info.country };
      job.apply(cache[key]);
    }).catch(() => {
      cache[key] = { region: '', country: '' };
      job.apply(cache[key]);
    }).finally(() => {
      save();
      running = false;
      setTimeout(drain, 1150);   // Nominatim 使用条款：≤1 请求/秒
    });
  }

  function reverse(lat, lon) {
    return new Promise((resolve) => {
      const key = cellKey(lat, lon);
      if (cache[key]) return resolve(cache[key]);
      queue.push({ lat, lon, apply: resolve });
      drain();
    });
  }

  /* 为事件批量补充地名（写回 store，触发 UI 刷新） */
  function enrich(list) {
    const targets = (list || []).filter((e) => !e.region);
    if (!targets.length) return Promise.resolve(0);
    let done = 0;
    return Promise.all(targets.map((e) => reverse(e.lat, e.lon).then((info) => {
      if (info && info.region) {
        e.region = info.region;
        e.subtitle = info.region + ' · ' + e.subtitle;
        const stored = TL.store.get(e.id);
        if (stored) stored.subtitle = e.subtitle;
        done++;
      }
    }))).then(() => { if (done) TL.store.emit('data'); return done; });
  }

  return { reverse, enrich };
})();