# PyInstaller spec — freeze the recognizer in ONEDIR mode (no per-launch
# self-extraction → near-instant startup, vs ~15s for onefile).
#
# On macOS it also wraps the result in a .app BUNDLE marked LSUIElement, so the
# sidecar never gets a Dock tile when the Electron app spawns it. (onefile's
# bootloader process keeps a Dock tile regardless of in-process tricks; a bundle
# Info.plist LSUIElement is honored by LaunchServices for the whole process.)
#
# Build: cd recognizer && pyinstaller recognizer.spec --distpath ../dist-recognizer
# Output is per-OS/arch; run scripts/build-recognizer.sh on each target platform.

a = Analysis(
    ['main.py'],
    pathex=['.'],
    hiddenimports=['uvicorn', 'uvicorn.logging', 'uvicorn.loops.auto',
                   'uvicorn.protocols.http.auto', 'shazamio', 'aiohttp', 'certifi'],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name='recognizer', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='recognizer')
# BUNDLE is a no-op off macOS, so other platforms just get the COLLECT folder.
app = BUNDLE(
    coll,
    name='recognizer.app',
    bundle_identifier='com.shazamradio.recognizer',
    info_plist={'LSUIElement': True},
)
