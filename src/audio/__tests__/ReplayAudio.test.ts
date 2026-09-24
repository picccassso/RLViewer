import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { ReplayAudio } from '../ReplayAudio';
import { replay } from './fixtures';

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
class MockContext {
  state = 'suspended';
  sampleRate = 8000;
  currentTime = 5;
  destination = node();
  sources: any[] = [];
  createGain = () => ({ ...node(), gain: param() });
  createDynamicsCompressor = () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  createStereoPanner = () => ({ ...node(), pan: param() });
  createBuffer = (_channels: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) });
  createBufferSource = () => {
    const source = { ...node(), buffer: null, playbackRate: param(), start: vi.fn(), stop: vi.fn(), onended: null };
    this.sources.push(source);
    return source;
  };
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}
let audio: ReplayAudio | null = null;
afterEach(() => { audio?.dispose(); audio = null; vi.unstubAllGlobals(); });
function setup() {
  const context = new MockContext();
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  const factory = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', factory);
  const status = vi.fn();
  audio = new ReplayAudio(status);
  const data = replay();
  data.ballTouches = [0.1, 0.2, 0.3, 0.4].map((time) => ({ time, team: 0 }));
  audio.setReplay(data);
  const camera = new PerspectiveCamera();
  return { context, factory, status, windowTarget, documentTarget, camera, data, sound: audio };
}

describe('Audio playback lifecycle', () => {
  it('unlocks on a gesture, with no catch-up of previously silent events', async () => {
    const { sound, context, factory, windowTarget, camera, status } = setup();
    expect(factory).not.toHaveBeenCalled();
    sound.update(0.11, true, 1, camera);
    expect(context.sources).toHaveLength(0);
    windowTarget.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith('ready');
    sound.update(0.12, true, 1, camera);
    expect(context.sources).toHaveLength(0);
    sound.update(0.21, true, 1, camera);
    expect(context.sources).toHaveLength(1);
    sound.update(0.21, true, 1, camera);
    expect(context.sources).toHaveLength(1);
  });

  it('stops voices on pause, seek, mute and replay replacement; cleans up on dispose', async () => {
    const { sound, context, windowTarget, camera, data } = setup();
    windowTarget.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    sound.update(0.11, true, 1, camera);
    sound.update(0.11, false, 1, camera);
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    sound.update(0.21, true, 1, camera);
    sound.seek(0.25);
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    sound.update(0.31, true, 2, camera);
    expect(context.sources[2].playbackRate.value).toBe(2);
    sound.setMix(0.5, true);
    expect(context.sources[2].stop).toHaveBeenCalledOnce();
    sound.update(0.41, true, 1, camera);
    expect(context.sources).toHaveLength(3);
    sound.setMix(0.5, false);
    sound.seek(0);
    sound.update(0.11, true, 1, camera);
    sound.setReplay(data);
    expect(context.sources[3].stop).toHaveBeenCalledOnce();
    sound.update(0.11, true, 1, camera);
    sound.dispose();
    audio = null;
    expect(context.sources[4].stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    windowTarget.dispatchEvent(new Event('pointerdown'));
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it('suspends in a hidden tab and does not replay skipped sounds when visible', async () => {
    const { sound, context, windowTarget, documentTarget, camera } = setup();
    windowTarget.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    sound.update(0.11, true, 1, camera);
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.suspend).toHaveBeenCalledOnce();
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    sound.update(0.35, true, 1, camera);
    expect(context.sources).toHaveLength(1);
    sound.update(0.41, true, 1, camera);
    expect(context.sources).toHaveLength(2);
  });

  it('handles unavailable browser audio without breaking playback', () => {
    const { sound, windowTarget, camera, status } = setup();
    vi.stubGlobal('AudioContext', undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => windowTarget.dispatchEvent(new Event('pointerdown'))).not.toThrow();
      expect(status).toHaveBeenLastCalledWith('unavailable');
      expect(() => sound.update(0.11, true, 1, camera)).not.toThrow();
    } finally { warning.mockRestore(); }
  });
});
