import{test}from'node:test';import assert from'node:assert/strict';import{forwardUpdates}from'../telegram-polling.mjs';
test('only acknowledges updates already durably forwarded',async()=>{
 const seen=[];const r=await forwardUpdates([{update_id:10},{update_id:11},{update_id:12}],undefined,async u=>{if(u.update_id===11)throw Error('unavailable');seen.push(u.update_id);});
 assert.deepEqual(r,{offset:11,accepted:1,retry:true});assert.deepEqual(seen,[10]);
 const retry=[];const next=await forwardUpdates([{update_id:10},{update_id:11},{update_id:12}],r.offset,async u=>retry.push(u.update_id));assert.deepEqual(retry,[11,12]);assert.equal(next.offset,13);
});
test('keeps pending updates on first forwarding failure',async()=>{
 const r=await forwardUpdates([{update_id:25}],undefined,async()=>{throw Error('offline');});assert.equal(r.offset,undefined);assert.equal(r.accepted,0);assert.equal(r.retry,true);
});
test('sorts valid batches and advances correctly without an update body assumption',async()=>{
 const seen=[];const r=await forwardUpdates([{update_id:4},{update_id:3}],3,async u=>seen.push(u.update_id));assert.deepEqual(seen,[3,4]);assert.equal(r.offset,5);
});
