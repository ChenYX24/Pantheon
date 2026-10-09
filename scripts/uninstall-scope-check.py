#!/usr/bin/env python3
"""Verify process ownership selection with real, disposable processes."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "deploy/uninstall.sh").read_text()
start = source.index("matching_panel_pids() {")
end = source.index("\n}\n", start) + 2
function = source[start:end]

if not Path('/proc/self/cmdline').is_file():
    print('=== uninstall-scope check: 0 FAIL, 1 WARN; Linux /proc unavailable, standalone termination stays disabled ===')
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix="parthenon-process-scope-") as temporary:
    directory = Path(temporary)
    program = directory / "vibepanel"
    fixture = directory / "fixture.c"
    fixture.write_text("#include <unistd.h>\nint main(void) { for (;;) pause(); }\n")
    subprocess.run(["cc", str(fixture), "-o", str(program)], check=True)
    base = {k: v for k, v in os.environ.items() if not k.startswith("VIBEPANEL_")}
    data = str(directory / "data with spaces")
    processes = []

    def launch(arguments, extra=None):
        process = subprocess.Popen([str(program), "serve", *arguments], env={**base, **(extra or {})})
        processes.append(process)
        return process

    def matches(path, socket):
        result = subprocess.check_output(["bash", "-euc", function + "\nmatching_panel_pids\n"], env={**base, "BIN": str(program), "DATA": path, "SOCKET": socket}, text=True)
        return {int(value) for value in result.split()}

    try:
        target = launch(["--data-dir", data, "--tmux-socket", "fixture-a"])
        other_data = launch(["--data-dir", data + "-other", "--tmux-socket", "fixture-a"])
        other_socket = launch(["--data-dir=" + data, "--tmux-socket=fixture-b"])
        inherited = launch([], {"VIBEPANEL_DATA_DIR": data, "VIBEPANEL_TMUX_SOCKET": "fixture-a"})
        overridden = launch(["--data-dir", data + "-other"], {"VIBEPANEL_DATA_DIR": data, "VIBEPANEL_TMUX_SOCKET": "fixture-a"})
        default_home = str(directory / "standalone-home")
        default_process = launch([], {"HOME": default_home})
        assert matches(default_home + "/.local/share/vibepanel", "vibepanel") == {default_process.pid}
        assert matches(data, "fixture-a") == {target.pid, inherited.pid}
        assert matches(data, "fixture-b") == {other_socket.pid}
        for pid in matches(data, "fixture-a"):
            os.kill(pid, signal.SIGTERM)
        target.wait(timeout=5)
        inherited.wait(timeout=5)
        assert all(process.poll() is None for process in [other_data, other_socket, overridden])
        assert matches(data, "fixture-a") == set()
        print("=== uninstall-scope check: 0 FAIL, 0 WARN; exact data/socket identity, argv precedence and concurrent instance preservation checked ===")
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=5)
