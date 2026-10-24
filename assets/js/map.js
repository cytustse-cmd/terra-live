/* TERRA LIVE — MapLibre 地图视图：地球投影、昼夜线、灾害发光标记、全球温度/海温场 */
window.TL = window.TL || {};

TL.mapView = (function () {
  const U = TL.util;
  const S = TL.store;
  const CFG = TL.CONFIG;

  let map = null;
  let ready = false;
  let selectedId = null;
  let pulsePhase = 0;
  let rafId = null;
  let lastPaint = 0;
  let pulsePaused = false;
  let projectionKind = 'globe';
  const layersOn = { field: true, sst: true, terminator: true, grid: true, zones: true, labels: true };
  const iconCache = {};
  const isSmall = () => window.innerWidth <= 820 || (window.innerHeight <= 480 && window.innerWidth <= 960);

  /* ---------- 图标生成：彩色圆盘 + 白色灾害符号 ---------- */
  const glyphCanvas = {};
  function glyphBitmap(key) {
    if (glyphCanvas[key]) return glyphCanvas[key];
    const meta = TL.HAZARDS[key];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 24;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = 'none';
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let hasPaths = false;
    (TL.GLYPHS[meta.icon] || []).forEach((d) => {
      try { ctx.stroke(new Path2D(d)); hasPaths = true; } catch (e) { /* 忽略非法路径 */ }
    });
    if (!hasPaths) { ctx.beginPath(); ctx.arc(12, 12, 6, 0, Math.PI * 2); ctx.stroke(); }
    glyphCanvas[key] = cv;
    return cv;
  }

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function makeIcon(key) {
    if (iconCache[key]) return iconCache[key];
    const meta = TL.HAZARDS[key];
    const px = 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d');
    const c = px / 2;

    const aura = ctx.createRadialGradient(c, c, 2, c, c, c);
    aura.addColorStop(0, hexToRgba(meta.color, 0.55));
    aura.addColorStop(0.45, hexToRgba(meta.color, 0.16));
    aura.addColorStop(1, hexToRgba(meta.color, 0));
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, px, px);

    const r = 11;
    const disc = ctx.createLinearGradient(0, c - r, 0, c + r);
    disc.addColorStop(0, hexToRgba(meta.color, 0.98));
    disc.addColorStop(1, hexToRgba(meta.color, 0.72));
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = disc;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.stroke();

    ctx.save();
    ctx.translate(c - 12, c - 12);
    ctx.drawImage(glyphBitmap(key), 0, 0, 24, 24);
    ctx.restore();

    const data = ctx.getImageData(0, 0, px, px);
    const img = { width: px, height: px, data: data.data };
    iconCache[key] = img;
    return img;
  }

  /* ---------- 昼夜分界线 ---------- */
  function terminatorPolygon() {
    const now = new Date();
    const doy = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
    const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * Math.PI / 180;
    const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
    const subLon = -15 * (utcH - 12);
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const H = (lon - subLon) * Math.PI / 180;
      const lat = Math.atan(-Math.cos(H) / Math.tan(decl)) * 180 / Math.PI;
      coords.push([lon, lat]);
    }
    const darkPole = decl > 0 ? -90 : 90;
    coords.push([180, darkPole], [-180, darkPole], [-180, coords[0][1]]);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
  }

  /* ---------- 经纬网 ---------- */
  function graticule() {
    const feats = [];
    for (let lon = -180; lon <= 180; lon += 30) {
      const c = [];
      for (let lat = -85; lat <= 85; lat += 5) c.push([lon, lat]);
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} });
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const c = [];
      for (let lon = -180; lon <= 180; lon += 5) c.push([lon, lat]);
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} });
    }
    return feats;
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function baseStyle() {
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: { fallbackGrid: { type: 'geojson', data: { type: 'FeatureCollection', features: graticule() } } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#050912' } },
        { id: 'fallback-grat', type: 'line', source: 'fallbackGrid', paint: { 'line-color': '#4a6a86', 'line-opacity': 0.22, 'line-width': 0.7 } }
      ]
    };
  }

  /* ---------- 事件 → GeoJSON ---------- */
  let currentEvents = [];

  function buildEvents(list) {
    currentEvents = list;
    // 极端密集时按强度裁剪，优先丢弃微弱余震，保证渲染帧率（手机上限更低）
    const cap = isSmall() ? 1200 : 2600;
    let draw = list;
    if (list.length > cap) {
      const majors = list.filter((e) => e.hazard !== 'earthquake' || e.severity > 0.18);
      draw = majors.length > cap
        ? majors.slice().sort((a, b) => b.severity - a.severity).slice(0, cap)
        : majors;
    }
    const feats = draw.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: {
        id: e.id,
        hazard: e.hazard,
        icon: 'hz-' + e.hazard,
        color: TL.HAZARDS[e.hazard] ? TL.HAZARDS[e.hazard].color : '#8899aa',
        severity: e.severity,
        isNew: S.isNew(e) ? 1 : 0,
        selected: e.id === selectedId ? 1 : 0,
        title: e.title
      }
    }));
    const fc = { type: 'FeatureCollection', features: feats };
    const src = map.getSource('events');
    if (src) src.setData(fc);
    // 选中事件也单独画一层高亮环
    const sel = list.filter((e) => e.id === selectedId).map((e) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: {}
    }));
    const selSrc = map.getSource('selected');
    if (selSrc) selSrc.setData({ type: 'FeatureCollection', features: sel });
  }

  function buildSst(points) {
    const feats = points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { anom: p.anom, sst: p.sst, a: Math.abs(p.anom) }
    }));
    const src = map.getSource('sst');
    if (src) src.setData({ type: 'FeatureCollection', features: feats });
  }

  function buildWx(points) {
    const feats = points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { temp: p.temp === null || p.temp === undefined ? 15 : p.temp, rain: p.rain }
    }));
    const src = map.getSource('wx');
    if (src) src.setData({ type: 'FeatureCollection', features: feats });
  }

  function buildZones(list) {
    const feats = list.filter((e) => e.geom && (e.geom.type === 'Polygon' || e.geom.type === 'MultiPolygon'))
      .map((e) => ({
        type: 'Feature', geometry: e.geom,
        properties: { color: TL.HAZARDS[e.hazard] ? TL.HAZARDS[e.hazard].color : '#8899aa' }
      }));
    const src = map.getSource('zones');
    if (src) src.setData({ type: 'FeatureCollection', features: feats });
  }

  /* ---------- 图层 ---------- */
  function addLayers() {
    Object.keys(TL.HAZARDS).forEach((k) => {
      const id = 'hz-' + k;
      if (!map.hasImage(id)) map.addImage(id, makeIcon(k), { pixelRatio: 2 });
    });

    map.addSource('graticule', { type: 'geojson', data: { type: 'FeatureCollection', features: graticule() } });
    map.addLayer({
      id: 'graticule-line', type: 'line', source: 'graticule',
      paint: { 'line-color': 'rgba(120,180,255,0.13)', 'line-width': 0.6, 'line-dasharray': [2, 4] }
    });

    map.addSource('wx', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'wx-field', type: 'circle', source: 'wx',
      layout: { visibility: layersOn.field ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 20, 2, 48, 3, 104, 4.5, 260],
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.26, 3, 0.2, 5, 0.12],
        'circle-color': ['interpolate', ['linear'], ['get', 'temp'],
          -45, '#221a52', -25, '#173a8a', -10, '#125f8a', 0, '#0d4f57',
          10, '#2a6b4c', 20, '#8a7d33', 30, '#b8602a', 38, '#b8331f', 48, '#6d1010']
      }
    });

    map.addSource('sst', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'sst-field', type: 'circle', source: 'sst',
      layout: { visibility: layersOn.sst ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 26, 2, 62, 3, 140, 5, 460],
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'a'], 0, 0.06, 0.5, 0.26, 2.5, 0.5],
        'circle-color': ['interpolate', ['linear'], ['get', 'anom'],
          -3, '#1b3fd8', -1.5, '#1c86c9', -0.4, '#173a4a',
          0.4, '#4a2417', 1.5, '#d9662a', 3, '#e01f1f']
      }
    });

    map.addSource('terminator', { type: 'geojson', data: terminatorPolygon() });
    map.addLayer({
      id: 'terminator-fill', type: 'fill', source: 'terminator',
      layout: { visibility: layersOn.terminator ? 'visible' : 'none' },
      paint: { 'fill-color': 'rgba(3,7,20,0.5)', 'fill-outline-color': 'rgba(150,200,255,0.22)' }
    });

    map.addSource('zones', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'zones-fill', type: 'fill', source: 'zones',
      layout: { visibility: layersOn.zones ? 'visible' : 'none' },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 }
    });
    map.addLayer({
      id: 'zones-line', type: 'line', source: 'zones',
      layout: { visibility: layersOn.zones ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [3, 2] }
    });

    map.addSource('events', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'event-glow', type: 'circle', source: 'events',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 3, 22, 6, 44, 10, 90],
        'circle-blur': 0.95,
        'circle-opacity': ['*', 0.55, ['+', 0.45, ['get', 'severity']]],
        'circle-color': ['get', 'color']
      }
    });
    map.addLayer({
      id: 'event-pulse', type: 'circle', source: 'events',
      filter: ['==', ['get', 'isNew'], 1],
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.8
      }
    });
    map.addLayer({
      id: 'event-icon', type: 'symbol', source: 'events',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['get', 'severity'], 0.05, 0.42, 0.5, 0.62, 1, 0.86],
        'icon-padding': 0
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['get', 'severity'], 0.04, 0.5, 0.35, 0.82, 0.75, 1]
      }
    });
    map.addSource('selected', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'selected-ring', type: 'circle', source: 'selected',
      paint: {
        'circle-radius': 16,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0.95
      }
    });

    ['event-glow', 'event-pulse', 'event-icon'].forEach((lid) => {
      map.on('mouseenter', lid, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', lid, (e) => {
        const f = e.features && e.features[0];
        if (f) TL.app.selectEvent(f.properties.id, true);
      });
    });
    map.on('mousemove', 'event-icon', (e) => {
      const f = e.features && e.features[0];
      if (f) TL.app.hoverEvent(f.properties.id, e.point); else TL.app.hoverEvent(null);
    });
  }

  function startPulse() {
    if (rafId || pulsePaused) return;
    function tick(ts) {
      rafId = requestAnimationFrame(tick);
      if (ts - lastPaint < (isSmall() ? 72 : 50)) return;   // 20fps / 手机 ~14fps
      lastPaint = ts;
      pulsePhase += 0.09;
      if (!map || !ready) return;
      const s = (Math.sin(pulsePhase) + 1) / 2;
      if (map.getLayer('event-pulse')) {
        map.setPaintProperty('event-pulse', 'circle-radius', 12 + s * 16);
        map.setPaintProperty('event-pulse', 'circle-stroke-opacity', 0.85 - s * 0.6);
      }
      if (map.getLayer('selected-ring') && selectedId) {
        map.setPaintProperty('selected-ring', 'circle-radius', 15 + s * 6);
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  /* 手机上面板遮住地图 / 标签页不可见时停掉 rAF，避免持续 WebGL 重绘 */
  function pausePulse(v) {
    pulsePaused = !!v;
    if (v && rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!v) {
      startPulse();
    }
  }

  /* ---------- 初始化 ---------- */
  function init(container) {
    const small = isSmall();
    // 手机屏窄，固定 zoom 会让地球撑出屏幕；按“约 110° 经度”反算初始缩放
    const vw = container.clientWidth || window.innerWidth;
    const zoom = small ? Math.round(Math.log2((vw * 360 / 110) / 512) * 100) / 100 : 1.35;
    map = new maplibregl.Map({
      container,
      style: CFG.basemaps[0].url,
      center: small ? [98, 16] : [104, 22],
      zoom,
      minZoom: small ? 0.5 : 0.4,
      maxZoom: 12,
      attributionControl: false,
      projection: 'globe',
      fadeDuration: small ? 0 : 300,
      dragRotate: !small,
      pitchWithRotate: !small,
      touchPitch: false
    });
    map.touchZoomRotate.disableRotation();

    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '数据：USGS · NASA EONET · GDACS · NOAA · Open-Meteo ｜ 底图：OpenFreeMap / OpenStreetMap' }), 'bottom-right');
    // 小屏默认收起版权信息，避免占掉半屏地图
    if (small) {
      const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      if (attrib) attrib.classList.remove('maplibregl-compact-show');
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: !small, showCompass: !small }), 'bottom-right');
    if (!small) map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    /* 用 style.load 而不是 load：底图瓦片慢/个别瓦片失败时 load 可能永不触发，
       之前那会把整张底图换成纯黑背景。样式一解析完就挂自有图层。 */
    let attached = false;
    function attach() {
      if (attached) return;
      attached = true;
      ready = true;
      addLayers();
      refresh();
      refreshZones();
      startPulse();
      TL.ui.setMapReady(true);
      map.on('moveend', () => TL.ui.updateStatusBar(map));
    }
    map.on('style.load', attach);
    if (map.isStyleLoaded()) attach();

    // 标签页不可见时停掉脉冲循环（rAF 被节流前主动退出更省电）
    document.addEventListener('visibilitychange', () => pausePulse(document.hidden));

    // 只有「样式本身没拿到」才降级；瓦片慢不再触发。降级底图带经纬网，不再是一片纯黑
    const guard = setTimeout(() => {
      if (attached) return;
      TL.ui.toast({ label: '底图', title: '底图服务响应缓慢', subtitle: '已切换简化底图，事件数据不受影响', color: 'var(--warn)' });
      map.setStyle(baseStyle());
    }, 10000);
    map.on('style.load', () => clearTimeout(guard));
    return map;
  }

  function refresh() {
    if (!ready) return;
    buildEvents(S.visible());
    buildSst(S.fields.sst || []);
    buildWx(S.fields.wx || []);
  }

  function refreshFields() {
    if (!ready) return;
    buildSst(S.fields.sst || []);
    buildWx(S.fields.wx || []);
  }

  function refreshZones() {
    if (!ready) return;
    buildZones(S.all());
  }

  function select(id) {
    selectedId = id;
    buildEvents(currentEvents);
  }

  function setProjection(kind) {
    projectionKind = kind;
    if (!map) return;
    if (typeof map.setProjection === 'function') {
      map.setProjection({ type: kind });
    } else {
      map.setStyle(map.getStyle(), { diff: true });
    }
  }

  function setBasemap(url) {
    if (!map) return;
    const keep = { sst: S.fields.sst, wx: S.fields.wx };
    map.setStyle(url);
    map.once('styledata', () => {
      ready = false;
      // 样式切换会清空自定义图层，等待 load 后重建
      setTimeout(() => {
        if (!map.isStyleLoaded()) return;
        ready = true;
        addLayers();
        refresh();
        map.setPaintProperty('graticule-line', 'line-color', 'rgba(120,180,255,0.13)');
        // 新样式默认平面投影，把用户当前选择重新套上
        if (typeof map.setProjection === 'function') map.setProjection({ type: projectionKind });
      }, 350);
    });
  }

  function toggleLayer(key, on) {
    if (!ready) return;
    layersOn[key] = on;
    const vis = on ? 'visible' : 'none';
    const m = {
      field: ['wx-field'],
      sst: ['sst-field'],
      terminator: ['terminator-fill'],
      grid: ['graticule-line'],
      zones: ['zones-fill', 'zones-line']
    };
    (m[key] || []).forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function flyTo(lon, lat, zoom) {
    if (!map) return;
    const small = isSmall();
    const sheet = document.getElementById('railRight');
    // 手机上详情面板占掉下部约 64% 的屏幕，把目标点留在露出的地图条里
    const bottom = small
      ? (sheet && sheet.classList.contains('open') ? Math.round(window.innerHeight * 0.64) : 90)
      : 40;
    const pad = small ? 24 : 60;
    map.flyTo({ center: [lon, lat], zoom: zoom === undefined ? Math.max(map.getZoom(), 4.2) : zoom, duration: 1200, essential: true, padding: { left: pad, right: pad, top: small ? 56 : 40, bottom } });
  }

  function fitBounds(bbox) {
    if (!map || !bbox) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { duration: 1100, padding: 70 });
  }

  function updateTerminator() {
    if (!ready) return;
    const src = map.getSource('terminator');
    if (src) src.setData(terminatorPolygon());
  }

  function updateBasemapTheme() { /* 预留：不同底图下的辅助线配色 */ }

  return {
    init, refresh, refreshFields, refreshZones, select, setProjection, setBasemap,
    toggleLayer, flyTo, fitBounds, updateTerminator, updateBasemapTheme, pausePulse,
    get map() { return map; },
    get ready() { return ready; },
    get layersOn() { return layersOn; }
  };
})();