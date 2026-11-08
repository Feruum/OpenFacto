import { expect, it } from 'vitest';
import { modelOptions } from '../src/model-options.js';

it('leaves existing providers unchanged when thinking mode is unset',()=>{
  expect(modelOptions({})).toEqual({});expect(modelOptions({AI_THINKING_MODE:''})).toEqual({});
});
it('supports explicit DeepSeek thinking modes',()=>{
  expect(modelOptions({AI_THINKING_MODE:'disabled'})).toEqual({thinking:{type:'disabled'}});
  expect(modelOptions({AI_THINKING_MODE:'enabled'})).toEqual({thinking:{type:'enabled'}});
});
it('rejects an invalid thinking mode instead of silently ignoring the setting',()=>{
  expect(()=>modelOptions({AI_THINKING_MODE:'false'})).toThrow('provider_unavailable');
});
