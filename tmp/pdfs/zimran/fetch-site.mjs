import {readFile,writeFile} from 'node:fs/promises';
const html=await readFile(new URL('./site.html',import.meta.url),'utf8');
const paths=[...html.matchAll(/<script[^>]+src="([^"]+)/g)].map(m=>m[1]);
await Promise.all(paths.map(async(p,i)=>{
 const r=await fetch(new URL(p,'https://businesscup.zimran.io'));
 if(!r.ok)throw Error('Official resource HTTP '+r.status);
 const text=await r.text();
 if(/SUBMISSION|coffee|Application & Selection|applicationStatus|prize pool/i.test(text)){
  await writeFile(new URL('./chunk-'+i+'.js',import.meta.url),text);console.log(i,text.length);
 }
}));
