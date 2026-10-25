# ai-workspace-manager for Tabby

[简体中文](README.md) | [English](README.en.md)

在 Tabby 侧栏管理本地与远程工作区：浏览和编辑文件、上传下载、预览内容、操作 Git，并启动 Codex、Claude 等本机 AI CLI，通过已有 SSH 连接开发远程项目。

插件：`tabby-ai-workspace-manager` · CLI：`arw` · 版本：`0.1.0`

[界面预览](docs/images/demo.png)

## 安装

验证环境：Tabby 1.0.238、Node.js 22+、npm、Git。AI CLI 需另行安装并登录。

1. 从 [GitHub Releases](https://github.com/SupremeJulyan/tabby-ai-workspace-manager/releases/tag/v0.1.0) 下载 `tabby-ai-workspace-manager-0.1.0.tgz`。
2. 在 Tabby 中打开 **Settings → Plugins → Open Plugins Directory**，进入该目录执行：

   ```sh
   npm install --omit=dev --legacy-peer-deps /absolute/path/to/tabby-ai-workspace-manager-0.1.0.tgz
   ```

3. 完全退出并重新启动 Tabby。

Linux/macOS 安装或首次加载时自动创建 `~/.local/bin/arw`；需要时为 Bash、Zsh、fish 配置 PATH，兼容已有 Bash 登录配置。Windows 在 `%USERPROFILE%\.tabby-ai-workspace-manager\bin` 安装 `arw.cmd`，并按需加入当前用户 PATH，不要求管理员或符号链接权限。重启 Tabby 后新终端生效。从 Tabby 插件管理器卸载时只删除本插件创建的命令和 PATH 配置，不覆盖已有命令。命令行手动卸载前，可在已安装插件目录运行 `npm run uninstall:cli`。

## 快速开始

1. 打开本地终端或连接 SSH，侧栏自动显示对应工作区。
2. 浏览到项目目录，点击工作区标题旁的 **+** 保存。
3. 在 **Tabby 设置 → ai-workspace-manager** 中配置 `codex`、`claude` 等 AI CLI 命令。
4. 点击已保存工作区旁的 **AI**，启动与该项目关联的 AI 终端。

## 工作区与文件

- 跟随当前终端切换本地、远程工作区，记忆每个标签页的浏览目录、展开状态和 Git 视图。
- 单击目录箭头展开，双击目录进入；路径栏支持目录补全，定位按钮可跟随终端当前目录。
- 拖动侧栏边缘调整宽度，字体与颜色跟随 Tabby 设置。
- 将本机文件或目录拖到远程目录行上传；拖到空白处则上传到当前目录。右键远程文件或目录可下载。传输需提供 SFTP，同名目标不会自动覆盖。
- 插件操作立即更新文件树；本地监听当前查看的目录，远端每 5 秒检查目录元数据。后台检测有范围限制，未查看的深层变更可手动刷新。

UTF-8 文本编辑上限为 10 MiB。保存检查外部修改，原地写入并保留权限、ACL 和扩展属性；远程编辑拒绝符号链接和硬链接目标，依赖 GNU `realpath`、`stat`、`sha256sum` 等工具。

文本页支持查找与替换：`Ctrl/Cmd+F` 查找、`Ctrl/Cmd+H` 替换，`F3` / `Shift+F3` 切换匹配，`Esc` 关闭；支持大小写、整词与正则。Markdown/CSV 预览查找时切到源码，替换时打开编辑页；替换只修改缓冲区，点击保存才写入文件。匹配超过 10000 项时禁用全部替换。

开启 Tabby 标签恢复后，编辑、预览和 Diff 文件页可在重启后恢复，文件页不显示工作区侧栏。远程文件通过按原 SSH 配置、主机、端口和用户隔离的文件会话池恢复：复用已认证连接，合并并发连接请求；原终端尚未显示时也可通过 Tabby 的认证流程建立文件会话，无需先切换终端标签。文件内容优先经 SFTP 读取，未提供 SFTP 时文本读取回退到 SSH shell；路径边界检查和保存冲突检查仍保留。关闭等待中的文件页会取消该页面的等待，不中断其他页面共用的连接。旧版本留下的空白标签没有文件路径，需重新打开。未保存编辑随标签状态保存在本机，恢复后仍检查文件冲突。

远程保存失败、超时或断线时保留本地编辑并标记“保存未确认”，远端可能已有部分内容。先核对远端或重新加载；覆盖重试需明确确认。未修改的已打开文件可随后台检测更新，未保存编辑不会被自动覆盖。

| 预览类型 | 功能 | 上限 |
| --- | --- | --- |
| PNG、JPEG、GIF、WebP、BMP、SVG、ICO、AVIF、TIFF | 缩放、适应窗口、切换同目录图片 | 32 MiB；TIFF 第一帧，最多 1600 万像素 |
| PDF | 翻页、跳页、缩放、密码输入 | 64 MiB |
| Markdown | 渲染 / 源码、工作区相对路径图片 | 2 MiB |
| CSV / TSV | 分隔符、表头、筛选、分页、源码 | 8 MiB；最多 10000 行、200 列 |

远程图片和 PDF 预览需提供 SFTP。

## Git

后台发现当前目录及子项目中的仓库。Git 视图支持：

- 查看变更及并排 / 统一差异，暂存、取消暂存、提交，确认后还原。
- 查看最近 50 条提交、上游同步状态，切换本地分支。
- 在当前目录初始化仓库，或通过本机 Git 克隆新项目。
- 本地仓库提取、快进拉取和推送；远程仓库通过本机网络与凭据中转拉取、推送，支持取消。

仓库发现最多 **2 层、60 个目录、10 个仓库、5000 个条目**，单目录最多 2000 条，限时 3 秒。Git 自动刷新至少间隔 5 秒，后台命令限时 3 秒、输出上限 256 KiB；超过 1000 项变更时提示进入具体项目后刷新。本地最多监听 32 个目录，不递归监听整棵目录树。

## AI 终端

设置页支持 AI CLI 命令、启动参数、恢复参数、HTTP/HTTPS 代理及环境变量。参数每行一项；环境变量每行写 `NAME VALUE`，值以明文保存在 Tabby 配置中，界面默认掩码显示。修改后重新打开 AI 终端生效。

Codex 恢复参数可填 `resume`、`--last`，Claude 可填 `--continue`。启动与恢复参数分别配置；配合 Tabby 标签恢复可继续会话。

同一标签页可打开多个 AI 终端，自动平铺，支持收起、恢复和关闭。AI 标题显示 `local->目录名` 或 `remote->目录名`，重名时补充上级目录。

本地 AI 在项目目录运行；远程 AI 使用 `awm/agent-cwd` 下的本地占位目录，通过 `AGENTS.md` 指引使用 `arw`。已保存的远程工作区自动开启转发；“AI 活动”显示经 ARW 执行的操作、状态与错误。

远程 **终端模式** 让 `arw exec` 在原交互终端运行，沿用当前用户、目录和已导出的环境变量。请在 shell 提示符下启用；此模式通过 shell 命令处理文件，不提供独立文件和批处理操作。终端目录改变后需重新同步并打开 AI 终端。

## ARW CLI

```sh
arw workspaces
arw list src --id ID
arw read README.md --head 40 --id ID
arw search TODO src --id ID
arw exec --id ID -- 'git status --short'
arw upload ./local-file path --id ID
arw download -r folder ./local-folder --id ID
arw git-pull --id ID
arw git-push --path subproject --id ID
```

先用 `arw workspaces` 找到目标，再为远程操作传入 `--id ID`。同一 AI 会话可以操作多个已转发工作区；上传命令先写本地路径、再写远程路径，下载命令相反，无需路径前缀。本地相对路径以 CLI 当前目录为起点。`git-pull` / `git-push` 等同于侧栏的“经本地拉取 / 推送”，默认操作工作区根目录，也可指定子项目路径；沿用当前分支的上游，拉取只允许快进，推送不强制覆盖。

运行 `arw --help` 查看读写、搜索、精确替换、创建、删除、移动、权限和批处理命令。`--input -` 从标准输入读取 JSON，`--file -` 读取文本；长命令输出可通过返回的 `outputId` 续读。

ARW 检查远程路径边界并拦截高危命令。审计记录位于 `<Tabby 配置目录>/omw/audit.jsonl`。自定义配置目录使用 `TABBY_CONFIG_DIRECTORY`。

## 开发与打包

```sh
npm ci
npm run check          # 构建并运行全部测试
npm run test:portable  # 构建后运行跨平台本机测试
npm run pack:plugin    # 生成 artifacts/tabby-ai-workspace-manager-0.1.0.tgz
npm run dev -- /opt/Tabby/tabby
```

开发模式使用独立的 userData 和插件目录。实现细节见 [架构说明](docs/architecture.md)。

CI 矩阵覆盖 Linux、macOS、Windows 的 Node.js 22 / 24：Linux 执行全部测试，三平台均执行原生 Git、路径、CLI 生命周期、IPC、文件恢复、搜索替换和打包预览测试。Linux shell/GNU 工具的远端测试仍在 Linux 上运行，不通过 Git Bash 冒充 Windows 本地 Git。该矩阵针对本机 Tabby；SSH 远端仍需满足前述 POSIX/GNU 工具要求，不代表支持 Windows 远端。未运行的 CI 不作为实机验证结果。

## License

[MIT](LICENSE)
