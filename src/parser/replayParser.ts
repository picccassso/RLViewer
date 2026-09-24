import { ParsedReplayData } from '../types/replay';

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('./replay.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return workerInstance;
}

/**
 * Turns the parser's raw error into something a person can act on. The raw error is
 * already logged by the worker.
 */
export function describeParseError(message: string): string {
  // Each Rocket League update can add replicated attributes, and the parser cannot skip
  // one it doesn't know: the network stream doesn't record attribute sizes.
  if (/attribute unknown or not implemented/i.test(message)) {
    return 'This replay was recorded on a newer version of Rocket League than the replay parser supports yet. It will open once the parser is updated.';
  }
  return message;
}

/**
 * Parses a Rocket League .replay file client-side inside a Web Worker.
 * Returns the typed memory streaming payload.
 */
export async function parseReplayBuffer(buffer: ArrayBuffer): Promise<ParsedReplayData> {
  const worker = getWorker();

  return new Promise((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const { type, payload, error } = e.data;
      if (type === 'PARSE_SUCCESS') {
        worker.removeEventListener('message', handleMessage);
        resolve(payload as ParsedReplayData);
      } else if (type === 'PARSE_ERROR') {
        worker.removeEventListener('message', handleMessage);
        reject(new Error(describeParseError(error || 'Replay parsing failed')));
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage({ type: 'PARSE_REPLAY', replayBuffer: buffer }, [buffer]);
  });
}

/**
 * Loads and parses the preloaded sample replay (`/sample.replay`).
 */
export async function loadSampleReplay(): Promise<ParsedReplayData> {
  const response = await fetch('/sample.replay');
  if (!response.ok) {
    throw new Error(`Failed to load sample replay: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return parseReplayBuffer(buffer);
}
