export const FILE_TOOLBAR_STYLES = `
:host{container-type:inline-size;min-width:0;overflow:hidden}
header{gap:clamp(4px,2cqw,10px);min-width:0}
header button{font-family:inherit;font-size:clamp(10px,3cqw,var(--arw-font-size,12px));line-height:1.4;padding:clamp(3px,1cqw,6px) clamp(5px,2cqw,10px);min-width:0;white-space:nowrap}
:host .file-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:clamp(26px,8cqw,32px);height:clamp(26px,8cqw,32px);padding:4px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;cursor:pointer;box-shadow:none}
:host .file-icon-button svg{display:block;width:18px;height:18px;flex:none}
:host .file-icon-button:hover:not(:disabled){background:#8882;border-color:#8884}
:host .file-icon-button:disabled{opacity:.35;cursor:default}
:host .file-icon-button:focus-visible{outline:1px solid currentColor;outline-offset:1px}
header .preview-actions{gap:clamp(4px,2cqw,8px)}
@container(max-width:320px){
    header{flex-wrap:wrap}
    .file-heading,.preview-heading{flex:1 1 100%}
    header>button{flex:0 1 auto}
    header .preview-actions{margin-left:auto;flex-wrap:wrap}
}
`
