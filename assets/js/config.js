/* TERRA LIVE — 全局配置：灾害类型、数据源、刷新节奏、色板 */
window.TL = window.TL || {};

TL.HAZARDS = {
  earthquake: { zh: '地震',     en: 'Earthquake',    color: '#f5b700', icon: 'quake' },
  heat:       { zh: '极端高温', en: 'Extreme Heat',  color: '#ff4e50', icon: 'heat' },
  wildfire:   { zh: '野火',     en: 'Wildfire',      color: '#ff7a00', icon: 'fire' },
  storm:      { zh: '热带气旋', en: 'Cyclone',       color: '#00b8d9', icon: 'cyclone' },
  flood:      { zh: '洪涝暴雨', en: 'Flood / Rain',  color: '#2f7bff', icon: 'flood' },
  landslide:  { zh: '泥石流滑坡', en: 'Landslide',   color: '#b08968', icon: 'slide' },
  drought:    { zh: '干旱',     en: 'Drought',       color: '#d9a94a', icon: 'drought' },
  volcano:    { zh: '火山',     en: 'Volcano',       color: '#c2185b', icon: 'volcano' },
  cold:       { zh: '严寒低温', en: 'Extreme Cold',  color: '#7fd8ff', icon: 'snow' },
  snow:       { zh: '暴雪',     en: 'Snow Storm',    color: '#cfeeff', icon: 'snow' },
  severe:     { zh: '强对流',   en: 'Severe Wx',     color: '#9b7bff', icon: 'bolt' },
  dust:       { zh: '沙尘雾霾', en: 'Dust / Haze',   color: '#9c8c6a', icon: 'dust' },
  seaice:     { zh: '海冰冰川', en: 'Sea / Lake Ice',color: '#8fe3ff', icon: 'ice' },
  manmade:    { zh: '人为灾害', en: 'Man-made',      color: '#6b7a8f', icon: 'manmade' }
};

TL.SOURCE_META = {
  usgs: { name: 'USGS 地震台网', short: 'USGS', kind: '地震', lat: '1 分钟', url: 'https://earthquake.usgs.gov' },
  eonet: { name: 'NASA EONET 地球观测', short: 'EONET', kind: '综合', lat: '5 分钟', url: 'https://eonet.gsfc.nasa.gov' },
  gdacs: { name: 'GDACS 全球灾害告警', short: 'GDACS', kind: '综合', lat: '10 分钟', url: 'https://www.gdacs.org' },
  nws: { name: 'NOAA/NWS 美国预警', short: 'NWS', kind: '气象', lat: '3 分钟', url: 'https://api.weather.gov' },
  wx: { name: 'Open-Meteo 全球格网', short: 'METEO', kind: '气象', lat: '15 分钟', url: 'https://open-meteo.com' },
  ocean: { name: 'Open-Meteo 海洋观测', short: 'OCEAN', kind: '海温', lat: '60 分钟', url: 'https://open-meteo.com' },
  oni: { name: 'NOAA CPC ONI 指数', short: 'ONI', kind: 'ENSO', lat: '6 小时', url: 'https://www.cpc.ncep.noaa.gov' }
};

TL.CONFIG = {
  refresh: { usgs: 60000, eonet: 300000, gdacs: 600000, nws: 180000, wx: 900000, ocean: 3600000, oni: 21600000 },
  // 全球气象格网采样（每源单次大请求，规避 Open-Meteo 分钟级调用次数限制）
  wxGrid: {
    step: 10, latMax: 80,
    heatWarn: 35, heatSevere: 38, heatExtreme: 40,   // 体感温度分级
    rainHeavy: 25, rainStorm: 50, rainLive: 2.5,      // 24h 累计 / 实时雨强 mm·h⁻¹
    windKmh: 80, coldC: -22
  },
  // 海温异常场与 Niño 分区
  oceanGrid: { step: 5, latMax: 25, lonStart: 120, lonEnd: -80, pastDays: 30 },
  ninoBoxes: {
    '1+2': { lon1: -90, lon2: -80, lat1: -10, lat2: 0 },
    '3': { lon1: -150, lon2: -90, lat1: -5, lat2: 5 },
    '3.4': { lon1: -170, lon2: -120, lat1: -5, lat2: 5 },
    '4': { lon1: 160, lon2: -150, lat1: -5, lat2: 5 }
  },
  westPacificBox: { lon1: 120, lon2: 160, lat1: -5, lat2: 5 },
  maxEvents: 5000,
  listPageSize: 60,
  newEventWindowMs: 15 * 60 * 1000,
  timeWindows: [
    { id: '1h', zh: '1 小时', ms: 3600000 },
    { id: '24h', zh: '24 小时', ms: 86400000 },
    { id: '7d', zh: '7 天', ms: 604800000 },
    { id: '30d', zh: '30 天', ms: 2592000000 }
  ],
  basemaps: [
    { id: 'dark', name: '午夜', url: 'https://tiles.openfreemap.org/styles/dark' },
    { id: 'positron', name: '灰白', url: 'https://tiles.openfreemap.org/styles/positron' },
    { id: 'liberty', name: '标准', url: 'https://tiles.openfreemap.org/styles/liberty' }
  ]
};

/* 灾害图标：24x24 网格上的路径笔画，在 canvas 中描边绘制 */
TL.GLYPHS = {
  quake:   ['M3 12h4l2-6 3 12 2.5-8 2 5H21'],
  heat:    ['M12 4v9', 'M12 4a4 4 0 0 1 0 8', 'M5 8l2 1.2M19 8l-2 1.2M5 16l2-1.2M19 16l-2-1.2M12 21v-2.5'],
  fire:    ['M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2.5-5 .4 1.6 1.2 2.3 2 2.5C11 8 11.3 5.4 12 3z'],
  cyclone: ['M12 12a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z', 'M12 7.2A4.8 4.8 0 0 1 21 12c0 5-3 7-5 8.6', 'M12 16.8A4.8 4.8 0 0 1 3 12c0-5 3-7 5-8.6'],
  flood:   ['M2 9c2.2-2 4.4-2 6.6 0S13 11 15.2 9 19.6 7 22 9', 'M2 15c2.2-2 4.4-2 6.6 0s4.4 2 6.6 0 4.4-2 6.8 0'],
  slide:   ['M3 19h18', 'M3 15l6-4 4 2 3-3 5 3', 'M8 11l1.5-1.5M15 10l1-1'],
  drought: ['M3 18h18', 'M7 18V9M12 18V6M17 18v-7', 'M7 9l3 3M12 6l3 3', 'M17 11l2 2'],
  volcano: ['M4 20l5.5-11h5L20 20z', 'M9.5 9c-.5-2 .5-3 2.5-3s3 1 2.5 3', 'M12 4v2'],
  snow:    ['M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9', 'M9 4.5l3 3 3-3M9 19.5l3-3 3 3'],
  bolt:    ['M13.5 3L5.5 13.5h5L10 21l8.5-10.5h-5z'],
  dust:    ['M3 8h13M6 12h15M3 16h11', 'M18.5 6.5h1.5M20 14h1'],
  ice:     ['M12 3l7 5v8l-7 5-7-5V8z', 'M12 3v18M5 8l14 8M19 8L5 16'],
  manmade: ['M5 5h14v14H5z', 'M9 9h6v6H9z']
};