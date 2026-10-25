export interface ArwFontConfig {
    font?: unknown
    fallbackFont?: unknown
    fontSize?: unknown
    linePadding?: unknown
    lineHeight?: unknown
}

const DEFAULT_SIZE = 14
const MIN_SIZE = 7
const MAX_SIZE = 32
const DEFAULT_FONT_SIZE = 12

export function terminalFont (terminal?: ArwFontConfig): {family:string; size:number; height:number} {
    const families = typeof terminal?.font === 'string'
        ? terminal.font.split(',').map(font => font.trim().replace(/^["']|["']$/g, ''))
            .filter(font => font && font.toLocaleLowerCase() !== 'monospace')
        : []
    if (typeof terminal?.fallbackFont === 'string' && terminal.fallbackFont.trim()) families.push(terminal.fallbackFont.trim())
    families.push('monospace')
    const configured = Number(terminal?.fontSize)
    const size = Number.isFinite(configured) && configured > 0
        ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, configured))
        : DEFAULT_SIZE
    const lineHeight = Number(terminal?.lineHeight)
    const linePadding = Number(terminal?.linePadding)
    const paddingHeight = Number.isFinite(linePadding) && linePadding > 0 ? linePadding * 2 / size : 0
    return {
        family: [...new Set(families)].map(font => /^[A-Za-z0-9 _.-]+$/.test(font) ? `"${font}"` : font).join(', '),
        size: Math.max(MIN_SIZE, size - 2),
        height: Math.max(1.1, Math.min(2, Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1.45 + paddingHeight)),
    }
}

export function applyArwFont (host: HTMLElement | undefined, terminal?: ArwFontConfig): void {
    if (!host) return
    const font = terminalFont(terminal)
    host.style.setProperty('--arw-font-family', font.family)
    host.style.setProperty('--arw-font-size', `${font.size}px`)
    host.style.setProperty('--arw-line-height', String(font.height))
}

function scaledSize (pixels: number): string {
    const difference = pixels - DEFAULT_FONT_SIZE
    if (!difference) return `var(--arw-font-size,${DEFAULT_FONT_SIZE}px)`
    return `calc(var(--arw-font-size,${DEFAULT_FONT_SIZE}px) ${difference > 0 ? '+' : '-'} ${Math.abs(difference)}px)`
}

function scaledFamily (family: string): string {
    const value = family.trim()
    if (value === 'monospace' || value === 'inherit') return `var(--arw-font-family,${value})`
    return value
}

/** Keeps existing compact CSS sizes while making them relative to Tabby's terminal font size. */
export function scaleTypography (css: string): string {
    return css
        .replace(/font-size:(\d+(?:\.\d+)?)px(!important)?/g, (_, size:string, important:string|undefined) =>
            `font-size:${scaledSize(Number(size))}${important ?? ''}`)
        .replace(/font-family:monospace/g, 'font-family:var(--arw-font-family,monospace)')
        .replace(/font-family:inherit/g, 'font-family:var(--arw-font-family,inherit)')
        .replace(/line-height:1\.45/g, 'line-height:var(--arw-line-height,1.45)')
        .replace(/font:((?:\d+\s+)?)(\d+(?:\.\d+)?)px(\/[\d.]+)?\s+([^;{}]+)/g,
            (_:string, weight:string, size:string, height:string|undefined, family:string) =>
                `font:${weight}${scaledSize(Number(size))}${height ?? ''} ${scaledFamily(family)}`)
}
