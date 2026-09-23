import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode, Play, Loader2, EyeOff } from 'lucide-react';

interface DropZoneOverlayProps {
  isLoading: boolean;
  loadingMessage: string;
  onFileLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  onLoadSample: () => void;
  showControls: boolean;
  onHideHud: () => void;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  isLoading,
  loadingMessage,
  onFileLoaded,
  onLoadSample,
  showControls,
  onHideHud,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        <div className="fixed top-3 right-3 z-30 ui-panel p-1 flex items-center gap-1 pointer-events-auto">
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
            title="Reload sample match"
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
    </>
  );
};
