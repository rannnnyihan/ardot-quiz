// GET /api/list?token=xxx&limit=1000
// admin.html 拉取所有问卷数据
import { json, handleOptions, getKV, needAdmin } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "GET") return json({ ok: false, msg: "method not allowed" }, { status: 405 });

  const auth = needAdmin(request, env);
  if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "1000", 10) || 1000, 1), 5000);

  try {
    const kv = getKV(env);
    const listed = await kv.list({ prefix: "s:", limit });
    const keys = (listed.keys || []).map(k => (typeof k === "string" ? k : k.name));
    // 并行读取
    const values = await Promise.all(keys.map(k => kv.get(k).then(v => {
      if (!v) return null;
      try { return JSON.parse(v); } catch { return null; }
    })));
    const data = values.filter(Boolean);
    return json({ ok: true, total: data.length, data });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
