/* TERRA LIVE — NOAA / NWS 美国气象预警适配器 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.nws = (function () {
  const U = TL.util;
  const S = TL.store;

  const RULES = [
    { re: /volcan/i, hazard: 'volcano' },
    { re: /tsunami/i, hazard: 'severe', zh: '海啸' },
    { re: /debris flow|landslide|mudslide/i, hazard: 'landslide' },
    { re: /flash flood|flood|hydrologic/i, hazard: 'flood' },
    { re: /hurricane|tropical storm|storm surge|typhoon/i, hazard: 'storm' },
    { re: /red flag|fire weather|fire warning/i, hazard: 'wildfire' },
    { re: /excessive heat|heat advisory|heat warning/i, hazard: 'heat' },
    { re: /blizzard|winter storm|snow squall|lake effect snow|snow/i, hazard: 'snow' },
    { re: /wind chill|extreme cold|freeze|frost/i, hazard: 'cold' },
    { re: /dust/i, hazard: 'dust' },
    { re: /drought/i, hazard: 'drought' },
    { re: /tornado|thunderstorm|severe thunderstorm|high wind|wind advisory|special marine/i, hazard: 'severe' },
    { re: /ice storm|freezing rain/i, hazard: 'snow' }
  ];
  const SEV = { Extreme: 0.95, Severe: 0.76, Moderate: 0.5, Minor: 0.3, Unknown: 0.4 };

  function classify(name) {
    for (let i = 0; i < RULES.length; i++) if (RULES[i].re.test(name)) return RULES[i];
    return null;
  }

  function centroid(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'Polygon') return polyCenter(geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      let best = null, bestLen = -1;
      geom.coordinates.forEach((poly) => {
        const len = poly[0] ? poly[0].length : 0;
        if (len > bestLen) { bestLen = len; best = poly; }
      });
      return best ? polyCenter(best) : null;
    }
    return null;
  }
  function polyCenter(rings) {
    const ring = rings && rings[0];
    if (!ring || !ring.length) return null;
    let minX = 180, maxX = -180, minY = 90, maxY = -90;
    ring.forEach((p) => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function toEvent(f) {
    const p = f.properties || {};
    const rule = classify(p.event || '');
    if (!rule) return null;
    const c = centroid(f.geometry);
    if (!c) return null;
    const zh = rule.zh || (TL.HAZARDS[rule.hazard] ? TL.HAZARDS[rule.hazard].zh : '预警');
    const sent = Date.parse(p.sent || p.onset || '') || Date.now();
    const expires = Date.parse(p.expires || '') || null;
    if (expires && expires < Date.now()) return null;
    return {
      id: 'nws:' + (p.id || U.hash(p.event + c[0] + c[1] + p.sent)),
      source: 'nws',
      hazard: rule.hazard,
      title: zh + ' · ' + (p.event || '警报'),
      subtitle: (p.areaDesc || '美国').split(';')[0] + ' · ' + (p.senderName || 'NWS'),
      lon: c[0], lat: c[1],
      time: sent,
      severity: SEV[p.severity] || 0.45,
      magnitude: null,
      value: null,
      alert: (p.severity || '').toLowerCase(),
      url: p['@id'] || 'https://www.weather.gov',
      desc: p.headline || p.description || '',
      geom: f.geometry || null,
      meta: [
        { k: '严重度', v: p.severity || '--' },
        { k: '紧急度', v: p.urgency || '--' },
        { k: '确信度', v: p.certainty || '--' },
        { k: '影响范围', v: (p.areaDesc || '--').slice(0, 90) },
        { k: '生效', v: U.fmtLocal(p.onset || p.sent) },
        { k: '失效', v: p.expires ? U.fmtLocal(p.expires) : '--' }
      ]
    };
  }

  function load() {
    S.setStatus('nws', { state: 'loading' });
    const t0 = performance.now();
    const base = 'https://api.weather.gov/alerts/active?status=actual&severity=';
    return Promise.all([
      U.fetchJSON(base + 'Extreme', 30000),
      U.fetchJSON(base + 'Severe', 30000)
    ]).then((res) => {
      const seen = new Set();
      const list = [];
      res.forEach((d) => {
        (d.features || []).forEach((f) => {
          const e = toEvent(f);
          if (e && !seen.has(e.id)) { seen.add(e.id); list.push(e); }
        });
      });
      const fresh = S.upsert(list, 'nws');
      S.setStatus('nws', {
        state: 'ok', ms: Math.round(performance.now() - t0), count: list.length,
        note: '美国区域 · Extreme/Severe ' + list.length + ' 条生效预警'
      });
      return { list, fresh };
    }).catch((err) => {
      S.setStatus('nws', { state: 'error', note: '连接失败 ' + err.message });
      throw err;
    });
  }

  return { load };
})();