/* TERRA LIVE — 事件仓库与状态中枢 */
window.TL = window.TL || {};

TL.store = (function () {
  const U = TL.util;
  const CFG = TL.CONFIG;

  const events = new Map();          // id -> event
  const seenIds = new Set();         // 历史出现过的 id
  const changed = new Set();         // 本轮新增/更新的 id
  const listeners = [];
  const status = {};                 // sourceId -> {state, at, ms, count, note}
  const fields = { sst: [], wx: [], meta: {} };
  const climate = { oni: null, regions: null, derivedIndex: null, source: null, updatedAt: 0 };

  let filter = {
    hazards: new Set(Object.keys(TL.HAZARDS)),
    windowId: '7d',
    query: '',
    onlyNew: false,
    minMag: 2.5,                    // 仅作用于地震：0 = 全部微震
    sort: 'time'                    // time | severity
  };

  Object.keys(TL.SOURCE_META).forEach((id) => {
    status[id] = { state: 'idle', at: 0, ms: 0, count: 0, note: '' };
  });

  function subscribe(fn) { listeners.push(fn); }
  function emit(kind) { listeners.forEach((fn) => fn(kind)); }

  function setStatus(id, patch) {
    status[id] = Object.assign({}, status[id], patch, { at: Date.now() });
    emit('status');
  }

  function normalize(e) {
    return {
      id: e.id,
      source: e.source,
      hazard: TL.HAZARDS[e.hazard] ? e.hazard : 'manmade',
      title: e.title || '未命名事件',
      subtitle: e.subtitle || '',
      lon: U.round(e.lon, 4),
      lat: U.round(e.lat, 4),
      time: e.time || Date.now(),
      endTime: e.endTime || null,
      severity: U.clamp(e.severity === undefined ? 0.4 : e.severity, 0, 1),
      magnitude: e.magnitude || null,
      alert: e.alert || null,
      url: e.url || null,
      desc: e.desc || '',
      meta: e.meta || [],
      geom: e.geom || null,
      region: e.region || null,
      value: e.value === undefined ? null : e.value
    };
  }

  function upsert(list, sourceId) {
    if (!list || !list.length) return 0;
    let fresh = 0;
    const now = Date.now();
    list.forEach((raw) => {
      const e = normalize(raw);
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return;
      const prev = events.get(e.id);
      if (!prev) {
        if (!seenIds.has(e.id)) { seenIds.add(e.id); fresh++; changed.add(e.id); }
        else { changed.add(e.id); }
      } else if (prev.time !== e.time || prev.severity !== e.severity) {
        changed.add(e.id);
      }
      events.set(e.id, prev ? Object.assign(prev, e) : e);
    });
    if (events.size > CFG.maxEvents) prune();
    emit('data');
    return fresh;
  }

  function prune() {
    const arr = Array.from(events.values()).sort((a, b) => a.time - b.time);
    const drop = arr.slice(0, arr.length - CFG.maxEvents);
    drop.forEach((e) => events.delete(e.id));
  }

  function get(id) { return events.get(id); }

  function windowMs() {
    const w = CFG.timeWindows.find((x) => x.id === filter.windowId);
    return w ? w.ms : 604800000;
  }

  function matchFilter(e, cutoff) {
    if (e.time < cutoff) return false;
    if (!filter.hazards.has(e.hazard)) return false;
    if (e.hazard === 'earthquake' && filter.minMag > 0 && (e.value === null || e.value < filter.minMag)) return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const hay = (e.title + ' ' + e.subtitle + ' ' + (e.region || '') + ' ' + (e.magnitude && e.magnitude.unit || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (filter.onlyNew && !isNew(e)) return false;
    return true;
  }

  function isNew(e) { return Date.now() - e.time <= CFG.newEventWindowMs; }

  function visible() {
    const cutoff = Date.now() - windowMs();
    let out = [];
    events.forEach((e) => { if (matchFilter(e, cutoff)) out.push(e); });
    if (filter.sort === 'severity') out.sort((a, b) => b.severity - a.severity || b.time - a.time);
    else out.sort((a, b) => b.time - a.time);
    return out;
  }

  function all() { return Array.from(events.values()); }

  function counts() {
    const cutoff = Date.now() - windowMs();
    const c = {};
    Object.keys(TL.HAZARDS).forEach((k) => { c[k] = 0; });
    let total = 0, fresh = 0;
    events.forEach((e) => {
      if (e.time < cutoff) return;
      if (e.hazard === 'earthquake' && filter.minMag > 0 && (e.value === null || e.value < filter.minMag)) return;
      c[e.hazard] = (c[e.hazard] || 0) + 1;
      total++;
      if (isNew(e)) fresh++;
    });
    return { byHazard: c, total, fresh };
  }

  function globalExtremes() {
    const cutoff = Date.now() - windowMs();
    const pick = (list, cmp) => list.length ? list.reduce((a, b) => (cmp(b, a) ? b : a)) : null;
    const pool = [];
    events.forEach((e) => { if (e.time >= cutoff && e.value !== null && Number.isFinite(e.value)) pool.push(e); });

    const quakes = pool.filter((e) => e.hazard === 'earthquake');
    const heats = pool.filter((e) => e.hazard === 'heat');
    const rains = pool.filter((e) => e.hazard === 'flood' && e.subtitle.indexOf('mm') > -1);
    const winds = pool.filter((e) => e.subtitle.indexOf('km/h') > -1);
    const fires = pool.filter((e) => e.hazard === 'wildfire');

    const best = (arr, dir) => pick(arr, (a, b) => dir === 'max' ? a.value > b.value : a.value < b.value);
    const bySeverity = (arr) => pick(arr, (a, b) => a.severity > b.severity);

    return {
      quake: best(quakes, 'max'),
      heat: best(heats, 'max'),
      cold: best(pool.filter((e) => e.hazard === 'cold'), 'min'),
      rain: best(rains, 'max'),
      wind: best(winds, 'max'),
      fire: best(fires, 'max'),
      severe: bySeverity(all().filter((e) => e.time >= cutoff && (e.hazard === 'storm' || e.hazard === 'volcano' || e.hazard === 'severe')))
    };
  }

  function sourceHealth() {
    const ids = Object.keys(status);
    let ok = 0, err = 0, idle = 0;
    ids.forEach((id) => {
      const s = status[id].state;
      if (s === 'ok') ok++; else if (s === 'error') err++; else if (s !== 'loading') idle++;
    });
    return { ok, err, idle, total: ids.length };
  }

  function setField(name, data) { fields[name] = data; emit('field'); }
  function setFieldMeta(patch) { fields.meta = Object.assign({}, fields.meta, patch); emit('field'); }
  function setClimate(patch) { Object.assign(climate, patch); emit('climate'); }

  function setFilter(patch) {
    Object.assign(filter, patch);
    emit('filter');
  }
  function getFilter() { return filter; }
  function toggleHazard(h) {
    if (filter.hazards.has(h)) filter.hazards.delete(h); else filter.hazards.add(h);
    emit('filter');
  }
  function resetHazards() {
    filter.hazards = new Set(Object.keys(TL.HAZARDS));
    emit('filter');
  }

  function consumeChanged() {
    const arr = Array.from(changed);
    changed.clear();
    return arr;
  }

  return {
    subscribe, emit, setStatus, status, upsert, get, visible, all, counts,
    globalExtremes, sourceHealth, setField, setFieldMeta, fields,
    setClimate, climate, setFilter, getFilter, toggleHazard, resetHazards,
    isNew, consumeChanged, windowMs
  };
})();