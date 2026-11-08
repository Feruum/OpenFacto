import http from'node:http';
let active=0;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');const secret=req.headers['x-telegram-bot-api-secret-token'];
 if(req.method!=='POST'||!/^\/webhooks\/telegram\/[a-f0-9-]{36}$/i.test(req.url??'')||typeof secret!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(secret)){res.writeHead(404).end();req.resume();return;}
 if(active>=20){res.writeHead(503).end();req.resume();return;}active++;
 try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>102400){res.writeHead(413).end();return;}chunks.push(chunk);}
  const result=await fetch('http://127.0.0.1:53000'+req.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:Buffer.concat(chunks)});
  res.writeHead(result.status,{'content-type':'application/json'});res.end(await result.text());
 }catch{if(!res.headersSent)res.writeHead(502);res.end();}finally{active--;}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.on('clientError',(_e,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(53001,'127.0.0.1',()=>console.log('Telegram-only relay ready'));
