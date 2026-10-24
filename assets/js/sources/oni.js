/* TERRA LIVE — NOAA CPC ONI（海洋尼诺指数）序列 */
window.TL = window.TL || {};

TL.sources = TL.sources || {};
TL.sources.oni = (function () {
  const U = TL.util;
  const S = TL.store;
  const RAW = 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';
  const RELAY = 'https://r.jina.ai/' + RAW;

  function parse(text) {
    const out = [];
    const re = /^\s*([A-Z]{3})\s+(\d{4})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ season: m[1], year: parseInt(m[2], 10), total: parseFloat(m[3]), anom: parseFloat(m[4]) });
    }
    return out;
  }

  function stateOf(anom) {
    if (anom === null || anom === undefined) return { id: 'unknown', zh: '数据待更新', en: 'UNKNOWN' };
    if (anom >= 0.5) return { id: 'elnino', zh: '厄尔尼诺', en: 'EL NIÑO' };
    if (anom <= -0.5) return { id: 'lanina', zh: '拉尼娜', en: 'LA NIÑA' };
    return { id: 'neutral', zh: '中性态', en: 'NEUTRAL' };
  }

  function apply(series, sourceLabel) {
    if (series.length < 12) throw new Error('序列长度不足');
    const tail = series.slice(-42);
    const latest = series[series.length - 1];
    const prev = series[series.length - 4] || latest;
    const trend = U.round(latest.anom - prev.anom, 2);
    const last6 = series.slice(-6);
    const runes = last6.map((s) => s.anom >= 0.5 ? 1 : (s.anom <= -0.5 ? -1 : 0));
    const streak = runes.reduce((a, b) => a + b, 0);
    S.setClimate({
      oni: {
        series: tail,
        latest: { season: latest.season, year: latest.year, anom: U.round(latest.anom, 2), total: U.round(latest.total, 2) },
        state: stateOf(latest.anom),
        trend,
        streak,
        range: { min: Math.min.apply(null, series.map((s) => s.anom)), max: Math.max.apply(null, series.map((s) => s.anom)) },
        source: sourceLabel,
        updatedAt: Date.now()
      }
    });
    S.setStatus('oni', {
      state: 'ok', ms: 0, count: series.length,
      note: latest.season + ' ' + latest.year + ' 距平 ' + U.round(latest.anom, 2) + '°C · ' + sourceLabel
    });
    return series.length;
  }

  function load() {
    S.setStatus('oni', { state: 'loading' });
    const t0 = performance.now();
    return U.fetchText(RAW, 15000).then((txt) => {
      const series = parse(txt);
      if (series.length < 12) throw new Error('官方文件解析失败');
      S.setStatus('oni', { state: 'loading', ms: Math.round(performance.now() - t0) });
      return apply(series, 'NOAA CPC 官方');
    }).catch(() => {
      return U.fetchText(RELAY, 30000).then((txt) => {
        const series = parse(txt);
        if (series.length < 12) throw new Error('中继解析失败');
        return apply(series, 'NOAA CPC（经文本中继）');
      });
    }).catch((err) => {
      S.setStatus('oni', { state: 'error', note: '官方序列不可达，已改用海温距平推算' });
      throw err;
    });
  }

  return { load, parse, stateOf, apply };
})();