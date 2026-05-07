#!/usr/bin/env node
/**
 * sync-share-version.mjs
 *
 * 作用：自动给微信/社交分享相关的图片 URL 加上一段基于"文件本身内容指纹"的版本号 (?v=...)，
 *      让每次 commit 后只要图片变了，分享卡片就被强制重抓；图片没变则版本号不变。
 *
 *   - 首页/答题中分享图：img/share-cover.png      →  指纹 cover
 *   - 6 个角色分享图：   role/d{1..6}-B.png       →  各自独立指纹
 *     （已与立绘 B 图共用同一文件，分享卡缩略图与立绘版本同步）
 *
 * 改写的目标：
 *   - quiz-h5.html
 *       · <meta og:image / og:image:secure_url / twitter:image / itemprop=image / image_src / thumbnail>
 *       · 内嵌 JS 中 posterImg / roleShareImg 的拼装位置（在拼出后再加 ?v=...）
 *       · const ROLE_LIVE_VER 表（用于 role/d{1..6}-{A,B}.png 的版本号）
 *   - share-d1..d6.html
 *       · 同样的 6 处 head meta
 *
 * 运行方式：
 *   node scripts/sync-share-version.mjs       （在仓库根目录）
 *   作为 git pre-commit hook 自动跑（见 scripts/install-hooks.sh）
 *
 * 设计原则：
 *   - 零依赖（仅用 node 内置 fs/path/crypto）
 *   - 幂等：图片不变，文件内容不会有 diff
 *   - 安全：找不到目标行就 no-op，不破坏现有结构
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

/* 角色 id → 对应分享图相对路径（与 quiz-h5.html 里 roleMetaImgName 保持一致） */
const ROLE_IMG = {
  d1: "role/d1-B.png",
  d2: "role/d2-B.png",
  d3: "role/d3-B.png",
  d4: "role/d4-B.png",
  d5: "role/d5-B.png",
  d6: "role/d6-B.png",
};
const COVER_IMG = "img/share-cover.png";

/** 读取一张图片，返回基于 mtime+size 的 8 位短 hash */
function imgFingerprint(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    console.warn(`[sync-share-version] 缺图: ${relPath}`);
    return "missing";
  }
  const st = statSync(abs);
  const h = createHash("sha1");
  h.update(String(st.size));
  h.update("|");
  h.update(String(Math.floor(st.mtimeMs)));
  return h.digest("hex").slice(0, 8);
}

const COVER_VER = imgFingerprint(COVER_IMG);
const ROLE_VERS = Object.fromEntries(
  Object.entries(ROLE_IMG).map(([id, p]) => [id, imgFingerprint(p)])
);

/* 立绘图（角色翻面海报实际使用）：role/d{1..6}-{A,B}.png 12 张
   缓存生效路径：quiz-h5.html 中 const ROLE_LIVE_VER 表
   注：B 图同时被 og:image 复用，这里仍重算一次，结果与 ROLE_VERS 一致 */
const ROLE_LIVE_IDS = ["d1", "d2", "d3", "d4", "d5", "d6"];
const ROLE_LIVE_SIDES = ["A", "B"];
const ROLE_LIVE_VERS = {};
for (const id of ROLE_LIVE_IDS) {
  for (const side of ROLE_LIVE_SIDES) {
    ROLE_LIVE_VERS[id + side] = imgFingerprint(`role/${id}-${side}.png`);
  }
}

console.log("[sync-share-version] 当前指纹：");
console.log("  cover  =", COVER_VER);
for (const [id, ver] of Object.entries(ROLE_VERS)) {
  console.log(`  ${id} (${ROLE_IMG[id]}) =`, ver);
}
console.log("  role/ 立绘：");
for (const [k, v] of Object.entries(ROLE_LIVE_VERS)) {
  console.log(`    ${k} =`, v);
}

/**
 * 把 URL 里的 ?v=xxx 替换/补全为指定版本；如果原 URL 没有 ?v=，会补上。
 * 已有 ?v= 的会替换；其它 query 参数（暂未出现）保持原样不动。
 */
function withVer(url, ver) {
  if (!ver) return url;
  // 去掉已有的 ?v=xxx 段
  const cleaned = url.replace(/([?&])v=[^&"' )]*(&?)/, (_, p1, p2) => (p2 ? p1 : ""))
    .replace(/[?&]$/, "");
  const sep = cleaned.includes("?") ? "&" : "?";
  return `${cleaned}${sep}v=${ver}`;
}

/**
 * 替换一段 HTML 中"指向 imgPath 的 URL"的版本号。
 * imgPath 是相对仓库根的完整相对路径，如 "role/d1-B.png" 或 "img/share-cover.png"。
 * 覆盖各种 meta + image_src + thumbnail + 内嵌 JS 字面量。
 */
function bumpImgVerInHtml(html, imgPath, ver) {
  if (!ver) return html;
  const escaped = imgPath.replace(/[\\.\/]/g, m => "\\" + m);
  // 1) 已经带 ?v= 的：直接替换其 v= 值
  const reHasV = new RegExp(`(${escaped})\\?v=[a-z0-9]+`, "g");
  html = html.replace(reHasV, `$1?v=${ver}`);
  // 2) 没带 ?v= 的：补上
  const reNoV = new RegExp(`(${escaped})(?!\\?v=)`, "g");
  html = html.replace(reNoV, `$1?v=${ver}`);
  return html;
}

/** 替换 quiz-h5.html 里 `const ROLE_LIVE_VER={...};` 这一行的内容 */
function bumpRoleLiveVerInHtml(html, vers) {
  // 把对象按固定顺序拼成 d1A/d1B/d2A/d2B/.../d6A/d6B
  const parts = [];
  for (const id of ROLE_LIVE_IDS) {
    for (const side of ROLE_LIVE_SIDES) {
      const k = id + side;
      parts.push(`${k}:"${vers[k] || ""}"`);
    }
  }
  const literal = `const ROLE_LIVE_VER={${parts.join(",")}};`;
  // 匹配整行赋值（容忍空白）
  const re = /const\s+ROLE_LIVE_VER\s*=\s*\{[^}]*\}\s*;?/;
  if (re.test(html)) return html.replace(re, literal);
  return html;
}

function processQuizH5() {
  const file = join(ROOT, "quiz-h5.html");
  let html = readFileSync(file, "utf8");
  const before = html;

  // share-cover 通用版本
  html = bumpImgVerInHtml(html, COVER_IMG, COVER_VER);
  // 6 张角色图各自版本
  for (const [id, p] of Object.entries(ROLE_IMG)) {
    html = bumpImgVerInHtml(html, p, ROLE_VERS[id]);
  }
  // role/ 立绘 12 张：注入到 ROLE_LIVE_VER 常量
  html = bumpRoleLiveVerInHtml(html, ROLE_LIVE_VERS);

  if (html !== before) {
    writeFileSync(file, html, "utf8");
    console.log("[sync-share-version] 已更新 quiz-h5.html");
  } else {
    console.log("[sync-share-version] quiz-h5.html 无需更新");
  }
}

function processShareDx() {
  for (const [id, p] of Object.entries(ROLE_IMG)) {
    const file = join(ROOT, `share-${id}.html`);
    if (!existsSync(file)) continue;
    let html = readFileSync(file, "utf8");
    const before = html;
    // 中转页只引一张图：自身的角色图
    html = bumpImgVerInHtml(html, p, ROLE_VERS[id]);
    if (html !== before) {
      writeFileSync(file, html, "utf8");
      console.log(`[sync-share-version] 已更新 share-${id}.html`);
    }
  }
}

processQuizH5();
processShareDx();

console.log("[sync-share-version] done");
