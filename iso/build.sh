#!/usr/bin/env bash
# Builds DevOS.iso (hybrid BIOS + UEFI incl. Secure Boot via Ubuntu's signed shim/grub).
# Run on Ubuntu/Debian as root:   sudo ./iso/build.sh        (needs ~15 GB free, internet, ~30-60 min)
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"; REPO="$(dirname "$HERE")"
WORK="${WORK:-/var/tmp/devos-build}"
OUT="${OUT:-$REPO/dist}"
VERSION="${DEVOS_VERSION:-1.0}"
MIRROR="${MIRROR:-http://archive.ubuntu.com/ubuntu}"
SUITE=noble
XZ_LEVEL="${XZ_LEVEL:-xz}"           # use XZ_LEVEL="zstd -Xcompression-level 9" for a faster, bigger build
C="$WORK/chroot"
ISO="$WORK/iso"
: "${WORK:?}" "${C:?}" "${ISO:?}"
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

log() { printf '\n\e[1;32m==> %s\e[0m\n' "$*"; }
umount_all() { for m in dev/pts dev proc sys run; do umount -lf "$C/$m" 2>/dev/null || true; done; }
trap umount_all EXIT

log "Host tools"
need=(debootstrap squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin mtools dosfstools shim-signed grub-efi-amd64-signed)
command -v npm >/dev/null || { echo 'npm (Node.js >= 18) is required on the build host'; exit 1; }
missing=(); for p in "${need[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
[ ${#missing[@]} -eq 0 ] || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"; }

log "DevOS app (npm + vendor libs)"
if [ ! -f "$REPO/app/public/vendor/monaco/vs/loader.js" ]; then
  (cd "$REPO/app" && npm install --no-audit --no-fund && npm run vendor)
fi

mkdir -p "$WORK" "$OUT"
if [ ! -f "$C/etc/os-release" ]; then
  log "debootstrap $SUITE"
  debootstrap --variant=minbase --arch=amd64 --include=ca-certificates,gnupg "$SUITE" "$C" "$MIRROR"
fi

log "Mount chroot"
umount_all
mount -t proc proc "$C/proc"; mount -t sysfs sys "$C/sys"; mount --bind /dev "$C/dev"; mount --bind /dev/pts "$C/dev/pts"
cp /etc/resolv.conf "$C/etc/resolv.conf"
cat > "$C/etc/apt/sources.list" <<APT
deb $MIRROR $SUITE main universe multiverse restricted
deb $MIRROR $SUITE-updates main universe multiverse restricted
deb http://security.ubuntu.com/ubuntu $SUITE-security main universe multiverse restricted
APT
rm -f "${C:?}"/etc/apt/sources.list.d/* 2>/dev/null || true
echo devos > "$C/etc/hostname"
printf '#!/bin/sh\nexit 101\n' > "$C/usr/sbin/policy-rc.d"; chmod +x "$C/usr/sbin/policy-rc.d"   # no daemons started while building
cp "$HERE/packages.txt" "$C/tmp/packages.txt"

log "Install packages (this is the long step)"
cat > "$C/tmp/stage1.sh" <<'IN'
set -e
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
apt-get update
apt-get install -y --no-install-recommends casper initramfs-tools
sed -i 's/^MODULES=.*/MODULES=most/' /etc/initramfs-tools/initramfs.conf
grep -v '^\s*#' /tmp/packages.txt | grep -v '^\s*$' | xargs apt-get install -y --no-install-recommends
apt-get install -y --no-install-recommends linux-image-generic linux-firmware
IN
chroot "$C" bash /tmp/stage1.sh

log "Node.js 22 LTS (official build from nodejs.org, checksum verified) + typescript, tsx"
NODE_BASE="https://nodejs.org/dist/latest-v22.x"
NODE_TAR="$(curl -fsSL "$NODE_BASE/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/{print $2}')"
curl -fsSL "$NODE_BASE/SHASUMS256.txt" | grep " $NODE_TAR\$" > "$WORK/node.sha"
[ -f "$WORK/$NODE_TAR" ] || curl -fsSL -o "$WORK/$NODE_TAR" "$NODE_BASE/$NODE_TAR"
(cd "$WORK" && sha256sum -c node.sha)
tar -xJf "$WORK/$NODE_TAR" -C "$C/usr/local" --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
NPMG="$WORK/npm-global"; rm -rf "${NPMG:?}"; mkdir -p "$NPMG"
npm install -g --prefix "$NPMG" --no-audit --no-fund typescript tsx          # on the host (pure JS + esbuild binary)
cp -a "$NPMG/lib/node_modules/." "$C/usr/local/lib/node_modules/"
for b in tsc tsx; do ln -sf "../lib/node_modules/$( [ $b = tsx ] && echo tsx/dist/cli.mjs || echo typescript/bin/$b )" "$C/usr/local/bin/$b"; done
chroot "$C" bash -c 'node --version && tsc --version && tsx --version | head -1'

log "Install DevOS app + overlay"
rm -rf "${C:?}/opt/devos"; mkdir -p "$C/opt/devos"
tar -C "$REPO/app" --exclude=node_modules --exclude='*.devos-tmp-*' -cf - . | tar -C "$C/opt/devos" -xf -
cp -a "$HERE/overlay/." "$C/"
chmod 755 "$C"/usr/local/bin/*
chroot "$C" env VERSION="$VERSION" bash -c '
  set -e
  locale-gen en_US.UTF-8 de_DE.UTF-8 >/dev/null; update-locale LANG=en_US.UTF-8
  printf "%s\n" "kernel.apparmor_restrict_unprivileged_userns=0" "kernel.unprivileged_bpf_disabled=1" "net.ipv4.conf.all.rp_filter=1" > /etc/sysctl.d/99-devos.conf
  systemctl enable devos.service nftables.service NetworkManager.service >/dev/null
  systemctl mask apt-daily.timer apt-daily-upgrade.timer motd-news.timer >/dev/null 2>&1 || true
  echo "DevOS $VERSION" > /etc/devos-release
  sed -i "s/^PRETTY_NAME=.*/PRETTY_NAME=\"DevOS $VERSION (Ubuntu 24.04 base)\"/" /etc/os-release
  update-initramfs -c -k all
'

log "Clean chroot"
KVER="$(ls "$C/boot" | sed -n 's/^vmlinuz-//p' | sort -V | tail -1)"
chroot "$C" apt-get clean
rm -rf "${C:?}"/var/lib/apt/lists/* "${C:?}"/tmp/* "${C:?}"/root/.npm "${C:?}/usr/sbin/policy-rc.d"
: > "$C/etc/machine-id"; rm -f "$C/var/lib/dbus/machine-id"
umount_all

log "Assemble ISO tree (kernel $KVER)"
rm -rf "${ISO:?}"; mkdir -p "$ISO"/{casper,boot/grub/i386-pc,EFI/boot,.disk}
cp "$C/boot/vmlinuz-$KVER" "$ISO/casper/vmlinuz"
cp "$C/boot/initrd.img-$KVER" "$ISO/casper/initrd"
chroot "$C" dpkg-query -W --showformat='${Package} ${Version}\n' > "$ISO/casper/filesystem.manifest" 2>/dev/null || true
echo "DevOS $VERSION - Ubuntu 24.04 base amd64" > "$ISO/.disk/info"
touch "$ISO/.disk/base_installable"
cp "$HERE/grub/grub.cfg" "$ISO/boot/grub/grub.cfg"
mkdir -p "$ISO/boot/grub/fonts"; cp /usr/share/grub/unicode.pf2 "$ISO/boot/grub/fonts/unicode.pf2"

log "SquashFS - slow but small"
if [ "$XZ_LEVEL" = xz ]; then COMP=(-comp xz -b 1M -Xbcj x86); else COMP=(-comp ${XZ_LEVEL}); fi
SQ="$WORK/filesystem.squashfs"
if [ "${REUSE_SQUASH:-0}" = 1 ] && [ -f "$SQ" ]; then echo "reusing $SQ"; else
  mksquashfs "$C" "$SQ" -noappend "${COMP[@]}" -wildcards \
    -e 'boot/vmlinuz*' -e 'boot/initrd.img*' -e proc/* -e sys/* -e dev/* -e run/* -e tmp/* 2>&1 | tail -3
fi
cp "$SQ" "$ISO/casper/filesystem.squashfs"
printf '%s' "$(du -sx --block-size=1 "$C" | cut -f1)" > "$ISO/casper/filesystem.size"

log "Boot loaders (BIOS + UEFI/Secure Boot)"
cp /usr/lib/grub/i386-pc/*.mod /usr/lib/grub/i386-pc/*.lst "$ISO/boot/grub/i386-pc/" 2>/dev/null || true
grub-mkimage -O i386-pc -o "$WORK/core.img" -p /boot/grub biosdisk iso9660 part_gpt part_msdos fat normal configfile search search_fs_file linux echo ls all_video gfxterm
cat /usr/lib/grub/i386-pc/cdboot.img "$WORK/core.img" > "$ISO/boot/grub/i386-pc/eltorito.img"
# EFI system partition image: signed shim -> signed grub -> finds the ISO and loads /boot/grub/grub.cfg
EFI="$WORK/efi.img"; rm -f "$EFI"; truncate -s 8M "$EFI"; mkfs.vfat -n DEVOS_EFI "$EFI" >/dev/null
mmd -i "$EFI" ::EFI ::EFI/boot ::EFI/ubuntu ::boot ::boot/grub
mcopy -i "$EFI" /usr/lib/shim/shimx64.efi.signed.latest ::EFI/boot/BOOTx64.EFI
mcopy -i "$EFI" /usr/lib/shim/mmx64.efi ::EFI/boot/mmx64.efi
mcopy -i "$EFI" /usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed ::EFI/boot/grubx64.efi
cat > "$WORK/efi-grub.cfg" <<'CFG'
search --no-floppy --set=root --file /casper/vmlinuz
set prefix=($root)/boot/grub
configfile ($root)/boot/grub/grub.cfg
CFG
mcopy -i "$EFI" "$WORK/efi-grub.cfg" ::boot/grub/grub.cfg
mcopy -i "$EFI" "$WORK/efi-grub.cfg" ::EFI/boot/grub.cfg
mcopy -i "$EFI" "$WORK/efi-grub.cfg" ::EFI/ubuntu/grub.cfg
# Ubuntu's signed GRUB looks for (boot device)/EFI/ubuntu/grub.cfg - also provide it on the ISO filesystem itself
mkdir -p "$ISO/EFI/ubuntu" "$ISO/EFI/boot"; cp "$WORK/efi-grub.cfg" "$ISO/EFI/ubuntu/grub.cfg"; cp "$WORK/efi-grub.cfg" "$ISO/EFI/boot/grub.cfg"
cp "$EFI" "$ISO/boot/grub/efi.img"

log "xorriso -> DevOS.iso"
ISOFILE="$OUT/DevOS-$VERSION-amd64.iso"; rm -f "$ISOFILE"
xorriso -as mkisofs -iso-level 3 -full-iso9660-filenames -joliet-long -r -V "DEVOS" \
  -o "$ISOFILE" \
  --grub2-mbr /usr/lib/grub/i386-pc/boot_hybrid.img -partition_offset 16 --mbr-force-bootable \
  -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b "$EFI" -appended_part_as_gpt \
  -iso_mbr_part_type a2a0d0ebe5b9334487c068b6b72699c7 \
  -c boot/boot.catalog -b boot/grub/i386-pc/eltorito.img -no-emul-boot -boot-load-size 4 -boot-info-table --grub2-boot-info \
  -eltorito-alt-boot -e '--interval:appended_partition_2:::' -no-emul-boot \
  "$ISO"
( cd "$OUT" && sha256sum "$(basename "$ISOFILE")" > "$(basename "$ISOFILE").sha256" && ln -sf "$(basename "$ISOFILE")" DevOS.iso && ln -sf "$(basename "$ISOFILE").sha256" DevOS.iso.sha256 )
log "DONE: $ISOFILE ($(du -h "$ISOFILE" | cut -f1))"; cat "$OUT/$(basename "$ISOFILE").sha256"
