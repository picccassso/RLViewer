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
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isRevealAwake, setIsRevealAwake] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        className={`fixed inset-0 transition-colors duration-200 z-50 ${
          isDragging
            ? 'pointer-events-auto bg-blue-600/30 border-4 border-dashed border-blue-400'
            : 'pointer-events-none'
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white select-none pointer-events-none">
            <UploadCloud size={32} className="text-slate-300 mb-3" />
            <h2 className="text-base font-semibold tracking-wide">Drop replay file</h2>
            <p className="text-xs text-slate-500 mt-1">.replay files are parsed locally</p>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md text-white select-none">
          <div className="ui-panel p-5 flex items-center gap-3 max-w-sm text-left">
            <Loader2 size={20} className="text-slate-300 animate-spin shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">Parsing replay</h3>
              <p className="text-xs text-slate-500 mt-0.5">{loadingMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Start screen: nothing is open yet */}
      {showStartPrompt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4 text-white">
          <div className="ui-panel w-full max-w-sm p-6 text-center">
            <div className="flex justify-center mb-3">
              <RLViewerLogo size={48} />
            </div>
            <h2 className="text-lg font-bold tracking-tight">RL<span className="text-cyan-400">Viewer</span></h2>
            <p className="mt-1 text-xs text-slate-400">
              Choose a Rocket League .replay file or drop one anywhere. It's parsed locally and never uploaded.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="ui-button ui-button-active flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold"
              >
                <FileCode size={14} />
                <span>Choose replay</span>
              </button>
              <button
                onClick={onLoadSample}
                className="ui-button flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium"
              >
                <Play size={13} />
                <span>Watch sample match</span>
              </button>
            </div>
            <p className="mt-4 text-[11px] text-slate-500">
              Rocket League saves replays in Documents\My Games\Rocket League\TAGame\Demos
            </p>
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
          className="fixed z-30 ui-panel p-1 flex items-center gap-1 pointer-events-auto"
          style={{
            top: 'max(12px, env(safe-area-inset-top))',
            right: 'max(12px, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className="ui-button flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium"
            title="Open a .replay file"
          >
            <FileCode size={13} />
            <span>Open</span>
          </button>

          <button
            onClick={onLoadSample}
            className="ui-button flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium"
            title="Load sample match"
          >
            <Play size={12} />
            <span>Sample</span>
          </button>

          <div className="h-4 w-px bg-white/10 mx-0.5" />
          <button
            onClick={onHideHud}
            className="ui-button p-1.5"
            title="Hide interface (H)"
            aria-label="Hide interface"
          >
            <EyeOff size={13} />
          </button>
        </div>
      )}

      {showRevealButton && (
        <button
          onClick={onShowHud}
          onMouseEnter={() => { revealHoveredRef.current = true; }}
          onMouseLeave={() => { revealHoveredRef.current = false; }}
          className={`fixed z-30 ui-button flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-opacity duration-300 ${
            isRevealAwake ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            top: 'max(12px, env(safe-area-inset-top))',
            right: 'max(12px, env(safe-area-inset-right))',
          }}
          title="Show interface (H)"
        >
          <Eye size={13} />
          <span>Show interface</span>
          <kbd className="ml-0.5 rounded border border-white/15 px-1 font-mono text-[10px] text-slate-400">H</kbd>
        </button>
      )}
    </>
  );
};
