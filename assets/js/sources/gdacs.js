/* TERRA LIVE — GDACS 全球灾害告警适配器 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.gdacs = (function () {
  const U = TL.util;
  const S = TL.store;

  const TYPE = {
    EQ: { hazard: 'earthquake', zh: '地震', unit: 'M', sev: (v) => U.clamp((v + 0.6) / 8.2, 0.15, 1) },
    TC: { hazard: 'storm', zh: '热带气旋', unit: 'km/h', sev: (v) => U.clamp(v / 250, 0.3, 1) },
    FL: { hazard: 'flood', zh: '洪涝', unit: '', sev: (v) => U.clamp(Math.log10(Math.max(v, 1)) / 4, 0.3, 0.95) },
    VO: { hazard: 'volcano', zh: '火山', unit: '', sev: () => 0.72 },
    DR: { hazard: 'drought', zh: '干旱', unit: '', sev: () => 0.55 },
    WF: { hazard: 'wildfire', zh: '野火', unit: 'ha', sev: (v) => U.clamp(Math.log10(Math.max(v, 1)) / 5, 0.3, 1) }
  };
  const LEVEL = { Red: 3, Orange: 2, Green: 1 };
  const LEVEL_ZH = { Red: '红色告警', Orange: '橙色告警', Green: '绿色告警' };

  function parseDate(s) {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  function toEvent(f) {
    const p = f.properties || {};
    const meta = TYPE[p.eventtype];
    if (!meta) return null;
    const c = f.geometry && f.geometry.coordinates;
    if (!c) return null;
    const sd = p.severitydata || {};
    const val = typeof sd.severity === 'number' ? sd.severity : null;
    const lvl = LEVEL[p.alertlevel] || 0;
    let severity = U.clamp(lvl / 3, 0.25, 1);
    if (val !== null) severity = Math.max(severity * 0.75, meta.sev(val));
    return {
      id: 'gdacs:' + p.eventtype + ':' + p.eventid + ':' + p.episodeid,
      source: 'gdacs',
      hazard: meta.hazard,
      title: meta.zh + ' · ' + (p.eventname || p.name || '未知事件'),
      subtitle: (p.country || '全球') + ' · ' + (LEVEL_ZH[p.alertlevel] || '未分级'),
      lon: c[0], lat: c[1],
      time: parseDate(p.todate) || parseDate(p.fromdate) || parseDate(p.datemodified) || Date.now(),
      endTime: null,
      severity,
      magnitude: val === null ? null : { value: val, unit: sd.severityunit || meta.unit },
      value: val,
      alert: (p.alertlevel || '').toLowerCase() || null,
      url: (p.url && (p.url.report || p.url.details)) || null,
      desc: p.htmldescription ? p.htmldescription.replace(/<[^>]+>/g, '') : (p.description || 'GDACS 全球灾害告警系统事件'),
      meta: [
        { k: '告警等级', v: LEVEL_ZH[p.alertlevel] || '--' },
        { k: '告警分值', v: p.alertscore === undefined ? '--' : p.alertscore + ' / 3' },
        { k: '强度', v: sd.severitytext || (val === null ? '--' : U.round(val, 1) + ' ' + (sd.severityunit || '')) },
        { k: '起始', v: U.fmtLocal(p.fromdate) },
        { k: '最后更新', v: U.fmtLocal(p.todate) },
        { k: 'GLIDE', v: p.glide || '--' }
      ]
    };
  }

  function load() {
    S.setStatus('gdacs', { state: 'loading' });
    const t0 = performance.now();
    const to = new Date();
    const from = new Date(Date.now() - 90 * 86400000);
    const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
      + '?eventlist=EQ,TC,FL,VO,DR,WF'
      + '&fromDate=' + U.fmtUTCDate(from) + '&toDate=' + U.fmtUTCDate(to);
    return U.fetchJSONRetry(url, { timeout: 20000, retries: 1, base: 4000 }).then((d) => {
      const list = (d.features || []).map(toEvent).filter(Boolean);
      const fresh = S.upsert(list, 'gdacs');
      const red = list.filter((e) => e.alert === 'red').length;
      S.setStatus('gdacs', {
        state: 'ok', ms: Math.round(performance.now() - t0), count: list.length,
        note: '近 90 天 · ' + list.length + ' 条告警，其中红色 ' + red + ' 条'
      });
      return { list, fresh };
    }).catch((err) => {
      const raw = (err && err.message) || '';
      const why = err && err.name === 'AbortError' ? '请求超时'
        : /pool|Timeout expired/i.test(raw) ? '上游服务繁忙'
          : (err && err.status ? 'HTTP ' + err.status : raw || '未知错误');
      S.setStatus('gdacs', { state: 'error', note: '连接失败 · ' + why + '，下个周期重试' });
      throw err;
    });
  }

  return { load };
})();