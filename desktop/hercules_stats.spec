# PyInstaller spec — Project Hercules Phase 8 desktop dashboard.
#
# onedir (not onefile): firebase-admin pulls in grpc/protobuf native
# extensions that are unreliable to unpack-on-every-launch from a onefile
# archive; onedir just runs them in place.
#
# Build from the repo root:
#   pyinstaller desktop/hercules_stats.spec
#
# Output: desktop/dist/HerculesStats/HerculesStats.exe (+ its _internal/ dir).
# Never bundles serviceAccountKey.json — see desktop/DESKTOP_APP.md for how
# end users supply their own key next to the .exe.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

DESKTOP_DIR = Path(SPECPATH)  # desktop/, whatever cwd the spec was invoked from

# ─── Packages that need "everything" (submodules + data files + binaries) ──
# dash/plotly ship JS/CSS assets and package-data JSON that static analysis
# can't see; firebase-admin/grpc/google.* ship native extensions and proto
# descriptors in the same boat.
COLLECT_ALL_PACKAGES = [
    "dash",
    "dash_table",
    "plotly",
    "firebase_admin",
    "google.cloud.firestore",
    "google.api_core",
    "grpc",
    "grpc_status",
    "google.rpc",
    "proto",
    "google._upb",
]

datas = []
binaries = []
hiddenimports = []

for pkg in COLLECT_ALL_PACKAGES:
    try:
        pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    except Exception:
        continue
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

# ─── Extra submodules that collect_all's static analysis tends to miss ────
# (import-by-name plugin registries, C-extension-backed subpackages, etc.)
hiddenimports += collect_submodules("google.protobuf")
hiddenimports += collect_submodules("grpc_status")
hiddenimports += collect_submodules("google.api_core")
hiddenimports += collect_submodules("firebase_admin")
hiddenimports += [
    "grpc._cython.cygrpc",
    "google.auth.transport.grpc",
    "google.auth.transport.requests",
    "google.cloud.firestore_v1",
    "google.cloud.firestore_bundle",
    "webview",
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
    "webview.platforms.cef",
    "clr_loader",
    "clr_loader.ffi",
    "pythonnet",
    "flask",
    "werkzeug",
    "dash.dash_table",
    "plotly.graph_objects",
    "plotly.express",
]

# dash/plotly's own package-data (component JS bundles, .plotly.json schema)
# — collect_all above already grabs these, but explicit collect_data_files
# calls are cheap insurance if a future dash/plotly release restructures.
datas += collect_data_files("dash")
datas += collect_data_files("plotly")

# Local desktop/ modules (app.py, data.py, metrics.py, theme.py) are picked
# up automatically by Analysis via desktop_app.py's `from app import app`,
# since desktop/ is on pathex below — no explicit datas needed for these.
# body_paths.json is NOT a .py module though — bodymap.py reads it off disk
# at import time (Path(__file__).parent), so it needs an explicit datas
# entry to land next to bodymap.pyc in the frozen build.
datas.append((str(DESKTOP_DIR / "body_paths.json"), "."))
# medallions.py reads medallion_art.json off disk (Path(__file__).parent), same
# as bodymap.py/body_paths.json — needs an explicit datas entry to land in the
# frozen build next to medallions.pyc, or the rank panel crashes at render time.
datas.append((str(DESKTOP_DIR / "medallion_art.json"), "."))

hiddenimports = sorted(set(hiddenimports))

a = Analysis(
    [str(DESKTOP_DIR / "desktop_app.py")],
    pathex=[str(DESKTOP_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="HerculesStats",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed: no console pops up alongside the native
    # window. data.py's stderr warnings and the smoke-test result are no
    # longer console-visible as a consequence — see desktop_app.py's
    # HERCULES_NO_WINDOW path, which writes its result to
    # %TEMP%/hercules_smoke.txt instead of stdout for exactly this reason.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(DESKTOP_DIR / "hercules.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="HerculesStats",
)
