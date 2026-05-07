// 全局中间件：拦截 quiz-h5.html 的静态响应，把 <head> 里写死的 meta
// （标题/描述类）替换成 KV 里最新的配置。
//
// 为什么需要这个？
//   前端 JS 虽然会在运行时把 document.title / og:title / description 等改成
//   admin 配置的最新值，但**企业微信 / 钉钉 / 飞书 / Slack / QQ** 等平台抓取
//   分享卡片时 *不会执行 JS*，只看原始 HTML 里写死的 meta。所以必须在边缘端
//   把响应体里的 static meta 也一并替换掉，这些抓取器才能拿到最新文案。
//
// 微信内置浏览器本身会运行 JS，所以之前的 document.title / updateShareMeta
// 已经能让微信卡片同步；本中间件解决的是**不执行 JS 的爬虫抓取**路径。
//
// 触发范围：/  /quiz-h5  /quiz-h5.html  （其他 html 如 admin/share-dX 不动）
// 其他请求直接 context.next() 放行。

import { getKV } from "./api/_utils.js";

const CONFIG_KEY = "quiz_config_v2";
const SHARE_CARD_SUBTITLE = "测一测你是什么类型的大师";

// 需要被替换的目标路径。命中才改写，其他走原响应。
// 注意不要拦截 share-d1~d6.html（它们是角色专属跳转页，标题语义不同）。
const TARGET_PATHS = new Set(["/", "/quiz-h5", "/quiz-h5.html"]);

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // 只处理 GET/HEAD；不是目标路径直接放行
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  if (!TARGET_PATHS.has(url.pathname)) return next();

  // 先拿到原始静态响应（quiz-h5.html 的字节流）
  const resp = await next();

  // 非 200 / 非 HTML 不动（避免误改二进制/跳转响应）
  const ct = resp.headers.get("content-type") || "";
  if (!resp.ok || !ct.includes("text/html")) return resp;

  // 读 KV 里的最新配置；读不到就原样返回，别阻塞首屏
  let meta = null;
  try {
    const kv = getKV(env);
    const raw = await kv.get(CONFIG_KEY);
    if (raw) {
      const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
      meta = (cfg && cfg.meta) || null;
    }
  } catch (e) {
    // KV 不可用 → 回退到原 HTML，前端 JS 仍会做运行时同步
    return resp;
  }
  if (!meta) return resp;

  const title = plainText(meta.mainTitle || "");
  const desc = SHARE_CARD_SUBTITLE;
  // 主标题没有时也要继续固定写入分享副标题
  if (!title && !desc) return resp;

  let html = await resp.text();
  if (title) html = rewriteTitleTag(html, title);
  if (title) html = rewriteMetaByAttr(html, "property", "og:title", title);
  if (title) html = rewriteMetaByAttr(html, "name", "twitter:title", title);
  if (title) html = rewriteMetaByAttr(html, "itemprop", "name", title);
  if (desc) {
    html = rewriteMetaByAttr(html, "name", "description", desc);
    html = rewriteMetaByAttr(html, "property", "og:description", desc);
    html = rewriteMetaByAttr(html, "name", "twitter:description", desc);
    html = rewriteMetaByAttr(html, "itemprop", "description", desc);
  }
  // og:image:alt = 标题 + 固定副标题，和前端 syncDocMetaFromConfig 里的格式保持一致
  if (title) {
    const altText = title + " — " + desc;
    html = rewriteMetaByAttr(html, "property", "og:image:alt", altText);
  }

  // 复制原 response 的 headers，保留 Cache-Control 等；content-length 必须重算
  const headers = new Headers(resp.headers);
  headers.delete("content-length");
  // HTML 本身仍强制 no-cache（edgeone.json 已配），这里兜底写一次
  headers.set(
    "cache-control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  return new Response(html, {
    status: resp.status,
    statusText: resp.statusText,
    headers
  });
}

// --- 纯工具 ---

// 剥掉 <br>/<em> 等富文本标签，还原成纯文本（供爬虫卡片显示用）
function plainText(s) {
  if (!s) return "";
  return String(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// HTML 属性值转义：插进 content="..." 里必须转义 & " < >，
// 避免 admin 文案里带引号时把 meta 标签破坏掉
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 改写 <title>...</title> 的内部文本
function rewriteTitleTag(html, newTitle) {
  return html.replace(
    /<title>[\s\S]*?<\/title>/i,
    "<title>" + escHtmlText(newTitle) + "</title>"
  );
}

// <title> 里的正文只需要转义 < & 即可，不在属性里所以 " 不用转
function escHtmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// 改写 <meta {attr}="{key}" content="..."> 的 content 值。
// 支持属性顺序颠倒：content 可能在 {attr}={key} 之前或之后。
// 用一个足够宽松但边界明确的正则：匹配一个 <meta ...> 标签，且里面同时
// 包含 {attr}="{key}"（大小写不敏感），把它的 content="..." 替换成新值。
// 若标签里没有 content 属性则补一个。
function rewriteMetaByAttr(html, attr, key, value) {
  // 逐个 <meta ...> 扫描
  return html.replace(/<meta\b[^>]*>/gi, (tag) => {
    // 快速过滤：必须含有 {attr}="{key}"（允许单双引号）
    const markerRe = new RegExp(
      "\\b" + attr + "\\s*=\\s*[\"']" + escapeRe(key) + "[\"']",
      "i"
    );
    if (!markerRe.test(tag)) return tag;

    const newContentAttr = 'content="' + escAttr(value) + '"';
    // 已有 content=... → 替换
    if (/\bcontent\s*=\s*["'][^"']*["']/i.test(tag)) {
      return tag.replace(
        /\bcontent\s*=\s*["'][^"']*["']/i,
        newContentAttr
      );
    }
    // 没 content → 在 > 前插入
    return tag.replace(/\s*\/?>$/, " " + newContentAttr + ">");
  });
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
