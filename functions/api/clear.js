// POST /api/clear  Header: X-Admin-Token
// 清空所有问卷数据
import { json, handleOptions, getKV, needAdmin, KEY_PREFIX } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ ok: false, msg: "method not allowed" }, { status: 405 });

  const auth = needAdmin(request, env);
  if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

  try {
    const kv = getKV(env);
    let deleted = 0;
    let cursor = null;
    let safety = 0;
    while (safety++ < 50) {
      const opts = { prefix: KEY_PREFIX, limit: 256 };
      if (cursor) opts.cursor = cursor;
      const r = await kv.list(opts);
      if (!r || !Array.isArray(r.keys) || r.keys.length === 0) break;
      const names = r.keys.map(k => (typeof k === "string" ? k : (k && (k.key || k.name)))).filter(Boolean);
      // 串行删除更稳（部分实现并发 delete 会踩限流）
      for (const n of names) {
        try { await kv.delete(n); deleted++; } catch (e) {}
      }
      if (r.complete || !r.cursor) break;
      cursor = r.cursor;
    }
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
