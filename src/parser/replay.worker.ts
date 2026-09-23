import initSubtr, { get_replay_frames_data } from '@rlrml/subtr-actor';
import { buildReplayData } from './buildReplayData';

import wasmUrl from '@rlrml/subtr-actor/rl_replay_subtr_actor_bg.wasm?url';

let wasmInitialized = false;

async function ensureWasmReady() {
  if (wasmInitialized) return;
  try {
    if (wasmUrl) {
      await initSubtr(wasmUrl);
      wasmInitialized = true;
      return;
    }
  } catch (e1) {
    console.warn('WASM init via wasmUrl failed, trying /wasm/ fallback:', e1);
  }

  try {
    await initSubtr('/wasm/rl_replay_subtr_actor_bg.wasm');
    wasmInitialized = true;
    return;
  } catch (e2) {
    console.warn('WASM init via /wasm/ failed, trying default import.meta.url:', e2);
  }

  await initSubtr();
  wasmInitialized = true;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, replayBuffer } = e.data;
  if (type !== 'PARSE_REPLAY') return;

  try {
    await ensureWasmReady();

    const bytes = new Uint8Array(replayBuffer);
    const startTime = performance.now();
    const rawData = get_replay_frames_data(bytes);
    const parseElapsed = performance.now() - startTime;
    console.log(`[ReplayWorker] Subtr-actor parsed replay in ${parseElapsed.toFixed(1)}ms`);

    const payload = buildReplayData(rawData);

    // Post message with transferable ArrayBuffer for zero-copy transfer!
    self.postMessage(
      { type: 'PARSE_SUCCESS', payload },
      [payload.framesBuffer.buffer]
    );
  } catch (error: any) {
    console.error('[ReplayWorker] Parse failed:', error);
    self.postMessage({
      type: 'PARSE_ERROR',
      error: error?.message || 'Failed to parse Rocket League replay file'
    });
  }
};
