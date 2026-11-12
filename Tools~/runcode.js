// usage: node runcode.js <file.cs>  — sends the file's text to MCP for Unity's execute_code over HTTP.
const fs = require("fs");
const U = "http://127.0.0.1:8080/mcp";
const hdr = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
async function rpc(body, sid) {
  const h = { ...hdr }; if (sid) h["mcp-session-id"] = sid;
  const r = await fetch(U, { method: "POST", headers: h, body: JSON.stringify(body) });
  const t = await r.text(); const s = r.headers.get("mcp-session-id") || sid; let j = null;
  for (const l of t.split("\n")) { const x = l.startsWith("data:") ? l.slice(5) : l; try { j = JSON.parse(x); } catch {} }
  return { j, s, t };
}
(async () => {
  const code = fs.readFileSync(process.argv[2], "utf8");
  let { s } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cli", version: "1" } } });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, s);
  const { j, t } = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "execute_code", arguments: { action: "execute", code, safety_checks: false } } }, s);
  const out = j ? (j.result || j.error) : t;
  const text = out && out.content ? out.content.map(c => c.text).join("\n") : JSON.stringify(out);
  console.log(text.slice(0, 8000));
})().catch(e => console.log("ERR", e.message));
