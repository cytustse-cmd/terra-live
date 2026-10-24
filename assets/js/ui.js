/* TERRA LIVE — 控制台界面渲染 */
window.TL = window.TL || {};

TL.ui = (function () {
  const U = TL.util;
  const S = TL.store;
  const H = TL.HAZARDS;
  const CFG = TL.CONFIG;
  const CH = TL.charts;

  const el = {};
  let listLimit = CFG.listPageSize;
  let selectedId = null;
  let rafPending = null;
  let lastTickerKey = '';
  const recentToasts = {};

  function $(id) { return document.getElementById(id); }
  function hazardColor(h) { return H[h] ? H[h].color : '#8899aa'; }
  function hazardZh(h) { return H[h] ? H[h].zh : '其他'; }

  function glyphSvg(h, size, color) {
    const meta = H[h] || H.manmade;
    const paths = (TL.GLYPHS[meta.icon] || []).map((d) => `<path d="${d}"/>`).join('');
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  function valueLabel(e) {
    if (e.magnitude && e.magnitude.value !== null && e.magnitude.value !== undefined) {
      const unit = e.magnitude.unit || '';
      const digits = e.hazard === 'earthquake' ? 1 : (Math.abs(e.magnitude.value) >= 100 ? 0 : 1);
      return U.fmtNum(e.magnitude.value, digits) + (unit ? ' ' + unit : '');
    }
    return Math.round(e.severity * 100) + '%';
  }

  /* ============ 数据源状态 ============ */
  function renderStatus() {
    const ids = Object.keys(TL.SOURCE_META);
    let ok = 0;
    ids.forEach((id) => {
      const st = S.status[id].state;
      if (st === 'ok' || st === 'cached') ok++;
    });
    const rows = ids.map((id) => {
      const m = TL.SOURCE_META[id];
      const s = S.status[id];
      const noteCls = s.state === 'error' ? 'note err' : (s.state === 'cached' ? 'note warn' : 'note');
      const lat = s.state === 'ok' && s.ms ? s.ms + 'ms' : m.lat;
      return `<div class="src-row" title="${U.esc(m.name + ' · ' + (s.note || '等待中'))}">
        <span class="led ${s.state}"></span>
        <span class="nm">${U.esc(m.name)}</span>
        <span class="sh">${U.esc(lat)}</span>
        <span class="${noteCls}">${U.esc(s.note || '待机')}</span>
      </div>`;
    }).join('');
    const srcBox = $('srcBox');
    if (srcBox) srcBox.innerHTML = rows;
    const st = $('stSrc');
    if (st) st.textContent = ok + '/' + ids.length;
    const sub = $('srcSub');
    if (sub) sub.textContent = ok + ' / ' + ids.length + ' 正常';

    let red = 0;
    S.all().forEach((e) => { if (e.alert === 'red' || e.alert === 'extreme') red++; });
    const stRed = $('stRed');
    if (stRed) stRed.textContent = red;
  }

  /* ============ 概览 ============ */
  function renderOverview() {
    const c = S.counts();
    const list = S.visible();
    $('stTotal').textContent = c.total;
    $('stFresh').textContent = c.fresh;
    $('ovTotal').textContent = c.total;
    $('ovTotalU').textContent = (CFG.timeWindows.find((w) => w.id === S.getFilter().windowId) || {}).zh || '';

    const top = Object.keys(c.byHazard).filter((k) => c.byHazard[k] > 0).sort((a, b) => c.byHazard[b] - c.byHazard[a]);
    const best = top[0];
    $('ovTopHaz').textContent = best ? hazardZh(best) : '--';
    $('ovTopHazU').textContent = best ? c.byHazard[best] + ' 条记录' : '暂无数据';
    $('ovTopHaz').style.color = best ? hazardColor(best) : '';

    const maxSev = list.reduce((a, b) => (b.severity > (a ? a.severity : -1) ? b : a), null);
    if (maxSev) {
      $('ovMaxSev').textContent = Math.round(maxSev.severity * 100);
      $('ovMaxSevU').textContent = hazardZh(maxSev.hazard);
      $('ovMaxSev').style.color = hazardColor(maxSev.hazard);
    } else {
      $('ovMaxSev').textContent = '--';
      $('ovMaxSevU').textContent = 'severity';
    }

    $('donutBox').innerHTML = c.total ? CH.donut(c.byHazard, c.total) : '';
    $('donutLegend').innerHTML = top.slice(0, 6).map((k) => `
      <div class="row"><i style="background:${hazardColor(k)};box-shadow:0 0 6px ${hazardColor(k)}"></i>
      ${U.esc(hazardZh(k))}<b>${c.byHazard[k]}</b></div>`).join('') || '<div class="row" style="color:var(--text-3)">等待数据…</div>';
  }

  /* ============ 筛选 ============ */
  function renderChips() {
    const f = S.getFilter();
    const c = S.counts();
    const keys = Object.keys(H);
    $('chips').innerHTML = keys.map((k) => {
      const on = f.hazards.has(k);
      const n = c.byHazard[k] || 0;
      if (!on && !n) return '';
      return `<span class="chip ${on ? 'on' : 'off'}" data-haz="${k}" style="color:${hazardColor(k)}">
        <i></i>${U.esc(hazardZh(k))}<span class="n">${n}</span></span>`;
    }).join('');
    const onCount = f.hazards.size;
    $('hazSub').textContent = onCount === keys.length ? '全部开启' : onCount + '/' + keys.length + ' 开启';
  }

  function renderTimeSeg() {
    const f = S.getFilter();
    $('winSeg').innerHTML = CFG.timeWindows.map((w) =>
      `<button data-win="${w.id}" class="${f.windowId === w.id ? 'on' : ''}">${w.zh}</button>`).join('');
    Array.prototype.forEach.call($('magSeg').children, (n) =>
      n.classList.toggle('on', parseFloat(n.getAttribute('data-mag')) === (f.minMag || 0)));
    $('btnOnlyNew').classList.toggle('on', !!f.onlyNew);
    Array.prototype.forEach.call($('sortSeg').children, (n) =>
      n.classList.toggle('on', n.getAttribute('data-sort') === f.sort));
  }

  /* ============ 事件流 ============ */
  function renderList(forceFull) {
    const f = S.getFilter();
    if (!forceFull) { /* keep limit */ }
    const all = S.visible();
    const shown = all.slice(0, listLimit);
    $('listSub').textContent = all.length ? shown.length + ' / ' + all.length + ' 条' : '0 条';

    if (!all.length) {
      $('evList').innerHTML = `<div class="empty">当前筛选条件下没有事件<br><span style="font-size:10.5px">尝试放宽灾害类型或时间窗口</span></div>`;
      return;
    }
    const html = shown.map((e) => {
      const col = hazardColor(e.hazard);
      const barH = Math.round(10 + e.severity * 26);
      const isNew = S.isNew(e);
      const alertFlag = (e.alert === 'red') ? '<span class="flag alert">RED</span>'
        : (e.alert === 'extreme' ? '<span class="flag alert">EXTREME</span>' : (isNew ? '<span class="flag">NEW</span>' : ''));
      return `<div class="ev ${e.id === selectedId ? 'sel' : ''}" data-id="${U.esc(e.id)}">
        <span class="bar" style="background:${col};height:${barH}px;box-shadow:0 0 10px ${col}88"></span>
        <div class="body">
          <div class="t">${alertFlag}${U.esc(e.title)}</div>
          <div class="s">${U.esc(e.subtitle || U.fmtCoord(e.lat, e.lon))}</div>
        </div>
        <div class="right">
          <div class="val" style="color:${col}">${U.esc(valueLabel(e))}</div>
          <div class="ago">${U.esc(U.timeAgo(e.time))}</div>
        </div>
      </div>`;
    }).join('');
    const more = all.length > listLimit
      ? `<button class="more" id="btnMore">继续加载 ${Math.min(CFG.listPageSize, all.length - listLimit)} 条（共 ${all.length}）</button>`
      : '';
    $('evList').innerHTML = html + more;
    if ($('btnMore')) $('btnMore').onclick = () => { listLimit += CFG.listPageSize; renderList(true); };
  }

  function markSelected(id) {
    selectedId = id;
    Array.prototype.forEach.call(document.querySelectorAll('.ev'), (n) => {
      n.classList.toggle('sel', n.getAttribute('data-id') === id);
    });
    $('detailSub').textContent = id ? '已锁定' : '未选择';
  }

  /* ============ 详情 ============ */
  function renderDetail(e) {
    if (!e) {
      $('detailBox').innerHTML = `<div class="detail-empty">点击地图上的任意标记，或从事件流中选择一条记录<br>
        查看 <b>强度、坐标、数据来源与实时元信息</b></div>`;
      return;
    }
    const col = hazardColor(e.hazard);
    const meta = (e.meta || []).filter((m) => m.v !== undefined && m.v !== null && m.v !== '' && m.v !== '--')
      .map((m) => `<div class="row"><span class="k">${U.esc(m.k)}</span><span class="v">${U.esc(String(m.v))}</span></div>`).join('');
    const hasMag = e.magnitude && e.magnitude.value !== null && e.magnitude.value !== undefined;
    const heroVal = hasMag ? U.fmtNum(e.magnitude.value, e.hazard === 'earthquake' ? 1 : (Math.abs(e.magnitude.value) >= 100 ? 0 : 1)) : Math.round(e.severity * 100);
    const heroUnit = hasMag ? (e.magnitude.unit || '') : '%';
    const srcName = TL.SOURCE_META[e.source] ? TL.SOURCE_META[e.source].name : e.source;

    $('detailBox').innerHTML = `
      <div class="d-hazard">
        <span class="pin" style="background:${col}22;border:1px solid ${col}66">${glyphSvg(e.hazard, 15, col)}</span>
        <span class="nm" style="color:${col}">${U.esc(hazardZh(e.hazard))}</span>
        <span class="src">${U.esc(srcName)}</span>
      </div>
      <h2 class="d-title">${U.esc(e.title)}</h2>
      <div class="d-sub">${U.esc(e.subtitle || '')}</div>
      <div class="d-hero">
        <span class="big" style="color:${col}">${U.esc(String(heroVal))}</span>
        <span class="unit">${U.esc(heroUnit)}</span>
        <span class="label">${hasMag ? '观测强度' : '综合强度'}<br><span style="color:var(--text-2);font-family:var(--mono);font-size:11px">${U.fmtCoord(e.lat, e.lon)}</span></span>
      </div>
      <div class="sev-line">
        <span class="lbl">强度</span>${CH.meter(e.severity, 1, col)}
        <span class="mono" style="font-size:10.5px;color:var(--text-2)">${Math.round(e.severity * 100)}</span>
      </div>
      ${e.desc ? `<div class="d-desc">${U.esc(String(e.desc).slice(0, 400))}</div>` : ''}
      <div class="d-meta">
        <div class="row"><span class="k">观测时间</span><span class="v">${U.esc(U.fmtLocal(e.time))} · ${U.esc(U.timeAgo(e.time))}</span></div>
        ${meta}
        <div class="row"><span class="k">坐标</span><span class="v">${U.esc(U.fmtCoord(e.lat, e.lon))}</span></div>
      </div>
      <div class="d-actions">
        <button class="btn" id="dFly">定位</button>
        <button class="btn" id="dCopy">复制坐标</button>
        ${e.url ? `<button class="btn" id="dOpen">来源</button>` : ''}
      </div>`;

    $('dFly').onclick = () => TL.mapView.flyTo(e.lon, e.lat);
    $('dCopy').onclick = () => {
      const txt = e.lat.toFixed(4) + ', ' + e.lon.toFixed(4);
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      toast({ title: '坐标已复制', subtitle: txt, color: col });
    };
    if ($('dOpen')) {
      $('dOpen').onclick = () => window.open(e.url, '_blank', 'noopener');
    }
  }

  /* ============ 气候 · ENSO ============ */
  function renderClimate() {
    const c = S.climate;
    const r = c.regions;
    const oni = c.oni;
    const derived = c.derivedIndex;
    let state, stateColor, headline, headUnit;

    if (oni && oni.state) {
      state = oni.state;
      headline = oni.latest.anom;
      headUnit = '°C ONI';
      stateColor = state.id === 'elnino' ? '#ff8a5c' : (state.id === 'lanina' ? '#7fb3ff' : '#c9d4e4');
      $('ensoSub').textContent = oni.latest.season + ' ' + oni.latest.year;
    } else {
      headline = derived === null || derived === undefined ? null : derived;
      headUnit = '°C 推算距平';
      state = (headline === null ? { zh: '数据待更新', en: 'PENDING' } : TL.sources.oni.stateOf(headline));
      stateColor = state.id === 'elnino' ? '#ff8a5c' : (state.id === 'lanina' ? '#7fb3ff' : '#c9d4e4');
      $('ensoSub').textContent = '海温推算';
    }

    const ninoCell = (k) => {
      const b = r && r[k] ? r[k] : null;
      const v = b ? b.anom : null;
      const cls = v === null ? '' : (v >= 0.4 ? 'warm' : (v <= -0.4 ? 'cool' : ''));
      return `<div class="nino-cell ${cls}">
        <div class="k">Niño ${k}</div>
        <div class="v">${v === null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2)}</div>
        <div class="s">${b && b.sst ? b.sst.toFixed(1) + '°C' : '--'}</div>
      </div>`;
    };

    const trendTxt = oni ? (oni.trend > 0.02 ? '↑ 增强' : (oni.trend < -0.02 ? '↓ 减弱' : '→ 平稳')) : '';
    const seriesForChart = oni ? oni.series : null;

    $('climateBox').innerHTML = `
      <div class="enso-head">
        <span class="enso-state" style="color:${stateColor}">${U.esc(state.zh)}<small>${U.esc(state.en)}</small></span>
        <div class="enso-val">
          <div class="v" style="color:${stateColor}">${headline === null || headline === undefined ? '--' : (headline >= 0 ? '+' : '') + Number(headline).toFixed(2)}</div>
          <div class="k">${U.esc(headUnit)}</div>
        </div>
      </div>
      ${seriesForChart ? CH.oniBars(seriesForChart) : `<div class="chart-empty">官方 ONI 序列不可达，使用海温距平推算<br><span style="font-size:10px">推算值：${derived === null || derived === undefined ? '--' : (derived >= 0 ? '+' : '') + Number(derived).toFixed(2)} °C</span></div>`}
      <div class="nino-grid">${['1+2', '3', '3.4', '4'].map(ninoCell).join('')}</div>
      <div class="climate-note">
        ${oni ? `<b>ONI</b>（海洋尼诺指数）为 NOAA CPC 官方三个月滑动海温距平，阈值 ±0.5°C 判定厄尔尼诺／拉尼娜。<br>` : ''}
        <b>分区数值</b>基于 Open-Meteo 海洋模式近 ${TL.CONFIG.oceanGrid.pastDays} 天海温序列：
        以最近 7 天均值减去此前 ${TL.CONFIG.oceanGrid.pastDays - 7} 天基准的差值计算（短期变化量，非气候态距平），
        用于观察赤道太平洋暖／冷异常的实时分布。<br>
        ${oni ? `<b>趋势</b> ${U.esc(trendTxt)}（近一季度 ${oni.trend >= 0 ? '+' : ''}${oni.trend.toFixed(2)}°C）· 数据源 ${U.esc(oni.source)} · ${U.esc(U.timeAgo(oni.updatedAt))}更新`
          : `数据源 Open-Meteo 海洋 API · ${c.oceanAt ? U.esc(U.timeAgo(c.oceanAt)) + '更新' : '载入中'}`}
        ${c.sstPoints ? `<br>监测海区格点 <b>${c.sstPoints}</b> 个 · 赤道太平洋平均海温 <b>${c.sstMean}°C</b>` : ''}
      </div>`;
  }

  /* ============ 全球极值 ============ */
  function renderExtremes() {
    const x = S.globalExtremes();
    const cards = [
      { key: 'quake', label: '最强地震', unit: 'M', e: x.quake, digits: 1, color: hazardColor('earthquake') },
      { key: 'heat', label: '最高体感', unit: '°C', e: x.heat, digits: 1, color: hazardColor('heat') },
      { key: 'cold', label: '最低气温', unit: '°C', e: x.cold, digits: 1, color: hazardColor('cold') },
      { key: 'rain', label: '最大 24h 雨量', unit: 'mm', e: x.rain, digits: 0, color: hazardColor('flood') },
      { key: 'wind', label: '最强阵风', unit: 'km/h', e: x.wind, digits: 0, color: hazardColor('severe') },
      { key: 'severe', label: '最高等级告警', unit: '', e: x.severe, digits: 0, color: hazardColor('storm') }
    ];
    $('extBox').innerHTML = cards.map((c) => {
      if (!c.e) {
        return `<div class="ex" style="cursor:default">
          <div class="k"><i style="background:${c.color}"></i>${c.label}</div>
          <div class="v" style="color:var(--text-3)">--</div>
          <div class="s">当前时间窗内无记录</div></div>`;
      }
      const v = c.unit === '' ? Math.round(c.e.severity * 100) : U.fmtNum(c.e.value, c.digits);
      const unit = c.unit === '' ? '%' : c.unit;
      return `<div class="ex" data-id="${U.esc(c.e.id)}">
        <div class="k" style="color:${c.color}"><i style="background:${c.color};box-shadow:0 0 6px ${c.color}"></i>${c.label}</div>
        <div class="v" style="color:${c.color}">${v}<span style="font-size:10px;color:var(--text-3)"> ${unit}</span></div>
        <div class="s" title="${U.esc(c.e.title)}">${U.esc(c.e.subtitle || c.e.title)}</div>
      </div>`;
    }).join('');
    Array.prototype.forEach.call($('extBox').querySelectorAll('.ex[data-id]'), (n) => {
      n.onclick = () => TL.app.selectEvent(n.getAttribute('data-id'), true);
    });
  }

  /* ============ 快讯 ============ */
  function renderTicker() {
    const list = S.visible().slice(0, 18);
    const key = list.map((e) => e.id).join('|');
    if (key === lastTickerKey) return;
    lastTickerKey = key;
    if (!list.length) { $('tickerTrack').innerHTML = '<div class="tk">正在建立实时数据链路…</div>'; return; }
    const items = list.map((e) => `
      <div class="tk" data-id="${U.esc(e.id)}">
        <i style="background:${hazardColor(e.hazard)};box-shadow:0 0 8px ${hazardColor(e.hazard)}"></i>
        <span style="color:${hazardColor(e.hazard)}">${U.esc(hazardZh(e.hazard))}</span>
        <span>${U.esc(e.title)}</span>
        <span style="color:var(--text-3)">${U.esc((e.subtitle || '').slice(0, 34))}</span>
        <span class="ago">${U.esc(U.timeAgo(e.time))}</span>
      </div>`).join('');
    $('tickerTrack').innerHTML = items + items;
    Array.prototype.forEach.call($('tickerTrack').querySelectorAll('.tk[data-id]'), (n) => {
      n.onclick = () => TL.app.selectEvent(n.getAttribute('data-id'), true);
    });
  }

  /* ============ 图例 ============ */
  function renderLegend() {
    const on = TL.mapView.layersOn;
    const haz = ['earthquake', 'heat', 'wildfire', 'storm', 'flood', 'landslide', 'drought', 'volcano', 'cold', 'severe']
      .map((k) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--text-2);margin:2px 8px 2px 0">
        <i style="width:6px;height:6px;border-radius:50%;background:${hazardColor(k)};box-shadow:0 0 6px ${hazardColor(k)}"></i>${hazardZh(k)}</span>`).join('');
    let extra = '';
    if (on.field) {
      extra += `<div class="legend-scale"><div class="cap">全球气温（格点实时）</div>
        <div class="bar" style="background:linear-gradient(90deg,#2b1a6b,#1e4fd8,#1aa3d9,#3fae6a,#c9c14a,#f08b2a,#e8452a)"></div>
        <div class="lbl"><span>-45°C</span><span>0°C</span><span>+48°C</span></div></div>`;
    }
    if (on.sst) {
      extra += `<div class="legend-scale" style="margin-top:9px"><div class="cap">海温距平（近 7 天 vs 前 ${(TL.CONFIG.oceanGrid.pastDays || 30) - 7} 天基准）</div>
        <div class="bar" style="background:linear-gradient(90deg,#1b3fd8,#1c86c9,#173a4a,#4a2417,#d9662a,#e01f1f)"></div>
        <div class="lbl"><span>-3°C</span><span>0</span><span>+3°C</span></div></div>`;
    }
    $('legendBody').innerHTML = `<div style="display:flex;flex-wrap:wrap;line-height:1.7">${haz}</div>${extra}`;
  }

  /* ============ 提示与通知 ============ */
  function showTooltip(e, point) {
    const tt = $('tooltip');
    if (!e) { tt.classList.remove('on'); return; }
    tt.innerHTML = `<div class="tt">${U.esc(e.title)}</div>
      <div class="ts">${U.esc(hazardZh(e.hazard))} · ${U.esc(U.fmtCoord(e.lat, e.lon))} · ${U.esc(U.timeAgo(e.time))}</div>`;
    const rect = $('map').getBoundingClientRect();
    tt.style.left = (rect.left + point.x) + 'px';
    tt.style.top = (rect.top + point.y) + 'px';
    tt.classList.add('on');
  }
  function hideTooltip() { $('tooltip').classList.remove('on'); }

  function toast(opt) {
    const box = $('toasts');
    const node = document.createElement('div');
    node.className = 'toast';
    node.style.borderLeftColor = opt.color || 'var(--accent)';
    node.innerHTML = `<div class="k"><span style="width:5px;height:5px;border-radius:50%;background:${opt.color || 'var(--accent)'}"></span>${U.esc(opt.label || '新事件')}</div>
      <div class="t">${U.esc(opt.title)}</div><div class="s">${U.esc(opt.subtitle || '')}</div>`;
    if (opt.id) node.onclick = () => { TL.app.selectEvent(opt.id, true); close(); };
    box.appendChild(node);
    let timer = setTimeout(close, isPhone() ? 5200 : 9000);
    function close() {
      clearTimeout(timer);
      node.classList.add('out');
      setTimeout(() => node.remove(), 320);
    }
  }

  function notifyNew(list) {
    const max = isPhone() ? 1 : 3;
    const fresh = list.filter((e) => S.isNew(e) && !recentToasts[e.id])
      .sort((a, b) => b.severity - a.severity).slice(0, max);
    fresh.forEach((e, i) => {
      recentToasts[e.id] = 1;
      setTimeout(() => toast({
        label: (e.alert === 'red' ? '红色告警' : '新事件') + ' · ' + hazardZh(e.hazard),
        title: e.title, subtitle: (e.subtitle || '') + ' · ' + U.timeAgo(e.time),
        color: hazardColor(e.hazard), id: e.id
      }), i * 260);
    });
  }

  /* ============ 状态条 / 时钟 / 启动日志 ============ */
  function updateStatusBar(map) {
    if (!map) return;
    const c = map.getCenter();
    $('mapStatus').innerHTML = `<span>中心 <b>${U.fmtCoord(c.lat, c.lng)}</b></span>
      <span>缩放 <b>${map.getZoom().toFixed(2)}</b></span>
      <span>已绘 <b>${S.visible().length}</b></span>` +
      (location.protocol === 'file:' ? '<span class="file-chip" title="本地文件打开时部分浏览器会限制网络请求，建议改用 http 地址或发布链接">本地文件</span>' : '');
  }

  function startClock() {
    function tick() {
      const d = new Date();
      $('clockTime').textContent = U.fmtCST(d);
      $('clockDate').textContent = U.fmtCSTDate(d) + ' ' + U.cstWeekday(d);
    }
    tick();
    setInterval(tick, 1000);
  }

  function bootLog(text, cls) {
    const box = $('bootLog');
    const line = document.createElement('div');
    line.className = cls || '';
    line.textContent = text;
    box.appendChild(line);
    while (box.children.length > 5) box.removeChild(box.firstChild);
  }
  function bootProgress(p) { $('bootBar').style.width = Math.round(U.clamp(p, 0, 1) * 100) + '%'; }
  function hideBoot() {
    setTimeout(() => {
      $('boot').classList.add('hide');
      setTimeout(() => { const b = $('boot'); if (b) b.remove(); }, 700);
    }, 420);
  }

  function setLive(paused) {
    const b = $('liveBadge');
    b.classList.toggle('paused', paused);
    $('liveText').textContent = paused ? 'PAUSED' : 'LIVE';
  }

  function setMapReady(v) {
    updateStatusBar(TL.mapView.map);
  }

  /* ============ 渲染调度 ============ */
  function schedule(kinds) {
    if (rafPending) { rafPending.kinds = Object.assign(rafPending.kinds, kinds); return; }
    rafPending = { kinds };
    requestAnimationFrame(() => {
      const k = rafPending.kinds;
      rafPending = null;
      if (k.overview) { renderOverview(); renderChips(); renderExtremes(); }
      if (k.list) renderList();
      if (k.status) renderStatus();
      if (k.climate) renderClimate();
      if (k.ticker) renderTicker();
      if (k.legend) renderLegend();
      if (k.statusbar && TL.mapView.map) updateStatusBar(TL.mapView.map);
    });
  }

  function bind() {
    $('chips').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      S.toggleHazard(chip.getAttribute('data-haz'));
    });
    $('btnAllHaz').onclick = () => {
      const f = S.getFilter();
      if (f.hazards.size === Object.keys(H).length) { f.hazards.clear(); S.setFilter({}); S.emit('filter'); }
      else S.resetHazards();
    };
    $('sortSeg').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-sort]');
      if (!b) return;
      S.setFilter({ sort: b.getAttribute('data-sort') });
      Array.prototype.forEach.call($('sortSeg').children, (n) => n.classList.toggle('on', n === b));
    });
    $('winSeg').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-win]');
      if (!b) return;
      const id = b.getAttribute('data-win');
      S.setFilter({ windowId: id });
      if (id === '30d') TL.sources.usgs.loadMonth();
      renderTimeSeg();
    });
    $('magSeg').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-mag]');
      if (!b) return;
      S.setFilter({ minMag: parseFloat(b.getAttribute('data-mag')) });
      Array.prototype.forEach.call($('magSeg').children, (n) => n.classList.toggle('on', n === b));
    });
    $('btnOnlyNew').onclick = () => {
      const f = S.getFilter();
      S.setFilter({ onlyNew: !f.onlyNew });
      $('btnOnlyNew').classList.toggle('on', !f.onlyNew);
    };
    $('searchInput').addEventListener('input', U.debounce((ev) => {
      listLimit = CFG.listPageSize;
      S.setFilter({ query: ev.target.value.trim() });
    }, 260));
    $('evList').addEventListener('click', (ev) => {
      const row = ev.target.closest('.ev[data-id]');
      if (row) TL.app.selectEvent(row.getAttribute('data-id'), true);
    });
    document.querySelectorAll('.sw[data-layer]').forEach((node) => {
      node.onclick = () => {
        const key = node.getAttribute('data-layer');
        const on = !node.classList.contains('on');
        node.classList.toggle('on', on);
        TL.mapView.toggleLayer(key, on);
        renderLegend();
      };
    });
    $('btnBasemap').onclick = () => TL.app.cycleBasemap();
    $('btnProjection').onclick = () => TL.app.toggleProjection();
    $('btnRefresh').onclick = () => TL.app.refreshAll(true);
    $('btnFull').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    };
    $('liveBadge').onclick = () => TL.app.toggleLive();
    $('btnRailL').onclick = () => toggleSheet('railLeft');
    $('btnRailR').onclick = () => toggleSheet('railRight');
    if ($('btnTools')) $('btnTools').onclick = () => {
      const on = !document.querySelector('.map-tools').classList.contains('show');
      closeSheets();
      document.querySelector('.map-tools').classList.toggle('show', on);
      syncScrim();
    };
    /* 手机「显示设置」卡片：投影 / 底图 / 全屏 */
    if ($('mProjection')) $('mProjection').onclick = () => TL.app.toggleProjection();
    if ($('mBasemap')) $('mBasemap').onclick = () => TL.app.cycleBasemap();
    if ($('mFull')) {
      if (document.documentElement.requestFullscreen) {
        $('mFull').onclick = () => {
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen();
        };
      } else {
        $('mFull').style.display = 'none';  // iPhone Safari 不支持元素全屏
      }
    }
    if ($('scrim')) $('scrim').onclick = () => closeSheets();
    Array.prototype.forEach.call(document.querySelectorAll('.sheet-head .x'), (b) => {
      b.onclick = () => closeSheet(b.getAttribute('data-close'));
    });
    const syncRailBtns = () => {
      const narrow = window.innerWidth <= 1080;
      $('btnRailL').style.display = narrow ? 'inline-flex' : 'none';
      $('btnRailR').style.display = (isPhone() || window.innerWidth <= 860) ? 'inline-flex' : 'none';
      if (!isPhone()) closeSheets();
    };
    syncRailBtns();
    window.addEventListener('resize', syncRailBtns);
    bindSheetGestures();
  }

  /* ============ 手机端抽屉 / 遮罩 ============ */
  function isPhone() {
    // 竖屏手机，以及横屏的手机（宽但很矮）
    return window.innerWidth <= 820 || (window.innerHeight <= 480 && window.innerWidth <= 960);
  }
  function sheetOpen(id) { return !!$(id) && $(id).classList.contains('open'); }
  function openSheetOnly(id) {
    ['railLeft', 'railRight'].forEach((k) => { if ($(k)) $(k).classList.toggle('open', k === id); });
    const tools = document.querySelector('.map-tools');
    if (tools) tools.classList.remove('show');
    syncScrim();
  }
  function closeSheet(id) {
    if ($(id)) $(id).classList.remove('open');
    syncScrim();
  }
  function closeSheets() {
    ['railLeft', 'railRight'].forEach((k) => { if ($(k)) $(k).classList.remove('open'); });
    const tools = document.querySelector('.map-tools');
    if (tools) tools.classList.remove('show');
    syncScrim();
  }
  function toggleSheet(id) {
    const on = !sheetOpen(id);
    if (on) openSheetOnly(id);
    else closeSheet(id);
  }
  function syncScrim() {
    if (!isPhone()) return;
    const tools = document.querySelector('.map-tools');
    const any = sheetOpen('railLeft') || sheetOpen('railRight') || (tools && tools.classList.contains('show'));
    if ($('scrim')) $('scrim').classList.toggle('on', !!any);
    /* 面板遮住地图时暂停脉冲动画，省电省帧 */
    if (TL.mapView && TL.mapView.pausePulse) TL.mapView.pausePulse(!!any);
  }
  /* 手机上选中事件后自动把详情面板推上来 */
  function revealDetail() {
    if (isPhone()) openSheetOnly('railRight');
  }

  /* ============ 手机手势：底部面板下拉关闭 / 左抽屉左滑关闭 ============ */
  function bindSheetGestures() {
    const THRESH = 84;    // 判定关闭的位移阈值（px）
    const SPEED = 0.5;    // 判定关闭的甩动速度（px/ms）
    function makeDraggable(id, axis) {
      const sheet = $(id);
      const head = sheet && sheet.querySelector('.sheet-head');
      if (!head) return;
      let start = null, startT = 0, lastPos = 0, moved = false;
      head.addEventListener('pointerdown', (ev) => {
        if (!sheet.classList.contains('open') || ev.target.closest('.x')) return;
        start = axis === 'y' ? ev.clientY : ev.clientX;
        lastPos = start;
        startT = performance.now();
        moved = false;
        try { head.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
      });
      head.addEventListener('pointermove', (ev) => {
        if (start === null) return;
        const pos = axis === 'y' ? ev.clientY : ev.clientX;
        let d = pos - start;
        if (axis === 'y' && d < 0) d = 0;   // 底部面板只跟手下拉
        if (axis === 'x' && d > 0) d = 0;   // 左抽屉只跟手左滑
        if (!moved && Math.abs(d) < 5) return;
        moved = true;
        sheet.style.transition = 'none';
        sheet.style.transform = axis === 'y' ? 'translateY(' + d + 'px)' : 'translateX(' + d + 'px)';
        lastPos = pos;
      });
      function finish() {
        if (start === null) return;
        const d = lastPos - start;
        const v = Math.abs(d) / Math.max(performance.now() - startT, 1);
        const close = moved && (Math.abs(d) > THRESH || v > SPEED);
        sheet.style.transition = '';
        sheet.style.transform = '';
        start = null;
        if (close) closeSheet(id);
      }
      head.addEventListener('pointerup', finish);
      head.addEventListener('pointercancel', finish);
    }
    makeDraggable('railRight', 'y');
    makeDraggable('railLeft', 'x');
    /* 遮罩左滑也可关闭 */
    const scrim = $('scrim');
    if (scrim) {
      let sx = null;
      scrim.addEventListener('pointerdown', (ev) => { sx = ev.clientX; });
      scrim.addEventListener('pointerup', (ev) => {
        if (sx !== null && sx - ev.clientX > 60) closeSheets();
        sx = null;
      });
    }
  }

  function init() {
    bind();
    startClock();
    renderTimeSeg();
    renderStatus();
    renderOverview();
    renderChips();
    renderList();
    renderLegend();
    renderClimate();
    renderExtremes();
    renderTicker();
    setLive(false);

    S.subscribe((kind) => {
      if (kind === 'status') schedule({ status: true });
      else if (kind === 'data') schedule({ overview: true, list: true, ticker: true, statusbar: true });
      else if (kind === 'filter') { listLimit = CFG.listPageSize; schedule({ overview: true, list: true, ticker: true }); }
      else if (kind === 'climate') schedule({ climate: true });
      else if (kind === 'field') schedule({ legend: true, statusbar: true });
    });
  }

  return {
    init, renderStatus, renderOverview, renderChips, renderList, renderDetail, renderClimate,
    renderExtremes, renderTicker, renderLegend, markSelected, showTooltip, hideTooltip, toast,
    notifyNew, updateStatusBar, bootLog, bootProgress, hideBoot, setLive, setMapReady,
    glyphSvg, hazardColor, hazardZh, schedule,
    isPhone, closeSheets, closeSheet, revealDetail
  };
})();