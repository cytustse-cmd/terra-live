#!/usr/bin/env node
/* 把 terra-live 打成单文件 HTML：内联本地 CSS 与全部本地 JS，保留 CDN 依赖。
   用法：node tools/build-single.mjs [输出路径] */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, 'terra-live.html'));

const read = (p) => readFile(resolve(root, p), 'utf8');
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';

// 内联脚本时若内容含 </script> 会提前闭合标签，需转义
const guard = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = await read('index.html');
const inlined = [];

const cssRe = /^[ \t]*<link[^>]+href="(assets\/[^"]+\.css)"[^>]*>[ \t]*$/gm;
for (const m of html.matchAll(cssRe)) {
  const css = await read(m[1]);
  html = html.replace(m[0], () => `<style>\n${css.trim()}\n</style>`);
  inlined.push(`${m[1]} → <style> (${kb(css)})`);
}

const jsRe = /^[ \t]*<script[^>]+src="(assets\/[^"]+\.js)"[^>]*><\/script>[ \t]*$/gm;
for (const m of html.matchAll(jsRe)) {
  const js = await read(m[1]);
  html = html.replace(m[0], () => `<script>\n${guard(js.trim())}\n</script>`);
  inlined.push(`${m[1]} → <script> (${kb(js)})`);
}

if (!inlined.length) {
  console.error('没有找到可内联的本地资源，检查 index.html 的相对路径。');
  process.exit(1);
}

// 保留的 CDN 依赖
const cdn = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https:\/\/[^"]+)"/g)].map((m) => m[1]);

html = html.replace(
  '</title>',
  '</title>\n<!-- 单文件构建产物：本地 CSS/JS 已内联，直接双击或用 AirDrop 到手机即可打开。数据链路仍需联网。 -->'
);

await writeFile(out, html, 'utf8');

console.log('已内联：');
inlined.forEach((l) => console.log('  · ' + l));
console.log('保留的 CDN 依赖：');
cdn.forEach((l) => console.log('  · ' + l));
console.log(`\n输出：${out}  (${kb(html)})`);