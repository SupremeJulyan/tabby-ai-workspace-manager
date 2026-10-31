/** Resolve the host default at launch time; do not persist a snapshot of it. */
export function defaultShell<T extends { id?: string }> (shells: T[], preferred: unknown): T | undefined {
    return shells.find(shell => typeof preferred === 'string' && shell.id === preferred)
        ?? shells.find(shell => shell.id === 'local:default')
}
