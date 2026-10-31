import { t } from '../../shared/i18n'
export interface GitCommit { hash:string; shortHash:string; author:string; date:string; subject:string; syncStatus?:'unpushed'|'synced'|'incoming'|'pushed'|'pulled'|'unknown' }
export interface GitBranch { name:string; current:boolean }

const record = '\x1e', field = '\x1f'
export function parseGitHistory (output:string, limit = 50): GitCommit[] {
    const commits: GitCommit[] = []
    for (const part of output.split(record).filter(part => part.trim()).slice(0, limit)) {
        const values = part.trim().split(field)
        if (values.length !== 5 || !/^[0-9a-f]{40,64}$/i.test(values[0]) || !values[1]) throw new Error('Invalid Git history output')
        const subject = values[4].replace(/\x1d$/, '').trim()
        commits.push({hash:values[0], shortHash:values[0].slice(0, 8), author:values[1].slice(0, 200), date:values[2], subject:subject.slice(0, 500)})
    }
    return commits
}

export function parseGitBranches (output:string, current = ''): GitBranch[] {
    const branches: GitBranch[] = []
    for (const line of output.split(/\r?\n/)) {
        const name = line.trim()
        if (!name || name.startsWith('(') || branches.some(branch => branch.name === name)) continue
        branches.push({name, current:name === current})
    }
    return branches.sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name))
}

export function parseSwitchError (error:unknown):Error {
    const text = error instanceof Error ? error.message : String(error)
    if (/would be overwritten by checkout/i.test(text)) return new Error(t('切换分支会覆盖未提交的改动。请先提交或还原这些文件，再切换分支。'))
    if (/would be overwritten by merge/i.test(text)) return new Error(t('本地改动与目标分支冲突。请先提交或还原改动，再切换分支。'))
    return error instanceof Error ? error : new Error(text)
}
