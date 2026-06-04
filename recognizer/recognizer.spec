# PyInstaller spec — freeze the recognizer into a single self-contained binary.
# Build:  cd recognizer && pyinstaller recognizer.spec --distpath ../dist-recognizer
# Output is per-OS/arch; run scripts/build-recognizer.sh on each target platform.

a = Analysis(
    ['main.py'],
    pathex=['.'],
    hiddenimports=['uvicorn', 'uvicorn.logging', 'uvicorn.loops.auto',
                   'uvicorn.protocols.http.auto', 'shazamio', 'aiohttp', 'certifi'],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas,
    name='recognizer',
    console=True,
)
