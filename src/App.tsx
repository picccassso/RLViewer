import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ParsedReplayData, FrameState } from './types/replay';
import { parseReplayBuffer, loadSampleReplay } from './parser/replayParser';
import { CameraMode } from './camera/CameraSuite';
import { CameraSettings, DEFAULT_CAMERA_SETTINGS } from './math/cameraMath';
import { getFrameTime } from './math/frameUnpacker';
import { resolveGoalScoredTime } from './math/impacts';
import { ReplayVisualizerCanvas } from './scene/ReplayVisualizerCanvas';
import { Scoreboard } from './components/Scoreboard';
import { PlayerTelemetry } from './components/PlayerTelemetry';
import { TacticalMinimap } from './components/TacticalMinimap';
import { CameraToolbar } from './components/CameraToolbar';
import { PlaybackTimeline } from './components/PlaybackTimeline';
import { DropZoneOverlay, HudStage } from './components/DropZoneOverlay';
import { RLViewerLogo } from './components/RLViewerLogo';
import { OrientationLockOverlay } from './components/OrientationLockOverlay';
import { MobileSpectatorHUD } from './components/mobile/MobileSpectatorHUD';
import { useDeviceOrientation } from './hooks/useDeviceOrientation';
import type { AudioStatus } from './audio/ReplayAudio';

function loadAudioSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('rl-viewer-audio') ?? 'null');
    if (saved && Number.isFinite(saved.volume) && typeof saved.muted === 'boolean') {
      return { volume: Math.max(0, Math.min(1, saved.volume)), muted: saved.muted as boolean };
    }
  } catch { /* Storage may be disabled. */ }
  return { volume: 0.65, muted: false };
}

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
  const [audioSettings, setAudioSettings] = useState(loadAudioSettings);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('locked');
  const [seekTarget, setSeekTarget] = useState<{ time: number; id: number } | null>(null);

  // Camera & Followed Player State
  const [cameraMode, setCameraMode] = useState<CameraMode>('pov');
  const [activePlayerIndex, setActivePlayerIndex] = useState<number>(0);
  // null follows the selected player's recorded Ball Cam state. A boolean is
  // only used after the viewer explicitly presses the Ball Cam toggle.
  const [ballCamOverride, setBallCamOverride] = useState<boolean | null>(null);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(DEFAULT_CAMERA_SETTINGS);
  const [hudStage, setHudStage] = useState<HudStage>('full');
  const { showRotatePrompt, isCompactMobile, isFullscreen, toggleFullscreen } = useDeviceOrientation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCycleHudStage = useCallback(() => {
    setHudStage((stage) =>
      stage === 'full' ? 'match' :
      stage === 'match' ? 'names' :
      stage === 'names' ? 'none' : 'full'
    );
  }, []);

  const handleToggleMute = useCallback(() => {
    setAudioSettings((settings) => ({
      ...settings,
      volume: settings.volume || 0.65,
      muted: audioStatus === 'locked' || settings.volume === 0 ? false : !settings.muted,
    }));
  }, [audioStatus]);

  useEffect(() => {
    try { localStorage.setItem('rl-viewer-audio', JSON.stringify(audioSettings)); } catch { /* Optional preference. */ }
  }, [audioSettings]);

  useEffect(() => {
    const handleHudShortcut = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return;
      if (event.code === 'KeyH' && !event.repeat) {
        event.preventDefault();
        handleCycleHudStage();
      } else if (event.code === 'KeyM' && !event.repeat) {
        event.preventDefault();
        setAudioSettings((settings) => ({ ...settings, muted: !settings.muted }));
      }
    };
    window.addEventListener('keydown', handleHudShortcut);
    return () => window.removeEventListener('keydown', handleHudShortcut);
  }, [handleCycleHudStage]);

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

  // Precompute the exact moment each goal crosses the goal line into the net
  // (timeline tick marks sit ~1.5-2s earlier so clicking them shows the shot buildup).
  const resolvedGoals = React.useMemo(() => {
    if (!replayData) return [];
    return replayData.tickMarks
      .filter((tm) => tm.type === 'goal')
      .map((tm) => ({
        ...tm,
        scoredTime: resolveGoalScoredTime(replayData, tm.time),
      }));
  }, [replayData]);

  // Live running match score based on goals scored at or before currentTime
  const liveTeamScores = React.useMemo(() => {
    let team0 = 0;
    let team1 = 0;
    for (const g of resolvedGoals) {
      if (g.scoredTime <= currentTime) {
        if (g.team === 0) team0++;
        else team1++;
      }
    }
    return { team0, team1 };
  }, [resolvedGoals, currentTime]);

  // Active goal celebration banner (shown for 3 seconds right when the ball enters the net)
  const activeGoal = React.useMemo(() => {
    for (let i = resolvedGoals.length - 1; i >= 0; i--) {
      const g = resolvedGoals[i];
      if (currentTime >= g.scoredTime && currentTime <= g.scoredTime + 3.0) {
        return { description: g.description, team: g.team, time: g.scoredTime };
      }
    }
    return null;
  }, [resolvedGoals, currentTime]);

  return (
    <div className="fixed inset-0 w-full h-full h-[100dvh] overflow-hidden bg-[#060913] select-none">
      {/* 0. Mobile Portrait Orientation Lock Overlay */}
      <OrientationLockOverlay isVisible={showRotatePrompt} />

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
        showHud={hudStage !== 'none'}
        volume={audioSettings.volume}
        muted={audioSettings.muted}
        onAudioStatus={setAudioStatus}
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
        showControls={!isCompactMobile && hudStage === 'full' && replayData !== null}
        showStartPrompt={replayData === null && !isLoading}
        hudStage={hudStage}
        onCycleHudStage={handleCycleHudStage}
        showRevealButton={!isCompactMobile && hudStage !== 'full' && replayData !== null}
        fileInputRef={fileInputRef}
      />

      {/* Render dedicated Mobile Spectator HUD or standard Desktop HUD */}
      {replayData && isCompactMobile ? (
        <MobileSpectatorHUD
          replayData={replayData}
          frameState={frameState}
          currentTime={currentTime}
          currentFrame={currentFrame}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          cameraMode={cameraMode}
          activePlayerIndex={activePlayerIndex}
          isBallCam={isBallCam}
          liveTeamScores={liveTeamScores}
          audioSettings={audioSettings}
          audioStatus={audioStatus}
          isFullscreen={isFullscreen}
          onTogglePlay={handleTogglePlay}
          onSeekTime={handleSeekTime}
          onSelectPlayer={handleSelectPlayer}
          onToggleBallCam={handleToggleBallCam}
          onSetCameraMode={setCameraMode}
          onChangePlaybackSpeed={setPlaybackSpeed}
          onToggleMute={handleToggleMute}
          onToggleFullscreen={toggleFullscreen}
          onLoadSample={handleLoadSample}
          onOpenFile={() => fileInputRef.current?.click()}
        />
      ) : replayData && (
        <>
          {/* 3. Match HUD: Scoreboard & Boost Meter (visible in 'full' and 'match' stages) */}
          {(hudStage === 'full' || hudStage === 'match') && (
            <>
              <div className="absolute inset-x-0 top-3 flex justify-center z-20 pointer-events-none">
                <div className="pointer-events-auto">
                  <Scoreboard
                    frameState={frameState}
                    teamScores={liveTeamScores}
                    activeGoal={activeGoal}
                    blueTeamName="BLUE"
                    orangeTeamName="ORANGE"
                  />
                </div>
              </div>

              <div
                className={`absolute z-20 right-3 pointer-events-none transition-[bottom] duration-150 ${
                  hudStage === 'full' ? 'bottom-[var(--hud-bottom)]' : 'bottom-4'
                }`}
              >
                <div className="pointer-events-auto flex items-end justify-end">
                  <PlayerTelemetry
                    frameState={frameState}
                    activePlayerIndex={activePlayerIndex}
                    isBallCam={isBallCam}
                    onToggleBallCam={handleToggleBallCam}
                    showCard={hudStage === 'full'}
                  />
                </div>
              </div>
            </>
          )}

          {/* 4. Replay Controls: Logo, Map, Camera Toolbar & Timeline (visible in 'full' stage) */}
          {hudStage === 'full' && (
            <>
              <div className="absolute z-20 top-3 left-3 hud-panel h-9 px-2.5 pointer-events-none flex items-center">
                <RLViewerLogo size={18} showText={true} />
              </div>

              <div className="absolute z-20 left-3 bottom-[var(--hud-bottom)] pointer-events-none">
                <div className="pointer-events-auto flex items-end gap-2 origin-bottom-left">
                  <TacticalMinimap
                    frameState={frameState}
                    boostPads={replayData?.boostPads}
                    activePlayerIndex={activePlayerIndex}
                    onSelectPlayer={handleSelectPlayer}
                    defaultCollapsed={false}
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

              <div className="absolute bottom-0 inset-x-0 z-20">
                <PlaybackTimeline
                  currentTime={currentTime}
                  duration={replayData?.duration || 0}
                  currentFrame={currentFrame}
                  totalFrames={replayData?.totalFrames || 0}
                  isPlaying={isPlaying}
                  playbackSpeed={playbackSpeed}
                  volume={audioSettings.volume}
                  muted={audioSettings.muted}
                  audioStatus={audioStatus}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  onToggleMute={handleToggleMute}
                  onChangeVolume={(volume) => setAudioSettings({ volume, muted: false })}
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
        </>
      )}
    </div>
  );
};
