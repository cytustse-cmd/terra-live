/* TERRA LIVE — USGS 地震台网适配器 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.usgs = (function () {
  const U = TL.util;
  const S = TL.store;
  const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
  let monthLoaded = false;

  function toEvent(f) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    if (!c) return null;
    const mag = p.mag === null || p.mag === undefined ? 0 : p.mag;
    const kind = p.type && p.type !== 'earthquake' ? p.type : '';
    return {
      id: 'usgs:' + f.id,
      source: 'usgs',
      hazard: 'earthquake',
      title: `M ${mag.toFixed(1)} 地震`,
      subtitle: p.place || '未知区域',
      lon: c[0], lat: c[1],
      time: p.time || Date.now(),
      severity: U.clamp((mag + 0.6) / 8.2, 0.04, 1),
      magnitude: { value: mag, unit: 'M' },
      value: mag,
      alert: p.alert || null,
      url: p.url || null,
      desc: kind ? `USGS 事件类型：${kind}` : 'USGS 地震台网自动测定事件',
      meta: [
        { k: '震源深度', v: (c[2] === null || c[2] === undefined ? '--' : c[2].toFixed(1) + ' km') },
        { k: '烈度 MMI', v: p.mmi === null || p.mmi === undefined ? '--' : p.mmi },
        { k: '感知报告', v: p.felt === null || p.felt === undefined ? '0' : p.felt },
        { k: '台网', v: (p.net || '').toUpperCase() },
        { k: '海啸风险', v: p.tsunami ? '有' : '无' },
        { k: '测定状态', v: p.status === 'reviewed' ? '人工复核' : '自动' }
      ]
    };
  }

  function feed(name) {
    return U.fetchJSON(BASE + name + '.geojson', 30000).then((d) => {
      const list = (d.features || []).map(toEvent).filter(Boolean);
      const fresh = S.upsert(list, 'usgs');
      return { list, fresh };
    });
  }

  function load(isFirst) {
    S.setStatus('usgs', { state: 'loading' });
    const t0 = performance.now();
    const job = isFirst ? feed('all_week') : feed('all_day');
    return job.then(({ list, fresh }) => {
      const note = isFirst ? '近 7 天 · ' + list.length + ' 条' : '近 24 小时 · ' + list.length + ' 条';
      S.setStatus('usgs', { state: 'ok', ms: Math.round(performance.now() - t0), count: list.length, note, fresh });
      return list.length;
    }).catch((err) => {
      S.setStatus('usgs', { state: 'error', note: '连接失败 ' + err.message });
      throw err;
    });
  }

  function loadMonth() {
    if (monthLoaded) return Promise.resolve(0);
    monthLoaded = true;
    S.setStatus('usgs', { state: 'loading', note: '拉取近 30 天目录…' });
    const t0 = performance.now();
    return feed('all_month').then(({ list }) => {
      S.setStatus('usgs', { state: 'ok', ms: Math.round(performance.now() - t0), count: list.length, note: '近 30 天 · ' + list.length + ' 条' });
      return list.length;
    }).catch(() => { monthLoaded = false; return 0; });
  }

  return { load, loadMonth, feed };
})();