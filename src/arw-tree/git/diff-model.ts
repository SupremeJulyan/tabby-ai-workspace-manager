import { t } from '../../shared/i18n'
export interface DiffLine {
    kind: 'context'|'add'|'delete'|'note'
    text: string
    oldNumber?: number
    newNumber?: number
    noteSide?: 'old'|'new'|'both'
}
export interface DiffRow { old?: DiffLine; next?: DiffLine }
export interface DiffHunk { header: string; lines: DiffLine[]; rows: DiffRow[]; file?: string }
export interface DiffModel { hunks: DiffHunk[]; added: number; removed: number; binary: boolean; combined: boolean; metadata: string[] }

function splitRows (lines: DiffLine[]): DiffRow[] {
    const rows: DiffRow[] = []
    let offset = 0
    while (offset < lines.length) {
        const line = lines[offset]
        if (line.kind === 'note') {
            rows.push({old: line.noteSide === 'new' ? undefined : line, next: line.noteSide === 'old' ? undefined : line}); offset++; continue
        }
        if (line.kind === 'context') {
            rows.push({old: line, next: line}); offset++; continue
        }
        const deleted: DiffLine[] = [], added: DiffLine[] = []
        while (offset < lines.length && ['delete','add'].includes(lines[offset].kind)) {
            const changed = lines[offset++]
            if (changed.kind === 'delete') deleted.push(changed)
            else added.push(changed)
        }
        for (let index = 0; index < Math.max(deleted.length, added.length); index++) rows.push({old: deleted[index], next: added[index]})
    }
    return rows
}

export function parseDiff (patch: string): DiffModel {
    const model: DiffModel = {hunks: [], added: 0, removed: 0, binary: false, combined: false, metadata: []}
    let current: DiffHunk|undefined, oldNumber = 0, newNumber = 0, oldRemaining = 0, newRemaining = 0
    let fileHeader: string|undefined
    const lines = patch.split('\n')
    if (lines.length > 20_000) throw new Error(t('差异超过 20000 行，请使用终端查看或缩小比较范围。'))
    for (const raw of lines) {
        if (raw.startsWith('\\') && current) {
            const previous = current.lines.at(-1)
            current.lines.push({kind: 'note', text: t('文件末尾无换行'), noteSide: previous?.kind === 'delete' ? 'old' : previous?.kind === 'add' ? 'new' : 'both'}); continue
        }
        if (current && (oldRemaining > 0 || newRemaining > 0)) {
            const text = raw.slice(1).replace(/\r/g, '␍')
            if (raw.startsWith('+') && newRemaining > 0) {
                current.lines.push({kind: 'add', text, newNumber: newNumber++}); newRemaining--; model.added++; continue
            }
            if (raw.startsWith('-') && oldRemaining > 0) {
                current.lines.push({kind: 'delete', text, oldNumber: oldNumber++}); oldRemaining--; model.removed++; continue
            }
            if (raw.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
                current.lines.push({kind: 'context', text, oldNumber: oldNumber++, newNumber: newNumber++}); oldRemaining--; newRemaining--; continue
            }
            throw new Error(t('Git diff 内容不完整，无法可靠显示行号。'))
        }
        const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
        if (header) {
            oldNumber = Number(header[1]); newNumber = Number(header[3])
            oldRemaining = header[2] === undefined ? 1 : Number(header[2]); newRemaining = header[4] === undefined ? 1 : Number(header[4])
            current = {header: raw, lines: [], rows: [], ...(fileHeader ? {file:fileHeader} : {})}; model.hunks.push(current)
        } else if (raw.startsWith('diff --git ')) {
            fileHeader = raw.slice('diff --git '.length)
            current = undefined
        } else if (/^(?:Binary files |GIT binary patch)/.test(raw)) model.binary = true
        else if (/^(?:@@@|diff --cc |diff --combined )/.test(raw)) model.combined = true
        else if (/^(?:rename |copy |similarity index |new file$|(?:old|new|new file|deleted file) mode )/.test(raw)) model.metadata.push(raw)
    }
    if (oldRemaining || newRemaining) throw new Error(t('Git diff 内容不完整，无法可靠显示行号。'))
    for (const hunk of model.hunks) hunk.rows = splitRows(hunk.lines)
    return model
}

export function addedFilePatch (content: string): string {
    if (!content) return 'new file\n'
    const lines = content.split('\n')
    const newline = lines.at(-1) === ''
    if (newline) lines.pop()
    return `new file\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line=>`+${line}`).join('\n')}\n${newline ? '' : '\\ No newline at end of file\n'}`
}
