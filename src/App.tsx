import React, { useState, useEffect, useCallback } from 'react';
import { ParsedReplayData, FrameState } from './types/replay';
import { parseReplayBuffer, loadSampleReplay } from './parser/replayParser';
import { CameraMode } from './camera/CameraSuite';
import { CameraSettings, DEFAULT_CAMERA_SETTINGS } from './math/cameraMath';
import { getFrameTime } from './math/frameUnpacker';
import { ReplayVisualizerCanvas } from './scene/ReplayVisualizerCanvas';
import { Scoreboard } from './components/Scoreboard';
import { PlayerTelemetry } from './components/PlayerTelemetry';
import { TacticalMinimap } from './components/TacticalMinimap';
import { CameraToolbar } from './components/CameraToolbar';
import { PlaybackTimeline } from './components/PlaybackTimeline';
import { DropZoneOverlay } from './components/DropZoneOverlay';

export const App: React.FC = () => {
  // Replay Data & Loading
  const [replayData, setReplayData] = useState<ParsedReplayData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  // Playback State
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [frameState, setFrameState] = useState<FrameState | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [seekTarget, setSeekTarget] = useState<{ time: number; id: number } | null>(null);

  // Camera & Followed Player State
  const [cameraMode, setCameraMode] = useState<CameraMode>('pov');
  const [activePlayerIndex, setActivePlayerIndex] = useState<number>(0);
  // null follows the selected player's recorded Ball Cam state. A boolean is
  // only used after the viewer explicitly presses the Ball Cam toggle.
  const [ballCamOverride, setBallCamOverride] = useState<boolean | null>(null);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(DEFAULT_CAMERA_SETTINGS);
  const [isHudVisible, setIsHudVisible] = useState<boolean>(true);

  useEffect(() => {
    const handleHudShortcut = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return;
      if (event.code === 'KeyH') {
        event.preventDefault();
        setIsHudVisible((visible) => !visible);
      }
    };
    window.addEventListener('keydown', handleHudShortcut);
    return () => window.removeEventListener('keydown', handleHudShortcut);
  }, []);

  // Handle uploaded replay file
  const handleFileLoaded = async (buffer: ArrayBuffer, fileName: string) => {
    try {
      setIsLoading(true);
      setLoadingMessage(`Parsing ${fileName}...`);
      setIsPlaying(false);

      const data = await parseReplayBuffer(buffer);
      setReplayData(data);
      setCurrentTime(0);
      setCurrentFrame(0);
      setActivePlayerIndex(0);
      setBallCamOverride(null);
      setSeekTarget({ time: 0, id: Date.now() });
      if (data.players[0]) {
        setCameraSettings(data.players[0].camera_settings);
      }
      setIsPlaying(true);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Failed to parse dropped replay:', err);
      alert(`Error parsing replay: ${err.message || 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  // Load the bundled sample replay
  const handleLoadSample = async () => {
    try {
      setIsLoading(true);
      setLoadingMessage('Loading sample match...');
      setIsPlaying(false);
      const data = await loadSampleReplay();
      setReplayData(data);
      setCurrentTime(0);
      setCurrentFrame(0);
      setActivePlayerIndex(0);
      setBallCamOverride(null);
      setSeekTarget({ time: 0, id: Date.now() });
      if (data.players[0]) {
        setCameraSettings(data.players[0].camera_settings);
      }
      setIsPlaying(true);
      setIsLoading(false);
    } catch (err: any) {
      console.error(err);
      setIsLoading(false);
    }
  };

  // Switch Active Player
  const handleSelectPlayer = useCallback(
    (index: number) => {
      setActivePlayerIndex(index);
      if (replayData && replayData.players[index]) {
        // Automatically adopt the player's replicated camera profile
        setCameraSettings(replayData.players[index].camera_settings);
      }
      if (cameraMode !== 'pov') {
        setCameraMode('pov');
      }
      // A newly selected POV should follow that player's actual camera events.
      setBallCamOverride(null);
    },
    [replayData, cameraMode]
  );

  // Play / Pause Toggle
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // BallCam Toggle
  const recordedBallCam =
    frameState?.players.find((player) => player.info.index === activePlayerIndex)?.ballCamActive ?? true;
  const isBallCam = ballCamOverride ?? recordedBallCam;

  const handleToggleBallCam = useCallback(() => {
    setBallCamOverride((override) => !(override ?? recordedBallCam));
  }, [recordedBallCam]);

  // Time update callback from 3D canvas render loop
  const handleTimeUpdate = useCallback((time: number, frame: number, state: FrameState) => {
    setCurrentTime(time);
    setCurrentFrame(frame);
    setFrameState(state);
  }, []);

  // Seek time
  const handleSeekTime = useCallback((time: number) => {
    setCurrentTime(time);
    setSeekTarget({ time, id: Date.now() });
  }, []);

  // Seek frame
  const handleSeekFrame = useCallback(
    (frame: number) => {
      if (!replayData) return;
      const time = getFrameTime(replayData, frame);
      setCurrentTime(time);
      setSeekTarget({ time, id: Date.now() });
    },
    [replayData]
  );

  // Step frames (e.g. +1, -1)
  const handleStepFrame = useCallback(
    (deltaFrames: number) => {
      if (!replayData) return;
      setIsPlaying(false);
      const targetFrame = Math.max(0, Math.min(replayData.totalFrames - 1, currentFrame + deltaFrames));
      const targetTime = getFrameTime(replayData, targetFrame);
      setCurrentTime(targetTime);
      setSeekTarget({ time: targetTime, id: Date.now() });
    },
    [replayData, currentFrame]
  );

  // Live running match score based on goals scored at or before currentTime
  const liveTeamScores = React.useMemo(() => {
    if (!replayData) return { team0: 0, team1: 0 };
    let team0 = 0;
    let team1 = 0;
    for (const tm of replayData.tickMarks) {
      if (tm.type === 'goal' && tm.time <= currentTime) {
        if (tm.team === 0) team0++;
        else team1++;
      }
    }
    return { team0, team1 };
  }, [replayData, currentTime]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#060913] select-none">
      {/* 1. 3D Canvas Background */}
      <ReplayVisualizerCanvas
        replayData={replayData}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        cameraMode={cameraMode}
        activePlayerIndex={activePlayerIndex}
        ballCamOverride={ballCamOverride}
        cameraSettings={cameraSettings}
        seekTarget={seekTarget}
        showHud={isHudVisible}
        onTimeUpdate={handleTimeUpdate}
        onSelectPlayer={handleSelectPlayer}
        onTogglePlay={handleTogglePlay}
        onToggleBallCam={handleToggleBallCam}
      />

      {/* 2. Drag and Drop Overlay & Header Actions */}
      <DropZoneOverlay
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        onFileLoaded={handleFileLoaded}
        onLoadSample={handleLoadSample}
        showControls={isHudVisible && replayData !== null}
        showStartPrompt={replayData === null && !isLoading}
        onHideHud={() => setIsHudVisible(false)}
      />

      {isHudVisible && replayData && (
        <>
          {/* 3. Compact score */}
          <div className="absolute top-3 inset-x-0 flex justify-center z-20 pointer-events-none">
            <div className="pointer-events-auto">
              <Scoreboard
                frameState={frameState}
                teamScores={liveTeamScores}
                blueTeamName="BLUE"
                orangeTeamName="ORANGE"
              />
            </div>
          </div>

          <div className="absolute top-3 left-3 z-20 ui-panel px-3 py-2 pointer-events-none">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-slate-200">RL VIEWER</span>
          </div>

          {/* 4. Analysis and camera controls */}
          <div className="absolute bottom-[68px] left-3 z-20 pointer-events-none">
            <div className="pointer-events-auto flex items-end gap-2">
              <TacticalMinimap
                frameState={frameState}
                activePlayerIndex={activePlayerIndex}
                onSelectPlayer={handleSelectPlayer}
              />
              <CameraToolbar
                mode={cameraMode}
                activePlayerIndex={activePlayerIndex}
                players={replayData?.players || []}
                cameraSettings={cameraSettings}
                isBallCam={isBallCam}
                onSetMode={setCameraMode}
                onSelectPlayer={handleSelectPlayer}
                onToggleBallCam={handleToggleBallCam}
                onUpdateCameraSettings={(patch) =>
                  setCameraSettings((prev) => ({ ...prev, ...patch }))
                }
              />
            </div>
          </div>

          {/* 5. Compact player telemetry */}
          <div className="absolute bottom-[68px] right-3 z-20 pointer-events-none">
            <PlayerTelemetry
              frameState={frameState}
              activePlayerIndex={activePlayerIndex}
              isBallCam={isBallCam}
              onToggleBallCam={handleToggleBallCam}
            />
          </div>

          {/* 6. Playback */}
          <div className="absolute bottom-0 inset-x-0 z-20">
            <PlaybackTimeline
              currentTime={currentTime}
              duration={replayData?.duration || 0}
              currentFrame={currentFrame}
              totalFrames={replayData?.totalFrames || 0}
              isPlaying={isPlaying}
              playbackSpeed={playbackSpeed}
              tickMarks={replayData?.tickMarks || []}
              onTogglePlay={handleTogglePlay}
              onSeekTime={handleSeekTime}
              onSeekFrame={handleSeekFrame}
              onChangeSpeed={setPlaybackSpeed}
              onStepFrame={handleStepFrame}
            />
          </div>
        </>
      )}
    </div>
  );
};
