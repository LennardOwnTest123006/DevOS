# </> DevOS - the operating system for developers

A bootable developer workstation (live USB / ISO, based on Ubuntu 24.04 LTS) that starts straight into **DevOS**:
a code editor with colours and red error underlines, a real terminal, one-key **Run** for every major language,
a **Custom Maker** (project templates, your own languages and run commands), settings, Wi-Fi/LAN tools, USB export
and an open-source web browser. Nothing is installed to your disks - you boot it from a USB stick and go back to
Windows or Linux by removing the stick and rebooting.

| | |
| --- | --- |
| Editor | Monaco (the VS Code editor): syntax colours for 70+ languages, autocomplete, multi-tabs, search, autosave |
| Red underlines | real compilers/interpreters check your code while you type: Python, C, C++, Java, Go, Rust, PHP, Ruby, Lua, Perl, Bash, Node.js (+ built-in TypeScript/JS/JSON/CSS/HTML) |
| Run (F5) | JavaScript/Node, TypeScript, Python, C, C++, Java, Go, Rust, PHP, Ruby, Lua, Perl, Bash, SQL, HTML preview, Markdown preview, project commands (`make`, `cargo run`, `go run .`) |
| Terminal | full PTY shell (bash), many tabs, 10 000 lines scrollback |
| Custom Maker | 15 project templates, save any folder as your own template, add your own language + run command |
| Settings | theme (follows system light/dark), fonts, tab size, autosave, checker delay, run profiles |
| Network | Ethernet automatic, Wi-Fi scan/connect, share a folder on the LAN, browser (GNOME Web) |
| USB | export projects to a stick, write ISOs safely (`devos-usb`), eject safely |
| Safety | live system, internal disks never mounted, token-protected local server, firewall, signed Secure-Boot chain |

## 1. Get the ISO

`DevOS.iso` + `DevOS.iso.sha256` come from the build (`dist/`) or the *Build DevOS ISO* GitHub Action (Releases/Artifacts).
**Check it before using it** (this also proves the download is not damaged):

```bash
sha256sum -c DevOS.iso.sha256                       # Linux
shasum -a 256 -c DevOS.iso.sha256                   # macOS
Get-FileHash .\DevOS.iso -Algorithm SHA256          # Windows PowerShell - compare with the .sha256 file
```

## 2. Put it on a USB stick (8 GB or more, it will be ERASED)

### From Windows
1. Download **Rufus** (https://rufus.ie) or **balenaEtcher** (https://etcher.balena.io).
2. Rufus: select `DevOS.iso` -> **Partition scheme: GPT** (UEFI) -> *Start* -> when asked choose **"Write in DD Image mode"**.
   Etcher: *Flash from file* -> `DevOS.iso` -> select the stick -> *Flash*.
3. Or without extra software, in an **Administrator** PowerShell it is easiest to use Rufus/Etcher; raw `dd` is not built into Windows.

### From Linux
```bash
lsblk                                            # find the stick, e.g. /dev/sdb  (the WHOLE disk, not sdb1)
sudo ./tools/devos-usb flash DevOS.iso /dev/sdX  # checks the device, asks you to type it again, then writes
sudo ./tools/devos-usb verify DevOS.iso /dev/sdX # optional: compare stick and ISO
# plain dd alternative:
sudo dd if=DevOS.iso of=/dev/sdX bs=4M status=progress conv=fsync && sync
```

### From macOS (Intel Macs only - DevOS is x86-64)
```bash
diskutil list                                    # find the stick, e.g. /dev/disk4
diskutil unmountDisk /dev/disk4
sudo dd if=DevOS.iso of=/dev/rdisk4 bs=4m && sync
diskutil eject /dev/disk4
```

### Files-to-files / no USB
* Put `DevOS.iso` on **Ventoy** (https://ventoy.net): copy the ISO onto the Ventoy stick like a normal file - it boots from the menu and the stick stays usable for other files.
* **Virtual machine** (test without rebooting):
  ```bash
  qemu-system-x86_64 -m 4G -smp 2 -enable-kvm -cdrom DevOS.iso -boot d                 # BIOS
  qemu-system-x86_64 -m 4G -smp 2 -enable-kvm -cdrom DevOS.iso -boot d -bios /usr/share/ovmf/OVMF.fd   # UEFI
  VBoxManage createvm --name DevOS --ostype Ubuntu_64 --register && VBoxManage modifyvm DevOS --memory 4096 --cpus 2 --firmware efi --graphicscontroller vmsvga --vram 64
  VBoxManage storagectl DevOS --name SATA --add sata && VBoxManage storageattach DevOS --storagectl SATA --port 0 --device 0 --type dvddrive --medium DevOS.iso && VBoxManage startvm DevOS
  ```
  (VMware / Hyper-V Gen 2 / UTM-on-Intel: create a 64-bit Linux VM, 4 GB RAM, attach the ISO, EFI on.)

## 3. Boot it

Plug in the stick, restart, and open the boot menu: usually **F12** (Dell/Lenovo/ThinkPad), **F9/Esc** (HP), **F8/F12** (ASUS/Acer), **F10/F12** (MSI/Gigabyte), **Option (⌥)** on Intel Macs. Pick the USB entry (`UEFI: ...`).
Secure Boot can stay **on** (Ubuntu's signed shim + GRUB + kernel). If a PC refuses, turn Secure Boot off for the test.

Boot menu entries: *start* · *German keyboard* · *safe graphics* (`nomodeset`, if the screen stays black) · *load into RAM* (then you may remove the stick) · *persistence* · *reboot into firmware setup*.
Login is automatic (user `dev`, passwordless `sudo` in the live session).

## 4. Switch back to Windows / Linux ("change from this to that")

DevOS runs entirely from the stick and RAM - **your Windows or Linux installation is not changed**.
* Shut down or reboot, **remove the stick** -> your normal system starts again. Nothing to repair.
* From inside DevOS: right-click desktop -> *Reboot to firmware / boot menu*, or `devos-menu firmware`. That opens the UEFI boot menu where you choose *Windows Boot Manager*, your Linux disk or the stick.
* Windows "Fast Startup", BitLocker and hibernation are untouched. To read Windows files from DevOS: `sudo mount -o ro /dev/nvme0n1p3 /mnt` (read-only; find the partition with `lsblk -f`). BitLocker drives stay locked.
* Keep your work: **export to another USB stick** (DevOS -> USB & export, or `devos-usb export ~/project`), copy over the LAN (Network -> share, `scp`), `git push`, or use **persistence** below.
* Want to try both OSes on one stick: use Ventoy and keep several ISOs on it.

### Optional persistence (keep files/settings on the stick)
Create a second partition on the stick, label it `casper-rw` (`sudo mkfs.ext4 -L casper-rw /dev/sdX3`), choose the *persistence* boot entry.

## 5. Using DevOS

* **Explorer** (left): right-click for new/rename/delete/download/export/share. Drop files from a file manager to upload. Menu *File -> Open folder*.
* **Editor**: colours for the language, red/yellow underlines while you type (hover for the message), *Problems* tab lists everything. `F1` = command palette, `Ctrl+Space` = completions.
* **Run** (`F5`): saves and runs in the bottom terminal (interactive). "Run as" selects a language manually. HTML/Markdown open in **Web** preview. A folder with `.devos.json` (made by templates) runs its project command.
* **Custom Maker** (pencil icon): new project from a template; *Run profiles* edit what Run does per language; *Add your own language* (extension + colours + command, e.g. Zig: `zig run {file}`); right-click a folder -> *Save as Maker template*.
* **Wi-Fi/LAN** (antenna icon): scan, connect, share a folder, see your IP.
* **Browser**: *Browser* button / `Super+B` opens GNOME Web (open source, WebKit) for the internet, LAN, localhost. *Web* is a small preview browser inside DevOS for your dev servers.
* **Install more**: `devos-install-lang kotlin`, `sudo apt install ...`. See `docs/COMMANDS.md`.

Preinstalled: Node.js 22 + npm + TypeScript + tsx, Python 3 + pip + venv, GCC/G++/gdb/valgrind/cmake/make/ninja, Java (OpenJDK), Go, Rust + Cargo, PHP, Ruby, Lua, Perl, SQLite, Git, curl, jq, ripgrep, tmux, shellcheck, and more (`devos-info`).

## 6. Security model (read this)

* The DevOS server listens on `127.0.0.1` only; every request needs the access token (stored `~/.devos/token`, mode 600) and a matching `Host`/`Origin` - no remote page can use your terminal.
* The terminal *is* a shell - treat the token like a password. LAN mode is opt-in (`DEVOS_HOST=0.0.0.0 devos start`) and printed with a warning.
* Firewall (nftables) drops all incoming traffic except replies, DHCP, ping and the share ports 8000-8999 from private networks.
* Internal disks are not mounted automatically; `devos-usb flash` refuses non-removable disks and the stick it booted from, and requires typing the device name.
* File saves are atomic (temp file + rename). Wi-Fi MAC addresses are randomised.
* The live session has passwordless sudo - that is why it is a *live* system: reboot and it is gone. Do not use the ISO as a permanent server.
* Verify the ISO checksum. Build it yourself with `iso/build.sh` if you want to audit everything - all sources are in this repository.

## 7. Repository layout

```
app/        DevOS (Node.js server, zero npm runtime dependencies; Monaco + xterm.js vendored for offline use)
iso/        build.sh, package list, GRUB menu, overlay (autologin, X session, firewall, CLI tools)
tools/      devos-usb (use it on any Linux to flash the ISO)
docs/       COMMANDS.md
```
Design: UI follows Apple's Human Interface Guidelines (semantic colours, one accent, system light/dark, glass only on the bar,
keyboard-first, 28 px minimum targets, reduced-motion/transparency/contrast support).
