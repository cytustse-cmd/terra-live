/* TERRA LIVE — 应用编排：数据轮询、交互、启动流程 */
window.TL = window.TL || {};

TL.app = (function () {
  const U = TL.util;
  const S = TL.store;
  const CFG = TL.CONFIG;
  const LIVE_URL = 'https://terra-live-vdvl5vu3jou.qoder.website';
  const onLiveHost = location.hostname === 'terra-live-vdvl5vu3jou.qoder.website';

  let paused = false;
  let basemapIdx = 0;
  let projection = 'globe';
  let bootDone = 0;
  let bootHidden = false;
  let netTimer = null;
  const timers = {};
  const lastRun = {};
  const throttledMapRefresh = U.throttle(() => TL.mapView.refresh(), 500);

  function setNetAlert(show) {
    const el = document.getElementById('netAlert');
    if (el) el.classList.toggle('show', !!show);
  }
  function checkNet() {
    setNetAlert(S.all().length === 0);
  }
  function armNetCheck(delay) {
    clearTimeout(netTimer);
    netTimer = setTimeout(checkNet, delay);
  }

  function settleBoot(note) {
    bootDone++;
    TL.ui.bootProgress(0.25 + (bootDone / 7) * 0.75);
    if (bootDone >= 7) finishBoot();
  }
  function finishBoot() {
    if (bootHidden) return;
    bootHidden = true;
    // 底图样式可能正在走 10 秒兜底，别急着把「渲染器未就绪」的锅甩给 WebGL
    const settleMap = () => {
      if (TL.mapView.ready) {
        TL.ui.bootLog('底图已就绪 · 实时监测中', 'ok');
        return;
      }
      TL.ui.bootLog('渲染器未就绪：WebGL 或 Worker 可能被浏览器限制', 'bad');
      TL.ui.toast({
        label: '提示',
        title: TL.mapView.map ? '底图样式未能加载' : '地图渲染器未就绪',
        subtitle: TL.mapView.map
          ? '地图交互仍可用，事件数据不受影响；可稍后刷新重试'
          : (location.protocol === 'file:'
            ? '本地文件模式下浏览器可能限制 Worker 与跨域请求，建议改用 http 地址或发布链接打开'
            : '请确认浏览器已启用 WebGL'),
        color: 'var(--warn)'
      });
    };
    if (!TL.mapView.ready) {
      if (!TL.mapView.map) settleMap();
      else setTimeout(settleMap, 4000);
    } else {
      TL.ui.bootLog('系统就绪 · 实时监测中', 'ok');
    }
    TL.ui.bootProgress(1);
    TL.ui.hideBoot();
    // 数据链路若在启动完成后仍为空，给出可见的重连入口
    armNetCheck(800);
  }

  /* 单源调度：带超时保护与启动错峰 */
  function schedule(id, fn, delay, interval) {
    const wrapped = () => {
      if (paused || document.hidden) return Promise.resolve();
      const t0 = Date.now();
      lastRun[id] = t0;
      return fn().catch((err) => {
        TL.ui.bootLog(TL.SOURCE_META[id].short + ' 连接异常：' + err.message, 'bad');
      });
    };
    setTimeout(() => {
      if (!TL.mapView.ready) TL.ui.bootLog('等待渲染器就绪，暂缓 ' + TL.SOURCE_META[id].short + ' 拉取…');
      wrapped().then(() => {
        settleBoot();
        const st = S.status[id].state;
        const label = st === 'error' ? ' 链路受限 · ' : (st === 'cached' ? ' 快照回放 · ' : ' 链路建立 · ');
        TL.ui.bootLog(TL.SOURCE_META[id].short + label + (S.status[id].note || ''),
          st === 'error' ? 'bad' : (st === 'ok' ? 'ok' : ''));
      });
    }, delay);
    timers[id] = setInterval(wrapped, interval);
  }

  function startLoaders() {
    schedule('usgs', () => TL.sources.usgs.load(true), 300, CFG.refresh.usgs);
    schedule('eonet', () => TL.sources.eonet.load(), 500, CFG.refresh.eonet);
    schedule('gdacs', () => TL.sources.gdacs.load(), 700, CFG.refresh.gdacs);
    schedule('nws', () => TL.sources.nws.load().then((r) => { TL.mapView.refreshZones(); return r; }), 900, CFG.refresh.nws);
    schedule('wx', () => TL.sources.weather.load(), 1200, CFG.refresh.wx);
    schedule('ocean', () => TL.sources.ocean.load(), 1600, CFG.refresh.ocean);
    schedule('oni', () => TL.sources.oni.load(), 800, CFG.refresh.oni);

    // 首屏兜底：无论数据源是否完成，最多 9 秒后收起启动遮罩
    setTimeout(finishBoot, 9000);
  }

  function refreshAll(manual) {
    if (manual) TL.ui.toast({ title: '正在强制刷新全部数据源…', subtitle: '7 个链路同时重新拉取', label: '手动刷新' });
    Object.keys(timers).forEach((id, i) => {
      setTimeout(() => {
        TL.sources[id].load(true).then(() => {
          if (id === 'nws') TL.mapView.refreshZones();
          if (manual) TL.ui.toast({
            title: TL.SOURCE_META[id].name + ' 已更新',
            subtitle: S.status[id].note, label: '数据刷新',
            color: S.status[id].state === 'ok' ? 'var(--ok)' : 'var(--danger)'
          });
        }).catch(() => {});
      }, i * 240);
    });
  }

  function toggleLive() {
    paused = !paused;
    TL.ui.setLive(paused);
    TL.ui.toast({
      label: paused ? '监测已暂停' : '监测已恢复',
      title: paused ? '自动轮询已暂停' : '实时轮询已恢复',
      subtitle: paused ? '地图与列表保留当前快照' : '各数据源将按设定节奏刷新',
      color: paused ? 'var(--warn)' : 'var(--ok)'
    });
  }

  function selectEvent(id, fly) {
    const e = S.get(id);
    if (!e) return;
    TL.mapView.select(id);
    TL.ui.markSelected(id);
    TL.ui.renderDetail(e);
    TL.ui.revealDetail();
    if (fly) TL.mapView.flyTo(e.lon, e.lat, e.hazard === 'earthquake' || e.severity < 0.5 ? 5 : 3.6);
    const rs = document.getElementById('rightScroll');
    if (rs) rs.scrollTop = 0;
  }

  function clearSelection() {
    TL.mapView.select(null);
    TL.ui.markSelected(null);
    TL.ui.renderDetail(null);
  }

  function hoverEvent(id, point) {
    if (!id) { TL.ui.hideTooltip(); return; }
    const e = S.get(id);
    if (e && point) TL.ui.showTooltip(e, point);
    else TL.ui.hideTooltip();
  }

  function toggleProjection() {
    projection = projection === 'globe' ? 'mercator' : 'globe';
    TL.mapView.setProjection(projection);
    const label = projection === 'globe' ? '球面' : '平面';
    const btn = document.getElementById('btnProjection');
    if (btn) {
      btn.classList.toggle('on', projection === 'globe');
      btn.childNodes[btn.childNodes.length - 1].nodeValue = label;
    }
    const mLabel = document.getElementById('mProjLabel');
    if (mLabel) mLabel.textContent = label;
  }

  function cycleBasemap() {
    basemapIdx = (basemapIdx + 1) % CFG.basemaps.length;
    const bm = CFG.basemaps[basemapIdx];
    TL.mapView.setBasemap(bm.url);
    const btn = document.getElementById('btnBasemap');
    if (btn) btn.textContent = bm.name;
    const mLabel = document.getElementById('mBmLabel');
    if (mLabel) mLabel.textContent = bm.name;
  }

  function bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      switch (ev.key.toLowerCase()) {
        case 'l': document.getElementById('railLeft').classList.toggle('open'); break;
        case 'g': toggleProjection(); break;
        case 'r': refreshAll(true); break;
        case 'b': cycleBasemap(); break;
        case 'f':
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen();
          break;
        case 'escape': clearSelection(); TL.ui.closeSheets(); break;
        case ' ':
          ev.preventDefault();
          toggleLive();
          break;
        default: break;
      }
    });
  }

  function startLoop() {
    // 事件脉冲状态每分钟重算一次（让“新事件”标记自然过期）
    setInterval(() => {
      if (document.hidden) return;
      TL.mapView.refresh();
      TL.ui.schedule({ overview: true, list: false, statusbar: true });
    }, 60000);
    // 昼夜线随时间推移
    setInterval(() => { if (!document.hidden) TL.mapView.updateTerminator(); }, 300000);
    // 回到前台时补齐一次（含后台打开、首屏从未拉取过的情况）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || paused) return;
      Object.keys(timers).forEach((id) => {
        const gap = CFG.refresh[id] || 300000;
        if (!lastRun[id] || Date.now() - lastRun[id] > gap) TL.sources[id].load(id === 'usgs').catch(() => {});
      });
      TL.ui.schedule({ overview: true, list: true, statusbar: true });
    });
  }

  function connectStore() {
    S.subscribe((kind) => {
      if (kind === 'data') {
        const changed = S.consumeChanged();
        if (changed.length) {
          const fresh = changed.map((id) => S.get(id)).filter(Boolean);
          TL.ui.notifyNew(fresh);
        }
        if (S.all().length) setNetAlert(false);
        throttledMapRefresh();
      } else if (kind === 'filter') {
        TL.mapView.refresh();
        TL.mapView.refreshZones();
      } else if (kind === 'field') {
        TL.mapView.refreshFields();
      }
    });
  }

  function boot() {
    TL.ui.bootLog('初始化控制台界面…');
    TL.ui.init();
    if (location.protocol === 'file:') {
      TL.ui.bootLog('本地文件模式（file://）：数据链路依赖网络与浏览器策略', 'bad');
      document.body.classList.add('file-mode');
    }
    TL.ui.bootLog('构建 WebGL 地球渲染器…');
    try {
      TL.mapView.init('map');
    } catch (err) {
      TL.ui.bootLog('渲染器初始化失败：' + err.message, 'bad');
    }
    connectStore();
    bindKeys();
    startLoop();
    const retryBtn = document.getElementById('netRetry');
    // 内嵌预览/本地文件通常不放行外部请求，重试没有意义，直接引导到正式版
    if (retryBtn && !onLiveHost) {
      retryBtn.textContent = '打开正式版';
      const hint = document.querySelector('#netAlert .na-text span');
      if (hint) hint.textContent = '当前预览未联网，点此在浏览器打开实时数据';
    }
    if (retryBtn) retryBtn.addEventListener('click', () => {
      if (!onLiveHost) {
        // 直接在当前 webview 导航到正式版，绕开预览沙箱的弹窗限制
        location.href = LIVE_URL;
        return;
      }
      setNetAlert(false);
      TL.ui.toast({ label: '重连', title: '正在重新连接数据链路…', subtitle: '依次重试 7 个数据源，请保持网络畅通', color: 'var(--warn)' });
      refreshAll(false);
      armNetCheck(9000);
    });
    TL.ui.bootLog('接入 7 个实时数据源…');
    startLoaders();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { selectEvent, clearSelection, hoverEvent, toggleLive, toggleProjection, cycleBasemap, refreshAll };
})();