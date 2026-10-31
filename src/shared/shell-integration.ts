export type RemoteShell = 'bash' | 'zsh' | 'fish';

/** Session-only hooks. Escape bytes are produced by printf, never printed as literal \\033. */
export function cwdIntegrationCommand(shell: RemoteShell): string {
  const report = String.raw`__arw_cwd(){ printf '\033]1337;CurrentDir=%s\007' "$PWD"; };`;
  if (shell === 'bash') return [report,
    'if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then',
    'case " ${PROMPT_COMMAND[*]} " in *" __arw_cwd "*) ;; *) PROMPT_COMMAND+=(__arw_cwd);; esac;',
    "else case \"${PROMPT_COMMAND-}\" in *__arw_cwd*) ;; *) PROMPT_COMMAND=\"${PROMPT_COMMAND-}\"$'\\n'__arw_cwd;; esac; fi;",
    '__arw_cwd',
  ].join(' ');
  if (shell === 'zsh') return [report,
    'typeset -ga precmd_functions;',
    'if (( ! ${precmd_functions[(Ie)__arw_cwd]} )); then precmd_functions+=(__arw_cwd); fi;',
    '__arw_cwd',
  ].join(' ');
  if (shell === 'fish') return String.raw`functions -e __arw_cwd; function __arw_cwd --on-event fish_prompt; printf '\033]1337;CurrentDir=%s\007' "$PWD"; end; __arw_cwd`;
  throw new Error('Unsupported shell');
}
