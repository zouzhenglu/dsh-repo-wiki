# dsh-repo-wiki

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个「仓库 Wiki」：让模型把代码库读一遍，整理成一份**可随时查阅的代码库架构导读**，每条结论都带源码位置，结果保存在本机、不写入仓库。

这是对 [ZCode 的 Wiki 功能](https://zcode.z.ai/cn/docs/repo-wiki) 的模仿实现 —— 一个 DSH 插件（bundle），host 半边与浏览器半边由同一个 cordis row 同时挂载。

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![dsh](https://img.shields.io/badge/dsh-0.2.x-blueviolet.svg)

> **English.** A Repo Wiki plugin for DeepSeek Harness. The model explores a
> codebase, writes a multi-page architecture guide with `path:line-line`
> citations, and every citation is checked against the files it actually read.
> The result lives in `<DSH_HOME>/repo-wiki/`, and is exposed three ways: a
> model-facing `repo_wiki` tool, `/api/repoWiki.*` routes, and a right-sidebar
> tab. The last few versions of the guide are kept so a bad regeneration can be
> rolled back. Install with `dsh plugin --profile web add github:zouzhenglu/dsh-repo-wiki`.

---

## 目录

- [它做了什么](#它做了什么)
- [与 ZCode 的对应关系](#与-zcode-的对应关系)
- [要求](#要求)
- [安装](#安装)
- [使用](#使用)
- [它会读什么、拒绝什么](#它会读什么拒绝什么)
- [配置](#配置)
- [存放位置与文件格式](#存放位置与文件格式)
- [限制](#限制)
- [已知未验证的部分](#已知未验证的部分)
- [代码结构](#代码结构)
- [测试](#测试)
- [本实现与 ZCode 的差异](#本实现与-zcode-的差异)
- [参与开发](#参与开发)
- [License](#license)

---

## 它做了什么

1. **分析代码库**：模型自己用 `list_directory` / `read_file` 逐层展开目录、按需读取文件，而不是先拿一份文件清单。读取范围始终受下面的排除规则约束。
2. **生成目录**：由分析结论裁出一份目录，覆盖项目身份、主执行链路、核心模块与子模块、跨端边界、数据与状态流、配置边界、扩展点、风险点。
3. **逐页生成**：每个页面单独一次请求，附上相关文件作为证据。**每生成完一页就立即落盘**，所以中途停止、失败或退出应用都不会丢掉已完成的页面。
4. **校验引用**：正文里每个 `` `path:line-line` `` 引用都会跟「本次真正读过的文件」比对。编造的路径、读都没读过的文件、超出文件行数的区间都会被标为**未验证**并在界面上划掉 —— 不会假装它是证据。
5. **只在代码真变了时刷新**：用与生成时相同的读取视图算指纹，因此 `node_modules` 里的一次安装不会触发刷新。
6. **误点、失败或删除都能找回**：每次整份重跑之前，当前版本会自动存档到工作区的 `history/`，默认保留 **3 天**、最多 30 份；重跑失败、被停止、连续生成出空页面或错误内容、甚至删除之后，都能在「历史版本」里挑任意一份恢复。整份重跑和删除前也会先确认，避免一次误点就动手。

## 与 ZCode 的对应关系

| ZCode | 本插件 |
| --- | --- |
| 文件树顶部的「仓库 Wiki」图标 | 右侧栏的 **仓库 Wiki** 标签页（guide 入口，order 40），也可用 `/wiki` 打开 |
| 语言 / 模型 / 生成图表 / 重试次数 四项配置 | 生成卡片上的同一组四项 |
| 正在分析代码库 → 正在生成目录 → 正在生成页面 → 正在保存 Wiki | 完全相同的四个阶段与进度计数 |
| 左目录树 + 右正文、可拖动分隔线 | 同一布局（可收起、可拖动） |
| 元数据：分支 / 语言 / 更新时间 / 提交 ID / Wiki 文件数 | 同一组字段，另加引用校验统计 |
| 结论旁可点击的源码位置 | 已验证引用可点击，直接在工作区文件查看器里打开该行 |
| Mermaid 图表 | `flowchart`/`graph` 内置渲染为 SVG；其它图种保留 Mermaid 源码（见[差异](#本实现与-zcode-的差异)） |
| `~/.zcode/v2/repo-wiki/<哈希>/wiki.json` | `<DSH_HOME>/repo-wiki/<工作区哈希>/wiki.json`（同期版本存档在 `history/`，默认保留 3 天） |
| 每轮对话结束时按需刷新 | 同样的指纹比较；见[限制](#限制)里的说明 |
| 一个仓库同时只跑一个任务、一个仓库只保留一个语言版本 | 完全一致 |
| 不保留历史版本 | **保留最近 3 天的多份历史版本**（默认最多 30 份），可逐份恢复；**单页重新生成是本实现多出来的**（ZCode 两者皆无） |

## 要求

| 项 | 要求 |
| --- | --- |
| DeepSeek Harness | 0.2.x（Web 版）。插件在 `0.2.0-rc.2` 上开发与验证 |
| Node.js | ≥ 20（`node --test` 与 ESM 顶层 await） |
| pnpm | 需要能在 `PATH` 上被调用 —— `dsh plugin` 用它完成安装 |
| 一个可启动的 profile | 通常是 `web`，即 Web 版已经跑过一次、`<DSH_HOME>/profiles/web` 已经存在 |

插件对 `@deepseek-ai/dsh-llm`、`dsh-tools`、`dsh-timeout`、`dsh-home-paths`、`schemastery` 只声明「需要这些包」而**不锁定版本**（`peerDependencies: "*"`），因此不会被 DSH 的 peer 版本兼容门拦下。

## 安装

### 从 GitHub 装（推荐）

```sh
dsh plugin --profile web add github:zouzhenglu/dsh-repo-wiki
```

装完**重启 Harness**（见[为什么必须重启](#为什么必须重启)）。右侧栏的 guide 里就会出现「仓库 Wiki」。

`dsh plugin` 的 target 不限于一条命令：git 地址（`github:user/repo`、`git+https://…`、`https://github.com/user/repo`）、本地绝对目录、`.tgz` 包、npm 包名都可以。它会把包装进 profile，并把 `dsh-repo-wiki` 自动追加到该 profile 的 `dsh.profile.bundles`。

安装过程中 pnpm 可能打印 `Issues with peer dependencies found` 之类的警告。这是预期的：peer 依赖由 DSH 运行时本身提供，不需要（也不应该）被打进 profile。

### 从本地目录装

```sh
git clone https://github.com/zouzhenglu/dsh-repo-wiki.git
dsh plugin --profile web add /绝对路径/dsh-repo-wiki
```

如果你要在**克隆目录里**直接改代码（而不是装一份拷贝），见[参与开发](#参与开发)。

### 为什么必须重启

浏览器半边（`lib/client.js`）的地址是在 Harness **启动时**组装进 `window.__DSH_BOOT__` 与 index 的 script 标签的，走 combo URL 批量下发：

```
plugins/??…,dsh-repo-wiki/client.js,…&rev=<哈希>
```

不存在 `/plugins/<包名>/client.js` 这种单文件地址。所以正在运行的那个实例不会热加载新插件，必须重启。

### 校验安装

```sh
node scripts/verify-install.mjs web
```

五项检查，全部 PASS 才算装好：profile 能按包名解析到插件、模块导出 `name`/`inject`/`Config`/`apply`、composed config 能通过插件自己的 schema、client 半边可被发现、bundle 声明存在且 patch 里确实插入了 `dsh-repo-wiki` 这一行。退出码 0 = 全通过。

### 卸载

```sh
dsh plugin --profile web remove dsh-repo-wiki
```

插件不含任何安装期副作用。已生成的 Wiki 在 `<DSH_HOME>/repo-wiki/` 下，卸载不会删它们；需要时手工删除即可。安装期的各种异常见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 使用

**界面**：右侧栏 → 添加标签页 → **仓库 Wiki**（或点 guide 里的胶囊）。第一次打开是状态卡，选好语言、模型、是否生成图表、重试次数，点「生成 Wiki」。

生成中的面板会显示：四阶段进度（分析代码库 → 生成目录 → 生成页面 → 保存）、已用时间、已完成/失败页数、当前正在写的页面、实际使用的模型路由与累计 token 用量，以及可展开的「生成日志」（每个页面的完成/失败时刻都在里面）。

一次运行结束后界面会直接告诉你结局，而不是让你猜：**失败**（红色卡片，带原始错误信息）、**已停止**、**部分页面失败**（目录里对应页标红）、或**上次生成未完成**（应用中途关闭导致有页面停在等待状态）。每种情况都有一键「重新生成」。

**误点、失败或删除后的找回**：工具栏的「重新生成」、结局卡片里的「重新生成」和过期提示里的「刷新」都会先弹一次确认，并说明旧内容会进入历史版本。整份重跑在第一次覆盖前就把当前文档存进工作区的 `history/`；面板里始终有一个可展开的「历史版本 (N)」列表，每行带存档时间、完成页数和自己的「恢复此版」。所以即使连续很多次生成了空页面或错误内容，也能回到任意一份较早的完整版本。删除同样只删当前 Wiki，历史版本保留；「无 Wiki」状态提供恢复入口和「彻底删除」——只有后者会连同历史一起清掉。默认保留 3 天，过期版本自动清理。

**生成过程中随时可读**：已完成的页面直接打开正文；还在排队或正在写的页面也能点开——显示这一页的导读说明与实时状态，内容写好后自动出现在同一视图里，不需要手动刷新。失败或被停止的页面正文顶部有「重新生成此页」按钮，只重写这一页、不动其它页；如果某页原本是好的（`done`）而重写失败，旧内容原样保留。

**补齐失败页面**：一次运行里只要有页面失败，工具栏就会出现「重新生成失败页面 (N)」，部分失败的结局卡片也把「重新生成失败页面」作为主按钮——它按顺序只重试目录里标红的那些页，已完成的页面不动。目录里每个失败/被停止的行右侧也有一个 ↻ 按钮，可以单独重试那一页，不必先把它打开。批量重试期间再次点击会被禁用，避免与「一个工作区同时只跑一个任务」冲突；某一页重试报错不会中断其余页面。

**斜杠命令**：

- `/wiki` — 显示当前工作区的 Wiki 状态
- `/wiki generate` — 开始生成
- `/wiki restore` — 恢复最新的一份历史版本；`/wiki restore <versionId>` 恢复指定版本
- `/wiki-delete` — 删除当前 Wiki（历史版本保留，可 `restore`）

**给模型用的工具** `repo_wiki`，`action` 取值：

| action | 作用 |
| --- | --- |
| `status` | 是否存在、完成/失败页数、是否正在生成、代码是否已变更、可恢复的历史版本列表 |
| `generate` | 开始生成（立即返回，用 `status` 轮询进度） |
| `read` | 读某一页的 Markdown（带 `pageId`） |
| `regenerate-page` | 单独重新生成一页（带 `pageId`）；已有生成任务时拒绝，重写失败时保留该页原有内容 |
| `stop` | 停止正在跑的任务，已完成的页面保留 |
| `refresh` | 代码变了才刷新，没变直接跳过 |
| `restore` | 恢复历史版本：不带 `versionId` 恢复最新一份，带则恢复指定版本 |
| `remove` | 删除当前 Wiki（历史版本保留；无 Wiki 时再删一次才彻底清除） |
| `list` | 列出本机所有已生成 Wiki 的工作区 |

**HTTP 路由**（都在 `/api` 下，走 Harness 自己的会话 cookie 与 Host/Origin 校验）：

```
GET  /api/repoWiki.state?sessionId=…
POST /api/repoWiki.generate   {sessionId, language, provider?, model?, diagrams?, retries?}
POST /api/repoWiki.stop       {sessionId}
GET  /api/repoWiki.read?sessionId=…&pageId=…
POST /api/repoWiki.remove     {sessionId}
POST /api/repoWiki.refresh    {sessionId, auto}
GET  /api/repoWiki.models
POST /api/repoWiki.regeneratePage {sessionId, pageId}   // 单页重新生成
POST /api/repoWiki.restore    {sessionId, versionId?}   // 恢复历史版本，省略 versionId 取最新
```

工作区**只能从会话推出**（会话创建元数据 → sandbox policy → 配置兜底），路由从不接受调用方传来的路径：这些路由带着会话 cookie 就能访问，接受任意路径等于让 cookie 能读整台机器。

## 它会读什么、拒绝什么

生成时只读工作区内的文件，用的是 Wiki 专用的读取视图：

| 排除项 | 规则 |
| --- | --- |
| 依赖、构建产物、缓存、本地状态目录 | `node_modules`、`dist`、`build`、`target`、`__pycache__`、`.cache`、`.venv`、`coverage`、`.next`、`.dsh`、`.git`、`.idea`、`.vscode` … |
| 二进制/压缩/媒体/数据库/文档 | 按扩展名（`.png` `.zip` `.so` `.pdf` `.sqlite` …），另有 NUL 字节嗅探兜底 |
| `.gitignore` | 根与嵌套的 `.gitignore` 都生效；按 git 语义（`!` 反选、`dir/`、前导 `/`、`**`），**深层文件优先**、**被排除的目录无法反选** |
| 疑似密钥 | `.env*`、`id_rsa`、`.npmrc`、`credentials*`、`secrets*`、`*.pem`、`*.key` … 以及**文件名含 token/secret/credential/password 且不是源码**的文件 |
| 符号链接 | 一律不跟随、不进入、不读取 |

关键的一条：`config/tokenService.js` 这类**正常源码不会被误伤** —— 只有当含敏感词的文件不是编程语言源码时才算凭据。

## 配置

`<DSH_HOME>/profiles/web/cordis.patch.yml` 里那一行 `- id: repo-wiki` 的 `config`，或者在 bundle 的 `cordis.patch.yml` 里改。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `zh-CN` | 默认语言，`zh-CN` 或 `en` |
| `requestTimeoutMs` | `180000` | 单次模型请求超时（ZCode 固定 180000 且不可配，这里保留了同样的默认值但允许调大） |
| `maxOutputTokens` | `8192` | 单次请求输出上限 |
| `retries` | `0` | 单页失败后的重试次数（ZCode 默认也是 0；本仓库自带的 `cordis.patch.yml` 把它调成 2，因为瞬时网络错误（如 `terminated`）不该赔上整页） |
| `diagrams` | `true` | 目录提示词是否要求 Mermaid 图 |
| `exploration` | `tools` | `tools` 让模型自己驱动探索；`brief` 改成一次性给一份简报，适合不能调用工具的端点 |
| `provider` / `model` | 未设置 | **不设置**才是对的：默认跟随当前会话正在用的模型 |
| `reasoningEffort` | 未设置 | 适配器自己的档位 |
| `autoRefresh` | `true` | 轮次结束时若代码变了就刷新 |
| `checkStale` | `true` | `status` 是否算指纹来判断是否过期 |
| `historyRetentionDays` | `3` | 历史版本保留天数（1–30）；更早的版本被自动清理 |
| `historyMaxEntries` | `30` | 每个工作区最多保留的历史版本数（1–200）；超出时优先淘汰较旧的、未完成的版本 |
| `dataDir` | `<DSH_HOME>/repo-wiki` | `wiki.json` 与 `history/` 的存放位置 |
| `maxScanFiles` | `20000` | 单次扫描的文件预算 |
| `excludedDirectories` / `excludedExtensions` / `excludedFiles` / `sourceExtensions` | `[]` | 在默认规则**之上**追加 |
| `useGitignore` / `nestedGitignore` | `true` | 是否遵守 `.gitignore` / 是否连嵌套的也遵守 |

## 存放位置与文件格式

```
<DSH_HOME>/repo-wiki/<工作区路径哈希>/wiki.json
<DSH_HOME>/repo-wiki/<工作区路径哈希>/history/<时间戳>-<完成页数>of<总页数>-<内容签名>.json
```

工作区标识哈希取自 **realpath 规范化后**的路径（Windows 上大小写不敏感、分隔符统一、去掉尾部分隔符），所以同一个目录的不同写法不会生出两份 Wiki。

`wiki.json` 是纯 JSON，正文与源码引用都在里面，可以直接交给 agent 读：

```jsonc
{
  "version": 1,
  "workspace": { "id": "…", "name": "my-project", "root": "/code/my-project" },
  "meta": {
    "language": "zh-CN", "updatedAt": "…", "branch": "main", "commit": "…",
    "fileCount": 27, "diagrams": true, "model": null,
    "fingerprint": "27:329bfa3d73240a63",   // 代码变了没，就比这个
    "project": { "summary": "…", "stack": ["…"], "entrypoints": ["…"] },
    "lastTask": { "state": "done", "error": null, "done": 12, "failed": 0, … }  // 上一次运行的结局，进程重启后仍在
  },
  "catalog": [ { "id": "identity", "title": "项目身份", "children": [] } ],
  "pages": [
    {
      "id": "identity", "title": "项目身份", "status": "done",   // waiting|generating|done|failed|stopped
      "markdown": "…每个结论都带 `path:line-line`…",
      "sources":            [ { "path": "src/main.ts", "start": 10, "end": 24, "verified": true } ],
      "unverifiedSources":  [ { "path": "src/nope.ts", "start": 1, "end": 2, "reason": "no such file in the Wiki reading view" } ],
      "error": null, "attempts": 1
    }
  ]
}
```

写入是原子的（临时文件 + rename）；文档损坏、版本不符、或属于别的工作区时会被判为不可读并说明原因，而不是渲染出半份内容。

`history/` 里每份文件与 `wiki.json` 同构，是整份重跑或删除前的版本。每次重跑开始前都会先把当前版本存成一份（0 个完成页的残稿和内容完全重复的版本会被跳过），因此连续多次重跑会留下多份可回退的版本，而不是只有最后一份；**默认保留 3 天、最多 30 份**，过期或被上限挤掉的版本自动删除。文件名里的时间戳用于排序和过期判断，完成页数用于列表摘要，内容签名用于去重，所以列历史时不需要读正文。`restore` 把选中的那份写回 `wiki.json`，并在 `meta.restoredAt` 记下恢复时间。`list` 只看 `wiki.json`，所以只有历史版本、没有当前版本的工作区不会出现在列表里。

## 限制

- **一个工作区同时只跑一个任务。** 两个并发任务会交错落盘，产出属于不同代码状态的页面。
- **一个工作区只保留一个语言版本。** 换语言重新生成会覆盖原来那份，中英文不能并存。
- **历史版本有窗口和上限。** 默认保留 3 天、最多 30 份；更早的版本、被上限清掉的版本、以及单页重写成功后的旧正文不会留存（单页重写失败时仍保留该页原内容）。要长期保留某些版本，请在过期前把需要的页面导出或另存。
- **自动刷新有一半依赖会话订阅。** DSH 把 `turn/end` 暴露为会话日志事件，插件会尽力订阅（`sessions.list()` 里已有的会话 + 会话对象支持 `on` 时）。订阅不上的环境里，过期状态仍然照常通过界面的「代码已变更」提示和 `/wiki` 报告 —— 只是少了「自动」那一半。
- **生成需要模型端点可用。** 单次请求超过 `requestTimeoutMs` 会被放弃（不会挂住）。

## 已知未验证的部分

**没有用真实模型端点跑过一次完整生成。** 下面这些有证据，「模型写出来的页面质量」没有：

| 已验证 | 怎么验证的 |
| --- | --- |
| 173 个单元/集成测试全绿 | `npm test`，9 个套件 |
| 真正的 mount：工具、路由、命令注册，经真实路由跑完一次生成 | `test/host-plugin.test.mjs`，其中**只有** provider 的原始 chunk 流是桩 |
| 从 git 地址安装、bundle 自动登记、`files` 字段生效 | 隔离 `DSH_HOME` 里 `dsh plugin --profile web add <git 地址>` |
| profile 能组合出插件 row、bundle patch 被读到 | `dsh --profile web --dump-config` 里出现完整的 `repo-wiki` 配置块 |
| pnpm 12 的 `ERR_PNPM_IGNORED_BUILDS` 可用 `allowBuilds` 解决 | 批准后 `dsh plugin install` / `add` 都干净退出 |
| 引用校验、落盘、历史版本、恢复、删除 | `test/service.test.mjs`、`test/store.test.mjs`、`test/model.test.mjs` |

**未验证**：真实的模型输出质量、真实代码库上的目录划分是否合理、长请求下的超时与重试表现。这套代码按 DSH 的流式 LLM 合约（`ctx.llm.stream` + `BlockAssembler` + `deadline`）实现，但接上你实际在用的模型端点后，仍建议先在一个小仓库上试一次。

安装期的各类情况（pnpm 构建脚本批准、`@deepseek-ai/cordis` 从哪来、为什么必须重启、怎么回滚）见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 代码结构

```
lib/
  index.js           host 半边：Config、服务装配、repo_wiki 工具、/api/repoWiki.* 路由、/wiki 命令
  llm-client.js      DSH 流式 LLM 合约的适配：分块装配、finish 检查、deadline、路由选择
  client.js          浏览器半边：标签页注册、状态卡、进度条、目录树、正文渲染、Mermaid→SVG
  wiki/
    policy.js        读取策略（纯判定，可单测）：目录/二进制/凭据/源码豁免
    gitignore.js     真正的 .gitignore 匹配器（反选、锚定、目录规则、**、嵌套优先级）
    workspace.js     落实策略的读取视图：包含性、不跟随符号链接、缓存、预算、指纹
    model.js         wiki.json 结构、目录归一化、引用解析与**校验**
    prompts.js       所有发给模型的提示词与工具协议
    pipeline.js      四阶段生成：探索循环、证据选取、逐页生成与重试、停止、引用修复
    store.js         按工作区原子读写 wiki.json 与 history/ 下的历史版本
    service.js       任务生命周期（一任务/工作区、一语言/工作区）、读、删、刷新、版本存档与恢复
scripts/
  verify-install.mjs 安装校验：按 profile 解析、插件合约、composed config 校验、client 半边、bundle patch
test/                173 个测试
docs/                DSH API 侦察笔记（LLM / client / host 三份）、安装排查
tools/preview/       预览与布局质量工具（把 Mermaid 语料渲染成一张可量尺寸的页面）
```

## 测试

```sh
npm test
```

173 个测试，9 个套件。其中 **8 个完全离线**（只用 `node:` 内置模块）；`host-plugin` 这一个需要 DSH 运行时提供的 peer 依赖，缺少时会**整体 skip 并说明原因**，而不是失败 —— 所以一个刚 `git clone` 下来的仓库也能直接跑出结果。

覆盖面：

| 套件 | 断言的是 |
| --- | --- |
| `policy` | 凭据规则的两个方向：`.env` 必须拒、`tokenService.ts` 必须留 |
| `gitignore` | 反选、锚定、`dir/`、`**` 跨零层、被排除目录不可反选、嵌套覆盖根 |
| `workspace` | 越界即拒、符号链接不跟随、预算与 NUL 嗅探、缓存、指纹对「只有被排除文件变了」不敏感 |
| `model` | 目录归一化与种子兜底、引用两种写法、**校验器对未知路径/未读文件/越界行号的处理** |
| `store` | 键的稳定性、原子替换不留临时文件、损坏文档与异工作区文档被拒、列表跳过坏条目、历史版本的新增/回读/越界 id 拒绝、过期与上限清理 |
| `pipeline` | 四阶段顺序、探索工具派发与拒绝、引用修复、单页失败不拖垮整体、全失败才整体失败、停止保留已完成页 |
| `service` | 一工作区一任务、一语言一版本、刷新只在真变了时发生、停止/失败的落盘状态、**多版本存档、重复内容去重、3 天过期、数量上限、旧单文件备份迁移、按版本 restore** |
| `host-plugin` | **真正 mount 插件**：工具/路由/命令注册、经真实路由跑完整生成、真实 LLM 适配器、密钥从不进入请求、删除只删本地、**restore 路由（含 versionId）与工具动作** |
| `client-bundle` | 用 `window.__ModuleLoader__` + 最小 React 加载 client.js：注册契约、目录树/正文/元数据/图表渲染、已验证引用可点而未验证不可点、**已完成页面的正文不会被加载态顶掉**、失败行单独重试与批量重试入口、**重跑确认与「历史版本」列表的渲染和逐版恢复** |

`host-plugin` 那一套只把「provider 的原始 chunk 流」换成了桩：`Config`、store、reader、pipeline、`BlockAssembler`、`deadline`、消息构造、路由 JSON 全是真代码。

## 本实现与 ZCode 的差异

刻意不同的地方，以及为什么：

1. **图表**：client 的共享模块表里没有 Mermaid 运行时，插件也不带打包产物，所以 `flowchart`/`graph` 由本插件解析并渲染成 SVG（分层布局、节点、箭头），`sequenceDiagram`/`stateDiagram` 等保留 Mermaid 源码并给出复制按钮。这是**渲染**上的差异，不是生成上的：目录提示词照常要求 Mermaid 图，图也照常存进 `wiki.json`。
2. **`.gitignore` 范围**：ZCode 文档只说根目录的 `.gitignore`，这里默认连嵌套的也生效（更接近 git 本身的行为），可用 `nestedGitignore: false` 退回。
3. **引用校验**：ZCode 要求结论带源码位置；这里在此之上**校验**它们，并把校验不通过的显式标出来。多花一次修复请求，换来「界面上能点的位置一定真的存在」。
4. **自动刷新**：见[限制](#限制)。
5. **正文渲染**是一个聚焦子集（标题、段落、列表、引用、围栏代码、表格、分隔线、粗斜体、链接），不是完整 CommonMark；不认识的内容按段落原样显示，而不是丢掉。
6. **目录生成失败会降级而不是整体失败**：目录请求超时、报错或返回不了 `catalog` 时，改用内置目录模板继续生成页面，并在任务里记一条 warning、在文档里记 `meta.catalogDegraded`。目录是产物里最不值得为它放弃整次生成的部分——读者真正打开的是页面。
7. **VCS 元数据直接读 `.git`**：分支和提交从 `.git/HEAD`、`refs/heads/*`、`packed-refs` 读出来，支持链接工作树和仓库在工作区之上的情况；不 spawn `git` 进程，所以 Windows 上没有 `git` 在 PATH 也能拿到。读不到就是 `null`，绝不会让一次生成失败。
8. **探索请求被端点整体拒绝时降级而不是整体失败**：有些模型网关（vLLM 系）会把 tool 的 JSON Schema 拿去编译校验，所以 `list_directory`/`read_file`/`finish` 的 schema 用的是严格合法的 JSON Schema（顶层 `required` 数组）；即便如此，若带 tools 的探索请求仍被拒（网关 400 等），会自动改用无 tools 的简报模式重试分析阶段，并记一条 warning——宁可探索浅一点，也不让整次生成失败。
9. **多版本历史**：ZCode 不保留历史版本；这里每次整份重跑和删除前都把当前版本存进 `history/`，默认保留 3 天、最多 30 份，界面上有「历史版本」列表并支持逐份恢复，整份重跑/刷新/删除前还会先确认。一次误点、连续多次空生成或错误生成，都不该把几十分钟的结果彻底丢掉。

## 参与开发

需要一个能把 `@deepseek-ai/*` 解析出来的本地环境。`npm test` 里 8 个套件不需要，只有 `host-plugin` 需要。

```sh
git clone https://github.com/zouzhenglu/dsh-repo-wiki.git
cd dsh-repo-wiki
npm test
```

要让 `host-plugin` 也跑起来，在仓库根建一个指向 DSH 安装的链接目录，让插件目录能解析它声明的 peer 依赖：

```powershell
# Windows
New-Item -ItemType Directory node_modules -Force
New-Item -ItemType Junction node_modules\@deepseek-ai `
  -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
```

```sh
# macOS / Linux
mkdir -p node_modules
ln -s "$HOME/.dsh/profiles/node_modules/@deepseek-ai" node_modules/@deepseek-ai
```

这个链接**不会被提交**（已在 `.gitignore` 里）。原因：以 `link:` 方式装进 profile 时，模块解析从插件的真实路径出发，需要这份链接；以 git/npm 方式分发时由 `peerDependencies` + profile 自己的 `node_modules` 承担。

`tools/preview/` 是开发期的图表质量工具：把真实 Wiki 里的 Mermaid 语料渲染成一张页面，量布局重叠、标签溢出等几何问题。

```sh
npm run preview          # 生成 tools/preview/preview.html（未提交）
node tools/preview/build.mjs --wiki <某个 wiki.json 路径>
```

## License

[MIT](LICENSE)
