import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkIsTouchDevice, checkIsPortrait, checkIsFullscreen } from '../useDeviceOrientation';

describe('device orientation and touch checks', () => {
  let mockWindow: any;
  let mockDocument: any;

  beforeEach(() => {
    mockWindow = {
      innerWidth: 1920,
      innerHeight: 1080,
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
      })),
    };
    mockDocument = {
      fullscreenElement: null,
    };
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('correctly identifies desktop landscape environment', () => {
    expect(checkIsPortrait()).toBe(false);
    expect(checkIsTouchDevice()).toBe(false);
  });

  it('identifies portrait orientation when height exceeds width', () => {
    mockWindow.innerWidth = 390;
    mockWindow.innerHeight = 844;
    expect(checkIsPortrait()).toBe(true);
  });

  it('identifies touch device when coarse pointer media query matches', () => {
    mockWindow.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: coarse'),
      media: query,
    }));
    expect(checkIsTouchDevice()).toBe(true);
  });

  it('does not flag fine-pointer desktop as touch device even on narrow window', () => {
    mockWindow.innerWidth = 400;
    mockWindow.innerHeight = 900;
    mockWindow.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
    }));
    expect(checkIsTouchDevice()).toBe(false);
  });

  it('detects fullscreen element state', () => {
    expect(checkIsFullscreen()).toBe(false);
    mockDocument.fullscreenElement = {};
    expect(checkIsFullscreen()).toBe(true);
  });
});
