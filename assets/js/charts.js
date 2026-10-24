/* TERRA LIVE — 轻量 SVG 图表（无依赖） */
window.TL = window.TL || {};

TL.charts = (function () {
  const U = TL.util;

  /* ONI 双色柱状序列：暖事件红、冷事件蓝、中性灰 */
  function oniBars(series, opt) {
    const o = Object.assign({ w: 320, h: 108, pad: { t: 10, r: 6, b: 16, l: 6 } }, opt || {});
    if (!series || !series.length) return '<div class="chart-empty">序列加载中…</div>';
    const iw = o.w - o.pad.l - o.pad.r;
    const ih = o.h - o.pad.t - o.pad.b;
    const maxAbs = Math.max(1.2, Math.max.apply(null, series.map((s) => Math.abs(s.anom))));
    const zero = o.pad.t + ih / 2;
    const bw = Math.max(1.6, iw / series.length - 1.1);
    let bars = '';
    series.forEach((s, i) => {
      const x = o.pad.l + (iw / series.length) * i + (iw / series.length - bw) / 2;
      const h = Math.abs(s.anom) / maxAbs * (ih / 2);
      const y = s.anom >= 0 ? zero - h : zero;
      const strong = Math.abs(s.anom) >= 0.5;
      const color = s.anom >= 0.5 ? '#e8452a' : (s.anom <= -0.5 ? '#2f7bff' : 'rgba(150,170,200,0.5)');
      bars += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1, h).toFixed(2)}" rx="1" fill="${color}" opacity="${strong ? 0.95 : 0.75}"/>`;
    });
    const th = 0.5 / maxAbs * (ih / 2);
    const latest = series[series.length - 1];
    return `<svg class="chart-svg" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none">
      <rect x="0" y="${o.pad.t}" width="${o.w}" height="${ih}" rx="4" fill="rgba(255,255,255,0.025)"/>
      <line x1="${o.pad.l}" y1="${(zero - th).toFixed(2)}" x2="${o.w - o.pad.r}" y2="${(zero - th).toFixed(2)}" stroke="rgba(232,69,42,0.45)" stroke-dasharray="3 3" stroke-width="1"/>
      <line x1="${o.pad.l}" y1="${(zero + th).toFixed(2)}" x2="${o.w - o.pad.r}" y2="${(zero + th).toFixed(2)}" stroke="rgba(47,123,255,0.45)" stroke-dasharray="3 3" stroke-width="1"/>
      <line x1="${o.pad.l}" y1="${zero.toFixed(2)}" x2="${o.w - o.pad.r}" y2="${zero.toFixed(2)}" stroke="rgba(200,220,255,0.3)" stroke-width="1"/>
      ${bars}
      <text x="${o.pad.l}" y="${o.h - 4}" fill="rgba(170,190,215,0.75)" font-size="9" font-family="var(--mono)">${U.esc(series[0].season)} ${series[0].year}</text>
      <text x="${o.w - o.pad.r}" y="${o.h - 4}" text-anchor="end" fill="rgba(170,190,215,0.9)" font-size="9" font-family="var(--mono)">${U.esc(latest.season)} ${latest.year} · ${latest.anom >= 0 ? '+' : ''}${latest.anom.toFixed(2)}</text>
    </svg>`;
  }

  /* 灾害构成环形图 */
  function donut(counts, total) {
    const size = 118, r = 46, sw = 11, c = size / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    let arcs = '';
    const entries = Object.keys(counts).filter((k) => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
    entries.forEach((k) => {
      const frac = counts[k] / total;
      const len = frac * circ;
      const color = TL.HAZARDS[k].color;
      arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
        stroke-dasharray="${Math.max(0.8, len - 1.4).toFixed(2)} ${(circ - len + 1.4).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="butt" opacity="0.92"
        transform="rotate(-90 ${c} ${c})"/>`;
      offset += len;
    });
    return `<svg viewBox="0 0 ${size} ${size}" class="donut-svg">${arcs}
      <text x="${c}" y="${c - 2}" text-anchor="middle" fill="#eaf2ff" font-size="21" font-weight="600" font-family="var(--mono)">${total}</text>
      <text x="${c}" y="${c + 13}" text-anchor="middle" fill="rgba(160,180,205,0.85)" font-size="8.5" letter-spacing="1">EVENTS</text>
    </svg>`;
  }

  /* 迷你趋势线 */
  function sparkline(values, color) {
    if (!values || values.length < 2) return '';
    const w = 120, h = 26, pad = 2;
    const max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    const span = max - min || 1;
    const step = (w - pad * 2) / (values.length - 1);
    const pts = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = d + ` L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" class="spark-svg" preserveAspectRatio="none">
      <path d="${area}" fill="${color}" opacity="0.14"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
  }

  /* 强度标尺 */
  function meter(value, max, color) {
    const pct = U.clamp((value / max) * 100, 2, 100);
    return `<div class="meter"><span style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg,${color}55,${color})"></span></div>`;
  }

  return { oniBars, donut, sparkline, meter };
})();