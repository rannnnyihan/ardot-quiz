#!/usr/bin/env node
/**
 * sync-share-version.mjs
 *
 * 作用：自动给微信/社交分享相关的图片 URL 加上一段基于"文件本身内容指纹"的版本号 (?v=...)，
 *      让每次 commit 后只要图片变了，分享卡片就被强制重抓；图片没变则版本号不变。
 *
 *   - 首页/答题中分享图：img/share-cover.png        →  指纹 cover
 *   - 6 个角色分享图：   img/{picasso,hara,...}.png →  各自独立指纹
 *
 * 改写的目标：
 *   - quiz-h5.html
 *       · <meta og:image / og:image:secure_url / twitter:image / itemprop=image / image_src / thumbnail>
 *       · 内嵌 JS 中 posterImg / roleShareImg 的拼装位置（在拼出后再加 ?v=...）
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

/* 角色 id → 对应分享图文件名（与 quiz-h5.html 里 roleMetaImgName 保持一致） */
const ROLE_IMG = {
  d1: "picasso.png",
  d2: "hara.png",
  d3: "mondrian.png",
  d4: "kusama.png",
  d5: "gogh.png",
  d6: "monet.png",
};
const COVER_IMG = "share-cover.png";

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

const COVER_VER = imgFingerprint(`img/${COVER_IMG}`);
const ROLE_VERS = Object.fromEntries(
  Object.entries(ROLE_IMG).map(([id, name]) => [id, imgFingerprint(`img/${name}`)])
);

console.log("[sync-share-version] 当前指纹：");
console.log("  cover  =", COVER_VER);
for (const [id, ver] of Object.entries(ROLE_VERS)) {
  console.log(`  ${id} (${ROLE_IMG[id]}) =`, ver);
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

/** 替换一段 HTML 中"指向 imgName 的 URL"的版本号，覆盖各种 meta + image_src + thumbnail + 内嵌 JS 字面量 */
function bumpImgVerInHtml(html, imgName, ver) {
  if (!ver) return html;
  // 粗粒度策略：只要某行/属性值里出现 `img/<imgName>` 且后面带 ?v=xxx 或不带 ?v=，都替换
  // 1) 已经带 ?v= 的：直接替换其 v= 值
  const reHasV = new RegExp(`(img\\/${imgName.replace(/\./g, "\\.")})\\?v=[a-z0-9]+`, "g");
  html = html.replace(reHasV, `$1?v=${ver}`);
  // 2) 没带 ?v= 的：补上 —— 但必须避免误伤"刚刚替换完"的，因为我们已经先处理了 ?v= 形式
  //    所以这里的 (img/name)([)"' ]) 也只会匹配剩下没参数的
  const reNoV = new RegExp(`(img\\/${imgName.replace(/\./g, "\\.")})(?!\\?v=)`, "g");
  html = html.replace(reNoV, `$1?v=${ver}`);
  return html;
}

function processQuizH5() {
  const file = join(ROOT, "quiz-h5.html");
  let html = readFileSync(file, "utf8");
  const before = html;

  // share-cover 通用版本
  html = bumpImgVerInHtml(html, COVER_IMG, COVER_VER);
  // 6 张角色图各自版本
  for (const [id, name] of Object.entries(ROLE_IMG)) {
    html = bumpImgVerInHtml(html, name, ROLE_VERS[id]);
  }

  if (html !== before) {
    writeFileSync(file, html, "utf8");
    console.log("[sync-share-version] 已更新 quiz-h5.html");
  } else {
    console.log("[sync-share-version] quiz-h5.html 无需更新");
  }
}

function processShareDx() {
  for (const [id, name] of Object.entries(ROLE_IMG)) {
    const file = join(ROOT, `share-${id}.html`);
    if (!existsSync(file)) continue;
    let html = readFileSync(file, "utf8");
    const before = html;
    // 中转页只引一张图：自身的角色图
    html = bumpImgVerInHtml(html, name, ROLE_VERS[id]);
    if (html !== before) {
      writeFileSync(file, html, "utf8");
      console.log(`[sync-share-version] 已更新 share-${id}.html`);
    }
  }
}

processQuizH5();
processShareDx();

console.log("[sync-share-version] done");
