export const SCROLLBAR_STYLES = `
arw-tree,arw-tree *,arw-editor,arw-editor *,arw-preview,arw-preview *,split-tab .xterm-viewport{scrollbar-width:thin;scrollbar-color:#7775 transparent}
split-tab .xterm .scrollbar>.slider{background:transparent!important}
split-tab .xterm .scrollbar>.slider::before{content:"";position:absolute;pointer-events:none;border-radius:999px;background:#7775}
split-tab .xterm .scrollbar.vertical>.slider::before{top:0;bottom:0;left:50%;width:6px;transform:translateX(-50%)}
split-tab .xterm .scrollbar.horizontal>.slider::before{left:0;right:0;top:50%;height:6px;transform:translateY(-50%)}
`
