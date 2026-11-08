import { ServiceFailure } from '@openfacto/answer-engine';

/** Provider-specific options are opt-in; existing compatible APIs keep their defaults. */
export function modelOptions(env: Record<string, string | undefined>): { thinking?: { type: 'enabled' | 'disabled' } } {
  const thinking = env.AI_THINKING_MODE;
  if (!thinking) return {};
  if (thinking !== 'enabled' && thinking !== 'disabled') throw new ServiceFailure('provider_unavailable');
  return { thinking: { type: thinking } };
}
