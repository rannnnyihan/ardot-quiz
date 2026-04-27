// /api/config
//   GET  -> 公开读取当前问卷配置（所有设备共享）
//   POST -> 需要 X-Admin-Token，覆盖写入问卷配置
// KV 里只存一份，key 固定为 "quiz_config_v2"
import { json, handleOptions, getKV, needAdmin, CORS_HEADERS } from "./_utils.js";

const CONFIG_KEY = "quiz_config_v2";
// body 大小保护，防止误传超大 payload 撑爆 KV
const MAX_BYTES = 512 * 1024; // 512KB

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();

  try {
    const kv = getKV(env);

    if (request.method === "GET") {
      // 读不到就返回 null，让前端走内置默认，不要 500
      let raw = null;
      try { raw = await kv.get(CONFIG_KEY); } catch (e) { raw = null; }
      let data = null;
      if (raw) {
        try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { data = null; }
      }
      return new Response(JSON.stringify({ ok: true, data }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          // 允许短时间缓存，减少 KV 读压力；admin 保存后会带 ?t= 打破缓存
          "Cache-Control": "public, max-age=30",
          ...CORS_HEADERS
        }
      });
    }

    if (request.method === "POST") {
      const auth = needAdmin(request, env);
      if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

      const text = await request.text();
      if (!text || text.length > MAX_BYTES) {
        return json({ ok: false, msg: "payload empty or too large" }, { status: 413 });
      }
      let cfg;
      try { cfg = JSON.parse(text); } catch (e) {
        return json({ ok: false, msg: "invalid json" }, { status: 400 });
      }
      // 基本结构校验，避免把空对象写上去
      // 注意：admin 里 questions 是对象映射 {q1:{...}, q2:{...}}，不是数组；roles 才是数组
      const questionsOk = cfg && typeof cfg === "object"
        && cfg.questions && typeof cfg.questions === "object" && !Array.isArray(cfg.questions)
        && Object.keys(cfg.questions).length > 0;
      const rolesOk = cfg && Array.isArray(cfg.roles) && cfg.roles.length > 0;
      if (!questionsOk || !rolesOk) {
        return json({ ok: false, msg: "config must contain non-empty questions{} and roles[]" }, { status: 400 });
      }
      // 附加一个服务端时间戳，方便前端判断新鲜度
      cfg.meta = cfg.meta && typeof cfg.meta === "object" ? cfg.meta : {};
      cfg.meta.serverUpdatedAt = new Date().toISOString();

      await kv.put(CONFIG_KEY, JSON.stringify(cfg));
      return json({ ok: true, updatedAt: cfg.meta.serverUpdatedAt });
    }

    return json({ ok: false, msg: "method not allowed" }, { status: 405 });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
