import { useState, useEffect, useCallback } from 'react';

export interface DeviceOrientationState {
  isPortrait: boolean;
  isTouchDevice: boolean;
  isCompactMobile: boolean;
  showRotatePrompt: boolean;
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
}

export function checkIsTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  // Match coarse pointer and no hover (touchscreens like phones/tablets)
  const coarsePointer = window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches ?? false;
  const touchPoints = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || (navigator as any).msMaxTouchPoints > 0);
  const touchEvent = typeof window !== 'undefined' && 'ontouchstart' in window;
  
  // If pointer is fine (e.g. standard mouse/trackpad desktop), coarsePointer will be false.
  return coarsePointer || (touchPoints && touchEvent && Math.min(window.innerWidth, window.innerHeight) <= 1024);
}

export function checkIsPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(orientation: portrait)')?.matches) {
    return true;
  }
  return window.innerHeight > window.innerWidth;
}

export function checkIsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
}

export function checkIsCompactMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight < 560 || (checkIsTouchDevice() && Math.min(window.innerWidth, window.innerHeight) < 600);
}

export function useDeviceOrientation(): DeviceOrientationState {
  const [isPortrait, setIsPortrait] = useState<boolean>(checkIsPortrait);
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(checkIsTouchDevice);
  const [isCompactMobile, setIsCompactMobile] = useState<boolean>(checkIsCompactMobile);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(checkIsFullscreen);

  useEffect(() => {
    const handleUpdate = () => {
      setIsPortrait(checkIsPortrait());
      setIsTouchDevice(checkIsTouchDevice());
      setIsCompactMobile(checkIsCompactMobile());
      setIsFullscreen(checkIsFullscreen());
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('orientationchange', handleUpdate);
    document.addEventListener('fullscreenchange', handleUpdate);
    document.addEventListener('webkitfullscreenchange', handleUpdate);

    // Initial check
    handleUpdate();

    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('orientationchange', handleUpdate);
      document.removeEventListener('fullscreenchange', handleUpdate);
      document.removeEventListener('webkitfullscreenchange', handleUpdate);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!checkIsFullscreen()) {
        const root = document.documentElement;
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if ((root as any).webkitRequestFullscreen) {
          await (root as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
      setIsFullscreen(checkIsFullscreen());
    } catch (err) {
      console.warn('Fullscreen toggle failed or not supported:', err);
    }
  }, []);

  const showRotatePrompt = isPortrait && isTouchDevice;

  return {
    isPortrait,
    isTouchDevice,
    isCompactMobile,
    showRotatePrompt,
    isFullscreen,
    toggleFullscreen,
  };
}
