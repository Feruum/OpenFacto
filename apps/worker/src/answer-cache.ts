import{createHash}from'node:crypto';
import type{AnswerInput,Decision}from'@openfacto/answer-engine';

function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
export function answerCacheKey(input:Omit<AnswerInput,'sources'>,snapshot:string,policy:string):string {
 const {traceId: _trace,...request}=input;
 return createHash('sha256').update(JSON.stringify(canonical({request,snapshot,policy}))).digest('hex');
}
const cacheable=(d:Decision)=>['approved_faq','grounded_answer'].includes(d.outcome)&&Boolean(d.answer.trim())&&d.sources.length>0;
type Generate=()=>Promise<Decision>;
type Validate=(decision:Decision)=>Promise<boolean>;

/** Process-local, bounded cache. The caller must include the complete knowledge snapshot in the key. */
export class VerifiedAnswerCache {
 private readonly entries=new Map<string,{expires:number;decision:Decision}>();
 private readonly pending=new Map<string,Promise<Decision>>();
 private readonly ttlMs:number;
 private readonly maxEntries:number;
 private readonly now:()=>number;
 constructor(options:{ttlMs?:number;maxEntries?:number;now?:()=>number}={}) {
  this.ttlMs=options.ttlMs??60_000;this.maxEntries=options.maxEntries??128;this.now=options.now??Date.now;
 }
 private replay(d:Decision,traceId:string,started:number,reason:'hit'|'coalesced'):Decision {
  const result=structuredClone(d);
  return {...result,traceId,durationMs:Math.round(performance.now()-started),usage:{paidOperations:0,costMicros:0},
   steps:[{stage:'answer_cache',reason,candidates:result.sources}]};
 }
 async run(key:string,traceId:string,generate:Generate,validate:Validate):Promise<Decision> {
  const started=performance.now(),entry=this.entries.get(key);
  if(entry){
   this.entries.delete(key);
   if(entry.expires>this.now()&&await validate(entry.decision)){
    this.entries.set(key,entry);return this.replay(entry.decision,traceId,started,'hit');
   }
  }
  const pending=this.pending.get(key);
  if(pending){
   const result=await pending;
   if(cacheable(result)&&await validate(result))return this.replay(result,traceId,started,'coalesced');
   return generate();
  }
  // A deferred job makes the promise visible before another identical caller starts generation.
  const work=Promise.resolve().then(generate);
  const tracked=this.pending.size<this.maxEntries;
  if(tracked)this.pending.set(key,work);
  try{
   const result=await work;
   if(cacheable(result)&&await validate(result)){
    for(const[k,v]of this.entries)if(v.expires<=this.now())this.entries.delete(k);
    while(this.entries.size>=this.maxEntries){const oldest=this.entries.keys().next().value;if(oldest===undefined)break;this.entries.delete(oldest);}
    this.entries.set(key,{expires:this.now()+this.ttlMs,decision:structuredClone(result)});
   }
   return result;
  }finally{if(tracked)this.pending.delete(key);}
 }
}
