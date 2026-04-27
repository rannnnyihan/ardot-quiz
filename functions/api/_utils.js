// EdgeOne Pages Functions - 共享工具
// KV 绑定变量名：SURVEY_KV（在 EdgeOne 控制台给项目绑定 KV 命名空间，变量名填 SURVEY_KV）
// 鉴权 Token：在 EdgeOne 控制台 -> Pages -> 环境变量 里加一个 ADMIN_TOKEN

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
  "Access-Control-Max-Age": "86400"
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...(init.headers || {}) }
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function needAdmin(request, env) {
  const expected = (env && env.ADMIN_TOKEN) ? String(env.ADMIN_TOKEN) : "";
  if (!expected) return { ok: false, status: 500, msg: "ADMIN_TOKEN not configured" };
  const got = request.headers.get("X-Admin-Token") || new URL(request.url).searchParams.get("token") || "";
  if (got !== expected) return { ok: false, status: 401, msg: "unauthorized" };
  return { ok: true };
}

// 获取 KV 实例。EdgeOne Pages 绑定后既是全局变量也在 env 上，这里两种都兼容。
export function getKV(env) {
  let kv = null;
  try { if (typeof SURVEY_KV !== "undefined") kv = SURVEY_KV; } catch (e) {}
  if (!kv && env && env.SURVEY_KV) kv = env.SURVEY_KV;
  if (!kv) throw new Error("SURVEY_KV binding is missing (请在 EdgeOne 控制台给项目绑定 KV 命名空间，变量名填 SURVEY_KV，然后重新部署)");
  return kv;
}

// EdgeOne KV key 仅支持数字、字母、下划线，长度 <= 512B。
// 生成按时间倒序可排的 key：s_<反序时间>_<随机>
export function makeKey() {
  const ts = Date.now();
  const inverted = (9999999999999 - ts).toString().padStart(13, "0");
  const rand = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 6) || "aaaaaa";
  return `s_${inverted}_${rand}`;
}

export const KEY_PREFIX = "s_";
