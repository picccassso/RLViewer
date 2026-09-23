@echo off
rem Builds CameraCapture.dll. Run from "x64 Native Tools Command Prompt for VS 2022".
rem The BakkesMod SDK ships with BakkesMod; override BAKKESMOD_SDK to use another copy.
setlocal
if "%BAKKESMOD_SDK%"=="" set "BAKKESMOD_SDK=%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk"
if not exist "%BAKKESMOD_SDK%\include\bakkesmod\plugin\bakkesmodplugin.h" (
  echo BakkesMod SDK not found at "%BAKKESMOD_SDK%". Set BAKKESMOD_SDK to its folder.
  exit /b 1
)
cl /nologo /LD /EHsc /MD /O2 /std:c++17 /DNOMINMAX ^
  /I "%BAKKESMOD_SDK%\include" ^
  CameraCapture.cpp ^
  /link /LIBPATH:"%BAKKESMOD_SDK%\lib" /OUT:CameraCapture.dll || exit /b 1
echo Built CameraCapture.dll
