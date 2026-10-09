#!/usr/bin/env python3
"""Supervise the private manual-dev units; preserve the existing owned route recovery."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

DATA = Path.home() / '.local/share/panel-dev'
BACKEND = 'parthenon-dev-manual.service'
TERMINALS = 'parthenon-dev-tmux.service'
SOCKET = 'panel-dev-manual'
ENV = {**os.environ, 'XDG_RUNTIME_DIR': f'/run/user/{os.getuid()}',
       'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{os.getuid()}/bus'}


def ctl(*args):
    return subprocess.check_output(['systemctl', '--user', *args], env=ENV, text=True).strip()


def unit_identity(unit, memory, cpu):
    pid = int(ctl('show', unit, '-p', 'MainPID', '--value'))
    if pid <= 0:
        raise RuntimeError(f'{unit}: no live main process')
    group = Path(f'/proc/{pid}/cgroup').read_text().strip().split('0::')[-1]
    base = Path('/sys/fs/cgroup') / group.lstrip('/')
    if not group.startswith('/user.slice/') or not group.endswith('/' + unit):
        raise RuntimeError(f'{unit}: unexpected process group')
    if base.joinpath('memory.max').read_text().strip() != str(memory) or base.joinpath('cpu.max').read_text().strip() != cpu:
        raise RuntimeError(f'{unit}: kernel resource limits differ')
    return pid, group


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['ensure-published', 'restart', 'status'])
    action = p.parse_args().action
    # A frozen copy of the existing launcher supplies health, PID recording and
    # precisely its pre-existing route recovery. No checkout code is executed.
    spec = importlib.util.spec_from_file_location('legacy', DATA / 'bin/panel-dev-route.py')
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    with (DATA / 'control.lock').open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == 'status':
            print(json.dumps({'backend': ctl('show', BACKEND, '-p', 'ActiveState', '--value'),
                              'terminals': ctl('show', TERMINALS, '-p', 'ActiveState', '--value')}))
            return
        if action == 'ensure-published' and not legacy.publication_enabled():
            return
        # Refuse to adopt a foreign process or socket. Starting a unit is
        # idempotent; restarting tmux would destroy sessions and is never done.
        tmux_pid = ctl('show', TERMINALS, '-p', 'MainPID', '--value')
        probe = subprocess.run(['/usr/bin/tmux', '-N', '-L', SOCKET, 'display-message', '-p', '#{pid}'], capture_output=True, text=True)
        if probe.returncode == 0 and probe.stdout.strip() != tmux_pid:
            raise RuntimeError('The dedicated tmux socket belongs to another process')
        current = legacy.running()
        backend_pid = ctl('show', BACKEND, '-p', 'MainPID', '--value')
        if current and str(current['pid']) != backend_pid:
            raise RuntimeError('An earlier dev backend still owns this port')
        ctl('start', TERMINALS)
        tp, tg = unit_identity(TERMINALS, 768 * 1024**2, '75000 100000')
        ctl('restart' if action == 'restart' else 'start', BACKEND)
        bp, bg = unit_identity(BACKEND, 256 * 1024**2, '25000 100000')
        if tg == bg:
            raise RuntimeError('Backend must not share the terminal process group')
        identity = legacy.identity(bp)
        if not identity or identity['command'][0] != str(DATA / 'bin/parthenon-dev') or '--development-terminal' not in identity['command'] or '--workflow-execute' in identity['command']:
            raise RuntimeError('Unexpected dev backend identity')
        legacy.private_json(DATA / 'process.json', identity)
        for attempt in range(50):
            try:
                legacy.healthy()
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('Dev backend did not become ready')
        # Same route ID, address, ETag checks and scope as the prior watchdog.
        legacy.reconcile_route(True)
        print(json.dumps({'backend_pid': bp, 'tmux_pid': tp, 'manual': True, 'workflow_execute': False}))


if __name__ == '__main__':
    main()
