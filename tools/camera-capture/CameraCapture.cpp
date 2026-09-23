// Camera capture plugin for BakkesMod.
//
// Records Rocket League's own replay camera every rendered frame while you watch a
// replay from a player's view, so the RL Visualiser POV camera can be compared against
// the real thing. See README.md for building and usage.
//
// Console commands:
//   camcap_start   start recording the current replay camera to a CSV file
//   camcap_stop    stop recording and close the file

#pragma comment(lib, "pluginsdk.lib")

#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/wrappers/includes.h"

#include <chrono>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>

namespace {

constexpr const char* kFormatVersion = "rlv-camera-capture v1";

// CSV fields must not contain separators or line breaks.
std::string Sanitize(std::string text) {
  for (char& c : text) {
    if (c == ',' || c == '\n' || c == '\r') c = ' ';
  }
  return text;
}

std::string Timestamp() {
  std::time_t now = std::time(nullptr);
  std::tm local{};
  localtime_s(&local, &now);
  std::ostringstream stream;
  stream << std::put_time(&local, "%Y%m%d_%H%M%S");
  return stream.str();
}

}  // namespace

class CameraCapture : public BakkesMod::Plugin::BakkesModPlugin {
 public:
  void onLoad() override {
    cvarManager->registerNotifier(
        "camcap_start", [this](std::vector<std::string>) { Start(); },
        "Start recording the replay camera for the RL Visualiser", PERMISSION_ALL);
    cvarManager->registerNotifier(
        "camcap_stop", [this](std::vector<std::string>) { Stop(); },
        "Stop recording the replay camera", PERMISSION_ALL);
    // Drawables run once per rendered frame, after the camera has been updated.
    gameWrapper->RegisterDrawable([this](CanvasWrapper canvas) { Sample(canvas); });
  }

  void onUnload() override { Stop(); }

 private:
  void Start() {
    if (out_.is_open()) {
      cvarManager->log("camcap: already recording to " + out_path_.string());
      return;
    }
    if (!gameWrapper->IsInReplay()) {
      cvarManager->log("camcap: open a replay first");
      return;
    }
    ReplayServerWrapper server = gameWrapper->GetGameEventAsReplay();
    if (server.IsNull()) return;

    std::string replay_id = "unknown";
    std::string replay_name;
    std::string map_name;
    float record_fps = 0.f;
    ReplayDirectorWrapper director = server.GetReplayDirector();
    if (!director.IsNull()) {
      ReplaySoccarWrapper replay = director.GetReplay();
      if (!replay.IsNull()) {
        UnrealStringWrapper id = replay.GetId();
        UnrealStringWrapper name = replay.GetReplayName();
        if (!id.IsNull()) replay_id = id.ToString();
        if (!name.IsNull()) replay_name = name.ToString();
        map_name = replay.GetMapName();
        record_fps = replay.GetRecordFPS();
      }
    }

    std::filesystem::path folder = gameWrapper->GetDataFolder() / "camera_captures";
    std::filesystem::create_directories(folder);
    out_path_ = folder / (Sanitize(replay_id) + "_" + Timestamp() + ".csv");
    out_.open(out_path_);
    if (!out_.is_open()) {
      cvarManager->log("camcap: could not open " + out_path_.string());
      return;
    }

    out_ << "# " << kFormatVersion << "\n"
         << "# replay_id=" << Sanitize(replay_id) << "\n"
         << "# replay_name=" << Sanitize(replay_name) << "\n"
         << "# map=" << Sanitize(map_name) << "\n"
         << "# record_fps=" << record_fps << "\n"
         << "render_time,replay_frame,replay_time,"
            "cam_x,cam_y,cam_z,cam_pitch,cam_yaw,cam_roll,fov,camera_state,"
            "target,target_x,target_y,target_z,ball_x,ball_y,ball_z,"
            "settings_fov,settings_height,settings_pitch,settings_distance,"
            "settings_stiffness,settings_transition_speed,viewport_w,viewport_h\n";
    out_ << std::fixed << std::setprecision(4);

    started_at_ = std::chrono::steady_clock::now();
    last_frame_ = -1;
    last_replay_time_ = -1.f;
    rows_ = 0;
    cvarManager->log("camcap: recording to " + out_path_.string());
  }

  void Stop() {
    if (!out_.is_open()) return;
    out_.close();
    cvarManager->log("camcap: saved " + std::to_string(rows_) + " samples to " + out_path_.string());
  }

  void Sample(CanvasWrapper canvas) {
    if (!out_.is_open()) return;
    if (!gameWrapper->IsInReplay()) {
      Stop();
      return;
    }

    canvas.SetColor(255, 60, 60, 230);
    canvas.SetPosition(Vector2{40, 40});
    canvas.DrawString("REC camera  " + std::to_string(rows_), 1.5f, 1.5f, true);

    ReplayServerWrapper server = gameWrapper->GetGameEventAsReplay();
    CameraWrapper camera = gameWrapper->GetCamera();
    if (server.IsNull() || camera.IsNull()) return;

    // Skip repeated samples while the replay is paused.
    const int frame = server.GetCurrentReplayFrame();
    const float replay_time = server.GetReplayTimeElapsed();
    if (frame == last_frame_ && replay_time == last_replay_time_) return;
    last_frame_ = frame;
    last_replay_time_ = replay_time;

    // The car being followed, if the view target is a car (not the fly camera).
    std::string target_name;
    Vector target_location(0.f);
    ActorWrapper view_target = server.GetViewTarget();
    if (!view_target.IsNull()) {
      ArrayWrapper<CarWrapper> cars = server.GetCars();
      for (int i = 0; i < cars.Count(); i++) {
        CarWrapper car = cars.Get(i);
        if (!car.IsNull() && car.memory_address == view_target.memory_address) {
          target_name = car.GetOwnerName();
          target_location = car.GetLocation();
          break;
        }
      }
    }

    Vector ball_location(0.f);
    BallWrapper ball = server.GetBall();
    if (!ball.IsNull()) ball_location = ball.GetLocation();

    // The point of view actually rendered this frame.
    const POV pov = camera.GetPOV();
    const ProfileCameraSettings settings = camera.GetCameraSettings();
    const Vector2 viewport = canvas.GetSize();
    const double render_time =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - started_at_).count();

    out_ << render_time << ',' << frame << ',' << replay_time << ','
         << pov.location.X << ',' << pov.location.Y << ',' << pov.location.Z << ','
         << pov.rotation.Pitch << ',' << pov.rotation.Yaw << ',' << pov.rotation.Roll << ','
         << pov.FOV << ',' << Sanitize(camera.GetCameraState()) << ','
         << Sanitize(target_name) << ','
         << target_location.X << ',' << target_location.Y << ',' << target_location.Z << ','
         << ball_location.X << ',' << ball_location.Y << ',' << ball_location.Z << ','
         << settings.FOV << ',' << settings.Height << ',' << settings.Pitch << ','
         << settings.Distance << ',' << settings.Stiffness << ',' << settings.TransitionSpeed << ','
         << viewport.X << ',' << viewport.Y << '\n';
    if (++rows_ % 300 == 0) out_.flush();
  }

  std::ofstream out_;
  std::filesystem::path out_path_;
  std::chrono::steady_clock::time_point started_at_;
  int last_frame_ = -1;
  float last_replay_time_ = -1.f;
  int rows_ = 0;
};

BAKKESMOD_PLUGIN(CameraCapture, "RL Visualiser camera capture", "1.0", PLUGINTYPE_REPLAY)
