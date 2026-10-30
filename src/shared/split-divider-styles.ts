export const SPLIT_DIVIDER_STYLES = `
split-tab > split-tab-spanner,
split-tab > split-tab-spanner:hover,
split-tab > split-tab-spanner.active{background:transparent!important}
split-tab > split-tab-spanner::after{content:"";position:absolute;pointer-events:none;transition:width .12s,height .12s,background .12s;background:color-mix(in srgb,currentColor 10%,transparent)}
split-tab > split-tab-spanner.h::after{top:0;bottom:0;left:50%;width:1px;transform:translateX(-50%)}
split-tab > split-tab-spanner.v::after{left:0;right:0;top:50%;height:1px;transform:translateY(-50%)}
split-tab > split-tab-spanner:hover::after,
split-tab > split-tab-spanner.active::after{background:#73a9ed55}
split-tab > split-tab-spanner.h:hover::after,
split-tab > split-tab-spanner.h.active::after{width:5px}
split-tab > split-tab-spanner.v:hover::after,
split-tab > split-tab-spanner.v.active::after{height:5px}
`
