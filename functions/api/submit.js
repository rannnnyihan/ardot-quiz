// POST /api/submit
// 接收 quiz-h5.html 提交的问卷数据，写入 KV
import { json, handleOptions, getKV, makeKey } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method !== "POST") return json({ ok: false, msg: "method not allowed" }, { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, msg: "invalid json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return json({ ok: false, msg: "empty body" }, { status: 400 });
  }

  // 简单限制 payload 尺寸（防刷）
  const raw = JSON.stringify(body);
  if (raw.length > 64 * 1024) {
    return json({ ok: false, msg: "payload too large" }, { status: 413 });
  }

  // 补充服务端元数据
  const record = {
    ...body,
    _server_ts: new Date().toISOString(),
    _ip: request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "",
    _ua: request.headers.get("user-agent") || ""
  };

  try {
    const kv = getKV(env);
    const key = makeKey();
    await kv.put(key, JSON.stringify(record));
    return json({ ok: true, key });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
