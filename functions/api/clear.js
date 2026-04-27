// POST /api/clear  Header: X-Admin-Token
// 清空所有问卷数据（慎用，admin 里二次确认后调用）
import { json, handleOptions, getKV, needAdmin } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ ok: false, msg: "method not allowed" }, { status: 405 });

  const auth = needAdmin(request, env);
  if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

  try {
    const kv = getKV(env);
    let deleted = 0;
    let cursor;
    do {
      const listed = await kv.list({ prefix: "s:", limit: 1000, cursor });
      const keys = (listed.keys || []).map(k => (typeof k === "string" ? k : k.name));
      await Promise.all(keys.map(k => kv.delete(k)));
      deleted += keys.length;
      cursor = listed.cursor;
      if (listed.list_complete) break;
    } while (cursor);
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
