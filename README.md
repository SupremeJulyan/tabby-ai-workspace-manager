# ai-workspace-manager for Tabby

[简体中文](README.md) | [English](README.en.md)

界面预览：[demo.png](docs/images/demo.png)

远程工作区提供与本地一致的文件浏览、编辑、预览和 Git 体验，并可随当前终端无缝切换。

在 Tabby 中统一管理本地与远程工作区，跟随当前终端无感切换：打开本地终端即浏览本地文件，切换到 SSH 终端即浏览对应服务器的文件，并恢复该标签页的目录与视图。

在同一个侧栏中浏览工作区、编辑文件、上传下载、预览内容和管理 Git，也可一键打开 AI 终端协助开发。本机运行的 Codex、Claude 等 AI CLI 可通过 Tabby 已连接的 SSH 会话操作远程工作区。

插件包：`tabby-ai-workspace-manager` · 命令行工具：`arw` · 版本：`1.0.0`

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 本地 / 远程无感切换 | 跟随当前终端自动切换工作区，恢复各标签页的浏览目录和视图 |
| 管理多个工作区 | 保存本地和远程工作区目录，一键切换工作区或打开对应 AI 终端 |
| 让 AI 操作远程工作区 | 本机 AI CLI 通过 `arw` 浏览、搜索、读写远程文件和执行命令 |
| 浏览和编辑文件 | 在侧栏展开目录、搜索文件名，打开文本文件编辑并保存 |
| 上传文件和目录 | 从本机拖入远程资源管理器，递归上传目录，并查看当前上传项或取消上传 |
| 下载远程文件和目录 | 右键选择下载，使用 Tabby 的保存对话框和传输进度 |
| 预览文件 | 查看图片、PDF、Markdown，以及可筛选和分页的 CSV/TSV 表格 |
| 管理 Git | 查看差异、暂存、提交、还原、切换分支、初始化或克隆仓库 |
| 同步 Git | 本地工作区直接提取、拉取和推送；远程工作区通过本机网络与凭据中转拉取和推送 |
| 管理 AI 会话 | 配置启动和恢复参数，多 AI 终端自动平铺，配合 Tabby 标签恢复继续会话 |
| 查看 AI 操作 | 在“AI 活动”中查看通过 ARW 执行的文件操作和命令，按工作区、类型和状态识别任务 |

## 安装

开发与验证环境：Node.js 22+、npm、Git、Tabby 1.0.238。

在插件源码目录构建安装包：

```sh
npm ci
npm run check
npm run pack:plugin
```

在 Tabby 中打开 **Settings → Plugins → Open Plugins Directory**，进入该目录执行：

```sh
npm install --omit=dev --legacy-peer-deps /absolute/path/to/artifacts/tabby-ai-workspace-manager-1.0.0.tgz
```

完全退出并重新启动 Tabby。

## 快速开始

1. 打开本地终端或连接 SSH，等待左侧资源管理器加载。
2. 浏览到工作区目录，点击工作区标题旁的 `+` 保存工作区。
3. 在 **Tabby 设置 → ai-workspace-manager** 中填写已安装并登录的 AI CLI 命令，例如 `codex` 或 `claude`。
4. 点击已保存工作区旁的 **AI**，在工作区对应的 AI 终端中输入开发任务。
5. 对远程工作区，AI 可使用 `arw` 读取代码、修改文件、运行命令；在“AI 活动”中查看操作记录。

## 工作区与文件

### 切换工作区和目录

本地终端显示 **AI Local Workspace**，SSH 终端显示 **AI Remote Workspace**。点击保存工作区的文件夹按钮进入工作区，点击 **AI** 打开对应 AI 终端。

双击目录进入，点击箭头展开子目录。路径栏支持目录补全：上下键选择候选，Tab 或末尾的右方向键接受，Enter 进入目录。点击定位箭头可跟随终端当前目录；需要时可启用 Bash/Zsh/Fish 会话路径检测。

每个顶层标签页记忆自己的目录、展开状态和 Git 视图。同一标签页中的终端和 AI 分屏共享这些状态。侧栏宽度可拖动调整，颜色和字体跟随 Tabby 设置。

远程工作区保存后自动开启 ARW 转发。工作区状态图标显示连接进度、转发状态或错误；悬停可查看最近的错误信息。SSH 重连后，加载对应终端可恢复转发。

### 上传和下载

插件自身的保存、上传等操作会立即更新文件树；远端终端或其他程序造成的变更按 SAFS 的方式每 5 秒检测当前目录、已展开目录和 Git 仓库元数据，本地工作区使用 Node 原生文件事件。检测到变化后静默刷新，手动刷新才显示加载状态。已打开且未修改的文本文件也会随检测结果重新读取；有未保存修改或保存未确认标记时保留当前编辑内容。切换标签恢复缓存的文件树和 Git 状态。文件读取优先使用 Tabby SSH 的 SFTP 会话，编辑保存使用同一 SSH 连接的独立命令通道。

将本机文件或目录从桌面文件管理器拖入远程资源管理器：

- **拖到目录行**：上传到该目录。
- **拖到文件行或空白处**：上传到当前浏览目录。
- **拖入多个文件或目录**：按顺序上传；目录保留层级，也支持空目录。

上传区域显示当前处理项，并提供取消按钮。同名目标会提示错误，已完成的上传会保留。上传需连接 SSH 并提供 SFTP；请在普通文件模式下使用。

右键远程文件或目录可下载到本机，通过 Tabby 原生对话框选择保存位置并查看传输进度。也可使用 `arw cp` 上传、下载或复制整个目录。

### 编辑和预览

打开 UTF-8 文本文件即可编辑和保存，编辑上限为 10 MiB。保存时检查文件内容哈希，发现外部修改时提示冲突。

本地和远程编辑保存均原地写入，保留原文件 inode 上的权限、ACL 和扩展属性。远程保存通过一个命令通道完成路径校验、远端哈希与元数据冲突检查、正文上传和写入；校验通过后开始传输正文，写入完成后检查字节数。setuid/setgid 文件额外恢复并核对特殊权限位。远程使用 GNU `realpath`、`stat`、`sha256sum` 及标准文件工具，拒绝符号链接和硬链接目标。新文件默认权限为 `0600`。断线可能留下部分内容，编辑器保留本地内容并标记保存未确认。

远程保存设有 30 秒超时，并监听 SSH 断开。失败、断线或超时会保留编辑内容；未保存的修改和保存待确认状态均在标签标题显示圆点，确认完成后清除。仍未结束的写入禁止重复保存。点击“核对远端文件”，内容与本次待保存内容以及保存前的权限、属主、属组一致才清除异常标记；不一致或核对失败保留标记。也可确认放弃本地修改后“重新加载”，成功读取后清除标记。核对与重新加载也有 30 秒超时。同一 SSH 配置、主机和账号重连后保留标记，标记在当前 Tabby 运行期间有效。

如果需要保留本地编辑并覆盖远端，可点击“再次保存”并明确确认。仍会检查当前文件元数据及权限；只有写入成功并得到确认才清除标记。

终端标签固定显示配置名称。AI 面板标题显示为 `local->目录名` 或 `remote->目录名`。不同工作区末级目录相同时，标题逐级增加上级目录，例如 `remote->opt/c2_tests` 和 `remote->srv/c2_tests`。侧栏工作区列表仅显示目录名，重名时同样补上级目录。

| 文件类型 | 预览功能 | 单文件上限 |
| --- | --- | --- |
| PNG、JPEG、GIF、WebP、BMP、SVG、ICO、AVIF、TIFF | 缩放、适应窗口、切换同目录图片；TIFF 显示第一帧，最多 1600 万像素 | 32 MiB |
| PDF | 翻页、跳页、缩放、适应宽度、密码输入 | 64 MiB |
| Markdown | 渲染与源码切换，显示工作区内相对路径图片 | 2 MiB |
| CSV / TSV | 自动识别分隔符、切换表头、筛选、分页、查看源码 | 8 MiB |

表格最多展示 10000 行数据和 200 列，每页 100 行。文本预览支持 UTF-8、带 BOM 的 UTF-16 和 GB18030 回退；不超过 10 MiB 的 UTF-8 Markdown/CSV 可直接进入编辑器。远程图片与 PDF 预览需提供 SFTP。

## Git

打开工作区后，插件会在后台查找当前目录及子目录中的 Git 仓库。进入 Git 视图可：

- 查看工作区变更，以及并排或统一格式的差异。
- 暂存、取消暂存、填写提交信息并提交，确认后还原变更。
- 查看最近 50 条提交，切换本地分支。
- 在本地或远程目录初始化仓库，或通过本机 Git 克隆仓库到当前目录下的新文件夹。

本地仓库提供 **提取 / 拉取 / 推送**，使用本机 Git、凭据助手和 SSH agent。拉取采用快进更新，推送目标为当前分支配置的上游。

远程仓库提供 **经本地拉取 / 经本地推送**，通过本机网络和 Git 凭据传输 Git 对象。中转时显示阶段进度，并支持取消。取消或失败后可检查仓库状态，再决定是否重试。

提交记录显示待推送、待拉取和已在上游状态；当前会话中成功同步的提交还会显示已推送或已拉取。状态根据最近已知的上游记录更新，点击提取可更新本地仓库的上游信息。

后台扫描最多 2 层、60 个目录、10 个仓库、5000 个条目（单目录 2000），限时 3 秒，超限保留结果并显示提示。Git 自动刷新至少间隔 5 秒，单次后台读取限时 3 秒、输出上限 256 KiB，超过 1000 项变更时停止渲染列表。本地仅监听当前查看的目录，最多 32 个，不递归监听整棵目录树。可取消扫描，或点击“刷新 Git”重新扫描当前范围。Git 操作后保留浏览位置、展开状态和提交草稿。

## AI 终端

### 配置 AI 工具

在 **Tabby 设置 → ai-workspace-manager** 配置：

| 设置 | 示例 | 用途 |
| --- | --- | --- |
| AI CLI 命令或完整路径 | `codex`、`claude` | 选择本机已安装并登录的 AI 工具 |
| 启动参数 | 每行一个参数 | 配置新 AI 会话的模型、选项或初始参数 |
| 恢复会话参数 | `resume` 和 `--last` 各占一行 | 配置恢复已有会话时使用的参数 |
| HTTP / HTTPS 代理地址 | `http://127.0.0.1:7897` | 为新开的本机 AI 终端设置代理；留空继承现有环境 |
| AI 终端环境变量 | `OPENAI_API_KEY your_value` | 每行一个 `NAME VALUE`，在启动 AI 进程时注入 |

启动参数和恢复参数分别生效，共用选项需分别填写。Codex 恢复可配置 `resume`、`--last`；Claude 可配置 `--continue`。启用 Tabby 标签恢复后，可在重启时继续 AI 会话；指定会话 ID 可恢复特定对话。

环境变量的值可以包含空格，以明文保存在配置中。设置页默认掩码显示，点击眼睛按钮查看。保存代理或环境变量设置后，重新打开 AI 终端生效。

### 使用多个 AI 终端

同一标签页内可打开多个 AI 终端，窗格自动平铺，来源终端位于左侧。点击收起按钮可释放该 AI 窗格的空间，相邻 AI 终端的展开按钮显示收起数量，点击可逐个恢复原会话。点击 AI 窗格右上角的 × 关闭该窗格。

本地 AI 在工作区目录运行。远程 AI 在稳定的本地占位目录运行，通过其中的 `AGENTS.md` 获取 ARW 操作指引；远程操作使用已连接的 SSH 工作区。

远程标签页的“AI 活动”汇总同一标签内通过 ARW 执行的文件操作和命令，显示工作区、运行状态、耗时、退出码和错误，可按类型与状态筛选。

### 使用交互终端环境

在远程工作区开启顶部的 **终端模式**，可让 Agent 的 `arw exec` 在原交互终端中运行，使用该终端当前的用户、工作目录和已导出的环境变量。适合需要沿用已激活虚拟环境或手动准备的 shell 环境的任务。

在 shell 提示符下启用，使用 shell 命令处理文件；命令结果以 PTY 合并输出返回。终端目录变化后，重新同步目录并打开 AI 终端。关闭终端模式即可恢复普通文件转发。

## ARW CLI

先查找已保存的远程工作区，再通过 `--id ID` 指定操作目标：

```sh
arw workspaces
arw list src --id ID
arw read README.md --id ID
arw write notes.txt --id ID --content 'hello'
arw exec --id ID -- 'git status --short'
```

所有远程操作均使用 `--id ID`，也可写作 `--workspace ID`。一个 AI 会话可以操作多个已转发工作区。

| 操作 | 示例（追加 `--id ID`） |
| --- | --- |
| 当前编辑文件 | `current-file` |
| 分页目录 | `list src --limit 100 --cursor CURSOR` |
| 读取文件 | `read README.md --head 40` |
| 分段读取 | `read app.ts --offset 0 --length 4096` 或 `read app.ts --start-line 20 --line-count 40` |
| 读取多个文件 | `read-many --input '{"requests":[{"path":"README.md","head":40}],"maxBytes":65536}'` |
| 搜索内容 | `search TODO src --mode content` |
| 搜索文件名 | `find '*.ts' src` |
| 精确替换 | `edit app.ts --input '{"edits":[{"oldText":"old","newText":"new"}]}'` |
| 创建文件或目录 | `create notes.txt file`、`create docs directory` |
| 删除 | `delete notes.txt`；非空目录加 `--input '{"recursive":true}'` |
| 移动 | `move --input '{"sourcePath":"old","targetPath":"new"}'` |
| 修改权限 | `chmod script.sh 755` |
| 上传 | `cp ./local-file remote:path` |
| 下载 | `cp remote:path ./local-file` |
| 上传或下载目录 | `cp -r ./folder remote:path`、`cp -r remote:path ./folder` |
| 顺序批处理 | `batch --input '{"operations":[{"command":"read","arguments":{"path":"README.md"}}]}'` |
| 续读命令输出 | `output OUTPUT_ID stdout --offset N --length N` |

使用 `arw --help` 查看完整参数，`arw --version` 查看版本。`--input -` 从标准输入读取 JSON；`write`、`create` 的 `--file -` 从标准输入读取文本。`--compact` 精简 JSON 元数据，`exec --verbose` 输出 JSON。

复制命令中的 `remote:` 表示所选工作区路径；本地相对路径以 CLI 当前目录为起点，也可使用 `local:` 前缀。目标为已有目录时，源文件或目录放入该目录。同名目标提示错误，目录复制需加 `-r`。

搜索支持内容、文件名与计数模式，并可用 `--input` 配置 `fixedStrings`、`ignoreCase`、`include` 和 `excludeDirs`。默认最多检查 10000 个目录项、8 MiB 文本，返回 1000 条结果；`truncated` 表示还有未完成的扫描或结果。文本读取上限为单文件 10 MiB。

批处理最多 50 个操作，按顺序执行，遇错停止并返回各项结果。`exec` 输出超过 64 KiB 时返回 `outputId` 和 `nextOffsets`，可用 `output` 继续读取；单命令输出上限为 8 MiB，每个连接保留最近四份长输出。

AI 终端已包含 `arw` 命令。Linux/macOS 安装插件或首次加载时会自动创建 `~/.local/bin/arw`；若该目录不在 PATH，会配置 Bash、Zsh 和 fish，新终端生效。通过 Tabby 插件管理器卸载时自动清理本插件创建的链接和 PATH 配置。命令行手动卸载前可执行 `npm run uninstall:cli`。自定义 Tabby 配置目录可设置 `TABBY_CONFIG_DIRECTORY`。

## 操作保护与日志

ARW 对远程操作检查工作区边界和真实路径，对高危命令进行拦截；编辑保存检查内容哈希，上传采用临时文件完成后发布。可结合远程低权限账号、容器和系统访问控制管理 AI 工具的运行权限。

审计日志位于 `<Tabby 配置目录>/omw/audit.jsonl`，记录操作信息，约 1 MiB 轮换并保留一个备份。工作区状态图标可查看最近 5 条脱敏错误，Git 操作详情显示在对应仓库面板中。

## 开发

```sh
npm run build          # 编译 TypeScript，构建插件和 CLI
npm test               # 运行单元和集成测试，需先构建
npm run check          # 构建并运行全部测试
npm run pack:plugin    # 生成 artifacts/ 下的安装包
npm run dev -- /opt/Tabby/tabby
```

开发模式使用独立的 userData 和插件目录。桌面检查可在测试配置中开启 DevTools 端口，再运行 `node scripts/smoke-tabby.mjs PORT`。

```text
src/
  arw-tree/      目录树、Git、编辑器与侧栏
  arw-cli/       CLI、转发、操作策略与活动记录
  arw-ai-cli/    AI 启动器、设置与占位目录
  services/      工作区注册与 Git 中转
  adapters/      SSH/SFTP 宿主适配
  shared/        命令执行与 shell 集成
test/            单元与集成测试
```

实现细节见 [架构说明](docs/architecture.md)。

## 发布

使用有权发布 `tabby-ai-workspace-manager` 的 npm 账号，在插件源码根目录执行：

```sh
npm ci
npm run check
npm login --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

按提示完成登录和双重验证。发布钩子会执行构建与测试。发布后验证：

```sh
npm view tabby-ai-workspace-manager@1.0.0 version --registry=https://registry.npmjs.org/
npm search --searchlimit=250 --registry=https://registry.npmjs.org/ 'keywords:tabby-plugin tabby-ai-workspace-manager'
```

npm 搜索索引更新后，可在 Tabby 的 **Settings → Plugins** 中搜索 `ai-workspace-manager`，安装并重启。后续发布请增加版本号。

参考：[Tabby 插件开发](https://github.com/Eugeny/tabby/blob/master/HACKING.md#plugins)、[npm 公开包发布](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)。

## License

[MIT](LICENSE)
