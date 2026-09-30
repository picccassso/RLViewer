import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode, Play, Loader2, Eye, EyeOff } from 'lucide-react';
import { RLViewerLogo } from './RLViewerLogo';

/** How long the show-interface button stays up after the mouse stops moving. */
const REVEAL_IDLE_MS = 2500;

interface DropZoneOverlayProps {
  isLoading: boolean;
  loadingMessage: string;
  onFileLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  onLoadSample: () => void;
  showControls: boolean;
  /** Nothing is open yet: ask for a replay. */
  showStartPrompt: boolean;
  onHideHud: () => void;
  /** Offer a way back while the interface is hidden. */
  showRevealButton: boolean;
  onShowHud: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  isLoading,
  loadingMessage,
  onFileLoaded,
  onLoadSample,
  showControls,
  showStartPrompt,
  onHideHud,
  showRevealButton,
  onShowHud,
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
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4 text-white pointer-events-auto overflow-hidden">
          {/* Backdrop: team glows over a faint pitch grid */}
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(ellipse 60% 70% at 0% 50%, rgb(22 114 232 / 0.28), transparent 70%),' +
                'radial-gradient(ellipse 60% 70% at 100% 50%, rgb(240 106 15 / 0.24), transparent 70%),' +
                'radial-gradient(ellipse 50% 50% at 50% 50%, rgb(34 211 238 / 0.06), transparent 70%),' +
                '#05070f',
            }}
          />
          <div
            className="absolute inset-0 -z-10 opacity-[0.35]"
            style={{
              backgroundImage:
                'linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent)',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent)',
            }}
          />

          <div className="hud-panel rounded-2xl w-full max-w-md p-6 sm:p-8 text-center max-h-[92dvh] overflow-y-auto">
            <div className="flex justify-center">
              <RLViewerLogo size={56} />
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
              RL<span className="text-cyan-300">Viewer</span>
            </h1>
            <p className="mt-1.5 text-[15px] text-slate-400 leading-snug">
              Watch any Rocket League replay in 3D, from any player's camera.
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 font-display text-[15px] font-bold text-slate-950 shadow-[0_6px_20px_-6px_rgb(34_211_238/0.7)] transition hover:brightness-110 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <FileCode size={17} />
                <span>Choose replay file</span>
              </button>
              <button
                onClick={onLoadSample}
                className="hud-btn h-11 rounded-xl bg-white/[0.06] text-[15px] text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/10"
              >
                <Play size={15} />
                <span>Watch sample match</span>
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 text-[12px] text-slate-500">
              <div className="h-px flex-1 bg-white/10" />
              <span>or drop a .replay file anywhere</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="mt-5 rounded-lg bg-black/30 px-3 py-2.5 text-left ring-1 ring-inset ring-white/5">
              <div className="hud-label text-[10px] text-slate-500">Replays are saved in</div>
              <code className="mt-1.5 block break-all font-mono text-[11px] leading-relaxed text-slate-300">
                Documents\My Games\Rocket League\TAGame\Demos
              </code>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-slate-500">
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">Space</kbd> Ball cam</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">K</kbd> Play</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">1</kbd>–<kbd className="hud-kbd">6</kbd> Players</span>
              <span className="flex items-center gap-1.5"><kbd className="hud-kbd">H</kbd> Hide UI</span>
            </div>

            <p className="mt-4 text-[11px] text-slate-600">Parsed 100% locally. Nothing is uploaded.</p>
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
            className="hud-btn h-8 px-2.5 text-[13px]"
            title="Open a .replay file"
          >
            <FileCode size={14} />
            <span>Open</span>
          </button>

          <button
            onClick={onLoadSample}
            className="hud-btn h-8 px-2.5 text-[13px]"
            title="Load sample match"
          >
            <Play size={13} />
            <span>Sample</span>
          </button>

          <div className="h-5 w-px bg-white/10 mx-0.5" />
          <button
            onClick={onHideHud}
            className="hud-btn h-8 w-8"
            title="Hide interface (H)"
            aria-label="Hide interface"
          >
            <EyeOff size={14} />
          </button>
        </div>
      )}

      {showRevealButton && (
        <button
          onClick={onShowHud}
          onMouseEnter={() => { revealHoveredRef.current = true; }}
          onMouseLeave={() => { revealHoveredRef.current = false; }}
          className={`fixed z-30 hud-panel hud-btn h-9 px-3 text-[13px] transition-opacity duration-300 ${
            isRevealAwake ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            top: 'max(12px, env(safe-area-inset-top))',
            right: 'max(12px, env(safe-area-inset-right))',
          }}
          title="Show interface (H)"
        >
          <Eye size={14} />
          <span>Show interface</span>
          <kbd className="hud-kbd ml-0.5">H</kbd>
        </button>
      )}
    </>
  );
};
