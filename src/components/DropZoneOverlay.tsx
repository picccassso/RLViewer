import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode, Play, Loader2 } from 'lucide-react';

interface DropZoneOverlayProps {
  isLoading: boolean;
  loadingMessage: string;
  onFileLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  onLoadSample: () => void;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  isLoading,
  loadingMessage,
  onFileLoaded,
  onLoadSample,
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md text-white select-none pointer-events-none">
            <UploadCloud size={64} className="text-cyan-400 animate-bounce mb-4" />
            <h2 className="text-3xl font-bold font-display uppercase tracking-wider">
              Drop Rocket League .replay File
            </h2>
            <p className="text-sm font-mono text-slate-300 mt-2">
              100% Client-Side WebAssembly Parsing (Zero-Server, Zero-Account)
            </p>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md text-white select-none">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center max-w-sm text-center">
            <Loader2 size={40} className="text-cyan-400 animate-spin mb-4" />
            <h3 className="text-xl font-bold font-display uppercase tracking-wider mb-1">
              Parsing Replay
            </h3>
            <p className="text-xs text-slate-400 font-mono mb-4">{loadingMessage}</p>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full w-full animate-pulse" />
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
      <div className="fixed top-3 right-4 z-30 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 hover:border-white/25 backdrop-blur-lg text-xs font-semibold text-slate-200 transition-all shadow-lg"
          title="Upload .replay file"
        >
          <FileCode size={14} className="text-blue-400" />
          <span>Load .replay</span>
        </button>

        <button
          onClick={onLoadSample}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/80 hover:bg-blue-600 border border-blue-400/40 backdrop-blur-lg text-xs font-semibold text-white transition-all shadow-lg"
          title="Reload Sample Match"
        >
          <Play size={13} fill="white" />
          <span>Sample Match</span>
        </button>
      </div>
    </>
  );
};
