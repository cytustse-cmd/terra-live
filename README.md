# TERRA LIVE · 全球自然灾害实时监测

纯静态、零依赖的实时灾害监测地图：MapLibre GL 地球投影 + 玻璃拟态控制台，桌面/手机双端适配（抽屉 + 底部面板 + 滑动手势）。

## 本地开发

无需安装任何依赖，直接起静态服务：

```bash
python3 -m http.server 8777
# 打开 http://localhost:8777
```

## 构建

把 CSS/JS 全部内联成单文件（可直接 AirDrop 给手机打开）：

```bash
node tools/build-single.mjs            # 输出 terra-live.html
node tools/build-single.mjs dist/index.html
```

## 部署

推送到 `main` 即由 GitHub Actions 构建并发布到 GitHub Pages。

## 数据来源

| 来源 | 内容 |
| ---- | ---- |
| USGS | 地震（60s 轮询） |
| NASA EONET | 野火、火山、洪涝等事件 |
| GDACS | 热带气旋等告警 |
| NOAA NWS | 美国官方预警 |
| Open-Meteo | 全球温度场 / 海温距平 / 极值格点 |
| NOAA CPC | ONI 厄尔尼诺指数 |
