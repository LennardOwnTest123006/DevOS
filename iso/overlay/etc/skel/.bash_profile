# DevOS: start the graphical session automatically on tty1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -nolisten tcp vt1 >/tmp/startx.log 2>&1
fi
[ -f ~/.bashrc ] && . ~/.bashrc
