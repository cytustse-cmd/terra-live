/* TERRA LIVE — NASA EONET 地球观测事件适配器 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.eonet = (function () {
  const U = TL.util;
  const S = TL.store;
  const URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=all&limit=600';

  const CAT = {
    wildfires: 'wildfire',
    severeStorms: 'storm',
    floods: 'flood',
    landslides: 'landslide',
    drought: 'drought',
    volcanoes: 'volcano',
    dustAndHaze: 'dust',
    seaLakeIce: 'seaice',
    snow: 'snow',
    temperatureExtremes: 'heat',
    earthquakes: 'earthquake',
    manmade: 'manmade'
  };

  const COLDC = /cold|freez|frost|blizzard|chill|snow|低温|寒/i;

  function severityOf(hazard, magValue, unit, title) {
    const v = Math.abs(magValue || 0);
    switch (hazard) {
      case 'wildfire': return U.clamp(Math.log10(Math.max(v, 1)) / 5.2, 0.25, 1);        // acres / ha
      case 'storm': return U.clamp(v / 150, 0.3, 1);                                       // knots
      case 'heat': return U.clamp(v / 50, 0.3, 1);
      case 'cold': return U.clamp(v / 50, 0.3, 1);
      case 'volcano': return 0.72;
      case 'drought': return 0.55;
      case 'flood': return U.clamp(Math.log10(Math.max(v, 1)) / 4.2, 0.3, 0.95);
      case 'seaice': return U.clamp(Math.log10(Math.max(v, 1)) / 6, 0.2, 0.85);
      case 'earthquake': return U.clamp((v + 0.6) / 8.2, 0.1, 1);
      default: return 0.42;
    }
  }

  function centroid(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    const ring = geom.type === 'Polygon' ? geom.coordinates[0] : (geom.coordinates[0] && geom.coordinates[0][0]);
    if (!ring || !ring.length) return null;
    let x = 0, y = 0;
    ring.forEach((p) => { x += p[0]; y += p[1]; });
    return [x / ring.length, y / ring.length];
  }

  function toEvent(ev) {
    const cat = ev.categories && ev.categories[0] ? ev.categories[0].id : null;
    let hazard = CAT[cat] || null;
    if (!hazard) return null;
    const g = ev.geometry && ev.geometry.length ? ev.geometry[ev.geometry.length - 1] : null;
    const coord = centroid(g);
    if (!coord) return null;
    const title = ev.title || 'EONET 事件';
    if (hazard === 'heat' && COLDC.test(title)) hazard = 'cold';
    const magValue = g.magnitudeValue;
    const unit = g.magnitudeUnit || '';
    const state = ev.closed ? '已结束' : '进行中';
    return {
      id: 'eonet:' + ev.id,
      source: 'eonet',
      hazard,
      title,
      subtitle: (ev.sources && ev.sources[0] ? ev.sources[0].id : 'NASA EONET') + ' · ' + state,
      lon: coord[0], lat: coord[1],
      time: Date.parse(g.date) || Date.now(),
      endTime: ev.closed ? Date.parse(ev.closed) || null : null,
      severity: severityOf(hazard, magValue, unit, title),
      magnitude: magValue ? { value: magValue, unit: unit || '' } : null,
      value: magValue === null || magValue === undefined ? null : magValue,
      url: ev.link || null,
      desc: ev.description || 'NASA EONET 记录的' + (ev.categories[0].title || '') + '事件',
      meta: [
        { k: '类别', v: (ev.categories || []).map((c) => c.title).join(' / ') || '--' },
        { k: '观测值', v: magValue === null || magValue === undefined ? '--' : U.round(magValue, 2) + ' ' + unit },
        { k: '状态', v: state },
        { k: '观测时间', v: U.fmtLocal(g.date) },
        { k: '数据提供', v: (ev.sources || []).map((s) => s.id).join(', ') || 'EONET' }
      ]
    };
  }

  function load() {
    S.setStatus('eonet', { state: 'loading' });
    const t0 = performance.now();
    return U.fetchJSON(URL, 40000).then((d) => {
      const list = (d.events || []).map(toEvent).filter(Boolean);
      const fresh = S.upsert(list, 'eonet');
      const byCat = {};
      list.forEach((e) => { byCat[e.hazard] = (byCat[e.hazard] || 0) + 1; });
      S.setStatus('eonet', {
        state: 'ok', ms: Math.round(performance.now() - t0), count: list.length,
        note: '近 30 天 · ' + list.length + ' 条观测'
      });
      return { list, fresh };
    }).catch((err) => {
      S.setStatus('eonet', { state: 'error', note: '连接失败 ' + err.message });
      throw err;
    });
  }

  return { load };
})();