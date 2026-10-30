import { extractEmbeddedCommands, matchHighRiskCommand } from './high-risk-commands'
import { remoteCommandBoundaryViolation, RemoteCommandBoundaryViolation } from './remote-command-boundary'

export class CommandPolicyError extends Error {}

export function commandBoundaryTargets (command: string, root: string): RemoteCommandBoundaryViolation[] {
    const targets: RemoteCommandBoundaryViolation[] = []
    for (const candidate of [command, ...extractEmbeddedCommands(command)]) {
        const boundary = remoteCommandBoundaryViolation(candidate, root, root, targets)
        if (boundary) throw new CommandPolicyError(`ARW denied an outside-workspace ${boundary.kind}`)
    }
    return targets
}

export function assertCommandAllowed (command: string, root: string): void {
    if (!command.trim() || command.includes('\0') || Buffer.byteLength(command) > 64 * 1024) throw new CommandPolicyError('Invalid or oversized remote command')
    const highRisk = matchHighRiskCommand(command)
    if (highRisk) throw new CommandPolicyError('ARW denied a high-risk command')
    commandBoundaryTargets(command, root)
}
