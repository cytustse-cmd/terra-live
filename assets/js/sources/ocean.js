/* TERRA LIVE — 海表温度异常场与 Niño 分区监测（Open-Meteo 海洋 API） */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.ocean = (function () {
  const U = TL.util;
  const S = TL.store;
  const CFG = TL.CONFIG.oceanGrid;
  const BOXES = TL.CONFIG.ninoBoxes;
  const WP = TL.CONFIG.westPacificBox;
  const gate = U.meteoGate;
  const API = 'https://marine-api.open-meteo.com/v1/marine';
  const CD = U.meteoCooldown;
  const LABEL = 'Open-Meteo 海洋海温';

  let lastErr = null;
  let inflight = null;
  let retryTimer = null;

  function buildGrid() {
    const pts = [];
    /* 经度区间跨 180°（120°E → 80°W），末端需折算到 120…280 的连续区间 */
    const lonTo = CFG.lonEnd <= CFG.lonStart ? CFG.lonEnd + 360 : CFG.lonEnd;
    for (let lat = -CFG.latMax; lat <= CFG.latMax + 0.001; lat += CFG.step) {
      for (let lon = CFG.lonStart; lon <= lonTo + 0.001; lon += CFG.step) {
        pts.push({ lat, lon: U.normLon(lon), raw: lon });
      }
    }
    return pts;
  }

  function query(grid) {
    const lat = grid.map((p) => p.lat.toFixed(2)).join(',');
    const lon = grid.map((p) => p.lon.toFixed(2)).join(',');
    return 'latitude=' + lat + '&longitude=' + lon
      + '&daily=sea_surface_temperature_mean&past_days=' + CFG.pastDays + '&forecast_days=1&timezone=UTC';
  }

  function mean(arr) {
    const v = arr.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  function inBox(p, b) {
    const lon = U.normLon(p.raw !== undefined ? p.raw : p.lon);
    const l1 = U.normLon(b.lon1), l2 = U.normLon(b.lon2);
    const okLon = l1 <= l2 ? (lon >= l1 && lon <= l2) : (lon >= l1 || lon <= l2);
    return okLon && p.lat >= b.lat1 && p.lat <= b.lat2;
  }

  function mapLimit(items, limit, worker) {
    let idx = 0;
    function next() {
      if (idx >= items.length) return Promise.resolve();
      const i = idx++;
      return Promise.resolve(worker(items[i], i)).then(next);
    }
    const runners = [];
    for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
    return Promise.all(runners);
  }

  function analyze(d, req) {
    if (!d || !d.daily || !d.daily.sea_surface_temperature_mean) return null;
    const vals = d.daily.sea_surface_temperature_mean;
    const n = vals.length;
    if (n < 14) return null;
    const cut = Math.max(1, n - 8);
    const recent = mean(vals.slice(cut));
    const baseline = mean(vals.slice(0, cut));
    if (recent === null || baseline === null) return null;
    return {
      lon: req.lon, lat: req.lat, raw: req.raw,
      sst: U.round(recent, 2),
      anom: U.round(recent - baseline, 2),
      days: n
    };
  }

  /* 整幅海区一次拉取（与 forecast 端点共享免费额度）；冷却期内直接跳过 */
  function fetchGrid(grid) {
    return gate(() => {
      if (CD.active()) { const e = new Error('配额冷却中'); e.quota = true; throw e; }
      return U.fetchJSONRetry(API, { body: query(grid), timeout: 50000, retries: 1, base: 20000 });
    })
      .then((res) => {
        const arr = Array.isArray(res) ? res : [res];
        return arr.map((d, i) => analyze(d, grid[i])).filter(Boolean);
      })
      .catch((err) => {
        if (err.quota) CD.trip();
        throw err;
      });
  }

  function load() {
    if (inflight) return inflight;
    inflight = run().then(
      () => { inflight = null; },
      (e) => { inflight = null; throw e; }
    );
    return inflight;
  }

  /* 冷却到期后自行补拉一次 */
  function armRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; load(); },
      Math.max(60000, CD.until - Date.now() + 5000));
  }

  function run() {
    if (CD.active()) {
      S.setStatus('ocean', { state: 'error', note: CD.note(LABEL) });
      armRetry();
      return Promise.resolve();
    }
    S.setStatus('ocean', { state: 'loading' });
    const t0 = performance.now();
    const grid = buildGrid();
    lastErr = null;

    return U.withDeadline(fetchGrid(grid).catch((err) => { lastErr = err; return []; }), 200000, [])
      .then((res) => {
        let field = res;
        let cachedAt = 0;
        if (field.length < 40) {                   // 冷却/失败时回落到本地快照
          const snap = U.cacheGet('sstField', 24 * 3600000);
          if (snap && snap.data && snap.data.length >= 40) { field = snap.data; cachedAt = snap.at; }
        }
        if (field.length < 40) {
          if (CD.active()) armRetry();
          S.setStatus('ocean', {
            state: 'error',
            note: CD.active() ? CD.note(LABEL)
              : (lastErr ? '海温请求失败 ' + lastErr.message : '海温格点不足（' + field.length + ' 个），下个周期重试')
          });
          return;
        }
        const live = !cachedAt;
        if (live) U.cacheSet('sstField', field);

        const regions = {};
        Object.keys(BOXES).forEach((k) => {
          const sub = field.filter((p) => inBox(p, BOXES[k]));
          regions[k] = { anom: U.round(mean(sub.map((p) => p.anom)) || 0, 2), sst: U.round(mean(sub.map((p) => p.sst)) || 0, 2), n: sub.length };
        });
        const wp = field.filter((p) => inBox(p, WP));
        const wpAnom = U.round(mean(wp.map((p) => p.anom)) || 0, 2);
        const derived = U.round((regions['3.4'] ? regions['3.4'].anom : 0) - wpAnom, 2);

        S.setClimate({
          regions, wpAnom, derivedIndex: derived,
          sstMean: U.round(mean(field.map((p) => p.sst)) || 0, 2),
          sstPoints: field.length,
          sstCached: !live,
          oceanAt: cachedAt || Date.now()
        });
        S.setField('sst', field);
        S.setFieldMeta({ sstAt: cachedAt || Date.now(), sstPoints: field.length, sstDays: field[0] ? field[0].days : 0, sstCached: !live });

        S.setStatus('ocean', {
          state: live ? 'ok' : 'cached',
          ms: Math.round(performance.now() - t0), count: field.length,
          note: (live ? '赤道太平洋 ' : '本地快照 ' + U.fmtAgo(cachedAt) + ' · ')
            + field.length + ' 个海区'
            + ' · Niño3.4 距平 ' + (regions['3.4'] ? regions['3.4'].anom : '--') + '°C'
        });
      });
  }

  return { load, buildGrid };
})();