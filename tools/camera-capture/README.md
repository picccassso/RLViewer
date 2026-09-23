# Camera capture plugin

A BakkesMod plugin that records Rocket League's own replay camera, every rendered
frame, so the viewer's POV camera can be measured against the real one.

Needs Windows, Rocket League, [BakkesMod](https://bakkesmod.com) and Visual Studio 2022
(the "Desktop development with C++" workload). BakkesMod only runs offline, and this
plugin only works in replays.

## Build

1. Open **x64 Native Tools Command Prompt for VS 2022**.
2. `cd` into this folder and run `build.bat`.

`build.bat` uses the SDK that ships with BakkesMod
(`%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk`). To use another copy, such as a clone of
[BakkesModSDK](https://github.com/bakkesmodorg/BakkesModSDK), set `BAKKESMOD_SDK` to its
folder first.

## Install

Copy `CameraCapture.dll` into `%APPDATA%\bakkesmod\bakkesmod\plugins`, then in Rocket
League open the BakkesMod console (F6) and run:

```
plugin load cameracapture
```

## Record

1. Open a replay whose `.replay` file you have (Match History, or a downloaded replay).
2. Pick a player's view (not the fly camera) and play the moment you want at 1x speed.
3. In the console: `camcap_start`. A red **REC camera** counter shows while recording.
4. Let it play. Switch players or seek freely; the comparison handles jumps.
5. `camcap_stop`. The console prints where the CSV went, normally
   `%APPDATA%\bakkesmod\bakkesmod\data\camera_captures\<replay id>_<time>.csv`.

Useful clips: normal driving, a Ball Cam toggle, wall driving, an air dribble or a flip
reset, and a corner play. Each file is about 2 MB per minute.

Keep camera shake off in the game settings; the plugin records the rendered view,
shake included.

## Compare

Copy the CSV files into `camera-captures/` in this project, with the replay saved as
`camera-captures/<replay id>.replay` (or in the project root). The replay id is the
start of the CSV file name. Then run:

```
npm run camera:compare
```

For each capture the test prints a table of how far the viewer's camera is from the
game's (position, view direction, camera distance and height relative to the car, and
where the car and ball land on screen), broken down by Ball Cam / Car Cam and ground /
air / wall. Per-frame data is written to `camera-captures/reports/` for closer
analysis.

## Recorded columns

| Column | Meaning |
| --- | --- |
| `render_time` | Seconds since `camcap_start`, from the frame clock |
| `replay_frame`, `replay_time` | Replay position shown this frame |
| `cam_x..z`, `cam_pitch/yaw/roll` | Rendered camera, Unreal units and rotator units (65536 per turn) |
| `fov` | Rendered horizontal FOV, degrees |
| `camera_state` | The game's camera state (Ball Cam, Car Cam, ...) |
| `target`, `target_x..z` | Followed player's name and car position |
| `ball_x..z` | Ball position, used to line the capture up with the replay |
| `settings_*` | Camera settings the game used |
| `viewport_w/h` | Game window size, for the aspect ratio |
