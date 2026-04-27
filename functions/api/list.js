// GET /api/list?token=xxx&limit=5000
// admin.html 拉取所有问卷数据
import { json, handleOptions, getKV, needAdmin, KEY_PREFIX } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "GET") return json({ ok: false, msg: "method not allowed" }, { status: 405 });

  const auth = needAdmin(request, env);
  if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

  const url = new URL(request.url);
  const softCap = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "5000", 10) || 5000, 1), 10000);

  try {
    const kv = getKV(env);
    // EdgeOne KV list 单次 limit 上限 256，需要用 cursor 分页遍历。
    // 注意：EdgeOne 要求 cursor 必须是 string，不能是 undefined，第一次调用不传该字段。
    const allKeys = [];
    let cursor = null;
    let safety = 0;
    while (safety++ < 50) {
      const opts = { prefix: KEY_PREFIX, limit: 256 };
      if (cursor) opts.cursor = cursor;
      const r = await kv.list(opts);
      if (r && Array.isArray(r.keys)) {
        for (const k of r.keys) {
          const name = typeof k === "string" ? k : (k && (k.key || k.name));
          if (name) allKeys.push(name);
          if (allKeys.length >= softCap) break;
        }
      }
      if (!r || r.complete || !r.cursor || allKeys.length >= softCap) break;
      cursor = r.cursor;
    }

    // 并行读取（注意并发不要太大，分批）
    const data = [];
    const CHUNK = 50;
    for (let i = 0; i < allKeys.length; i += CHUNK) {
      const slice = allKeys.slice(i, i + CHUNK);
      const values = await Promise.all(slice.map(k => kv.get(k).then(v => {
        if (!v) return null;
        try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
      }).catch(() => null)));
      for (const v of values) if (v) data.push(v);
    }

    return json({ ok: true, total: data.length, data });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
