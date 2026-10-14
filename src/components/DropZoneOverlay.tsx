import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode, Play, Loader2, Eye, EyeOff } from 'lucide-react';
import { RLViewerLogo } from './RLViewerLogo';

/** How long the floating HUD-stage button stays visible after the mouse stops moving. */
const REVEAL_IDLE_MS = 2500;

export type HudStage = 'full' | 'match' | 'names' | 'none';

const HUD_STAGE_LABELS: Record<HudStage, string> = {
  full: 'Full HUD',
  match: 'Match HUD',
  names: 'Names Only',
  none: 'HUD Off',
};

interface DropZoneOverlayProps {
  isLoading: boolean;
  loadingMessage: string;
  onFileLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  onLoadSample: () => void;
  showControls: boolean;
  /** Nothing is open yet: ask for a replay. */
  showStartPrompt: boolean;
  hudStage: HudStage;
  onCycleHudStage: () => void;
  /** Offer a floating button to keep cycling/restoring the HUD when replay controls are hidden. */
  showRevealButton: boolean;
  fileInputRef?: React.RefObject<HTMLInputElement>;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  isLoading,
  loadingMessage,
  onFileLoaded,
  onLoadSample,
  showControls,
  showStartPrompt,
  hudStage,
  onCycleHudStage,
  showRevealButton,
  fileInputRef: externalFileInputRef,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isRevealAwake, setIsRevealAwake] = useState(true);
  const internalFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalFileInputRef || internalFileInputRef;
  const revealHoveredRef = useRef(false);

  // With the interface hidden, the show button appears while the mouse moves and fades
  // away once it rests, so it stays out of clean recordings.
  useEffect(() => {
    if (!showRevealButton) return;
    let timer = 0;
    const wake = () => {
      setIsRevealAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!revealHoveredRef.current) setIsRevealAwake(false);
      }, REVEAL_IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [showRevealButton]);

  useEffect(() => {
    let dragCounter = 0;

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDragging(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setIsDragging(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.replay')) {
          const buffer = await file.arrayBuffer();
          onFileLoaded(buffer, file.name);
        } else {
          alert('Please drop a valid Rocket League .replay file');
        }
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [onFileLoaded]);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      // Clear the selection so choosing the same file again still loads it.
      e.target.value = '';
      const buffer = await file.arrayBuffer();
      onFileLoaded(buffer, file.name);
    }
  };

  return (
    <>
      {/* Full screen drag receiver overlay */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-200 ${
          isDragging ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#040710]/85 backdrop-blur-sm p-6 select-none pointer-events-none">
            <div className="flex h-full max-h-[420px] w-full max-w-2xl flex-col items-center justify-center rounded-3xl border-2 border-dashed border-cyan-300/50 bg-cyan-400/[0.04] text-white">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/15 ring-1 ring-cyan-300/40">
                <UploadCloud size={28} className="text-cyan-200" />
              </div>
              <h2 className="font-display text-2xl font-bold tracking-wide">Drop to open replay</h2>
              <p className="mt-1 text-sm text-slate-400">.replay files are parsed locally in your browser</p>
            </div>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#040710]/80 backdrop-blur-md text-white select-none">
          <div className="hud-panel rounded-2xl px-6 py-5 flex items-center gap-4 max-w-sm text-left">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-white/10" />
              <Loader2 size={40} strokeWidth={1.5} className="absolute text-cyan-300 animate-spin" />
              <RLViewerLogo size={20} />
            </div>
            <div>
              <h3 className="font-display text-[17px] font-bold">Parsing replay</h3>
              <p className="text-[13px] text-slate-400 mt-0.5">{loadingMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Start screen: nothing is open yet */}
      {showStartPrompt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4 text-white pointer-events-auto overflow-hidden bg-[#080b12]">
          <div className="hud-panel rounded-lg w-full max-w-md p-6 sm:p-7 text-center max-h-[92dvh] overflow-y-auto">
            <div className="flex justify-center">
              <RLViewerLogo size={48} />
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-white">
              RLViewer
            </h1>
            <p className="mt-1 text-[14px] text-slate-400 leading-snug">
              Watch any Rocket League replay in 3D, from any player's camera.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 items-center justify-center gap-2 rounded bg-[#1968cc] font-display text-[14px] font-bold text-white transition-colors hover:bg-[#1e74e0] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
              >
                <FileCode size={16} />
                <span>Choose replay file</span>
              </button>
              <button
                onClick={onLoadSample}
                className="hud-btn h-10 rounded bg-white/[0.07] text-[14px] text-slate-200 border border-white/10 hover:bg-white/12"
              >
                <Play size={14} />
                <span>Watch sample match</span>
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 text-[12px] text-slate-500">
              <div className="h-px flex-1 bg-white/10" />
              <span>or drop a .replay file anywhere</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="mt-4 rounded bg-black/35 px-3 py-2 text-left border border-white/5">
              <div className="hud-label text-[10px] text-slate-500">Replays are saved in</div>
              <code className="mt-1 block break-all font-mono text-[11px] leading-relaxed text-slate-300">
                Documents\My Games\Rocket League\TAGame\Demos
              </code>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-slate-400">
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">Space</kbd> Ball cam</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">K</kbd> Play</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">1</kbd>–<kbd className="hud-kbd">6</kbd> Players</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">H</kbd> Cycle HUD</span>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">Parsed 100% locally. Nothing is uploaded.</p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".replay"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Top Right Replay Controls */}
      {showControls && (
        <div
          className="fixed z-30 hud-panel p-1 flex items-center gap-0.5 pointer-events-auto"
          style={{
            top: 'max(12px, env(safe-area-inset-top))',
            right: 'max(12px, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className="hud-btn h-7 px-2.5 text-[12px]"
            title="Open a .replay file"
          >
            <FileCode size={13} />
            <span>Open</span>
          </button>

          <button
            onClick={onLoadSample}
            className="hud-btn h-7 px-2.5 text-[12px]"
            title="Load sample match"
          >
            <Play size={12} />
            <span>Sample</span>
          </button>

          <div className="h-4 w-px bg-white/10 mx-0.5" />
          <button
            onClick={onCycleHudStage}
            className="hud-btn h-7 px-2 text-[12px]"
            title="Cycle HUD elements (H): Full -> Match HUD -> Names Only -> Off"
            aria-label="Cycle HUD elements"
          >
            <Eye size={13} />
            <span>{HUD_STAGE_LABELS[hudStage]}</span>
            <kbd className="hud-kbd ml-0.5">H</kbd>
          </button>
        </div>
      )}

      {showRevealButton && (
        <button
          onClick={onCycleHudStage}
          onMouseEnter={() => { revealHoveredRef.current = true; }}
          onMouseLeave={() => { revealHoveredRef.current = false; }}
          className={`fixed z-30 hud-panel hud-btn h-8 px-2.5 text-[12px] transition-opacity duration-200 ${
            isRevealAwake ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            top: 'max(12px, env(safe-area-inset-top))',
            right: 'max(12px, env(safe-area-inset-right))',
          }}
          title="Cycle HUD elements (H): Full -> Match HUD -> Names Only -> Off"
        >
          {hudStage === 'none' ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>{HUD_STAGE_LABELS[hudStage]}</span>
          <kbd className="hud-kbd ml-0.5">H</kbd>
        </button>
      )}
    </>
  );
};
