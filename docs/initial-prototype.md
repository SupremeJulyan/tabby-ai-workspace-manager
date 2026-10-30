# 历史原型记录

本文记录独立插件拆分之前的状态，内容不是当前开发指南。当前构建与安装步骤见仓库 README.md。

# ARW Terminal

基于 Tabby 的独立终端项目。原 ARW VS Code 扩展保持独立。

## 已落地

- 复用 Tabby 的终端、SSH 连接、认证、主机密钥验证与 SFTP。
- `tabby-ai-workspace-manager`：SSH 标签右键绑定远程绝对路径，通过当前会话 SFTP 验证目录；连接销毁时解除绑定。
- `src/arw-tree/git`：迁入原 SAFS 的 Git 本地中转拉取/推送核心及其集成测试，剥离间接 VS Code 依赖。
- 不引入本地代码镜像、文件监听或双向同步。

## 当前边界

这是首轮开发基线，尚非完整产品。Git 中转核心尚未连接桌面菜单与 Tabby 命令通道；CLI/MCP 服务、工作区持久化、Agent 活动面板尚未接入。尚未完成桌面运行与安装包验证。

## 验证 Git 核心

```sh
npm ci
npm run build
npx tsx --test test/local-git-*.test.ts
```

## 桌面开发

遵循上游 HACKING.md 安装平台依赖和 Yarn，浅克隆需先运行 `git fetch upstream --unshallow --tags` 以满足上游版本脚本，然后运行 `yarn`、`yarn build`、`yarn start`。新模块已注册到内置插件构建列表。不要使用上游发布或更新凭据发布 ARW 产品；独立品牌、更新源与安装包配置需在发布阶段调整。

## 后续顺序

1. 构建并启动桌面，验证现有 SSH 会话绑定与失效处理。
2. 基于认证后的 Tabby 会话封装受限输出、取消与退出码明确的 exec/SFTP 适配器。
3. 将 Git 中转的 bundle 上传下载、命令执行和进度回调接到适配器，完成远端不出网的真实用例。
4. 迁入 CLI/MCP 服务，明确工作区 ID、连接生命周期及多客户端发现协议。
5. 增加 Agent 活动和文件编辑联动，再完成跨平台发布。

Tabby 的来源提交见 `git log`。本仓库保留 MIT 许可。
