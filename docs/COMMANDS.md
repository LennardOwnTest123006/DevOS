# DevOS command reference

## Inside DevOS (live system)

| Command | What it does |
| --- | --- |
| `devos` | open the IDE (prints the URL + token) |
| `devos url` / `devos token` | print the login URL / token |
| `devos status` / `restart` / `stop` | control the DevOS server |
| `devos lan` | how to open DevOS from another PC (opt-in) |
| `devos-help` | list of all commands |
| `devos-info` | kernel, CPU, RAM, boot mode, installed toolchains |
| `devos-browser [url]` | open-source browser (GNOME Web / WebKit) |
| `devos-terminal` | extra terminal window |
| `devos-wifi` | interactive Wi-Fi connect (or `nmcli device wifi connect SSID password PASS`) |
| `devos-share DIR [port]` | read-only folder share for 30 min on the LAN (private ranges only) |
| `devos-usb list` | list disks / USB sticks |
| `sudo devos-usb flash FILE.iso /dev/sdX` | write an ISO to a USB stick (refuses internal disks, asks to confirm) |
| `sudo devos-usb verify FILE.iso /dev/sdX` | byte-compare stick and ISO |
| `devos-usb export DIR` | copy a folder as `.tar.gz` to the first USB stick |
| `devos-menu firmware` | reboot into the UEFI/BIOS boot menu (to go back to Windows / your Linux) |
| `devos-menu reboot` / `poweroff` | reboot / shut down |
| `devos-install-lang kotlin\|dotnet\|r\|julia\|haskell\|ocaml\|elixir\|scala\|dart` | install extra languages (internet needed) |
| `sudo apt update && sudo apt install PACKAGE` | install anything from the Ubuntu archive |

Shortcuts: `F5` run · `Ctrl+S` save · ``Ctrl+` `` terminal · `Ctrl+Shift+F` search · `F1` editor command palette ·
`Ctrl+Alt+T` extra terminal · `Super+B` browser · `Super+E` IDE.

## Run DevOS without the ISO (Windows, macOS, Linux)

```bash
cd app && npm install && npm run vendor && node server.js
# open the printed http://127.0.0.1:7777/?t=... link
```
Needs Node.js 18+ (and Python 3 for the terminal; on Windows use WSL for a full terminal).

## Build the ISO yourself

```bash
sudo ./iso/build.sh                       # Ubuntu/Debian host, ~15 GB free, internet
XZ_LEVEL="zstd -Xcompression-level 9" sudo ./iso/build.sh   # faster build, bigger ISO
```
Output: `dist/DevOS-1.0-amd64.iso` + `.sha256`. Or run the **Build DevOS ISO** GitHub Action.
