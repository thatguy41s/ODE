import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = process.env.OPENAI_API_KEY; // Secure API key via env variable

// Proxy helper to rewrite links
function rewriteHtml(html, base){
  return html.replace(/(href|src)=["'](?!https?:|data:|#)([^"']+)["']/gi,(m,attr,link)=>{
    try { return `${attr}="/proxy/${encodeURIComponent(new URL(link,base).href)}"`; } catch { return m; }
  });
}

// Proxy endpoint
app.get("/proxy/:url", async (req,res)=>{
  let target;
  try { target=decodeURIComponent(req.params.url); } catch { return res.status(400).send("Bad URL"); }
  try{
    const response = await fetch(target,{headers:{"user-agent":"Mozilla/5.0","accept":"*/*"}});
    const ct = response.headers.get("content-type")||"";
    if(!ct.includes("text/html")){ res.set("content-type",ct); response.body.pipe(res); return; }
    let html = await response.text();
    html = rewriteHtml(html,target);
    res.send(html);
  } catch(err){ res.status(500).send(`<pre>Proxy error: ${err.message}</pre>`); }
});

// AI chat endpoint
app.post("/ai", async(req,res)=>{
  const prompt=req.body.prompt;
  try{
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${API_KEY}`
      },
      body: JSON.stringify({model:"gpt-3.5-turbo", messages:[{role:"user", content:prompt}], max_tokens:200})
    });
    const data = await openaiRes.json();
    res.json({reply:data.choices[0].message.content});
  }catch(err){ res.json({reply:"AI error: "+err.message}); }
});

app.listen(3000,()=>console.log("ODE Hub 3.0 running on http://localhost:3000"));
