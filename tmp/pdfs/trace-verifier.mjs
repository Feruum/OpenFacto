const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  let body,verification=false;
  if(String(url)===process.env.AI_CHAT_ENDPOINT&&typeof options?.body==='string'){
    body=JSON.parse(options.body);
    verification=body.messages?.[0]?.content.startsWith('Act as an independent evidence checker.');
    if(verification){
      body.messages[0].content+=' For diagnostics include a short reason string explaining your verdict. Keep exactly the same evidence and safety criteria.';
      options={...options,body:JSON.stringify(body)};
    }
  }
  const response=await original(url,options);
  if(verification&&response.ok){
    const completion=await response.clone().json();
    try{console.log(JSON.stringify({diagnostic:JSON.parse(completion.choices[0].message.content),question:JSON.parse(body.messages[1].content).question}));}catch{}
  }
  return response;
};
await import('./check-noisy-questions.mjs');
