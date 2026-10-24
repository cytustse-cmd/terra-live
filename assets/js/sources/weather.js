/* TERRA LIVE — Open-Meteo 全球格网：极端高温 / 强降雨 / 暴雨 / 强风 / 严寒
   说明：整幅格网一次请求（格点写入请求体，避开 URL 长度上限），全站串行节流，
   遇 429 配额错误则进入整点冷却，不做无谓重试。 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.weather = (function () {
  const U = TL.util;
  const S = TL.store;
  const CFG = TL.CONFIG.wxGrid;
  const gate = U.meteoGate;
  const API = 'https://api.open-meteo.com/v1/forecast';
  const CD = U.meteoCooldown;
  const LABEL = 'Open-Meteo 全球格网';

  let lastErr = null;
  let inflight = null;
  let retryTimer = null;

  const CAPS = { heat: 45, rain: 45, live: 30, wind: 20, cold: 20 };

  function buildGrid() {
    const pts = [];
    for (let lat = -CFG.latMax; lat <= CFG.latMax + 0.001; lat += CFG.step) {
      for (let lon = -180; lon < 180; lon += CFG.step) pts.push({ lat, lon });
    }
    return pts;
  }

  function query(grid) {
    const lat = grid.map((p) => p.lat.toFixed(2)).join(',');
    const lon = grid.map((p) => p.lon.toFixed(2)).join(',');
    return 'latitude=' + lat + '&longitude=' + lon
      + '&current=temperature_2m,apparent_temperature,wind_gusts_10m,precipitation'
      + '&daily=precipitation_sum,temperature_2m_max'
      + '&past_days=2&forecast_days=1&timezone=UTC&wind_speed_unit=kmh';
  }

  function parseOne(d, req) {
    if (!d || !d.current) return null;
    const dl = d.daily || {};
    const sums = dl.precipitation_sum || [];
    const tmaxs = dl.temperature_2m_max || [];
    return {
      lon: req.lon, lat: req.lat,
      temp: d.current.temperature_2m,
      app: d.current.apparent_temperature,
      wind: d.current.wind_gusts_10m,
      rate: d.current.precipitation,
      rain: sums.length > 1 ? sums[1] : (sums[0] || 0),   // 上一完整 UTC 日的 24 小时累计
      tmax: tmaxs.length ? tmaxs[tmaxs.length - 1] : null
    };
  }

  function eventsFor(p) {
    const out = [];
    const where = '格点 ' + U.fmtCoord(p.lat, p.lon);

    if (p.app !== null && p.app !== undefined && p.app >= CFG.heatWarn) {
      const tier = p.app >= CFG.heatExtreme ? { t: '极端高温', color: 1 }
        : (p.app >= CFG.heatSevere ? { t: '严重高温' } : { t: '高温' });
      out.push({
        id: 'wx:heat:' + p.lat + ':' + p.lon,
        source: 'wx', hazard: 'heat',
        title: tier.t + ' ' + U.fmtNum(p.app, 1) + '°C（体感）',
        subtitle: '气温 ' + U.fmtNum(p.temp, 1) + '°C · ' + where,
        lon: p.lon, lat: p.lat, time: Date.now(),
        severity: U.clamp((p.app - 30) / 13, 0.2, 1),
        magnitude: { value: U.round(p.app, 1), unit: '°C' }, value: U.round(p.app, 1),
        desc: 'Open-Meteo 全球模式格点实时体感温度达 ' + U.fmtNum(p.app, 1) + '°C，'
          + '处于' + (tier.t === '高温' ? '高温' : '极端高温') + '区间，伴随热射病与电力负荷风险。',
        meta: [
          { k: '体感温度', v: U.fmtNum(p.app, 1) + ' °C' },
          { k: '实际气温', v: U.fmtNum(p.temp, 1) + ' °C' },
          { k: '今日最高', v: p.tmax === null ? '--' : U.fmtNum(p.tmax, 1) + ' °C' },
          { k: '阵风', v: U.fmtNum(p.wind, 0) + ' km/h' },
          { k: '分级阈值', v: CFG.heatWarn + ' / ' + CFG.heatSevere + ' / ' + CFG.heatExtreme + ' °C' }
        ]
      });
    }

    if (p.rate !== null && p.rate !== undefined && p.rate >= CFG.rainLive) {
      out.push({
        id: 'wx:live:' + p.lat + ':' + p.lon,
        source: 'wx', hazard: 'flood',
        title: '短时强降水 ' + U.fmtNum(p.rate, 1) + ' mm/h',
        subtitle: where,
        lon: p.lon, lat: p.lat, time: Date.now(),
        severity: U.clamp(p.rate / 20, 0.25, 1),
        magnitude: { value: U.round(p.rate, 1), unit: 'mm/h' }, value: U.round(p.rate, 1),
        desc: '当前小时降水强度达 ' + U.fmtNum(p.rate, 1) + ' mm/h，为短时强降水，'
          + '易引发城市内涝与山洪，山区需防范泥石流。',
        meta: [
          { k: '当前强度', v: U.fmtNum(p.rate, 1) + ' mm/h' },
          { k: '昨日累计', v: U.fmtNum(p.rain, 1) + ' mm' },
          { k: '气温', v: U.fmtNum(p.temp, 1) + ' °C' },
          { k: '判定阈值', v: CFG.rainLive + ' mm/h' }
        ]
      });
    }

    if (p.rain >= CFG.rainHeavy) {
      const storm = p.rain >= CFG.rainStorm;
      out.push({
        id: 'wx:rain:' + p.lat + ':' + p.lon,
        source: 'wx', hazard: 'flood',
        title: (storm ? '暴雨 ' : '大雨 ') + U.fmtNum(p.rain, 0) + ' mm / 24h',
        subtitle: where,
        lon: p.lon, lat: p.lat, time: Date.now(),
        severity: U.clamp(p.rain / 180, storm ? 0.45 : 0.24, 1),
        magnitude: { value: p.rain, unit: 'mm/24h' }, value: p.rain,
        desc: '最近一个完整 UTC 日累计降水 ' + U.fmtNum(p.rain, 0) + ' mm，达到'
          + (storm ? '暴雨量级' : '大雨量级') + '，需关注内涝、山洪与泥石流风险。',
        meta: [
          { k: '24 小时降水', v: U.fmtNum(p.rain, 1) + ' mm' },
          { k: '当前强度', v: U.fmtNum(p.rate, 1) + ' mm/h' },
          { k: '气温', v: U.fmtNum(p.temp, 1) + ' °C' },
          { k: '分级阈值', v: CFG.rainHeavy + ' / ' + CFG.rainStorm + ' mm' }
        ]
      });
    }

    if (p.wind !== null && p.wind !== undefined && p.wind >= CFG.windKmh) {
      out.push({
        id: 'wx:wind:' + p.lat + ':' + p.lon,
        source: 'wx', hazard: 'severe',
        title: '强风 ' + U.fmtNum(p.wind, 0) + ' km/h',
        subtitle: where,
        lon: p.lon, lat: p.lat, time: Date.now(),
        severity: U.clamp(p.wind / 200, 0.25, 1),
        magnitude: { value: U.round(p.wind, 0), unit: 'km/h' }, value: U.round(p.wind, 0),
        desc: '阵风风速达 ' + U.fmtNum(p.wind, 0) + ' km/h，可能造成设施损毁、停电与交通中断。',
        meta: [
          { k: '阵风', v: U.fmtNum(p.wind, 0) + ' km/h' },
          { k: '气温', v: U.fmtNum(p.temp, 1) + ' °C' },
          { k: '判定阈值', v: CFG.windKmh + ' km/h' }
        ]
      });
    }

    if (p.temp !== null && p.temp !== undefined && p.temp <= CFG.coldC) {
      out.push({
        id: 'wx:cold:' + p.lat + ':' + p.lon,
        source: 'wx', hazard: 'cold',
        title: '严寒 ' + U.fmtNum(p.temp, 1) + '°C',
        subtitle: where,
        lon: p.lon, lat: p.lat, time: Date.now(),
        severity: U.clamp((-p.temp - 12) / 25, 0.25, 1),
        magnitude: { value: U.round(p.temp, 1), unit: '°C' }, value: U.round(p.temp, 1),
        desc: '实时气温低至 ' + U.fmtNum(p.temp, 1) + '°C，存在冻伤、道路结冰与能源负荷风险。',
        meta: [
          { k: '气温', v: U.fmtNum(p.temp, 1) + ' °C' },
          { k: '体感', v: U.fmtNum(p.app, 1) + ' °C' },
          { k: '判定阈值', v: CFG.coldC + ' °C' }
        ]
      });
    }
    return out;
  }

  /* 整幅格网一次拉取：格点走请求体；冷却期内直接跳过，配额错误即刻触发全站冷却 */
  function fetchGrid(grid) {
    return gate(() => {
      if (CD.active()) { const e = new Error('配额冷却中'); e.quota = true; throw e; }
      return U.fetchJSONRetry(API, { body: query(grid), timeout: 45000, retries: 1, base: 20000 });
    })
      .then((res) => {
        const arr = Array.isArray(res) ? res : [res];
        return arr.map((d, i) => parseOne(d, grid[i])).filter(Boolean);
      })
      .catch((err) => {
        if (err.quota) CD.trip();
        throw err;
      });
  }

  function load() {
    if (inflight) return inflight;          // 合并并发请求，避免手动刷新叠加额度消耗
    inflight = run().then(
      (r) => { inflight = null; return r; },
      (e) => { inflight = null; throw e; }
    );
    return inflight;
  }

  /* 冷却到期后自行补拉一次，避免干等到下一个刷新周期 */
  function armRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; load(); },
      Math.max(60000, CD.until - Date.now() + 5000));
  }

  function run() {
    if (CD.active()) {
      S.setStatus('wx', { state: 'error', note: CD.note(LABEL) });
      armRetry();
      return Promise.resolve({ list: [], fresh: 0 });
    }
    S.setStatus('wx', { state: 'loading' });
    const t0 = performance.now();
    const grid = buildGrid();
    lastErr = null;

    return U.withDeadline(fetchGrid(grid).catch((err) => { lastErr = err; return []; }), 150000, [])
      .then((res) => {
        let field = res;
        let cachedAt = 0;
        if (!field.length) {                       // 冷却/失败时回落到本地快照，标注数据时刻
          const snap = U.cacheGet('wxField', 12 * 3600000);
          if (snap && snap.data && snap.data.length) { field = snap.data; cachedAt = snap.at; }
        }
        if (!field.length) {
          if (CD.active()) armRetry();
          S.setStatus('wx', {
            state: 'error',
            note: CD.active() ? CD.note(LABEL)
              : (lastErr ? '格点请求失败 ' + lastErr.message : '格点请求超时，下个周期重试')
          });
          return { list: [], fresh: 0 };
        }
        const live = !cachedAt;
        if (live) U.cacheSet('wxField', field);

        const ev = [];
        field.forEach((p) => { eventsFor(p).forEach((e) => ev.push(e)); });

        const kept = [];
        ['heat', 'live', 'rain', 'wind', 'cold'].forEach((type) => {
          const sub = ev.filter((e) => {
            if (type === 'cold') return e.hazard === 'cold';
            if (type === 'wind') return e.hazard === 'severe';
            if (type === 'heat') return e.hazard === 'heat';
            return e.id.indexOf('wx:' + type + ':') === 0;
          });
          sub.sort((a, b) => (type === 'cold' ? a.value - b.value : b.value - a.value));
          kept.push.apply(kept, sub.slice(0, CAPS[type]));
        });

        const fresh = S.upsert(kept, 'wx');
        S.setField('wx', field);
        S.setFieldMeta({ wxAt: cachedAt || Date.now(), wxPoints: field.length, wxCached: !!cachedAt });
        if (live) TL.geocode.enrich(kept.slice(0, 14));

        const maxT = field.reduce((a, b) => (b.temp > (a ? a.temp : -999) ? b : a), null);
        const maxR = field.reduce((a, b) => (b.rain > (a ? a.rain : -1) ? b : a), null);
        const maxLive = field.reduce((a, b) => (b.rate > (a ? a.rate : -1) ? b : a), null);
        S.setStatus('wx', {
          state: live ? 'ok' : 'cached',
          ms: Math.round(performance.now() - t0), count: kept.length,
          note: live
            ? '整幅 ' + field.length + ' 格点 · 极值 ' + kept.length + ' 条'
              + (maxT ? ' · 最高 ' + U.fmtNum(maxT.temp, 1) + '°C' : '')
              + (maxLive && maxLive.rate > 0 ? ' · 实时雨强 ' + U.fmtNum(maxLive.rate, 1) + 'mm/h' : '')
              + (maxR && maxR.rain > 0 ? ' · 最大 24h 雨量 ' + U.fmtNum(maxR.rain, 0) + 'mm' : '')
            : '本地快照 ' + U.fmtAgo(cachedAt) + ' · ' + field.length + ' 格点 · 极值 ' + kept.length + ' 条'
        });
        return { list: kept, fresh };
      });
  }

  return { load, buildGrid };
})();