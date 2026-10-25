import { t } from '../shared/i18n'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface AgentEnvironmentSource {
    name?: string
    value?: string
    file?: string
}

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export function parseAgentEnvironment (text: unknown): AgentEnvironmentSource[] {
    if (typeof text !== 'string') throw new Error(t('AI 终端环境变量配置无效'))
    const sources: AgentEnvironmentSource[] = []
    const names = new Set<string>()
    for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
        const match = /^(\S+)(?:[ \t]+(.*))?$/.exec(line)
        if (!match) throw new Error(t`环境变量格式应为 NAME VALUE：${line}`)
        const name = match[1]
        const value = match[2]?.trim() ?? ''
        if (!namePattern.test(name)) throw new Error(t`环境变量名称无效：${name}`)
        if (value === '***') throw new Error(t`环境变量 ${name} 的隐藏值请在设置页重新输入`)
        if (names.has(name)) throw new Error(t`环境变量重复：${name}`)
        names.add(name)
        if (!value) throw new Error(t`环境变量 ${name} 缺少值或密钥文件`)
        sources.push({ name, value })
    }
    return sources
}

export function agentEnvironment (sources: unknown, home = homedir()): Record<string,string> {
    if (sources === undefined || sources === null) return {}
    if (!Array.isArray(sources)) throw new Error(t('AI 终端环境变量配置无效'))
    const env: Record<string,string> = {}
    for (const source of sources as AgentEnvironmentSource[]) {
        if (!source || typeof source !== 'object') throw new Error(t('AI 终端环境变量配置无效'))
        const name = source.name?.trim() ?? ''
        if (!namePattern.test(name)) throw new Error(t`环境变量名称无效：${name || t('(空)')}`)
        if (name in env) throw new Error(t`环境变量重复：${name}`)
        if (source.value !== undefined && typeof source.value !== 'string') throw new Error(t`环境变量 ${name} 的配置无效`)
        if (source.file !== undefined && typeof source.file !== 'string') throw new Error(t`环境变量 ${name} 的配置无效`)
        const file = source.file?.trim() ?? ''
        const value = source.value ?? ''
        if (value && file) throw new Error(t`环境变量 ${name} 不能同时填写值和文件`)
        if (file) {
            const path = isAbsolute(file) ? file : join(home, file)
            let content: string
            try {
                const mode = statSync(path).mode
                if (process.platform !== 'win32' && (mode & 0o077) !== 0) throw new Error(t('文件权限过宽'))
                content = readFileSync(path, 'utf8')
            } catch (error) {
                throw new Error(t`无法读取环境变量 ${name} 的密钥文件 ${path}：${error instanceof Error ? error.message : String(error)}`)
            }
            env[name] = content.replace(/\r?\n$/, '')
            if (!env[name]) throw new Error(t`环境变量 ${name} 的密钥文件为空：${path}`)
        } else if (value) {
            env[name] = value
        } else {
            throw new Error(t`环境变量 ${name} 缺少值或密钥文件`)
        }
    }
    return env
}
