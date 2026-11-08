import{randomBytes,createHash}from'node:crypto';
import{resolve}from'node:path';import{pathToFileURL}from'node:url';

/** Advance only past updates durably accepted by the existing authenticated ingress. */
export async function forwardUpdates(updates,offset,forward){
 let accepted=0;
 for(const update of [...updates].sort((a,b)=>a.update_id-b.update_id)){
  if(!Number.isSafeInteger(update.update_id)||update.update_id<0)throw Error('Invalid update ID');
  if(offset!==undefined&&update.update_id<offset)continue;
  try{await forward(update);}catch{return{offset,accepted,retry:true};}
  offset=update.update_id+1;accepted++;
 }
 return{offset,accepted,retry:false};
}

async function main(){
 const botId=process.argv[2];if(!/^[a-f0-9-]{36}$/i.test(botId??''))throw Error('Pass the existing local bot UUID');
 const [{default:postgres},{decryptBotToken}]=await Promise.all([import('../apps/worker/node_modules/postgres/src/index.js'),import('../packages/database/dist/index.js')]);
 const dbUrl=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname))throw Error('Local polling requires a loopback database');
 const sql=postgres(dbUrl.href,{max:1,onnotice(){}}),secret=randomBytes(32).toString('base64url');
 let stopped=false,offset;let token;
 const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 async function telegram(method,data,timeout=30000){
  const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeout),headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const body=await r.json();if(!r.ok||!body.ok){const e=Error('Telegram API request failed');e.code=body.error_code??r.status;throw e;}return body.result;
 }
 try{
  const [bot]=await sql`SELECT b.token_ciphertext,b.active,e.status FROM telegram_bots b JOIN events e ON (e.organization_id,e.id)=(b.organization_id,b.event_id) WHERE b.id=${botId}`;
  if(!bot?.active||bot.status!=='active')throw Error('Local test bot is inactive');
  token=decryptBotToken(bot.token_ciphertext,process.env.BOT_ENCRYPTION_KEY,botId);
  let configured=false;
  for(let i=0;i<5&&!configured;i++){try{await telegram('deleteWebhook',{drop_pending_updates:false},12000);configured=true;}catch{if(i===4)throw Error('Unable to enable local Telegram polling');await new Promise(r=>setTimeout(r,1000));}}
  await sql`UPDATE telegram_bots SET webhook_secret_hash=${createHash('sha256').update(secret).digest('hex')} WHERE id=${botId}`;
  console.log(JSON.stringify({event:'telegram.polling.ready',botId,pid:process.pid}));
  while(!stopped){
   try{
    const updates=await telegram('getUpdates',{...(offset===undefined?{}:{offset}),timeout:20,limit:50,allowed_updates:['message']});
    const result=await forwardUpdates(updates,offset,async update=>{
     const r=await fetch('http://127.0.0.1:53000/webhooks/telegram/'+botId,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update)});
     if(!r.ok)throw Error('Local ingress did not accept the update');
    });
    offset=result.offset;
    if(result.accepted)console.log(JSON.stringify({event:'telegram.polling.forwarded',count:result.accepted,offset}));
    if(result.retry)await new Promise(r=>setTimeout(r,1000));
   }catch(e){
    if(e.code===409)throw Error('Another receiver or webhook is active; stopping this polling receiver');
    console.log(JSON.stringify({event:'telegram.polling.retry',code:e.code??'network'}));
    await new Promise(r=>setTimeout(r,1500));
   }
  }
 }finally{await sql.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(e=>{console.error(e.message);process.exitCode=1;});}
