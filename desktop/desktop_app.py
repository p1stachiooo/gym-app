# Phase 8 packaging — native-window launcher for the Dash dashboard in
# app.py. This file contains NO display logic of its own; it only:
#   1. resolves the Firebase service-account key (dev vs. frozen/.exe),
#   2. boots app.py's Flask/Dash server in a background thread,
#   3. shows that server in a native window (pywebview), with graceful
#      fallbacks for headless smoke-testing and for machines without a
#      webview runtime.
#
# Run directly with `python desktop_app.py` in dev, or via the frozen
# HerculesStats.exe built from hercules_stats.spec.
from __future__ import annotations

import os
import socket
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

HOST = "127.0.0.1"
DEFAULT_PORT = 8050
KEY_FILENAME = "serviceAccountKey.json"
KEY_ENV_VAR = "HERCULES_KEY"
PORT_ENV_VAR = "HERCULES_PORT"
SMOKE_FILE = Path(tempfile.gettempdir()) / "hercules_smoke.txt"


def _app_dir() -> Path:
    """Directory the launcher itself lives in — the frozen .exe's folder
    when packaged, or this file's folder in dev."""
    if getattr(sys, "frozen", False):
        return Path(os.path.dirname(sys.executable))
    return Path(__file__).resolve().parent


def resolve_service_account_key() -> Path | None:
    """Find serviceAccountKey.json, preferring (in order):
      1. an already-set HERCULES_KEY env var (caller override wins),
      2. next to the frozen .exe, when running frozen,
      3. the repo's pull/serviceAccountKey.json, when running from source.
    Returns the resolved Path, or None if nothing exists at any candidate.
    Does not raise — the caller decides how to surface "not found".
    """
    existing = os.environ.get(KEY_ENV_VAR)
    if existing and Path(existing).exists():
        return Path(existing)

    if getattr(sys, "frozen", False):
        candidate = _app_dir() / KEY_FILENAME
    else:
        # desktop/desktop_app.py -> repo root -> pull/serviceAccountKey.json
        candidate = (Path(__file__).resolve().parent / ".." / "pull" / KEY_FILENAME).resolve()

    if candidate.exists():
        return candidate
    return None


def _write_smoke_result(message: str) -> None:
    """Headless (HERCULES_NO_WINDOW=1) result channel. The frozen, windowed
    (console=False) build has no stdout/stderr a caller can see, so the
    smoke path's pass/fail result — including fatal-error reasons like a
    missing key — is written to a well-known temp file instead."""
    try:
        SMOKE_FILE.write_text(message, encoding="utf-8")
    except Exception:
        pass


def _show_fatal_error(message: str) -> None:
    """User-facing error, no traceback. Tries a small native message box
    (via tkinter) first; falls back to stderr if unavailable.

    Skips the (blocking, click-to-dismiss) message box under
    HERCULES_NO_WINDOW=1 — the smoke-test/headless path needs this to exit
    on its own rather than wait forever for a click nobody will make. It
    writes the reason to the smoke file instead, since a windowed
    (console=False) build has no stderr a caller could otherwise read.
    """
    print(f"\nProject Hercules — Stats: {message}\n", file=sys.stderr)
    if os.environ.get("HERCULES_NO_WINDOW") == "1":
        _write_smoke_result(f"SMOKE_FAIL: {message}")
        return
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror("Project Hercules — Stats", message)
        root.destroy()
    except Exception:
        # No Tk available (unusual, but not fatal to the error path) — the
        # stderr message above is still the source of truth.
        pass


def _pick_port() -> int:
    """Choose the port to serve on: HERCULES_PORT env override wins if set;
    otherwise try to bind 127.0.0.1:8050, falling back to an OS-assigned
    free port (127.0.0.1:0) if 8050 is already taken.

    This removes the old failure modes entirely: a second instance no
    longer hangs waiting for a port a foreign process holds, nor silently
    attaches to that foreign instance — it just gets its own port.

    The probe socket is closed before returning so Flask can bind the real
    port; there's an inherent tiny race between the close and Flask's own
    bind (something else could grab the port in between), but that's true
    of any "find a free port" approach without OS-level port reservation,
    and is not worth the complexity of avoiding here.
    """
    env_port = os.environ.get(PORT_ENV_VAR)
    if env_port:
        return int(env_port)

    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((HOST, DEFAULT_PORT))
        return DEFAULT_PORT
    except OSError:
        pass
    finally:
        probe.close()

    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]
    finally:
        probe.close()


def _wait_for_server(url: str, timeout_s: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except URLError:
            pass
        except Exception:
            pass
        time.sleep(0.25)
    return False


def _run_server(dash_app, port: int) -> None:
    # debug=False / use_reloader=False: a reloader would fork a second
    # process, which both breaks the "wait for server" handshake below and
    # is meaningless in a frozen app with no source file to watch.
    dash_app.run(debug=False, port=port, use_reloader=False, host=HOST)


def _start_server_thread(dash_app, port: int) -> threading.Thread:
    thread = threading.Thread(target=_run_server, args=(dash_app, port), daemon=True)
    thread.start()
    return thread


def _smoke_test(port: int) -> int:
    """HERCULES_NO_WINDOW=1 escape hatch: boot the server, poll it (and the
    Dash layout endpoint) headlessly, write SMOKE_OK to the smoke file,
    exit 0 — no window, no webview dependency needed. Non-zero exit +
    message (also written to the smoke file) on failure.

    Result goes to a file rather than stdout because the frozen build is
    windowed (console=False) and has no stdout/stderr a caller can read."""
    from app import app as dash_app  # deferred: needs the key resolved first

    base_url = f"http://{HOST}:{port}"
    _start_server_thread(dash_app, port)

    if not _wait_for_server(f"{base_url}/", timeout_s=45.0):
        msg = "SMOKE_FAIL: server did not respond at / within timeout"
        print(msg, file=sys.stderr)
        _write_smoke_result(msg)
        return 1

    if not _wait_for_server(f"{base_url}/_dash-layout", timeout_s=15.0):
        msg = "SMOKE_FAIL: /_dash-layout did not respond within timeout"
        print(msg, file=sys.stderr)
        _write_smoke_result(msg)
        return 1

    msg = f"SMOKE_OK {port}"
    print(msg, file=sys.stderr)
    _write_smoke_result(msg)
    return 0


def _run_browser_fallback_window(base_url: str) -> int:
    """pywebview couldn't initialize (e.g. WebView2 runtime missing) — open
    the dashboard in the default browser, but keep a tiny always-on-top Tk
    window alive as the only way to quit. The windowed (console=False)
    build has no Ctrl-C to catch, and simply looping forever would strand
    the server thread if the user just closes the browser tab.
    """
    webbrowser.open(base_url)

    try:
        import tkinter
    except Exception as exc:
        # No Tk either (very unusual) — nothing left to offer the user as a
        # quit affordance; block rather than exit out from under a server
        # someone may still be using. Task Manager / window close is it.
        print(
            f"tkinter unavailable ({exc}); no quit window available. "
            f"Dashboard running at {base_url}.",
            file=sys.stderr,
        )
        while True:
            time.sleep(3600)

    def _quit() -> None:
        os._exit(0)

    root = tkinter.Tk()
    root.title("Project Hercules — Stats")
    root.attributes("-topmost", True)
    root.resizable(False, False)
    root.protocol("WM_DELETE_WINDOW", _quit)

    tkinter.Label(
        root,
        text="Hercules Stats is running in your browser.\nClose this window to quit.",
        justify="center",
        padx=24,
        pady=16,
    ).pack()
    tkinter.Button(root, text="Quit", command=_quit, padx=12, pady=4).pack(pady=(0, 16))

    root.mainloop()
    return 0


def _run_windowed(port: int) -> int:
    from app import app as dash_app

    base_url = f"http://{HOST}:{port}"
    _start_server_thread(dash_app, port)

    if not _wait_for_server(f"{base_url}/", timeout_s=45.0):
        _show_fatal_error(
            f"The dashboard server did not start in time (tried port {port})."
        )
        return 1

    try:
        import webview

        window = webview.create_window(
            "Project Hercules — Stats", base_url, width=1400, height=900,
        )
        # destroy() (not just letting the process idle) makes the daemon
        # server thread's process exit immediately on window close.
        window.events.closed += lambda: os._exit(0)
        webview.start()
        return 0
    except Exception as exc:
        print(f"pywebview unavailable ({exc}); opening in the default browser instead.", file=sys.stderr)
        return _run_browser_fallback_window(base_url)


def main() -> int:
    key_path = resolve_service_account_key()
    if key_path is None:
        if getattr(sys, "frozen", False):
            hint = (
                f"Couldn't find {KEY_FILENAME}.\n\n"
                f"Place your Firebase service-account key file, named "
                f"'{KEY_FILENAME}', in the same folder as this .exe:\n"
                f"  {_app_dir()}\n\n"
                "(Firebase console -> Project settings -> Service accounts -> "
                "Generate new private key.)"
            )
        else:
            hint = (
                f"Couldn't find {KEY_FILENAME}.\n\n"
                f"Set {KEY_ENV_VAR}=/path/to/{KEY_FILENAME}, or place the key "
                f"at pull/{KEY_FILENAME} (repo root)."
            )
        _show_fatal_error(hint)
        return 1

    os.environ[KEY_ENV_VAR] = str(key_path)

    # Make sure `import app` (desktop/app.py) resolves when run from source
    # (cwd may be anywhere). Not needed when frozen — PyInstaller's own
    # import mechanism (PYZ archive) already has app/data/metrics/theme
    # bundled as a byproduct of app.py's `import data` etc. being picked up
    # by static analysis of the entry script.
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(Path(__file__).resolve().parent))

    port = _pick_port()

    if os.environ.get("HERCULES_NO_WINDOW") == "1":
        return _smoke_test(port)
    return _run_windowed(port)


if __name__ == "__main__":
    sys.exit(main())
