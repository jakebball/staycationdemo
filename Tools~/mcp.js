// usage: node mcp.js <tool|--list> [jsonArgs]
const U="http://127.0.0.1:8080/mcp";
const hdr={"Content-Type":"application/json","Accept":"application/json, text/event-stream"};
async function rpc(body,sid){const h={...hdr};if(sid)h["mcp-session-id"]=sid;const r=await fetch(U,{method:"POST",headers:h,body:JSON.stringify(body)});const t=await r.text();const s=r.headers.get("mcp-session-id")||sid;let j=null;for(const l of t.split("\n")){const x=l.startsWith("data:")?l.slice(5):l;try{j=JSON.parse(x)}catch{}}return{j,s,t};}
(async()=>{let {s}=await rpc({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"cli",version:"1"}}});
await rpc({jsonrpc:"2.0",method:"notifications/initialized"},s);
const [tool,args]=process.argv.slice(2);
if(tool==="--list"){const {j}=await rpc({jsonrpc:"2.0",id:2,method:"tools/list"},s);console.log(j.result.tools.map(t=>t.name).join(" "));return;}
const {j,t}=await rpc({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:tool,arguments:JSON.parse(args||"{}")}},s);
console.log(j?JSON.stringify(j.result||j.error,null,1).slice(0,6000):t.slice(0,2000));})().catch(e=>console.log("ERR",e.message));
