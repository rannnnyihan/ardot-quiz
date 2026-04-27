// EdgeOne Pages Functions - 共享工具
// 存储绑定名使用 SURVEY_KV（在 EdgeOne 控制台给项目绑定一个 KV 命名空间并命名为 SURVEY_KV）
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

export function getKV(env) {
  // 在 EdgeOne Pages 控制台绑定 KV 命名空间，绑定名为 SURVEY_KV
  const kv = env && env.SURVEY_KV;
  if (!kv) throw new Error("SURVEY_KV binding is missing");
  return kv;
}

// 生成按时间倒序可排的 key：s:<ISO 反序号>:<随机>
export function makeKey() {
  const ts = Date.now();
  const inverted = (9999999999999 - ts).toString().padStart(13, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `s:${inverted}:${rand}`;
}
