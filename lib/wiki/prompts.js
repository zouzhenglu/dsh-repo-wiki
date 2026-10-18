/**
 * Every instruction the Wiki sends to a model, in one place.
 *
 * Keeping the prompts here rather than inline at each call site is what makes
 * the generation contract reviewable: the citation format the prompts demand is
 * the same format `model.js` parses and verifies, and the tool names the
 * exploration prompt advertises are the same names `pipeline.js` dispatches. A
 * change to one without the other is a bug that this file's shape makes visible.
 *
 * The prompts encode three product decisions inherited from ZCode's Wiki:
 *
 * - The Wiki is a **codebase architecture guide**, not a product manual, so the
 *   prompts explicitly exclude installation, deployment and CI sections.
 * - Every conclusion carries a **source location**; an uncited claim is a
 *   defect, and the model is told that citations are verified against files it
 *   actually read.
 * - The model **explores the repository itself** rather than receiving a file
 *   dump, so the reader's refusals are part of its world and it is told what
 *   they mean.
 *
 * @module dsh-repo-wiki/wiki/prompts
 */

/**
 * The language directive for one Wiki language tag.
 * @param language - `'zh-CN'` or `'en'`.
 * @returns the sentence to place in a prompt.
 */
export function languageDirective(language) {
  return language === 'en'
    ? 'Write every title and every sentence of prose in English.'
    : '所有标题与正文一律使用简体中文；代码标识符、文件路径与命令保持原文。'
}

/** Word for "source location" in each language, used by the trailing section. */
function sourcesHeading(language) {
  return language === 'en' ? '## Source locations' : '## 源码位置'
}

/**
 * The shared preamble: the role, the citation format, and the refusals.
 * @param language - the Wiki's language.
 * @returns the preamble.
 */
export function systemPreamble(language) {
  return [
    language === 'en'
      ? 'You are documenting a codebase for engineers who have never seen it. You produce a codebase architecture guide — not a product manual and not a usage handbook.'
      : '你在为一个从未见过该代码库的工程师编写文档。你产出的是「代码库架构导读」，不是产品文档站，也不是使用手册。',
    '',
    language === 'en'
      ? 'Rules that are not negotiable:'
      : '以下规则不可协商：',
    language === 'en'
      ? '- Every factual sentence about the code MUST end with a source location in exactly this form: `path/to/file.ext:START-END` — backticked, workspace-relative, 1-based inclusive line numbers. The path must be a file you actually read in this session. Paths are verified; an invented path is discarded and counts against you.'
      : '- 每一句关于代码的事实性结论都必须在句末标注源码位置，格式严格为 `` `path/to/file.ext:起始行-结束行` ``：使用反引号、工作区相对路径、从 1 开始且包含首尾行的区间。路径必须是你本次真实读过的文件；系统会校验路径，编造的路径会被丢弃。',
    language === 'en'
      ? '- Never describe a file you could not read. If a path is refused, say what the refusal was and move on; a refusal is information about the repository.'
      : '- 不要描述你读不到的文件。若某个路径被拒绝，就写明被拒绝的原因，然后继续；被拒绝本身就是关于这个仓库的信息。',
    language === 'en'
      ? '- Do not fill space with generic advice. If you cannot support a claim from the code, omit the claim.'
      : '- 不要用泛泛的建议填充篇幅。若某个结论无法从代码中得到支撑，就不要写它。',
    languageDirective(language),
  ].join('\n')
}

/**
 * The diagram clause, included only when diagrams were requested.
 * @param enable - whether diagrams are on.
 * @returns the clause, or an empty string.
 */
function diagramClause(enable) {
  if (!enable) return ''
  return [
    '',
    'DIAGRAMS: when — and only when — a diagram genuinely helps and you have read the code it depicts, include at most one Mermaid diagram in a ```mermaid fenced block. Use `flowchart` for control flow, `sequenceDiagram` for a request that crosses a boundary, or `stateDiagram-v2` for a lifecycle. Keep node labels short, prefer ASCII identifiers, and quote any label containing punctuation. A diagram that restates a list is worse than no diagram.',
  ].join('\n')
}

/**
 * The tool protocol the exploration loop speaks. The names are dispatched by
 * `pipeline.js`; the descriptions are what the model reads.
 *
 * The parameter schemas are strict JSON Schema (a top-level `required` array of
 * property names). Earlier versions used the DSH tool-registry shorthand of
 * `required: true` inside a property — invalid per the JSON Schema metaschema —
 * and provider stacks that validate tool schemas for guided decoding reject the
 * whole request with a 400 instead of ignoring the stray keyword.
 */
export const EXPLORE_TOOLS = Object.freeze([
  {
    name: 'list_directory',
    description: 'List one directory of the workspace, one layer at a time. Entries the Wiki reading view excludes are shown with the reason but cannot be opened. Use "." for the repository root.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path, or "." for the root.' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read one text file from the workspace. Returns numbered lines. Files excluded by the Wiki reading view, binary files, and files over the size limit are refused with a reason.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        startLine: { type: 'integer', description: 'First line to return, 1-based. Omit to start at line 1.' },
        endLine: { type: 'integer', description: 'Last line to return, inclusive. Omit to read to the end.' },
      },
    },
  },
  {
    name: 'finish',
    description: 'Finish exploring and return your findings. Call this exactly once, when you have read enough to describe the repository.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'stack', 'entrypoints'],
      properties: {
        summary: { type: 'string', description: 'One paragraph describing what this repository is and does.' },
        stack: { type: 'array', items: { type: 'string' }, description: 'Languages, frameworks and runtime facts, each with a citation where possible.' },
        entrypoints: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths where execution or the public API begins.' },
        notes: { type: 'string', description: 'Anything a reader must know before the rest of the guide makes sense.' },
      },
    },
  },
])

/**
 * Render a listing or a read into the compact text a tool result carries.
 * @param value - the tool's structured result.
 * @returns the text form.
 */
export function formatToolResult(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

/**
 * The first exploration message: what to do and what the refusals mean.
 * @param options - the message inputs.
 * @param options.language - the Wiki's language.
 * @param options.workspaceName - the repository's directory name.
 * @param options.rootOutline - a bounded directory outline, as a hint rather than a file list.
 * @param options.excludedSummary - one line per excluded top-level entry, or an empty array.
 * @returns the user message.
 */
export function explorationBrief(options) {
  const lines = [
    options.language === 'en'
      ? `Repository: ${options.workspaceName}`
      : `代码库：${options.workspaceName}`,
    '',
    options.language === 'en'
      ? 'Explore this repository with `list_directory` and `read_file`, then call `finish`. Read the files that actually answer these questions:'
      : '请用 `list_directory` 与 `read_file` 探索这个仓库，然后调用 `finish`。请阅读真正能回答以下问题的文件：',
    options.language === 'en'
      ? '1. What is this project, what is its stack, and where does execution begin?'
      : '1. 这是什么项目、技术栈是什么、执行从哪开始？',
    options.language === 'en'
      ? '2. What happens in order after startup, and how does the main flow advance?'
      : '2. 启动之后按什么顺序发生什么，主流程如何推进？',
    options.language === 'en'
      ? '3. How is the code divided into modules, and how do they connect?'
      : '3. 代码如何划分模块，模块之间如何衔接？',
    options.language === 'en'
      ? '4. Where does data come from and go, and who owns state?'
      : '4. 数据从哪来、到哪去，状态由谁持有？',
    '',
    options.language === 'en'
      ? 'You do not receive a file list. The outline below is a hint about where to start, not an inventory, and it may be truncated.'
      : '你不会拿到一份文件清单。下面的轮廓只是起点提示，不是完整清单，而且可能已被截断。',
  ]
  if (options.rootOutline.length > 0) {
    lines.push('', '```', ...options.rootOutline, '```')
  }
  if (options.excludedSummary.length > 0) {
    lines.push(
      '',
      options.language === 'en'
        ? 'Excluded from your reading view (visible so you can describe them, unreadable):'
        : '以下内容不在你的阅读范围内（可见、可用于描述，但不可读取）：',
      ...options.excludedSummary.slice(0, 30).map((note) => `- ${note}`),
    )
  }
  lines.push(
    '',
    options.language === 'en'
      ? 'Work within a modest budget: read the files that carry the architecture, not every file. Then call `finish` once.'
      : '请控制在合理范围内：只读承载架构的文件，不要逐个读。完成后调用一次 `finish`。',
  )
  return lines.join('\n')
}

/**
 * Ask for the catalog, given what the exploration learned.
 * @param options - the catalog inputs.
 * @param options.language - the Wiki's language.
 * @param options.project - the exploration's `finish` payload.
 * @param options.entrypoints - workspace-relative paths worth naming.
 * @returns the user message.
 */
export function catalogBrief(options) {
  return [
    options.language === 'en'
      ? 'Now design the table of contents for the architecture guide.'
      : '现在设计这份架构导读的目录。',
    '',
    options.language === 'en' ? 'What exploration found:' : '探索阶段的结论：',
    '```json',
    JSON.stringify(options.project, null, 2),
    '```',
    '',
    options.language === 'en'
      ? 'The catalog MUST cover, in this order, these aspects — adapt each one to what you actually saw rather than keeping the generic name:'
      : '目录必须按以下顺序覆盖这些方面；请根据你实际看到的内容改写标题，不要照抄通用名称：',
    options.language === 'en'
      ? '1. project identity — what it is, its stack, its entrypoints'
      : '1. 项目身份 — 它是什么、技术栈、入口在哪',
    options.language === 'en'
      ? '2. main execution paths — what runs in what order'
      : '2. 主执行链路 — 按什么顺序执行什么',
    options.language === 'en'
      ? '3. core modules and submodules — one page per real module, with submodules nested'
      : '3. 核心模块与子模块 — 每个真实模块一页，子模块作为子节点',
    options.language === 'en'
      ? '4. cross-boundary behaviour — processes, surfaces, platforms, IPC'
      : '4. 跨端边界 — 进程、端、平台、IPC',
    options.language === 'en'
      ? '5. data and state flow'
      : '5. 数据与状态流',
    options.language === 'en'
      ? '6. configuration boundaries'
      : '6. 配置边界',
    options.language === 'en'
      ? '7. extension points — where a contributor adds behaviour'
      : '7. 扩展点 — 贡献者在哪加功能',
    options.language === 'en'
      ? '8. risk points — failure-prone and subtly coupled areas'
      : '8. 风险点 — 易错、隐含耦合的区域',
    '',
    options.language === 'en'
      ? 'Do NOT include installation, deployment, CI/CD, contributing or licence sections; they are out of scope for this artifact.'
      : '不要包含「安装部署」「CI/CD」「贡献指南」「许可证」这类栏目；它们不属于这份产物。',
    options.language === 'en'
      ? 'Aim for 8 to 16 pages in total including children. Nest at most two levels. Reply with JSON only, in exactly this shape:'
      : '总页数（含子节点）控制在 8 到 16 页，最多嵌套两层。只回复 JSON，格式严格如下：',
    '```json',
    '{"catalog":[{"title":"…","brief":"one sentence on what this page answers","children":[{"title":"…","brief":"…"}]}]}',
    '```',
  ].join('\n')
}

/**
 * One page's writing brief, with the evidence attached.
 * @param options - the page inputs.
 * @param options.language - the Wiki's language.
 * @param options.title - the page title.
 * @param options.brief - what the page answers.
 * @param options.path - the catalog trail, for orientation.
 * @param options.project - the exploration payload.
 * @param options.catalog - the sibling titles, so the page does not duplicate them.
 * @param options.files - `{ path, text }` evidence the model may cite.
 * @param options.diagrams - whether diagrams are on.
 * @param options.readPaths - every file the session has read, so the model knows what it may cite.
 * @returns the user message.
 */
export function pageBrief(options) {
  const evidence = options.files
    .map((file) => {
      const numbered = file.text
        .split('\n')
        .map((line, index) => `${String(index + 1).padStart(5, ' ')}\t${line}`)
        .join('\n')
      return `### \`${file.path}\`\n\`\`\`\n${numbered}\n\`\`\``
    })
    .join('\n\n')

  return [
    options.language === 'en'
      ? `Write the page "${options.title}" for the architecture guide.`
      : `请撰写架构导读中的页面「${options.title}」。`,
    options.language === 'en'
      ? `It sits at: ${options.path.join(' › ')}`
      : `它在目录中的位置：${options.path.join(' › ')}`,
    options.language === 'en'
      ? `This page must answer: ${options.brief}`
      : `这一页要回答的问题：${options.brief}`,
    options.language === 'en'
      ? `Sibling sections of the guide (do not duplicate their content): ${options.catalog.join('; ')}`
      : `导读的其他栏目（不要重复它们的内容）：${options.catalog.join('；')}`,
    '',
    options.language === 'en' ? 'What the repository is:' : '仓库概况：',
    '```json',
    JSON.stringify(options.project, null, 2),
    '```',
    '',
    options.language === 'en'
      ? 'Evidence you may cite, with line numbers:'
      : '可以引用的证据（带行号）：',
    evidence,
    '',
    options.language === 'en'
      ? `Files read this session, which are the only paths a citation may name: ${[...options.readPaths].slice(0, 200).join(', ')}`
      : `本次会话读过的文件（引用只能指向这些路径）：${[...options.readPaths].slice(0, 200).join('、')}`,
    diagramClause(options.diagrams),
    '',
    options.language === 'en'
      ? 'Shape: 3 to 8 short paragraphs or bullet groups, each carrying citations. Start with a two-sentence orientation, then the mechanism, then anything a reader would get wrong. End with the source section.'
      : '行文要求：3 到 8 段简短的段落或要点组，每组都带引用。先用两句话交代定位，再讲机制，最后讲读者最容易搞错的地方。以源码位置小节结尾。',
    options.language === 'en'
      ? 'Reply with Markdown only, no preamble, in exactly this shape:'
      : '只回复 Markdown 正文，不要任何开场白，格式严格如下：',
    '```markdown',
    options.language === 'en'
      ? 'Orientation in two sentences. `src/example.ts:10-24`\n\n## Mechanism\n\nWhat happens, and why. `src/other.ts:5-18`\n\n## Traps\n\nWhat a reader gets wrong. `src/third.ts:100-140`\n\n' + sourcesHeading(options.language) + '\n- src/example.ts:10-24\n- src/other.ts:5-18\n- src/third.ts:100-140'
      : '用两句话交代这一页的定位。`src/example.ts:10-24`\n\n## 机制\n\n发生了什么、为什么。`src/other.ts:5-18`\n\n## 容易搞错的地方\n\n读者常犯的错误。`src/third.ts:100-140`\n\n' + sourcesHeading(options.language) + '\n- src/example.ts:10-24\n- src/other.ts:5-18\n- src/third.ts:100-140',
    '```',
  ].join('\n')
}

/**
 * A repair brief: the first attempt's citations did not verify.
 * @param options - the repair inputs.
 * @param options.language - the Wiki's language.
 * @param options.rejections - one line per rejected citation.
 * @returns the corrective user message.
 */
export function repairBrief(options) {
  return [
    options.language === 'en'
      ? 'Your previous reply cited locations that do not exist or were never read:'
      : '你上一次回复引用的位置不存在或本次并未读过：',
    ...options.rejections.map((line) => `- ${line}`),
    '',
    options.language === 'en'
      ? 'Rewrite the page, citing only paths from the list of files read this session. If a claim cannot be cited, delete the claim.'
      : '请重写这一页，只引用「本次会话读过的文件」列表中的路径。若某个结论无法标注来源，请删掉该结论。',
  ].join('\n')
}

export { sourcesHeading }

/**
 * Extract the first complete JSON value from a model reply.
 *
 * A model asked for "JSON only" still routinely wraps the answer in a fence,
 * prefixes it with a sentence, or appends an explanation. Rather than failing
 * those replies — which would turn a cosmetic habit into a lost page — the
 * reply is scanned for the first balanced object or array, honoring string
 * literals and escapes so a brace inside a string cannot close it early.
 *
 * @param text - the model's reply.
 * @returns the parsed value, or null when the reply holds no complete JSON value.
 */
export function parseJsonReply(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null

  // Fast path: the whole reply is JSON.
  try {
    return JSON.parse(trimmed)
  } catch {
    // Fall through to the scanner.
  }

  const start = (() => {
    const object = trimmed.indexOf('{')
    const array = trimmed.indexOf('[')
    if (object === -1) return array
    if (array === -1) return object
    return Math.min(object, array)
  })()
  if (start === -1) return null

  const open = trimmed[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
