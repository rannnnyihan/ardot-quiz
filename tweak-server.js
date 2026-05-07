#!/usr/bin/env node
/**
 * 元素微调工具的本地保存服务
 *   功能 1：托管当前目录的静态文件（替代 python -m http.server）
 *   功能 2：接收 POST /__tweak_save__ 把 CSS 写回 quiz-h5.html
 *
 * 启动：node tweak-server.js
 * 然后访问：http://localhost:5174/quiz-h5.html?tweak=1
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = 5174;
const ROOT = __dirname;
const TARGET = path.join(ROOT, "quiz-h5.html");
const START = "/* === TWEAK_SAVED_START === 由元素微调工具写入，手动编辑这一段也可以 === */";
const END = "/* === TWEAK_SAVED_END === */";

const MIME = {
  ".html":"text/html; charset=utf-8",
  ".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".gif":"image/gif",".svg":"image/svg+xml",".webp":"image/webp",
  ".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2"
};

/** 解析现有保存块为 selector -> {prop: value} */
function parseSavedBlock(block){
  const map = {};
  // 匹配 selector { ... }
  const re = /([^{}\n][^{}]*?)\{([^{}]*)\}/g;
  let m;
  while((m = re.exec(block)) !== null){
    const sel = m[1].trim();
    if(!sel || sel.startsWith("/*")) continue;
    const body = m[2];
    const props = {};
    body.split(";").forEach(line=>{
      const idx = line.indexOf(":");
      if(idx<0) return;
      const k = line.slice(0,idx).trim();
      const v = line.slice(idx+1).trim();
      if(k && v) props[k] = v;
    });
    map[sel] = Object.assign(map[sel]||{}, props);
  }
  return map;
}

function serializeMap(map){
  const lines = [];
  Object.keys(map).forEach(sel=>{
    const props = map[sel];
    if(!props || !Object.keys(props).length) return;
    lines.push("    "+sel+"{");
    Object.keys(props).forEach(k=>{
      lines.push("      "+k+": "+props[k]+" !important;");
    });
    lines.push("    }");
  });
  return lines.join("\n");
}

function saveCss(selector, props){
  let html = fs.readFileSync(TARGET, "utf8");
  const i1 = html.indexOf(START);
  const i2 = html.indexOf(END);
  if(i1<0 || i2<0 || i2<i1) throw new Error("找不到保存标记块，请检查 quiz-h5.html 是否有 TWEAK_SAVED_START/END 注释");
  const before = html.slice(0, i1 + START.length);
  const after = html.slice(i2);
  const middle = html.slice(i1 + START.length, i2);

  const map = parseSavedBlock(middle);
  // 合并：传入空字符串视为删除该属性；空对象视为删除该 selector
  if(!props || !Object.keys(props).length){
    delete map[selector];
  }else{
    map[selector] = Object.assign(map[selector]||{}, props);
    // 清理空值
    Object.keys(map[selector]).forEach(k=>{
      const v = map[selector][k];
      if(v===""||v==null) delete map[selector][k];
    });
    if(!Object.keys(map[selector]).length) delete map[selector];
  }
  const newMiddle = "\n"+serializeMap(map)+"\n    ";
  const out = before + newMiddle + after;
  fs.writeFileSync(TARGET, out, "utf8");
  return map;
}

function send(res, code, body, headers){
  res.writeHead(code, Object.assign({
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Cache-Control":"no-store"
  }, headers||{}));
  res.end(body);
}

const server = http.createServer((req, res)=>{
  if(req.method === "OPTIONS"){ return send(res, 204, ""); }

  const u = url.parse(req.url, true);

  // 保存接口
  if(req.method === "POST" && u.pathname === "/__tweak_save__"){
    let body = "";
    req.on("data", c=> body += c);
    req.on("end", ()=>{
      try{
        const data = JSON.parse(body || "{}");
        if(!data.selector) throw new Error("缺少 selector");
        const map = saveCss(data.selector, data.props || {});
        console.log("[saved]", data.selector, data.props);
        send(res, 200, JSON.stringify({ok:true, selector:data.selector, total:Object.keys(map).length}),
          {"Content-Type":"application/json; charset=utf-8"});
      }catch(err){
        console.error("[save error]", err.message);
        send(res, 500, JSON.stringify({ok:false, error:err.message}),
          {"Content-Type":"application/json; charset=utf-8"});
      }
    });
    return;
  }

  // 静态文件
  let p = decodeURIComponent(u.pathname);
  if(p === "/") p = "/quiz-h5.html";
  const filePath = path.join(ROOT, p);
  // 安全检查
  if(!filePath.startsWith(ROOT)){ return send(res, 403, "Forbidden"); }
  fs.stat(filePath, (err, st)=>{
    if(err || !st.isFile()) return send(res, 404, "Not Found");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, ()=>{
  console.log("\n  🛠  Tweak server running");
  console.log("  → http://localhost:"+PORT+"/quiz-h5.html?tweak=1");
  console.log("  保存接口：POST /__tweak_save__");
  console.log("  目标文件：" + TARGET + "\n");
});
