// /api/snapshot
//   GET  ?token=... &list=1           -> 列出所有历史快照（仅 meta，不含 answers/cfg）
//   GET  ?token=... &id=snap_xxx      -> 读取单个快照完整内容（cfg + answers）
//   POST ?token=...                   -> 创建一个新快照：把当前 KV 里所有 s_* 作答打包 + 附带前端传来的 cfg 存成 snap_<ts>_<rand>
//        body = { label?: string, cfg: {...}, clearAfter?: boolean }
//          label: 管理员手动备注
//          cfg: 归档时刻的问卷配置（由前端把当时的 cfg 提交上来，避免服务端 cfg 已被覆盖）
//          clearAfter: true 时归档完顺手清空 s_* 当前收集（和 /api/clear 等价）
//   DELETE ?token=... &id=snap_xxx    -> 删除某个快照
//
// 快照 key 前缀：snap_
// 快照 value 结构：
//   {
//     id,                   // 同 key
//     createdAt,            // ISO
//     label,                // 用户备注
//     count,                // answers 数量
//     meta: { questionSchema, roleSetVersion, ... },  // 便于列表展示
//     cfg,                  // 冻结的问卷配置
//     answers: [ ... ]      // 原始作答列表
//   }
import { json, handleOptions, getKV, needAdmin, KEY_PREFIX } from "./_utils.js";

const SNAP_PREFIX = "snap_";
// 单条 KV value 上限 25MB；超大时前端会收到 413，让管理员先导出 CSV 再清
const MAX_BYTES = 20 * 1024 * 1024;

function genSnapId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 6) || "aaaaaa";
  // 前缀 snap_，后接倒序时间戳，方便 list 时天然新→旧；再加随机抗碰撞
  const inverted = (9999999999999 - ts).toString().padStart(13, "0");
  return `${SNAP_PREFIX}${inverted}_${rand}`;
}

// 遍历某前缀下所有 key（EdgeOne KV list 单次 limit 上限 256，用 cursor 翻页）
async function listKeys(kv, prefix) {
  const all = [];
  let cursor = null;
  let safety = 0;
  while (safety++ < 50) {
    const opts = { prefix, limit: 256 };
    if (cursor) opts.cursor = cursor;
    const r = await kv.list(opts);
    if (r && Array.isArray(r.keys)) {
      for (const k of r.keys) {
        const name = typeof k === "string" ? k : (k && (k.key || k.name));
        if (name) all.push(name);
      }
    }
    if (!r || r.complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return all;
}

async function readAnswers(kv) {
  const keys = await listKeys(kv, KEY_PREFIX);
  const out = [];
  const CHUNK = 50;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const values = await Promise.all(slice.map(k => kv.get(k).then(v => {
      if (!v) return null;
      try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
    }).catch(() => null)));
    for (const v of values) if (v) out.push(v);
  }
  return { keys, answers: out };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return handleOptions();

  const auth = needAdmin(request, env);
  if (!auth.ok) return json({ ok: false, msg: auth.msg }, { status: auth.status });

  const url = new URL(request.url);

  try {
    const kv = getKV(env);

    // ---------- GET ----------
    if (request.method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        if (!id.startsWith(SNAP_PREFIX)) return json({ ok: false, msg: "invalid snapshot id" }, { status: 400 });
        const raw = await kv.get(id);
        if (!raw) return json({ ok: false, msg: "snapshot not found" }, { status: 404 });
        let data = null;
        try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { data = null; }
        if (!data) return json({ ok: false, msg: "snapshot parse failed" }, { status: 500 });
        return json({ ok: true, data });
      }
      // list 模式：只拿 meta 段，answers 不回传（避免一次把几十 MB 吐出来）
      const keys = await listKeys(kv, SNAP_PREFIX);
      const items = [];
      const CHUNK = 20;
      for (let i = 0; i < keys.length; i += CHUNK) {
        const slice = keys.slice(i, i + CHUNK);
        const values = await Promise.all(slice.map(k => kv.get(k).then(v => {
          if (!v) return null;
          try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
        }).catch(() => null)));
        values.forEach((v, idx) => {
          if (!v) return;
          items.push({
            id: v.id || slice[idx],
            createdAt: v.createdAt || "",
            label: v.label || "",
            count: Number(v.count || (Array.isArray(v.answers) ? v.answers.length : 0)),
            meta: v.meta || {}
          });
        });
      }
      // 按 createdAt 倒序
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ ok: true, total: items.length, data: items });
    }

    // ---------- POST ----------
    if (request.method === "POST") {
      const text = await request.text();
      let body = null;
      try { body = JSON.parse(text || "{}"); } catch { return json({ ok: false, msg: "invalid json" }, { status: 400 }); }
      const label = String(body && body.label || "").slice(0, 120);
      const clearAfter = !!(body && body.clearAfter);
      const frozenCfg = body && body.cfg;
      if (!frozenCfg || typeof frozenCfg !== "object" || !frozenCfg.questions || typeof frozenCfg.questions !== "object") {
        return json({ ok: false, msg: "body.cfg (frozen questions snapshot) is required" }, { status: 400 });
      }

      const { keys: answerKeys, answers } = await readAnswers(kv);

      const id = genSnapId();
      const record = {
        id,
        createdAt: new Date().toISOString(),
        label,
        count: answers.length,
        meta: {
          questionSchema: (frozenCfg.meta && frozenCfg.meta.questionSchema) || "",
          roleSetVersion: (frozenCfg.meta && frozenCfg.meta.roleSetVersion) || 0,
          mainTitle: (frozenCfg.meta && frozenCfg.meta.mainTitle) || "",
          questionCount: Object.keys(frozenCfg.questions || {}).length
        },
        cfg: frozenCfg,
        answers
      };
      const payload = JSON.stringify(record);
      if (payload.length > MAX_BYTES) {
        return json({
          ok: false,
          msg: `snapshot too large: ${payload.length} bytes (limit ${MAX_BYTES}). 请先在 admin 导出 CSV，再选「直接清除」。`
        }, { status: 413 });
      }
      await kv.put(id, payload);

      let deleted = 0;
      if (clearAfter && answerKeys.length) {
        for (const k of answerKeys) {
          try { await kv.delete(k); deleted++; } catch (e) {}
        }
      }

      return json({ ok: true, id, count: answers.length, deleted });
    }

    // ---------- DELETE ----------
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id || !id.startsWith(SNAP_PREFIX)) return json({ ok: false, msg: "invalid snapshot id" }, { status: 400 });
      await kv.delete(id);
      return json({ ok: true });
    }

    return json({ ok: false, msg: "method not allowed" }, { status: 405 });
  } catch (e) {
    return json({ ok: false, msg: String(e && e.message || e) }, { status: 500 });
  }
}
