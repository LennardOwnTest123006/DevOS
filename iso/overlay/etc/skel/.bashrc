# DevOS shell
case $- in *i*) ;; *) return;; esac
export LC_TIME=en_US.UTF-8   # 12-hour clock with AM/PM
export EDITOR=nano HISTCONTROL=ignoreboth PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"
export GOPATH="$HOME/go" npm_config_prefix="$HOME/.local"
alias ll='ls -alFh --color=auto' ls='ls --color=auto' grep='grep --color=auto' ..='cd ..'
PS1='\[\e[1;32m\]\u@devos\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
command -v devos-info >/dev/null && [ -z "$DEVOS_MOTD" ] && export DEVOS_MOTD=1 && devos-info --short
