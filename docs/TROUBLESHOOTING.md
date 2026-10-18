# 安装排查（Troubleshooting）

README 的[安装](../README.md#安装)一节是一条命令就能装好的路径。这一节记录装不上的各种情况、它们的成因，以及这个仓库在发布前实际验证到哪一步。

---

## `dsh plugin` 返回非 0：`ERR_PNPM_IGNORED_BUILDS`

**现象**：`dsh plugin --profile web add github:…` 打印

```
× installing dependencies
╰─▶ Ignored build scripts: @deepseek-ai/dsh-subprocess-local@…, @google/genai@…,
    koffi@…, node-pty@…, protobufjs@…
  help: Run "pnpm approve-builds" to pick which dependencies should be allowed
        to run scripts
dsh: plugin command failed
```

**成因**：不是这个插件的问题。pnpm 10 起默认**不执行**依赖里声明的 build 脚本，必须显式批准；而 `@deepseek-ai/dsh-base` 这条依赖链上正好有几个带 build 脚本的包（`node-pty`、`koffi` 这类需要编译原生模块的）。所以任何**新建**的 DSH profile 第一次装东西都可能撞上这一条，与装的是哪个插件无关。

**判断**：依赖本身其实已经装好了，只是 DSH 的「把包登记进 `dsh.profile.bundles`」这一步没跑到。验证：

```sh
node scripts/verify-install.mjs web
```

如果第一项 `[PASS] profile resolves the package by name` 通过、只是最后一项 `[FAIL] bundle patch …` 没过，就是这种情况。

**处理**：在 profile 目录里允许这些构建脚本，然后重跑。

```yaml
# <DSH_HOME>/profiles/web/pnpm-workspace.yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  koffi: true
  node-pty: true
  protobufjs: true
```

```sh
dsh plugin --profile web add github:zouzhenglu/dsh-repo-wiki
```

`allowBuilds` 的确切键名以 pnpm 报错里打印的那几个为准。另一种做法是 `pnpm approve-builds` 交互式挑选，效果相同。

**如果不批准会怎样**：`node-pty` / `koffi` 是 DSH 终端与原生调用所需，不批准它们的构建脚本会让这些能力不可用，但插件的读仓库、生成 Wiki、落盘、恢复版本都不依赖它们。

---

## profile 里没有 `dsh-repo-wiki`，但依赖已经装上了

`dsh plugin add` 的对账（把包名追加进 `dsh.profile.bundles`）只有在 pnpm 成功退出后才执行。pnpm 非 0 时它会被跳过 —— 上一条就是这种情况。手工补一行即可：

```jsonc
// <DSH_HOME>/profiles/web/package.json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-repo-wiki"          // ← 加这一行
] } }
```

然后重启 Harness。改这个文件之前建议先备份：DSH 自己在安装前也会把 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` 存到 `<profile>/.backup-<时间戳>/`。

---

## peer 依赖告警：`Issues with peer dependencies found`

**预期，不需要处理。** 插件声明的 `@deepseek-ai/cordis`、`dsh-llm`、`dsh-tools`、`dsh-timeout`、`dsh-home-paths`、`schemastery` 是 DSH 运行时本身就带的包，不该被装进 profile。profile 的 `pnpm-workspace.yaml` 里 `autoInstallPeers: false` 是 DSH 自己写的默认值，正是为了不把它们重复装一份。

运行时它们由 profile 的依赖树（`@deepseek-ai/dsh-base` 等）提供，从 `<profile>/node_modules/@deepseek-ai/` 解析。

### `Cannot find package '@deepseek-ai/cordis' imported from …/dsh-tools/lib/index.js`

这一条只会在**不完整**的 profile 上出现，值得单独说明，因为它容易被误判成插件的 bug。

`@deepseek-ai/cordis` 是 `dsh-tools` 与 `dsh-base` 的 **peer** 依赖（`~4.0.4`），**不是**它们的 `dependencies`。又因为 DSH 的默认 `autoInstallPeers: false`，没有任何东西会把它装进去 —— 真实 profile 的 `<profile>/node_modules/@deepseek-ai/` 里通常**也没有** `cordis`，它来自 DSH **安装本身**的包树（`<DSH_HOME>/profiles/node_modules/@deepseek-ai/`，指向 DSH 自带的那批包）。

所以：

| 场景 | `@deepseek-ai/cordis` 从哪来 |
| --- | --- |
| 真实 DSH 安装下的 profile | DSH 安装自带的包树，`dsh-tools` 一定能解析到 |
| 只从 npm 装 `dsh-base` / `dsh-web-app`、没有 DSH 安装包树的 profile | **没有**，会报 `ERR_MODULE_NOT_FOUND` |

第二种情况不是插件的问题，是那个 profile 少了 DSH 自己的包。要在一个纯 npm profile 里跑起来，把它补上即可：

```sh
dsh plugin --profile web add @deepseek-ai/cordis@~4.0.4
```

> `package.json` 里把 `@deepseek-ai/cordis` 声明为 `peerDependencies`（`optional: true`）正是为了记录这个要求：插件的运行时依赖链需要它，但它由 DSH 提供，不该被打进插件本身。


---

## 装好了但右侧栏没有「仓库 Wiki」

浏览器半边的地址是在**启动时**组装进 `window.__DSH_BOOT__` 的，不会热加载。重启 Harness。重启后首页 HTML 里应该多出一条包含 `dsh-repo-wiki/client.js` 的 combo 地址：

```
plugins/??…,dsh-repo-wiki/client.js,…&rev=<哈希>
```

注意它是 **combo URL**（`dsh-client-modules` 批量下发浏览器插件）。不存在 `/plugins/<包名>/client.js` 这种单文件地址 —— 早期排查时按后者去探测，那是猜错了路径，别重复这个错。

---

## 启动时打印 `disabling profile plugin row`

DSH 有一道 peer 版本兼容门：`peerDependencies` 里 `@deepseek-ai/dsh*` 的版本范围与当前运行时对不上时，会把该 row 禁用并打印警告。本插件声明的是 `*`，**不会**被这道门拦下。确认：

```sh
dsh --profile web --help 2>&1 | Select-String 'disabling profile plugin row'
```

输出里不应出现 `repo-wiki`。如果出现了别的插件名，那是它们自己的版本声明问题，与本插件无关。

> 顺带一提：`package.json` 里的 `dsh.engines.dsh` 字段是**装饰性的** —— 0.2.0 的 DSH 没有任何代码读它，真正生效的只有 `peerDependencies`。本仓库因此不写这个字段，避免给人已经生效的错觉。

---

## 卸载

```sh
dsh plugin --profile web remove dsh-repo-wiki
```

插件没有安装期副作用。已生成的 Wiki 在 `<DSH_HOME>/repo-wiki/` 下，卸载不会删；需要时手工删除。如果中途手工改过 `dsh.profile.bundles`，`remove` 会把这一行也去掉。

---

## 安装是怎么验证的

发布前在一个**隔离的 `DSH_HOME`**（临时目录，跑完即删，没碰真实 profile）里做了这些验证：

| 验证项 | 结果 |
| --- | --- |
| `git+file://` 形式的 git 安装能把包装进 profile | ✅ 装到 `<profile>/node_modules/dsh-repo-wiki/`，内容只含 `lib/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`package.json`（`files` 字段对 git 安装同样生效） |
| `dsh-repo-wiki` 自动登记进 `dsh.profile.bundles` | ✅ pnpm 成功时自动追加 |
| `dsh --profile web --dump-config` 能组合出插件 row | ✅ 输出里有 `# == dsh-repo-wiki` 及完整的 `config`（`language`/`requestTimeoutMs`/`retries`/`diagrams`/`historyRetentionDays`/`historyMaxEntries`） |
| bundle 的 `cordis.patch.yml` 被读到并应用 | ✅ 同上，config 来自 bundle 的 patch |
| client 半边被发现（`dsh.client` + `./client` 导出 + 目标文件存在） | ✅ |
| **`allowBuilds` 能解掉 `ERR_PNPM_IGNORED_BUILDS`** | ✅ 批准后 `dsh plugin install` 与 `dsh plugin add` 都干净退出（0），`node-pty` / `koffi` / `dsh-subprocess-local` 的构建脚本正常跑完 |
| 插件合约（`name`/`inject`/`Config`/`apply`）能加载 | ⚠️ 见下方「已知限制」 |

### 已知限制

**插件合约的加载验证只在一个完整 DSH 安装下成立。** 在「只从 npm 装 `dsh-base` / `dsh-web-app`、没有 DSH 安装包树」的隔离 profile 里，`verify-install.mjs` 的第 2、3 项会失败，报 `Cannot find package '@deepseek-ai/cordis'` —— 成因见上文，不是插件的缺陷。真实 DSH 安装下的 profile 不存在这个问题。

**没有用真实模型端点跑过一次完整生成。** `test/host-plugin.test.mjs` 里 provider 的原始 chunk 流是唯一被替换掉的部分，`BlockAssembler`、`deadline`、消息构造、引用校验、落盘、路由 JSON 全是真代码 —— 所以「管线能跑通」有证据，「模型写出来的页面质量」没有。接上你实际在用的模型端点后，建议先在一个小仓库上试一次。

早期验证过一次隔离实例（`DSH_HOME` 指向临时目录、临时 profile 只挂 `dsh-base` + `dsh-web-app` + 本插件、`--port 0 --no-open`）：

| 观察到的事实 | 说明 |
| --- | --- |
| 实例正常起在随机端口 | 插件没有阻止启动 |
| `GET /api/repoWiki.state?sessionId=none` → **200** | host 半边真的挂上了，返回了真实的工作区与指纹 |
| 含 `client.js` 的 combo → **200** | 浏览器半边真的下发了 |
| 下发内容含 `window.__ModuleLoader__.load({ id: "dsh-repo-wiki" …})`、`sidebarRightTabs`、`repoWiki.state`、`仓库 Wiki` | 是这份 bundle 本身，不是同名占位 |

路由能应答本身就证明了 `apply` 跑过：路由是在 `ctx.inject(['connection'], …)` 里注册的，而 `apply` 只在 `inject: ['llm','tools']` 全部就绪时才执行。

---

## 开发环境的 `node_modules` 链接

以 `link:` 方式把仓库装进 profile 时，模块解析从插件的**真实路径**出发，所以克隆出来的目录里必须有一个能让 `@deepseek-ai/*` 解析出来的 `node_modules`。见 README 的[参与开发](../README.md#参与开发)。

以 git / npm 方式分发时不需要这一步：`peerDependencies` 由 profile 自己的依赖树承担。这也是为什么 `.gitignore` 里排除了 `node_modules/`。
