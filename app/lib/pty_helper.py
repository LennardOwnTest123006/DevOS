#!/usr/bin/env python3
"""Tiny PTY bridge used by the DevOS terminal.

stdin  -> keystrokes for the shell
stdout <- shell output
fd 3   -> control lines, "R <cols> <rows>" resizes the terminal
No third-party modules: only the Python standard library.
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    shell = sys.argv[1]
    cwd = sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 80
    rows = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except OSError:
            pass
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        os.execvp(shell, [shell])
    set_size(fd, cols, rows)
    ctl = b""
    inputs = [0, fd]
    try:
        os.fstat(3)
        inputs.append(3)
    except OSError:
        pass
    alive = True
    while alive:
        try:
            r, _, _ = select.select(inputs, [], [])
        except InterruptedError:
            continue
        for s in r:
            if s == 0:
                data = os.read(0, 65536)
                if not data:
                    alive = False
                    break
                os.write(fd, data)
            elif s == fd:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    data = b""
                if not data:
                    alive = False
                    break
                os.write(1, data)
            elif s == 3:
                chunk = os.read(3, 4096)
                if not chunk:
                    inputs.remove(3)
                    continue
                ctl += chunk
                while b"\n" in ctl:
                    line, ctl = ctl.split(b"\n", 1)
                    p = line.split()
                    if len(p) == 3 and p[0] == b"R":
                        try:
                            set_size(fd, int(p[1]), int(p[2]))
                        except Exception:
                            pass
    try:
        os.kill(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, 0)
        sys.exit(os.waitstatus_to_exitcode(status))
    except ChildProcessError:
        sys.exit(0)


if __name__ == "__main__":
    main()
