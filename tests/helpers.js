/* Aides communes aux tests : serveur statique, tuiles de relief synthétiques, navigateur. */
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const ROOT = path.resolve(__dirname, "..");
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript", ".json":"application/json", ".png":"image/png", ".webmanifest":"application/manifest+json", ".md":"text/plain"};

function serveur(){
 return new Promise(res => { const s = http.createServer((req, rep) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0])); if (f.endsWith(path.sep)) f += "index.html";
  fs.readFile(f, (e, d) => { if (e) { rep.writeHead(404); rep.end("introuvable"); } else { rep.writeHead(200, {"Content-Type":MIME[path.extname(f)] || "application/octet-stream"}); rep.end(d); } }); });
  s.listen(0, "127.0.0.1", () => res({server:s, base:"http://127.0.0.1:" + s.address().port + "/"})); });
}

/* PNG minimal (RGBA 256×256) */
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data){ const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(rgba){ const raw = Buffer.alloc(256*(1 + 1024)); for (let y = 0; y < 256; y++) { raw[y*1025] = 0; rgba.copy(raw, y*1025 + 1, y*1024, (y + 1)*1024); }
 const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 6;
 return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/* Relief synthétique : plaine à 100 m et une grosse colline gaussienne (sommet à `pic` m) centrée en (lon0, lat0) */
function reliefSynthetique(opts){
 const o = Object.assign({lon0:0.35, lat0:47.26, pic:900, sigmaKm:14}, opts || {});
 const elev = (lon, lat) => { const dx = (lon - o.lon0)*111.32*Math.cos(lat*Math.PI/180), dy = (lat - o.lat0)*110.57; return 100 + o.pic*Math.exp(-(dx*dx + dy*dy)/(2*o.sigmaKm*o.sigmaKm)); };
 const tile = (z, x, y) => { const n = 2**z, buf = Buffer.alloc(256*256*4);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) { const lon = (x + (px + 0.5)/256)/n*360 - 180, lat = Math.atan(Math.sinh(Math.PI*(1 - 2*(y + (py + 0.5)/256)/n)))*180/Math.PI;
   const v = elev(lon, lat) + 32768, k = (py*256 + px)*4; buf[k] = Math.floor(v/256); buf[k+1] = Math.floor(v) & 255; buf[k+2] = Math.floor((v - Math.floor(v))*256); buf[k+3] = 255; }
  return png(buf); };
 return {elev, tile, opts:o};
}
async function brancherRelief(ctx, relief){ const cache = new Map();
 await ctx.route(/elevation-tiles-prod/, route => { const m = route.request().url().match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/); if (!m) return route.abort(); const key = m[0];
  if (!cache.has(key)) cache.set(key, relief.tile(+m[1], +m[2], +m[3])); route.fulfill({status:200, contentType:"image/png", body:cache.get(key)}); }); }

async function navigateur(){
 const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
 return chromium.launch({ executablePath:process.env.CHROMIUM || "/opt/pw-browsers/chromium", args:["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
}
module.exports = {serveur, reliefSynthetique, brancherRelief, navigateur, ROOT};
