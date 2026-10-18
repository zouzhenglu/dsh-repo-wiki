window.__ModuleLoader__.load({
	id: "dsh-repo-wiki",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;

		//#region locales
		/**
		 * Every string the tab shows, in both languages. A tab's chip text is
		 * captured when the tab opens, so the title is resolved once per open; body
		 * copy follows the current language.
		 */
		const DICTIONARIES = {
			"zh-CN": {
				title: "仓库 Wiki",
				guideTitle: "仓库 Wiki",
				guideDescription: "代码库架构导读，每条结论都带源码位置",
				loading: "正在读取 Wiki 状态…",
				noWiki: "这个工作区还没有 Wiki",
				noWikiHint: "让模型读一遍代码库，生成一份可随时查阅的架构导读。所有结论都会标注源码位置，生成结果保存在本机，不写入仓库…",
				generate: "生成 Wiki",
				regenerate: "重新生成",
				stop: "停止",
				remove: "删除 Wiki",
				removeConfirm: "删除本机保存…Wiki？历史版本仍会保留在本机，可以随时恢复…",
				restore: "恢复上一…",
				restored: "已恢复选中的历史版本…",
				purge: "彻底删除",
				purged: "已彻底删除本机保存的 Wiki 和历史版本…",
				purgeConfirm: "彻底删除本机保存…Wiki 和全部历史版本？此操作无法恢复…",
				deletedRecoverable: "已删除本…Wiki；历史版本仍保留，可以恢复…",
				backupAvailable: "较早的版本仍保留",
				backupSummary: "最新存…· 已完…{done}/{total} …",
				backupHint: "误点重新生成、运行失败或删除后，可以在历史版本里找回较早的完成内…",
				history: "历史版本",
				historyHint: "保留最…{days} 天的版本，最新的在最上面；恢复会用选中的版本替换当…Wiki…",
				restoreVersion: "恢复此版",
				regenerateConfirm: "重新生成会用新内容替换当…Wiki（已完成 {done} 页）。旧内容会进入历史版本，之后可以随时恢复。继续？",
				refreshConfirm: "代码已变更，刷新会重新生成整…Wiki（当前已完成 {done} 页）。旧内容会进入历史版本，之后可以随时恢复。继续？",
				options: "生成选项",
				language: "语言",
				model: "模型",
				modelDefault: "跟随当前会话模型",
				diagrams: "生成图表",
				diagramsHint: "在图确实有帮助的地方生成流程…",
				retries: "重试次数",
				retriesHint: "单个页面生成失败时自动重试几…",
				phase: {
					analyzing: "正在分析代码…",
					catalog: "正在生成目录",
					pages: "正在生成页面",
					saving: "正在保存 Wiki",
				},
				progress: "进度",
				pagesDone: "已完…",
				pagesFailed: "失败",
				catalog: "目录",
				metadata: "元数…",
				branch: "分支",
				commit: "提交",
				updatedAt: "更新时间",
				files: "文件…",
				pageCount: "Wiki 文件…",
				pageStatus: { waiting: "等待生成", generating: "正在生成", done: "已完…", failed: "生成失败", stopped: "已停…" },
				stale: "代码已变更，Wiki 可能已过…",
				refresh: "刷新",
				refreshed: "已开始刷…",
				unchanged: "代码没有变化",
				collapse: "收起目录",
				expand: "展开目录",
				copyDiagram: "复制图表源码",
				copied: "已复…",
				diagramUnsupported: "这张图无法内置渲染，以下是它…Mermaid 源码",
				unverified: "未验证的源码位置",
				unverifiedHint: "生成时并未读过这个文件，或行号超出范…",
				sourceLocation: "打开源码位置",
				emptyPage: "这一页还没有内容…",
				errorAt: "失败",
				notFound: "没有找到这一…",
				retry: "重试",
				elapsed: "耗时",
				tokens: "引用",
				verified: "已验…",
				deleteFailed: "删除失败",
				generateFailed: "生成失败",
				requestFailed: "请求失败",
				modelUsed: "生成模型",
				enlarge: "放大",
				reset: "重置",
				close: "关闭",
				pickPage: "从左侧选一页开始阅…",
				pickPageHint: "目录里的每一页都标注了源码位置，点开即可查看…",
				noPagesYet: "还没有页…",
				catalogDegraded: "目录生成失败，已改用内置模板；正文仍然是根据代码生成的…",
				activity: "生成日志",
				currentPage: "当前页面",
				tokensUsed: "Token 用量",
				tokenDetail: "输入 / 输出",
				requestCount: "模型请求",
				runFailed: "上次生成失败",
				runFailedHint: "已完成的页面已保留在本地；调整选项后可以重新生成…",
				runStopped: "上次生成已停…",
				runStoppedHint: "已完成的页面已保留，重新生成会从零开始…",
				interruptedRun: "上次生成未完…",
				interruptedHint: "应用关闭或异常中断会让这些页面停在等待状态；重新生成会补齐全部页面…",
				partialFailure: "部分页面生成失败",
				partialFailureHint: "失败的页面已在目录里标红；可以一键重新生成全部失败页面，也可以只重试其中一页…",
				startedAt: "开始时…",
				finishedAt: "结束时间",
				errorLabel: "错误",
				retryPage: "重新生成此页",
				retryFailed: "重新生成失败页面",
				retryingFailed: "正在重新生成失败页面…",
				retryFailedDone: "失败页面已全部重新生成…",
				retryFailedLeft: "重新生成结束，仍有失败的页面",
				retryStalled: "等待页面重新生成超时，已停止批量重试…",
				pageWaiting: "这一页还在排…",
				pageWaitingHint: "轮到它时内容会自动出现在这里，不需要刷新…",
				pageGenerating: "这一页正在生…",
				pageGeneratingHint: "内容写好后这里会自动更新；也可以先去看其他已完成的页面…",
				eventLog: { phase: "进入阶段", catalog: "目录已生…", pageDone: "页面完成", pageFailed: "页面失败", pageStart: "正在生成", model: "生成模型", warning: "警告", done: "生成完成", failed: "生成失败", stopped: "已停…" },
			},
			en: {
				title: "Repo Wiki",
				guideTitle: "Repo Wiki",
				guideDescription: "A source-cited architecture guide for this codebase",
				loading: "Reading Wiki state…",
				noWiki: "This workspace has no Wiki yet",
				noWikiHint: "Let a model read the codebase once and keep an architecture guide you can consult at any time. Every conclusion carries a source location, and the result is stored locally rather than written into the repository.",
				generate: "Generate Wiki",
				regenerate: "Regenerate",
				stop: "Stop",
				remove: "Delete Wiki",
				removeConfirm: "Delete the locally stored Wiki? The archived versions stay on this machine, so it can be restored.",
				restore: "Restore previous",
				restored: "Restored the selected version.",
				purge: "Delete permanently",
				purged: "Deleted the local Wiki and all its versions permanently.",
				purgeConfirm: "Permanently delete the local Wiki and every archived version? This cannot be undone.",
				deletedRecoverable: "Deleted the local Wiki; its archived versions are still kept and can be restored.",
				backupAvailable: "Earlier versions are still available",
				backupSummary: "Newest archive · {done}/{total} pages done",
				backupHint: "After a mis-clicked regeneration, a failed run or a delete, earlier finished content can be recovered from the version history",
				history: "Version history",
				historyHint: "Versions from the last {days} days are kept, newest first; restoring replaces the current Wiki.",
				restoreVersion: "Restore this version",
				regenerateConfirm: "Regenerating replaces the current Wiki with new content ({done} pages are done). The old content goes into the version history and can be restored afterwards. Continue?",
				refreshConfirm: "The code changed, so refreshing regenerates the whole Wiki ({done} pages are done). The old content goes into the version history and can be restored afterwards. Continue?",
				options: "Generation options",
				language: "Language",
				model: "Model",
				modelDefault: "Follow the current session model",
				diagrams: "Generate diagrams",
				diagramsHint: "Draw a flow diagram where one genuinely helps",
				retries: "Retries",
				retriesHint: "Retries per page after a failure",
				phase: {
					analyzing: "Analysing the codebase",
					catalog: "Generating the table of contents",
					pages: "Generating pages",
					saving: "Saving the Wiki",
				},
				progress: "Progress",
				pagesDone: "done",
				pagesFailed: "failed",
				catalog: "Contents",
				metadata: "Metadata",
				branch: "Branch",
				commit: "Commit",
				updatedAt: "Updated",
				files: "Files",
				pageCount: "Wiki files",
				pageStatus: { waiting: "Waiting", generating: "Generating", done: "Done", failed: "Failed", stopped: "Stopped" },
				stale: "The code changed since this Wiki was generated",
				refresh: "Refresh",
				refreshed: "Refresh started",
				unchanged: "The code has not changed",
				collapse: "Hide contents",
				expand: "Show contents",
				copyDiagram: "Copy diagram source",
				copied: "Copied",
				diagramUnsupported: "This diagram has no built-in renderer; its Mermaid source follows",
				unverified: "Unverified source location",
				unverifiedHint: "This file was not read during generation, or the line range is out of bounds",
				sourceLocation: "Open the source location",
				emptyPage: "This page has no content yet.",
				errorAt: "Failed",
				notFound: "No such page",
				retry: "Retry",
				elapsed: "Elapsed",
				tokens: "Citations",
				verified: "verified",
				deleteFailed: "Delete failed",
				generateFailed: "Generation failed",
				requestFailed: "Request failed",
				modelUsed: "Model",
				enlarge: "Enlarge",
				reset: "Reset",
				close: "Close",
				pickPage: "Pick a page on the left to start reading",
				pickPageHint: "Every page in the contents carries source locations you can open.",
				noPagesYet: "No pages yet",
				catalogDegraded: "The table of contents could not be generated, so the built-in template stands in; the pages themselves are still generated from the code.",
				activity: "Activity",
				currentPage: "Writing",
				tokensUsed: "Tokens",
				tokenDetail: "input / output",
				requestCount: "Model requests",
				runFailed: "The last generation failed",
				runFailedHint: "The pages that finished are kept locally; adjust the options and generate again.",
				runStopped: "The last generation was stopped",
				runStoppedHint: "The pages that finished are kept; generating again starts from scratch.",
				interruptedRun: "The last generation did not finish",
				interruptedHint: "An application exit or crash leaves pages waiting; generating again writes every page.",
				partialFailure: "Some pages failed to generate",
				partialFailureHint: "Failed pages are marked red in the contents; regenerate every failed page at once, or retry just one of them.",
				startedAt: "Started",
				finishedAt: "Finished",
				errorLabel: "Error",
				retryPage: "Regenerate this page",
				retryFailed: "Regenerate failed pages",
				retryingFailed: "Regenerating failed pages…",
				retryFailedDone: "Every failed page was regenerated.",
				retryFailedLeft: "Regeneration finished; some pages still fail",
				retryStalled: "Timed out waiting for the page to regenerate; the batch stopped.",
				pageWaiting: "This page is still queued",
				pageWaitingHint: "Its content appears here automatically when its turn comes; no refresh needed.",
				pageGenerating: "This page is being written",
				pageGeneratingHint: "The content updates itself when the page lands; feel free to read a finished page meanwhile.",
				eventLog: { phase: "Stage", catalog: "Contents ready", pageDone: "Page done", pageFailed: "Page failed", pageStart: "Writing", model: "Model", warning: "Warning", done: "Generation finished", failed: "Generation failed", stopped: "Stopped" },
			},
		};

		//#region mermaid
		/** Monospace advance of one node-label character, in SVG user units. */
		const FLOW_MONO_CHAR = 7;
		/** Sans-serif advance of one edge-label character, in SVG user units. */
		const FLOW_SANS_CHAR = 6.6;
		/** Node labels wrap at this width. */
		const FLOW_LABEL_MAX = 190;
		/** Horizontal padding inside a node box, per side. */
		const FLOW_NODE_PAD_X = 14;
		/** Extra height reserved for the diagonal arrowheads an LR/RL edge carries. */
		const FLOW_ARROW_ROOM = 12;
		/** Floor sizes, so a graph of short labels still reads as boxes rather than chips. */
		const FLOW_MIN_WIDTH = 112;
		const FLOW_MIN_HEIGHT = 44;
		/** Room between a layer's boxes along the layering axis. */
		const FLOW_GAP_DEPTH = 46;
		/** Room between the boxes of one layer. */
		const FLOW_GAP_CROSS = 40;
		/** Edge-label text size, matching `.rw-diagram-edge-label`. */
		const FLOW_EDGE_LABEL_SIZE = 10.5;
		/** Edge-label pill padding, height, and gap between pills. */
		const FLOW_EDGE_LABEL_PAD = 7;
		const FLOW_EDGE_LABEL_HEIGHT = 17;

		/**
		 * Split one label the way Mermaid and the page prompts write it: at a
		 * `<br>` element, at a newline, and then into words so the rest can wrap.
		 * @param {string} label - the raw label text.
		 * @returns {string[]} the explicit lines, each still a sequence of words.
		 */
		function splitFlowLabel(label) {
			return String(label ?? "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line !== "");
		}

		/**
		 * Estimate the rendered width of one run of text.
		 *
		 * There is no DOM in the bundle's tests and no measuring pass while a page
		 * renders, so widths are estimated from per-character advances. They only
		 * have to agree with the SVG that draws the same string, which is why the
		 * result rounds down: a box a hair too wide is a box the text still fits.
		 * @param {string} text - the text to measure.
		 * @param {number} size - the character advance for the font in use.
		 * @returns {number} the estimated width in SVG user units.
		 */
		function flowTextWidth(text, size) {
			let width = 0;
			for (const character of String(text ?? "")) {
				// A CJK character is about twice as wide as a monospace Latin one in
				// the fallback stack the diagram inherits, so measuring every
				// character at the Latin advance would under-report these labels and
				// let them spill out of the box measured for them.
				width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(character) ? size * 2 : size;
			}
			return Math.floor(width);
		}

		/**
		 * Wrap one label into the lines a node box will draw.
		 *
		 * Words wrap to {@link FLOW_LABEL_MAX}; an explicit line from `<br/>` is
		 * never merged with the next, so an author's line breaks survive.
		 * @param {string} label - the raw label text.
		 * @returns {string[]} the lines, at least one.
		 */
		function wrapFlowLabel(label) {
			const budget = FLOW_LABEL_MAX;
			const lines = [];
			for (const explicit of splitFlowLabel(label)) {
				const words = explicit.split(/\s+/).filter((word) => word !== "");
				let line = "";
				for (const word of words) {
					const candidate = line === "" ? word : `${line} ${word}`;
					if (line !== "" && flowTextWidth(candidate, FLOW_MONO_CHAR) > budget) {
						lines.push(line);
						line = word;
						continue;
					}
					line = candidate;
				}
				// A single word can still be wider than the box: CJK text has no
				// spaces to break on, so fall back to cutting it between characters.
				if (flowTextWidth(line, FLOW_MONO_CHAR) > budget) {
					let piece = "";
					for (const character of line) {
						if (piece !== "" && flowTextWidth(piece + character, FLOW_MONO_CHAR) > budget) {
							lines.push(piece);
							piece = character;
							continue;
						}
						piece += character;
					}
					line = piece;
				}
				if (line !== "") lines.push(line);
			}
			if (lines.length === 0) lines.push(String(label ?? "").trim() || " ");
			return lines;
		}

		/**
		 * Measure every node's label into the box size it needs.
		 *
		 * Width grows with the longest wrapped line and height with the line count,
		 * but both are uniform across one graph …a layered picture reads as rows of
		 * equal boxes, and unequal heights would bend every connector. An LR/RL box
		 * also reserves room for the two diagonal arrowheads that land on its sides.
		 * @param {{direction: string, nodes: object[]}} graph - the parsed graph.
		 * @returns {{sizes: Map<string, object>, width: number, height: number}}
		 */
		function measureFlowchartNodes(graph) {
			const horizontal = graph.direction === "LR" || graph.direction === "RL";
			const measured = graph.nodes.map((node) => {
				const lines = wrapFlowLabel(node.label);
				const textWidth = Math.max(0, ...lines.map((line) => flowTextWidth(line, FLOW_MONO_CHAR)));
				return {
					id: node.id,
					lines,
					width: Math.min(FLOW_LABEL_MAX, textWidth) + FLOW_NODE_PAD_X * 2,
					height: lines.length * 16 + 18 + (horizontal ? FLOW_ARROW_ROOM : 0),
				};
			});
			const height = Math.max(FLOW_MIN_HEIGHT, ...measured.map((entry) => entry.height));
			const width = Math.max(FLOW_MIN_WIDTH, ...measured.map((entry) => entry.width));
			const sizes = new Map();
			for (const entry of measured) sizes.set(entry.id, { width, height, lines: entry.lines });
			return { sizes, width, height };
		}

		/**
		 * Split one line into the node references it contains.
		 *
		 * A node may carry a bracketed shape …`A[text]`, `A("text")`, `A{text}`,
		 * `A((text))`, `A>text]` …whose label may itself be quoted. The parser reads
		 * nodes and arrows through this one scanner, so the two can never disagree
		 * about where a node ends and an arrow begins.
		 * @param {string} text - the line to scan.
		 * @returns {{type: string, value: string, shape: string, label?: string}[]} the node references.
		 */
		function scanFlowchartNodes(text) {
			const source = String(text ?? "");
			const tokens = [];
			let cursor = 0;
			while (cursor < source.length) {
				const lead = /[A-Za-z0-9_.:]/.exec(source.slice(cursor));
				if (lead === null) break;
				cursor += lead.index;
				const id = /^[A-Za-z0-9_.:-]+/.exec(source.slice(cursor))[0];
				cursor += id.length;
				const token = { type: "node", value: id, shape: "rect" };
				const opener = source[cursor];
				if (opener === "[" || opener === "(" || opener === "{") {
					const close = opener === "[" ? "]" : opener === "(" ? ")" : "}";
					cursor += 1;
					let value = null;
					if (source[cursor] === "\"") {
						const end = source.indexOf("\"", cursor + 1);
						if (end !== -1) {
							value = source.slice(cursor + 1, end);
							cursor = end + 1;
						}
					}
					const end = source.indexOf(close, cursor);
					if (end !== -1) {
						if (value === null) value = source.slice(cursor, end);
						cursor = end + 1;
						// `A((text))` is one extra bracket on each side of the same shape.
						if (opener === "(" && source[cursor] === ")") cursor += 1;
						token.shape = opener === "[" ? "rect" : opener === "(" ? "round" : "diamond";
						token.label = value.replace(/\s+/g, " ").trim();
					}
				}
				tokens.push(token);
			}
			return tokens;
		}

		/**
		 * Parse the subset of Mermaid that the Wiki prompts actually ask for: a
		 * `flowchart`/`graph` declaration followed by node and edge lines.
		 *
		 * The client's shared-module table has no Mermaid runtime and this plugin
		 * ships no bundler output, so rather than pretending to render Mermaid this
		 * module renders the one diagram family it can lay out correctly …nodes and
		 * directed edges …and shows the source for everything else. Parsing is
		 * deliberately tolerant: an unrecognized line is dropped rather than failing
		 * the page, because a diagram is never worth losing prose over.
		 *
		 * Node shapes and labels: `A`, `A[text]`, `A["quoted text"]`, `A(text)`,
		 * `A((text))`, `A{text}`, and a `<br/>` inside any label is a line break. An
		 * id-only line declares a node without an edge. Edges take their label from
		 * either spelling …`A -- label --> B` or `A -->|label| B` …and a duplicate
		 * edge collapses into the first one that described it.
		 *
		 * @param {string} source - the fenced block's body.
		 * @returns {{kind: string, direction: string, nodes: object[], edges: object[]}}
		 */
		function parseMermaidFlowchart(source) {
			const lines = String(source).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
			const graph = { kind: "unsupported", direction: "TD", nodes: [], edges: [] };
			if (lines.length === 0) return graph;
			const header = /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)?/i.exec(lines[0]);
			if (header === null) return graph;
			graph.kind = "flowchart";
			graph.direction = (header[2] ?? "TD").toUpperCase();
			if (graph.direction === "TB") graph.direction = "TD";

			const byId = new Map();
			/**
			 * Register one node, or fill in a label a later line added for it.
			 * @param {{value: string, label?: string, shape: string}} token - the scanned reference.
			 * @returns {object} the node record.
			 */
			const register = (token) => {
				const existing = byId.get(token.value);
				if (existing !== undefined) {
					if (token.label !== undefined && token.label !== "") existing.label = token.label;
					if (token.shape !== "rect") existing.shape = token.shape;
					return existing;
				}
				const created = {
					id: token.value,
					label: token.label === undefined || token.label === "" ? token.value : token.label,
					shape: token.shape,
				};
				byId.set(created.id, created);
				graph.nodes.push(created);
				return created;
			};

			/**
			 * Cut one line into the pieces on either side of its arrows.
			 *
			 * The line is split at each arrow, which leaves the node references in the
			 * pieces and the arrow's own text in the separators. Both label spellings
			 * live in that separator: `-- label -->` keeps it between the dashes and
			 * `-->|label|` keeps it inside the pipes. The labelled forms come first in
			 * the alternation, so a label is never itself read as a node.
			 * @param {string} line - the source line.
			 * @returns {{pieces: string[], labels: string[]}} the pieces, and the label
			 *   each arrow carried (empty for an unlabelled arrow).
			 */
			const cutArrows = (line) => {
				const pieces = [];
				const labels = [];
				const pattern = /-{2,}\s*("[^"]*"|[^\s>][^>]*?)\s*-{2,}>|<--\s*([^\s>-][^>]*?)\s*--|<->|<?-\.+->|<?={2,}>|<?-{1,3}[->x](?:\|([^|]*)\|)?/g;
				let cursor = 0;
				let match = pattern.exec(line);
				while (match !== null) {
					pieces.push(line.slice(cursor, match.index));
					labels.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/^"|"$/g, "").trim());
					cursor = match.index + match[0].length;
					match = pattern.exec(line);
				}
				pieces.push(line.slice(cursor));
				return { pieces, labels };
			};

			for (const line of lines.slice(1)) {
				if (line.startsWith("%%")) continue;
				const tokens = scanFlowchartNodes(line);
				if (tokens.length === 0) continue;
				// Statements that name nodes without drawing between them.
				if (/^(?:classDef|class|style|linkStyle|click|subgraph|end|direction)\b/.test(line)) {
					tokens.forEach(register);
					continue;
				}
				const { pieces, labels } = cutArrows(line);
				// Each piece between two arrows holds one or more node references. A `&`
				// inside a piece lists siblings on the same side of the arrow, so every
				// node in a piece connects to the nodes of the previous piece …the shape
				// `A & B --> C` needs …while a single node simply chains onwards.
				const sides = pieces.map((piece) => scanFlowchartNodes(piece).map(register));
				for (let sideIndex = 1; sideIndex < sides.length; sideIndex += 1) {
					const text = labels[sideIndex - 1] ?? "";
					for (const from of sides[sideIndex - 1]) {
						for (const to of sides[sideIndex]) {
							if (graph.edges.some((edge) => edge.from === from.id && edge.to === to.id)) continue;
							graph.edges.push(text === "" ? { from: from.id, to: to.id } : { from: from.id, to: to.id, label: text });
						}
					}
				}
			}
			return graph;
		}

		/**
		 * Measure each edge's label so the layout can reserve the room it needs.
		 * @param {object[]} edges - the parsed edges.
		 * @returns {Map<number, {width: number, height: number, text: string}>} label boxes by edge index.
		 */
		function measureFlowchartLabels(edges) {
			const labels = new Map();
			edges.forEach((edge, index) => {
				const text = typeof edge.label === "string" ? edge.label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
				if (text === "") return;
				labels.set(index, {
					text,
					width: flowTextWidth(text, FLOW_SANS_CHAR) + FLOW_EDGE_LABEL_PAD * 2,
					height: FLOW_EDGE_LABEL_HEIGHT,
				});
			});
			return labels;
		}

		/**
		 * Find the edges that close a cycle in the graph.
		 *
		 * Mermaid users write the occasional feedback edge, and a layering pass
		 * cannot honour one. Dropping the edge would lose information, so it is
		 * reversed for the layout pass only and the router draws it as a lane around
		 * the side of the picture.
		 * @param {object[]} edges - the parsed edges.
		 * @returns {Set<number>} the indices of the edges that will point backwards.
		 */
		function markFlowchartFeedback(edges) {
			const back = new Set();
			const state = new Map();
			/**
			 * Walk the graph depth-first from one node, noting cycle-closing edges.
			 * @param {string} id - the node being entered.
			 */
			const visit = (id) => {
				state.set(id, 1);
				edges.forEach((edge, index) => {
					if (edge.from !== id) return;
					const seen = state.get(edge.to);
					if (seen === 1) back.add(index);
					else if (seen === undefined) visit(edge.to);
				});
				state.set(id, 2);
			};
			for (const edge of edges) if (state.get(edge.from) === undefined) visit(edge.from);
			return back;
		}

		/**
		 * Put every node in a layer and order the layers for few crossings.
		 *
		 * Longest-path layering gives each node the layer one past its deepest
		 * predecessor, so a chain of N nodes spans N layers. An initial order by
		 * graph order is then refined by two barycenter sweeps …down towards parents,
		 * then up towards children …which is what stops long edges from criss-
		 * crossing the picture.
		 * @param {{nodes: object[], edges: object[]}} graph - the parsed graph.
		 * @returns {object} `{layers, layerOf, incoming, outgoing, back}` with the
		 *   layers holding node records in drawing order.
		 */
		function orderFlowchartLayers(graph) {
			const back = markFlowchartFeedback(graph.edges);
			const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
			const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
			graph.edges.forEach((edge, index) => {
				if (!incoming.has(edge.to) || !outgoing.has(edge.from)) return;
				// A self-loop constrains nothing about layering, and feeding it back
				// through the recursion makes a node its own predecessor.
				if (edge.from === edge.to) return;
				const [from, to] = back.has(index) ? [edge.to, edge.from] : [edge.from, edge.to];
				incoming.get(to).push(from);
				outgoing.get(from).push(to);
			});

			const layerOf = new Map();
			const visiting = new Set();
			/**
			 * Resolve one node's layer.
			 * @param {string} id - the node id.
			 * @returns {number} the layer index.
			 */
			const resolve = (id) => {
				if (layerOf.has(id)) return layerOf.get(id);
				if (visiting.has(id)) return 0;
				visiting.add(id);
				const parents = incoming.get(id) ?? [];
				const layer = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => resolve(parent) + 1));
				visiting.delete(id);
				layerOf.set(id, layer);
				return layer;
			};
			for (const node of graph.nodes) resolve(node.id);

			const grouped = new Map();
			for (const node of graph.nodes) {
				const layer = layerOf.get(node.id) ?? 0;
				if (!grouped.has(layer)) grouped.set(layer, []);
				grouped.get(layer).push(node);
			}
			const layers = [...grouped.keys()].sort((left, right) => left - right).map((layer) => grouped.get(layer));
			const orderOf = new Map();
			/** Record each node's index inside its layer. */
			const index = () => {
				for (const layer of layers) layer.forEach((node, position) => orderOf.set(node.id, position));
			};
			index();

			/**
			 * Average the positions of one node's neighbours in a given layer.
			 * @param {object} node - the node to score.
			 * @param {Map<string, string[]>} neighbours - the neighbour lists.
			 * @param {number} layer - the neighbour layer to look at.
			 * @returns {number} the barycenter, or the node's own position when it has no neighbours there.
			 */
			const barycenter = (node, neighbours, layer) => {
				const across = (neighbours.get(node.id) ?? []).filter((id) => layerOf.get(id) === layer);
				if (across.length === 0) return orderOf.get(node.id) ?? 0;
				return across.reduce((total, id) => total + (orderOf.get(id) ?? 0), 0) / across.length;
			};

			for (let sweep = 0; sweep < 2; sweep += 1) {
				for (let layer = 1; layer < layers.length; layer += 1) {
					const scores = new Map(layers[layer].map((node) => [node.id, barycenter(node, incoming, layer - 1)]));
					layers[layer] = [...layers[layer]].sort((left, right) => (scores.get(left.id) - scores.get(right.id)) || (orderOf.get(left.id) - orderOf.get(right.id)));
					index();
				}
				for (let layer = layers.length - 2; layer >= 0; layer -= 1) {
					const scores = new Map(layers[layer].map((node) => [node.id, barycenter(node, outgoing, layer + 1)]));
					layers[layer] = [...layers[layer]].sort((left, right) => (scores.get(left.id) - scores.get(right.id)) || (orderOf.get(left.id) - orderOf.get(right.id)));
					index();
				}
			}
			return { layers, layerOf, incoming, outgoing, back };
		}

		/**
		 * Lay a parsed flowchart out in layers: sizes first, then positions.
		 *
		 * For a down/up graph the layers run down the picture and a layer's boxes sit
		 * side by side; for LR/RL the layers run across. `positions` are box centres
		 * in SVG user units around the origin, so the router never has to work in
		 * painted coordinates. The gap past a layer grows with the widest edge label
		 * crossing it, which is what leaves the pills somewhere to go.
		 * @param {{direction: string, nodes: object[], edges: object[]}} graph - the parsed graph.
		 * @returns {object} the layout: size, positions, layers, routes, extent and the
		 *   `depthOf`/`boxOf` helpers the drawing code needs.
		 */
		function layoutFlowchart(graph) {
			const direction = graph.direction ?? "TD";
			const horizontal = direction === "LR" || direction === "RL";
			const mirrored = direction === "BT" || direction === "RL";
			const measure = measureFlowchartNodes(graph);
			const order = orderFlowchartLayers(graph);
			const labels = measureFlowchartLabels(graph.edges);
			const layers = order.layers;
			const layerCount = Math.max(1, layers.length);
			const sizeOf = (id) => measure.sizes.get(id) ?? { width: measure.width, height: measure.height, lines: [] };
			const thickness = horizontal ? measure.width : measure.height;
			const across = horizontal ? measure.height : measure.width;

			// Room after each layer: the base gap, or more when a wide label crosses it.
			const labelRoom = new Array(layerCount).fill(0);
			graph.edges.forEach((edge, index) => {
				const box = labels.get(index);
				if (box === undefined) return;
				const from = order.layerOf.get(edge.from) ?? 0;
				const to = order.layerOf.get(edge.to) ?? 0;
				for (let layer = Math.min(from, to); layer < Math.max(from, to); layer += 1) {
					labelRoom[layer] = Math.max(labelRoom[layer], horizontal ? box.height : box.width);
				}
			});

			// A depth band per layer, and a cross band per node inside its layer.
			const depthBand = [];
			for (let layer = 0; layer < layerCount; layer += 1) {
				if (layer === 0) depthBand[0] = thickness / 2;
				else depthBand[layer] = depthBand[layer - 1] + thickness + Math.max(FLOW_GAP_DEPTH, labelRoom[layer - 1] / 2 + 22);
			}
			const crossBand = new Map();
			let widestCross = 0;
			for (const layer of layers) {
				const total = layer.reduce((sum, node) => sum + across, 0) + Math.max(0, layer.length - 1) * FLOW_GAP_CROSS;
				widestCross = Math.max(widestCross, total);
				let cursor = -total / 2;
				for (const node of layer) {
					crossBand.set(node.id, cursor + across / 2);
					cursor += across + FLOW_GAP_CROSS;
				}
			}
			const positions = new Map();
			for (const node of graph.nodes) {
				const along = depthBand[order.layerOf.get(node.id) ?? 0];
				const cross = crossBand.get(node.id) ?? 0;
				positions.set(node.id, horizontal ? { x: along, y: cross } : { x: cross, y: along });
			}
			const boxOf = (id) => {
				const centre = positions.get(id) ?? { x: 0, y: 0 };
				const size = sizeOf(id);
				return { x: centre.x, y: centre.y, width: size.width, height: size.height, lines: size.lines };
			};

			// The reach along the layering axis, needed before mirroring.
			const reach = depthBand[layerCount - 1] + thickness / 2;
			// BT and RL are the same layering drawn from the other end: mirror the whole
			// picture now, so every later step …routing included …sees final
			// coordinates and no direction special-casing leaks past this point.
			if (mirrored) {
				for (const [id, centre] of positions) {
					const axis = horizontal ? "x" : "y";
					positions.set(id, { ...centre, [axis]: reach - centre[axis] });
				}
			}
			// Depth read back from the finished positions rather than recomputed from the
			// layering, so a mirrored graph reports its real flow direction. The
			// comparison is ordinal only: the router asks whether one node is further
			// along the flow than another, and whether they are level.
			const depthAxis = horizontal ? "x" : "y";
			const flowSide = direction === "BT" || direction === "RL" ? -1 : 1;
			const depthOf = (id) => flowSide * ((positions.get(id) ?? { x: 0, y: 0 })[depthAxis] ?? 0);
			const layout = {
				direction,
				horizontal,
				mirrored,
				sizes: measure.sizes,
				positions,
				layers: layers.map((layer) => layer.map((node) => node.id)),
				labels,
				boxOf,
				depthOf,
				reach,
				widestCross,
				across,
				thickness,
				back: order.back,
			};
			const routed = routeFlowchartEdges(graph, layout);
			return { ...layout, edges: routed.edges, edgeLabels: routed.labels, extent: routed.extent };
		}

		/**
		 * Clip a segment leaving a box centre towards a point onto the box outline.
		 *
		 * Every connector starts and ends on a border, never inside a box, so an
		 * arrow can never be drawn through a node's text.
		 * @param {{x: number, y: number, width: number, height: number}} box - the box.
		 * @param {number} towardX - the x the segment aims at.
		 * @param {number} towardY - the y the segment aims at.
		 * @returns {{x: number, y: number}} the point on the outline.
		 */
		function clipFlowchartBox(box, towardX, towardY) {
			const dx = towardX - box.x;
			const dy = towardY - box.y;
			if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
			const limitX = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
			const limitY = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
			const scale = Math.min(limitX, limitY);
			return { x: box.x + dx * scale, y: box.y + dy * scale };
		}

		/**
		 * Route every edge from one box border to another and place its label.
		 *
		 * The rules, in the order they apply: two boxes in one layer are joined side
		 * to side; an edge that moves forward through the layers leaves the bottom
		 * (or right) border and enters the opposite border with a cubic curve whose
		 * tangent follows the flow, or a plain line when the boxes share a column; an
		 * edge that points back through the layers runs in a lane outside every box,
		 * on the side its arrow enters the target from. Labels are centred on their
		 * path's midpoint and then pushed clear of the labels already placed, which is
		 * what keeps an annotation off the arrow it annotates.
		 * @param {{edges: object[]}} graph - the parsed graph.
		 * @param {object} layout - `{boxOf, depthOf, labels, horizontal, widestCross, across, back}`.
		 * @returns {{edges: object[], labels: object[], extent: {width: number, height: number, offsetX: number, offsetY: number}}}
		 */
		function routeFlowchartEdges(graph, layout) {
			const { boxOf, depthOf, labels, horizontal, widestCross, across } = layout;
			/** The lane step for feedback edges, and the count on each side. */
			const laneStep = 16;
			const lanes = { right: 0, left: 0 };
			const margin = 14;
			const routes = graph.edges.map((edge, index) => {
				const from = boxOf(edge.from);
				const to = boxOf(edge.to);
				// A self-loop has no direction to route along, so it gets its own
				// shape: out of the right border, round the outside and back into the
				// right border lower down. Without this it would be handed to the
				// same-layer code, which would produce a zero-length edge.
				if (edge.from === edge.to) {
					// Out of the right border, round the outside and back in over the top,
					// so the arrowhead meets the border vertically from outside — the same
					// way every other edge arrives — instead of sliding along it.
					const bulge = Math.max(24, Math.min(44, from.height / 2 + 14));
					// Start a few pixels clear of the right border: a tail point on, or
					// within a pixel of, the border is ambiguous to anything measuring
					// whether the arrow's last segment enters the box.
					const start = { x: from.x + from.width / 2 + 4, y: from.y - from.height / 4 };
					const end = { x: to.x, y: to.y - to.height / 2 };
					// Approach the top border from directly above, so the final segment
					// arrives vertically and the arrowhead reads as entering the box.
					const lift = 16;
					return {
						index,
						kind: "same",
						start,
						end,
						curve: [start, { x: start.x + bulge, y: start.y }, { x: end.x + bulge, y: end.y - lift }, end],
					};
				}
				const forward = (depthOf(edge.to) ?? 0) > (depthOf(edge.from) ?? 0);
				const level = (depthOf(edge.to) ?? 0) === (depthOf(edge.from) ?? 0);
				if (level) {
					// One layer: leave the side that faces the target, re-enter the other.
					if (horizontal) {
						const down = to.y >= from.y;
						const start = { x: from.x, y: from.y + (down ? from.height / 2 : -from.height / 2) };
						const end = { x: to.x, y: to.y + (down ? -to.height / 2 : to.height / 2) };
						const bend = Math.max(14, Math.min(30, Math.abs(end.y - start.y) / 2));
						return { index, kind: "same", start, end, curve: [start, { x: start.x, y: start.y + (down ? bend : -bend) }, { x: end.x, y: end.y + (down ? -bend : bend) }, end] };
					}
					const right = to.x >= from.x;
					const start = { x: from.x + (right ? from.width / 2 : -from.width / 2), y: from.y };
					const end = { x: to.x + (right ? -to.width / 2 : to.width / 2), y: to.y };
					const bend = Math.max(14, Math.min(30, Math.abs(end.x - start.x) / 2));
					return { index, kind: "same", start, end, curve: [start, { x: start.x + (right ? bend : -bend), y: start.y }, { x: end.x + (right ? -bend : bend), y: end.y }, end] };
				}
				if (forward) {
					// The exit and entry borders follow the flow, which the signed depth
					// already carries: a positive step in depth leaves the far border of the
					// source and enters the near border of the target, whichever way the
					// picture runs.
					// An edge that skips over intermediate layers has to step around the
					// boxes sitting between its ends, or it draws a line straight through
					// their labels. It leaves sideways, runs down its own lane and comes
					// back in, which keeps every box clear.
					const spansLayers = Math.abs((depthOf(edge.to) ?? 0) - (depthOf(edge.from) ?? 0)) > 1;
					if (horizontal) {
						const towardsRight = to.x > from.x;
						const start = { x: from.x + (towardsRight ? from.width / 2 : -from.width / 2), y: from.y };
						const end = { x: to.x + (towardsRight ? -to.width / 2 : to.width / 2), y: to.y };
						if (spansLayers) {
							// A hop over other layers has no free corridor at the row's own
							// height: every box in between sits on it. Leave sideways, travel
							// above or below the whole band, and come back in.
							let top = Infinity;
							let bottom = -Infinity;
							for (const node of graph.nodes) {
								const box = boxOf(node.id);
								top = Math.min(top, box.y - box.height / 2);
								bottom = Math.max(bottom, box.y + box.height / 2);
							}
							const laneY = end.y >= start.y ? bottom + 20 : top - 20;
							const lead = 18;
							const outX = start.x + (towardsRight ? lead : -lead);
							const inX = end.x + (towardsRight ? -lead : lead);
							return {
								index,
								kind: "forward",
								start,
								end,
								curve: [start, { x: outX, y: start.y }, { x: outX, y: laneY }, { x: inX, y: laneY }, { x: inX, y: end.y }, end],
							};
						}
						if (Math.abs(start.y - end.y) < to.height / 2) return { index, kind: "forward", start, end, curve: [start, end] };
						const bend = Math.max(18, Math.min(70, Math.abs(end.x - start.x) * 0.45));
						return { index, kind: "forward", start, end, curve: [start, { x: start.x + (towardsRight ? bend : -bend), y: start.y }, { x: end.x + (towardsRight ? -bend : bend), y: end.y }, end] };
					}
					const downwards = to.y > from.y;
					const start = { x: from.x, y: from.y + (downwards ? from.height / 2 : -from.height / 2) };
					const end = { x: to.x, y: to.y + (downwards ? -to.height / 2 : to.height / 2) };
					if (spansLayers) {
						// Same column but several layers apart: the straight line would run
						// down the middle of every box in between, so it leaves the source
						// sideways, travels in its own lane clear of the boxes, and enters
						// the target from the side too.
						lanes.right += 1;
						const laneX = start.x + Math.max(widestCross / 2 + 22 + lanes.right * laneStep, from.width / 2 + 18);
						return { index, kind: "forward", start, end, curve: [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end] };
					}
					if (Math.abs(start.x - end.x) < to.width / 2) return { index, kind: "forward", start, end, curve: [start, end] };
					const bend = Math.max(18, Math.min(70, Math.abs(end.y - start.y) * 0.45));
					return { index, kind: "forward", start, end, curve: [start, { x: start.x, y: start.y + (downwards ? bend : -bend) }, { x: end.x, y: end.y + (downwards ? -bend : bend) }, end] };
				}
				// Backwards through the layers: a lane outside every box. A down/up picture
				// has room beside the boxes and enters the target from its side; an LR/RL
				// picture has room above and below them and enters from the top.
				const side = edge.from <= edge.to ? "right" : "left";
				lanes[side] += 1;
				const offset = widestCross / 2 + 18 + (lanes[side] - 1) * laneStep;
				if (horizontal) {
					// Clear the tallest box on the way: the boxes are spread along the
					// cross axis, so a lane at a fixed height above the middle would run
					// straight through any box that sits higher than that.
					let topY = -Infinity;
					let laneSpan = 0;
					for (const node of graph.nodes) {
						const box = boxOf(node.id);
						topY = Math.max(topY, -box.y + box.height / 2);
						laneSpan = Math.max(laneSpan, box.width);
					}
					const start = { x: from.x, y: from.y - from.height / 2 };
					const end = { x: to.x, y: to.y - to.height / 2 };
					const laneY = -(topY + 18 + (lanes[side] - 1) * laneStep);
					return { index, kind: "back", start, end, curve: [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end] };
				}
				const start = { x: from.x + (side === "right" ? from.width / 2 : -from.width / 2), y: from.y };
				const end = { x: to.x + (side === "right" ? to.width / 2 : -to.width / 2), y: to.y };
				const laneX = (side === "right" ? offset : -offset);
				return { index, kind: "back", start, end, curve: [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end] };
			});

			// Place each label on its own path, clear of every box and of the pills already
			// placed. The search walks a small ring of candidate offsets around the
			// path's midpoint and takes the first that touches nothing, so two labels on
			// parallel edges end up side by side instead of stacked.
			const pills = [];
			/** Whether a pill centred at `x`,`y` would overlap a box or a placed pill. */
			const collides = (x, y, width, height) => {
				for (const node of graph.nodes) {
					const box = boxOf(node.id);
					if (Math.abs(x - box.x) < (width + box.width) / 2 + 3 && Math.abs(y - box.y) < (height + box.height) / 2 + 3) return true;
				}
				return pills.some((pill) => Math.abs(x - pill.x) < (width + pill.width) / 2 + 4 && Math.abs(y - pill.y) < (height + pill.height) / 2 + 4);
			};
			/**
			 * How badly a pill centred at `x`,`y` would sit on top of a box or pill.
			 *
			 * Only used to rank losing candidates when nothing fits: the smallest
			 * overlap wins, so a crowded label leans out of the way instead of
			 * landing squarely on a box.
			 * @param {number} x - centre x.
			 * @param {number} y - centre y.
			 * @param {number} width - pill width.
			 * @param {number} height - pill height.
			 * @returns {number} the overlapped area in square pixels.
			 */
			const collisionArea = (x, y, width, height) => {
				let area = 0;
				const overlap = (otherX, otherY, otherWidth, otherHeight) => {
					const dx = (width + otherWidth) / 2 - Math.abs(x - otherX);
					const dy = (height + otherHeight) / 2 - Math.abs(y - otherY);
					return dx > 0 && dy > 0 ? dx * dy : 0;
				};
				for (const node of graph.nodes) {
					const box = boxOf(node.id);
					area += overlap(box.x, box.y, box.width, box.height);
				}
				for (const pill of pills) area += overlap(pill.x, pill.y, pill.width, pill.height);
				return area;
			};
			for (const route of routes) {
				const label = labels.get(route.index);
				if (label === undefined) continue;
				const anchor = route.curve[Math.max(0, Math.floor((route.curve.length - 1) / 2))];
				// A starting offset that steps the pill off the stroke it annotates.
				const leadX = route.kind === "forward" && !horizontal ? label.width / 2 + 5 : 0;
				const leadY = route.kind === "forward" && horizontal ? -(label.height / 2 + 3) : 0;
				// Ring of candidate offsets, nearest first. In a layered graph the
				// gaps are narrow, so a pill beside a box usually only fits by
				// stepping along the axis that is NOT the layering axis: that is the
				// one with room, because the layers themselves are the squeeze. The
				// rings grow until something fits, and a pill that never fits still
				// keeps the least-bad spot instead of the colliding midpoint.
				const stepX = label.width / 2 + 8;
				const stepY = label.height + 5;
				const order = [];
				for (let ring = 0; ring <= 4; ring += 1) {
					for (let stepYIndex = -ring; stepYIndex <= ring; stepYIndex += 1) {
						for (let stepXIndex = -ring; stepXIndex <= ring; stepXIndex += 1) {
							if (Math.max(Math.abs(stepXIndex), Math.abs(stepYIndex)) !== ring) continue;
							order.push([stepXIndex, stepYIndex]);
						}
					}
				}
				let chosen = { x: anchor.x + leadX, y: anchor.y + leadY };
				let bestPenalty = Infinity;
				for (const [stepXIndex, stepYIndex] of order) {
					const candidate = {
						x: anchor.x + leadX + stepXIndex * stepX,
						y: anchor.y + leadY + stepYIndex * stepY,
					};
					const penalty = collides(candidate.x, candidate.y, label.width, label.height)
						? collisionArea(candidate.x, candidate.y, label.width, label.height) + Math.hypot(stepXIndex, stepYIndex) * 0.001
						: 0;
					if (penalty < bestPenalty) {
						bestPenalty = penalty;
						chosen = candidate;
						if (penalty === 0) break;
					}
				}
				pills.push({ index: route.index, x: chosen.x, y: chosen.y, width: label.width, height: label.height, text: label.text });
			}

			// The painted frame: every box and every pill, plus air around them.
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			const include = (x, y, width, height) => {
				minX = Math.min(minX, x - width / 2);
				maxX = Math.max(maxX, x + width / 2);
				minY = Math.min(minY, y - height / 2);
				maxY = Math.max(maxY, y + height / 2);
			};
			for (const node of graph.nodes) {
				const box = boxOf(node.id);
				include(box.x, box.y, box.width, box.height);
			}
			for (const pill of pills) include(pill.x, pill.y, pill.width, pill.height);
			if (!Number.isFinite(minX)) include(FLOW_MIN_WIDTH / 2, FLOW_MIN_HEIGHT / 2, FLOW_MIN_WIDTH, FLOW_MIN_HEIGHT);
			return {
				edges: routes,
				labels: pills,
				extent: { width: maxX - minX + margin * 2, height: maxY - minY + margin * 2, offsetX: margin - minX, offsetY: margin - minY },
			};
		}

		/**
		 * Turn one routed edge into an SVG path command.
		 *
		 * A two-point curve is a straight line; a four-point one is a cubic whose
		 * control points keep the tangent along the flow at both ends, so the arrow
		 * meets the border square-on. Anything else is joined as a polyline.
		 * @param {object[]} points - the route, start first and end last.
		 * @returns {string} the `d` attribute.
		 */
		function flowchartEdgePath(points) {
			/** Round to a tenth, so the attribute stays short. */
			const round = (value) => Math.round(value * 10) / 10;
			const [start, ...rest] = points;
			if (rest.length === 0) return "M 0 0";
			const move = `M ${round(start.x)} ${round(start.y)}`;
			if (rest.length === 1) return `${move} L ${round(rest[0].x)} ${round(rest[0].y)}`;
			if (rest.length === 2) return `${move} L ${round(rest[0].x)} ${round(rest[0].y)} L ${round(rest[1].x)} ${round(rest[1].y)}`;
			if (rest.length === 3) return `${move} C ${round(rest[0].x)} ${round(rest[0].y)} ${round(rest[1].x)} ${round(rest[1].y)} ${round(rest[2].x)} ${round(rest[2].y)}`;
			return `${move} ${rest.map((point) => `L ${round(point.x)} ${round(point.y)}`).join(" ")}`;
		}

		//#region markdown
		/**
		 * Split one Markdown table row into its cells.
		 *
		 * A leading or trailing pipe is decoration, and `\|` is an escaped literal
		 * pipe inside a cell rather than a separator.
		 * @param {string} line - the row.
		 * @returns {string[]} the cells.
		 */
		function splitRow(line) {
			return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
		}

		/**
		 * Split a page body into block-level chunks.
		 *
		 * A focused subset, not a full CommonMark parser: headings, fenced code
		 * (including `mermaid`), bullet and numbered lists, block quotes, tables,
		 * rules, and paragraphs. That is the shape the page prompts ask a model for,
		 * and a partial renderer that shows the rest as paragraphs is honest about
		 * what it does not understand.
		 *
		 * @param {string} markdown - the page body.
		 * @returns {object[]} the blocks.
		 */
		function parseBlocks(markdown) {
			const lines = String(markdown ?? "").split(/\r?\n/);
			const blocks = [];
			let index = 0;
			while (index < lines.length) {
				const line = lines[index];
				if (line.trim() === "") {
					index += 1;
					continue;
				}
				const fence = /^\s*```(\S*)\s*$/.exec(line);
				if (fence !== null) {
					const language = fence[1];
					const body = [];
					index += 1;
					while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
						body.push(lines[index]);
						index += 1;
					}
					index += 1;
					blocks.push({ type: "code", language, text: body.join("\n") });
					continue;
				}
				const heading = /^(#{1,6})\s+(.*)$/.exec(line);
				if (heading !== null) {
					blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
					index += 1;
					continue;
				}
				if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
					blocks.push({ type: "rule" });
					index += 1;
					continue;
				}
				// A GFM table: a header row of cells, then a delimiter row of dashes.
				if (line.includes("|")) {
					const rows = [];
					const start = index;
					while (index < lines.length && lines[index].includes("|")) {
						rows.push(splitRow(lines[index]));
						index += 1;
					}
					if (rows.length >= 2 && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
						const align = rows[1].map((cell) => {
							const value = cell.trim();
							if (value.startsWith(":") && value.endsWith(":")) return "center";
							return value.endsWith(":") ? "right" : "left";
						});
						blocks.push({ type: "table", head: rows[0], rows: rows.slice(2), align });
						continue;
					}
					index = start;
				}
				if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
					const items = [];
					while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
						items.push(lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
						index += 1;
						// Continuation lines of a wrapped item belong to that item.
						while (index < lines.length && lines[index].trim() !== "" && !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) && !/^\s*```/.test(lines[index])) {
							items[items.length - 1] += ` ${lines[index].trim()}`;
							index += 1;
						}
					}
					blocks.push({ type: "list", items });
					continue;
				}
				if (/^\s*>\s?/.test(line)) {
					const quoted = [];
					while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
						quoted.push(lines[index].replace(/^\s*>\s?/, ""));
						index += 1;
					}
					blocks.push({ type: "quote", text: quoted.join("\n") });
					continue;
				}
				const paragraph = [];
				while (index < lines.length && lines[index].trim() !== "" && !/^\s*```/.test(lines[index]) && !/^#{1,6}\s/.test(lines[index]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) && !/^\s*>\s?/.test(lines[index])) {
					paragraph.push(lines[index]);
					index += 1;
				}
				blocks.push({ type: "paragraph", text: paragraph.join("\n") });
			}
			return blocks;
		}

		/** A citation as the page prose writes it: `path:12-34`, optionally inside backticks. */
		const CITATION = /^([^\s`]+?):(?:#?L?)(\d+)(?:\s*[-–]\s*(?:#?L?)(\d+))?$/;

		/**
		 * Match a span of text against the citation shape.
		 * @param {string} text - candidate text, with any backticks already removed.
		 * @returns {{path: string, start: number, end: number} | null} the citation.
		 */
		function matchCitation(text) {
			const match = CITATION.exec(String(text).trim());
			if (match === null) return null;
			const start = Number.parseInt(match[2], 10);
			const end = match[3] === undefined ? start : Number.parseInt(match[3], 10);
			if (!Number.isFinite(start) || start < 1) return null;
			if (!Number.isFinite(end) || end < start) return null;
			return { path: match[1].replace(/\\/g, "/").replace(/^\.\//, ""), start, end };
		}

		/**
		 * Render inline Markdown into React nodes, turning source locations into
		 * controls.
		 *
		 * Citation handling is where this renderer earns its keep. A span that names
		 * a location the generation verified becomes a button that opens the file at
		 * that line in the workspace viewer. A span that names a location the verifier
		 * rejected becomes visibly marked text that does *not* pretend to be a link …		 * which is the whole reason the pipeline verifies citations in the first place.
		 *
		 * @param {string} text - inline markdown.
		 * @param {object} context - `{ t, onCite, verified, unverified }`.
		 * @returns {any[]} React children.
		 */
		function renderInline(text, context) {
			const nodes = [];
			const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
			let cursor = 0;
			let match;
			let key = 0;
			while ((match = pattern.exec(text)) !== null) {
				if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
				const token = match[0];
				// Advance past the match: without this the tail append below
				// re-emits the whole string after every token, duplicating text.
				cursor = match.index + token.length;
				if (token.startsWith("`")) {
					const inner = token.slice(1, -1);
					const citation = matchCitation(inner);
					if (citation !== null) {
						const key0 = `${citation.path}:${citation.start}-${citation.end}`;
						const isVerified = context.verified.has(key0);
						nodes.push(h(
							"button",
							{
								key: `cite-${key++}`,
								type: "button",
								className: isVerified ? "rw-cite" : "rw-cite rw-cite-unverified",
								title: isVerified ? context.t("sourceLocation") : `${context.t("unverified")} …${context.t("unverifiedHint")}`,
								onClick: isVerified ? () => context.onCite(citation) : undefined,
								disabled: !isVerified,
							},
							inner,
							isVerified ? null : h("span", { className: "rw-cite-warn", "aria-hidden": "true" }, "!"),
						));
					} else {
						nodes.push(h("code", { key: `code-${key++}`, className: "rw-inline-code" }, inner));
					}
					continue;
				}
				if (token.startsWith("**")) {
					nodes.push(h("strong", { key: `b-${key++}` }, token.slice(2, -2)));
					continue;
				}
				if (token.startsWith("*")) {
					nodes.push(h("em", { key: `i-${key++}` }, token.slice(1, -1)));
					continue;
				}
				const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
				if (link !== null) {
					nodes.push(h("a", { key: `a-${key++}`, href: link[2], target: "_blank", rel: "noreferrer noopener" }, link[1]));
					continue;
				}
				nodes.push(token);
			}
			if (cursor < text.length) nodes.push(text.slice(cursor));
			return nodes;
		}

		//#region views
		/**
		 * The framed diagram block.
		 *
		 * Renders a flowchart as SVG when the source really is one, and otherwise
		 * shows the source with a copy affordance. A page never fails to render
		 * because a diagram could not be drawn.
		 * @param {{source: string, t: Function}} props - the diagram source and translator.
		 * @returns {any} the element.
		 */
		function DiagramBlock(props) {
			const { source, t } = props;
			const graph = React.useMemo(() => parseMermaidFlowchart(source), [source]);
			const [copied, setCopied] = React.useState(false);
			const [zoom, setZoom] = React.useState(null);

			const copy = () => {
				void Promise.resolve(navigator.clipboard?.writeText(source)).then(() => {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				}).catch(() => setCopied(false));
			};

			// The layout pass walks a graph the model wrote, so it can meet a shape
			// the layering code does not expect. A diagram is never worth losing a
			// page over: failure degrades to the source view, and only this figure
			// degrades.
			let layout = null;
			try {
				layout = graph.kind === "flowchart" && graph.nodes.length > 0 ? layoutFlowchart(graph) : null;
			} catch {
				layout = null;
			}
			if (layout === null) {
				return h(
					"figure",
					{ className: "rw-diagram rw-diagram-source" },
					h("figcaption", null, t("diagramUnsupported")),
					h("pre", { className: "rw-diagram-pre" }, h("code", null, source)),
					h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: copy }, copied ? t("copied") : t("copyDiagram")),
				);
			}

			// Every position from here on is a measured SVG coordinate. `extent`
			// carries the drawing size and the offset that brings the routed
			// connectors — including the lanes outside the boxes — back inside a
			// viewBox that starts at the origin.
			const { width, height, offsetX, offsetY } = layout.extent;
			const shift = (point) => ({ x: point.x + offsetX, y: point.y + offsetY });
			// `boxOf` answers in centred coordinates with the measured size attached,
			// so shifting the centre is enough; the size and wrapped lines ride along.
			const boxOf = (id) => {
				const box = layout.boxOf(id);
				return { ...box, ...shift(box) };
			};

			// Connectors first, so they render behind every box and can never cross
			// a node's text; then the labels that annotate them, each on its own
			// masked pill so the line it belongs to does not run through it.
			const edges = [];
			for (const route of layout.edges ?? []) {
				const points = (route.curve ?? []).map(shift);
				if (points.length === 0) continue;
				edges.push(h("path", {
					key: `e-${route.index}`,
					d: flowchartEdgePath(points),
					className: `rw-diagram-edge rw-diagram-edge-${route.kind ?? "forward"}`,
					markerEnd: "url(#rw-arrow)",
				}));
			}

			const labels = (layout.edgeLabels ?? []).map((pill) => {
				const at = shift(pill);
				return h("g", { key: `el-${pill.index}`, className: "rw-diagram-edge-label-group" },
					h("rect", {
						x: at.x - pill.width / 2,
						y: at.y - pill.height / 2,
						width: pill.width,
						height: pill.height,
						rx: pill.height / 2,
						className: "rw-diagram-edge-label-bg",
					}),
					h("text", { x: at.x, y: at.y + 3.5, textAnchor: "middle", className: "rw-diagram-edge-label" }, pill.text));
			});

			const boxes = [];
			for (const node of graph.nodes) {
				const box = boxOf(node.id);
				const lines = box.lines.length > 0 ? box.lines : [node.label];
				boxes.push(h("rect", {
					key: `n-${node.id}`,
					x: box.x - box.width / 2,
					y: box.y - box.height / 2,
					width: box.width,
					height: box.height,
					rx: 8,
					className: node.kind === "heading" ? "rw-diagram-node rw-diagram-node-heading" : "rw-diagram-node",
				}));
				// Centre the block of wrapped lines vertically: the first baseline
				// sits half a line above centre, shifted down by half the leading.
				const lineHeight = 16;
				const top = box.y - ((lines.length - 1) * lineHeight) / 2 + 4;
				lines.forEach((text, index) => {
					boxes.push(h("text", {
						key: `t-${node.id}-${index}`,
						x: box.x,
						y: top + index * lineHeight,
						textAnchor: "middle",
						className: "rw-diagram-label",
					}, text));
				});
			}

			// One figure, drawn twice: inline at the page's width, and again inside
			// the lightbox when the reader asks for the large copy. `scale` is the
			// only difference, so what enlarges is exactly what was rendered.
			const draw = (scale) => h(
				"svg",
				{
					className: "rw-diagram-svg",
					viewBox: `0 0 ${width} ${height}`,
					// Style, not attributes: the stylesheet sets `height: auto` for
					// the inline copy, and a CSS declaration beats a presentation
					// attribute …so the enlarged copy has to win with a style.
					style: scale === null ? undefined : { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px`, maxWidth: "none" },
					width: scale === null ? "100%" : undefined,
					role: "img",
					"aria-label": graph.nodes.map((node) => node.label).join(" …"),
				},
				h(
					"defs",
					null,
					h("marker", { id: "rw-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
						h("path", { d: "M 0 0 L 10 5 L 0 10 z", className: "rw-diagram-arrow" })),
				),
				edges,
				labels,
				boxes,
			);

			return h(
				"figure",
				{ className: "rw-diagram" },
				h("div", { className: "rw-diagram-stage" }, draw(null)),
				h("div", { className: "rw-diagram-bar" },
					h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setZoom(1) }, t("enlarge")),
					h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: copy }, copied ? t("copied") : t("copyDiagram"))),
				h("details", { className: "rw-diagram-details" },
					h("summary", null, "Mermaid"),
					h("pre", { className: "rw-diagram-pre" }, h("code", null, source))),
				zoom !== null
					? h("div", {
						className: "rw-lightbox",
						role: "dialog",
						"aria-modal": "true",
						onClick: (event) => { if (event.target === event.currentTarget) setZoom(null); },
					},
					h("div", { className: "rw-lightbox-panel" },
						h("div", { className: "rw-lightbox-head" },
							h("span", null, `${Math.round(zoom * 100)}%`),
							h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setZoom((value) => Math.max(0.5, +(value - 0.25).toFixed(2))) }, "…"),
							h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setZoom((value) => Math.min(4, +(value + 0.25).toFixed(2))) }, "+"),
							h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setZoom(1) }, t("reset")),
							h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setZoom(null) }, t("close"))),
						h("div", { className: "rw-lightbox-body" }, draw(zoom))))
					: null,
			);
		}

		/**
		 * Render one page body: prose, lists, code, quotes and diagrams, with source
		 * locations as controls.
		 *
		 * A page that is still queued or being written is not an error and not a
		 * blank: it shows its brief and its live status, and the open view updates
		 * itself when the body lands. A failed or stopped page offers to regenerate
		 * just this page.
		 * @param {{page: object, t: Function, onCite: Function, onRetry?: Function}} props - the page view props.
		 * @returns {any} the element.
		 */
		function PageView(props) {
			const { page, t, onCite, onRetry } = props;
			const verified = new Set((page.sources ?? []).map((source) => `${source.path}:${source.start}-${source.end}`));
			const unverified = new Set((page.unverifiedSources ?? []).map((source) => `${source.path}:${source.start}-${source.end}`));
			const context = { t, onCite, verified, unverified };
			const blocks = parseBlocks(page.markdown ?? "");

			const retryButton = (page.status === "failed" || page.status === "stopped") && typeof onRetry === "function"
				? h("button", { type: "button", className: "rw-button rw-page-retry", onClick: () => onRetry(page.id) }, t("retryPage"))
				: null;

			if (page.status === "waiting" || page.status === "generating") {
				return h("div", { className: "rw-page" },
					h("h1", { className: "rw-page-title" }, page.title),
					page.brief !== undefined && page.brief !== "" ? h("p", { className: "rw-page-brief" }, page.brief) : null,
					h("div", { className: "rw-pending", "aria-live": "polite" },
						h("span", { className: page.status === "generating" ? "rw-spinner" : "rw-pending-dot", "aria-hidden": "true" }),
						h("p", { className: "rw-pending-title" }, t(page.status === "generating" ? "pageGenerating" : "pageWaiting")),
						h("p", { className: "rw-muted" }, t(page.status === "generating" ? "pageGeneratingHint" : "pageWaitingHint"))));
			}

			if (blocks.length === 0) {
				return h("div", { className: "rw-page" },
					h("h1", { className: "rw-page-title" }, page.title),
					page.status === "failed"
						? h("div", { className: "rw-notice rw-notice-error" }, `${t("errorAt")}: ${page.error ?? ""}`)
						: h("p", { className: "rw-muted" }, page.status === "stopped" ? t("pageStatus").stopped : t("emptyPage")),
					retryButton);
			}

			const rendered = blocks.map((block, index) => {
				const key = `blk-${index}`;
				if (block.type === "heading") {
					const level = Math.min(6, block.level + 1);
					return h(`h${level}`, { key, className: `rw-h rw-h${block.level}` }, renderInline(block.text, context));
				}
				if (block.type === "code") {
					if (block.language === "mermaid") return h(DiagramBlock, { key, source: block.text, t });
					return h("pre", { key, className: "rw-code" }, h("code", null, block.text));
				}
				if (block.type === "rule") {
					return h("hr", { key, className: "rw-rule" });
				}
				if (block.type === "table") {
					return h("div", { key, className: "rw-table-wrap" },
						h("table", { className: "rw-table" },
							h("thead", null,
								h("tr", null, block.head.map((cell, cellIndex) => h("th", {
									key: cellIndex,
									style: { textAlign: block.align[cellIndex] ?? "left" },
								}, renderInline(cell, context))))),
							h("tbody", null, block.rows.map((row, rowIndex) => h("tr", { key: rowIndex },
								row.map((cell, cellIndex) => h("td", {
									key: cellIndex,
									style: { textAlign: block.align[cellIndex] ?? "left" },
								}, renderInline(cell, context))))))));
				}
				if (block.type === "list") {
					return h("ul", { key, className: "rw-list" },
						block.items.map((item, itemIndex) => h("li", { key: itemIndex }, renderInline(item, context))));
				}
				if (block.type === "quote") {
					return h("blockquote", { key, className: "rw-quote" }, renderInline(block.text, context));
				}
				return h("p", { key, className: "rw-p" }, renderInline(block.text, context));
			});

			return h("div", { className: "rw-page" },
				h("h1", { className: "rw-page-title" }, page.title),
				page.brief !== undefined && page.brief !== "" ? h("p", { className: "rw-page-brief" }, page.brief) : null,
				page.status === "failed" ? h("div", { className: "rw-notice rw-notice-error" }, `${t("errorAt")}: ${page.error ?? ""}`) : null,
				page.status === "stopped" ? h("div", { className: "rw-notice" }, t("pageStatus").stopped) : null,
				retryButton,
				...rendered,
				unverified.size > 0
					? h("div", { className: "rw-notice rw-notice-warn" },
						h("strong", null, t("unverified")),
						h("span", null, ` …${t("unverifiedHint")}`),
						h("ul", { className: "rw-unverified" },
							[...unverified].map((entry, index) => h("li", { key: index }, h("code", null, entry)))))
					: null);
		}

		/**
		 * Build the page pane's own state from a `read` route response.
		 *
		 * The reader's phase must not live in `page.status`: a stored page record
		 * carries its own generation status (`done`, `failed`, `waiting`, …, and
		 * spreading that record over a `"ready"` sentinel silently replaces it …"
		 * which is how a finished page rendered as "Reading Wiki state…? forever.
		 * The pane phase therefore lives in `readState`, a field no page record has.
		 * @param {string} pageId - the page that was requested.
		 * @param {object | null | undefined} result - the decoded read response.
		 * @returns {object} the pane state.
		 */
		function pageViewState(pageId, result) {
			const record = result === null || result === undefined ? undefined : result.page;
			if (record === null || record === undefined || typeof record !== "object") {
				return { readState: "missing", id: pageId };
			}
			return { readState: "ready", ...record };
		}

		/**
		 * Fill `{name}` placeholders in a translated string.
		 *
		 * The locale contract is a flat dictionary of strings, so a sentence that
		 * carries a number is filled here rather than assembled from fragments …		 * word order differs between the two languages.
		 * @param {string} text - the translated template.
		 * @param {object} values - the placeholder values.
		 * @returns {string} the filled string.
		 */
		function fillTemplate(text, values) {
			return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
		}

		/**
		 * Decide whether the previous-version copy should be offered back.
		 *
		 * The copy is offered when the live Wiki is gone (a delete) or when it
		 * has fewer completed pages than the copy …the shape a mis-clicked
		 * regeneration, a failed run or a stop leaves behind. A successful run
		 * with at least as many pages hides the offer: nothing was lost, and a
		 * perpetual "restore" banner would suggest otherwise.
		 * @param {object | null | undefined} wiki - the live Wiki summary, or null.
		 * @param {object | null | undefined} backup - the previous-version summary, or null.
		 * @returns {boolean} whether the recovery should be shown.
		 */
		function restorableBackup(wiki, backup) {
			if (backup === null || backup === undefined || typeof backup !== "object") return false;
			const backupDone = Number(backup.done) || 0;
			if (backupDone <= 0) return false;
			if (wiki === null || wiki === undefined) return true;
			const done = wiki.counts !== null && wiki.counts !== undefined ? Number(wiki.counts.done) || 0 : 0;
			return done < backupDone;
		}

		/**
		 * Decide whether an action that overwrites the whole Wiki may proceed.
		 *
		 * With no completed pages there is nothing to lose, so no dialog is
		 * shown. Otherwise the reader is asked with a sentence that names the
		 * number of pages at stake and says the old content is recoverable. A
		 * dismiss (or `false`) cancels the action; a host with no `confirm`
		 * implementation cannot ask and therefore proceeds, since blocking the
		 * action entirely would be a worse failure than the dialog's absence.
		 * @param {number} done - completed pages in the live Wiki.
		 * @param {Function} t - the translator.
		 * @param {Function} [ask] - the confirmation function, normally `window.confirm`.
		 * @param {string} [messageKey] - which confirmation sentence to use.
		 * @returns {boolean} whether the action may proceed.
		 */
		function confirmOverwrite(done, t, ask, messageKey = "regenerateConfirm") {
			if (!(done > 0)) return true;
			if (typeof ask !== "function") return true;
			return ask(fillTemplate(t(messageKey), { done })) !== false;
		}

		/**
		 * The reader pane: an empty prompt, the article, or the reason there is no
		 * article yet. A page that is queued or being written still renders …its
		 * body says so and updates itself when the text lands.
		 * @param {{page: object | null, t: Function, onCite: Function, onRetry?: Function, error?: string}} props - the pane props.
		 * @returns {any} the element.
		 */
		function PagePane(props) {
			const { page, t, onCite, onRetry, error } = props;
			if (page === null || page === undefined) {
				return h("div", { className: "rw-empty" },
					h("p", { className: "rw-empty-title" }, t("pickPage")),
					h("p", { className: "rw-muted" }, t("pickPageHint")));
			}
			if (page.readState === "ready") return h(PageView, { page, t, onCite, onRetry });
			if (page.readState === "missing") return h("p", { className: "rw-muted" }, t("notFound"));
			if (page.readState === "error") {
				return h("div", { className: "rw-notice rw-notice-error" }, page.error ?? error ?? t("requestFailed"));
			}
			return h("p", { className: "rw-muted" }, t("loading"));
		}

		/**
		 * The catalog tree: one row per page, with its status and, for a page that
		 * failed or was cut off, its own regenerate control.
		 *
		 * Every row opens, whatever its status: a finished page shows its body, a
		 * failed page says why it failed, and a queued or generating page shows a
		 * placeholder that fills itself in when the body lands. The row action is a
		 * sibling button rather than a nested one, because a button inside a button
		 * is invalid and browsers disagree about which one gets the click.
		 * @param {{pages: object[], activeId: string | null, onSelect: Function, t: Function, pending?: boolean, onRetry?: Function, busy?: boolean}} props - the tree props.
		 * @returns {any} the element.
		 */
		function CatalogTree(props) {
			const { pages, activeId, onSelect, t, pending, onRetry, busy } = props;
			if ((pages === null || pages === undefined || pages.length === 0) && pending !== true) {
				return h("p", { className: "rw-hint", style: { padding: "4px 10px" } }, t("noPagesYet"));
			}
			if (pages === null || pages === undefined || pages.length === 0) {
				// Before the catalog exists the reader sees the shape of what is
				// coming rather than an empty panel.
				return h("div", { className: "rw-tree-pending", "aria-busy": "true" },
					[0, 1, 2, 3, 4].map((index) => h("div", {
						key: index,
						className: "rw-skeleton",
						style: { width: `${[92, 78, 86, 64, 74][index]}%` },
					})));
			}
			return h("ul", { className: "rw-tree", role: "tree" },
				pages.map((page) => {
					const retryable = (page.status === "failed" || page.status === "stopped") && typeof onRetry === "function";
					return h("li", {
						key: page.id,
						role: "treeitem",
						className: `rw-tree-row${page.id === activeId ? " rw-tree-active" : ""} rw-tree-depth-${Math.min(page.depth ?? 0, 3)}`,
						"aria-selected": page.id === activeId,
					},
					h("div", { className: "rw-tree-line" },
						h("button", {
							type: "button",
							className: page.status === "generating" ? "rw-tree-button rw-tree-busy" : "rw-tree-button",
							onClick: () => onSelect(page.id),
							title: page.brief ?? page.title,
						},
							h("span", { className: `rw-dot rw-dot-${page.status}`, "aria-hidden": "true" }),
							h("span", { className: "rw-tree-title" }, page.title),
							page.status !== "done" ? h("span", { className: "rw-tree-status" }, t("pageStatus")[page.status] ?? page.status) : null,
							page.unverified > 0 ? h("span", { className: "rw-tree-warn", title: t("unverified") }, "!") : null),
						retryable
							? h("button", {
								type: "button",
								className: "rw-tree-retry",
								title: t("retryPage"),
								"aria-label": `${t("retryPage")}: ${page.title}`,
								disabled: busy === true,
								onClick: () => onRetry(page.id),
							}, "…")
							: null));
				}));
		}

		/**
		 * The metadata panel: what code state this Wiki describes.
		 * @param {{wiki: object, t: Function}} props - the panel props.
		 * @returns {any} the element.
		 */
		function MetadataPanel(props) {
			const { wiki, t } = props;
			const meta = wiki.meta ?? {};
			const commit = meta.commit === null || meta.commit === undefined ? null : String(meta.commit);
			const rows = [
				[t("branch"), meta.branch ?? "…"],
				[t("commit"), commit === null ? "…" : commit.slice(0, 7)],
				[t("language"), meta.language ?? "…"],
				[t("modelUsed"), meta.model === null || meta.model === undefined ? t("modelDefault") : `${meta.model.provider}/${meta.model.model}`],
				[t("updatedAt"), meta.updatedAt === undefined ? "…" : new Date(meta.updatedAt).toLocaleString()],
				[t("files"), meta.fileCount ?? "…"],
				[t("pageCount"), `${wiki.counts.done}/${wiki.counts.total}`],
				[t("tokens"), `${wiki.citations.verified} ${t("verified")}${wiki.citations.unverified > 0 ? `, ${wiki.citations.unverified} ${t("unverified")}` : ""}`],
			];
			return h("details", { className: "rw-meta" },
				h("summary", null, t("metadata")),
				h("dl", { className: "rw-meta-list" },
					...rows.flatMap(([label, value], index) => [
						h("dt", { key: `dt-${index}` }, label),
						h("dd", { key: `dd-${index}` }, String(value)),
					])),
				meta.project !== null && meta.project !== undefined && meta.project.summary !== undefined
					? h("p", { className: "rw-meta-summary" }, meta.project.summary)
					: null);
		}

		/**
		 * A small book glyph for the empty-state hero, drawn inline so the plugin
		 * ships no asset files.
		 * @returns {any} the icon.
		 */
		function BookIcon() {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", className: "rw-card-svg" },
				h("path", { d: "M12 6.5C10.2 4.9 7.4 4.4 4 4.4v13.8c3.4 0 6.2.5 8 2.1 1.8-1.6 4.6-2.1 8-2.1V4.4c-3.4 0-6.2.5-8 2.1z", stroke: "currentColor", strokeWidth: "1.6", strokeLinejoin: "round" }),
				h("path", { d: "M12 6.5v13.8", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }));
		}

		/**
		 * The pre-generation card: the four options ZCode exposes, then generate.
		 * @param {{options: object, providers: object[], t: Function, onChange: Function, onGenerate: Function, busy: boolean}} props - the card props.
		 * @returns {any} the element.
		 */
		function StatusCard(props) {
			const { options, providers, t, onChange, onGenerate, busy } = props;
			const set = (key) => (event) => onChange({ ...options, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value });
			return h("div", { className: "rw-card" },
				h("div", { className: "rw-card-hero" },
					h("span", { className: "rw-card-icon" }, h(BookIcon)),
					h("h2", { className: "rw-card-title" }, t("noWiki")),
					h("p", { className: "rw-muted" }, t("noWikiHint"))),
				h("fieldset", { className: "rw-fieldset" },
					h("legend", null, t("options")),
					h("label", { className: "rw-field" },
						h("span", null, t("language")),
						h("select", { value: options.language, onChange: set("language") },
							h("option", { value: "zh-CN" }, "简体中…"),
							h("option", { value: "en" }, "English"))),
					h("label", { className: "rw-field" },
						h("span", null, t("model")),
						h("select", { value: options.model, onChange: set("model") },
							h("option", { value: "" }, t("modelDefault")),
							...providers.flatMap((provider) =>
								provider.models.map((model) => h("option", {
									key: `${provider.provider}/${model.id}`,
									value: `${provider.provider}/${model.id}`,
								}, `${provider.providerName} · ${model.name}`))))),
					h("label", { className: "rw-field rw-field-inline" },
						h("input", { type: "checkbox", checked: options.diagrams, onChange: set("diagrams") }),
						h("span", null, t("diagrams")),
						h("small", { className: "rw-hint" }, t("diagramsHint"))),
					h("label", { className: "rw-field rw-field-inline" },
						h("span", null, t("retries")),
						h("input", { type: "number", min: "0", max: "8", value: options.retries, onChange: set("retries"), className: "rw-number" }),
						h("small", { className: "rw-hint" }, t("retriesHint")))),
				h("button", { type: "button", className: "rw-button rw-button-primary rw-card-go", onClick: onGenerate, disabled: busy },
					busy ? t("loading") : t("generate")));
		}

		/**
		 * Format an ISO timestamp as a short local clock reading; an unreadable
		 * timestamp yields an empty string rather than "Invalid Date".
		 * @param {string} iso - the timestamp.
		 * @returns {string} the clock reading, or "".
		 */
		function formatClock(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			const time = new Date(iso);
			if (Number.isNaN(time.getTime())) return "";
			return time.toLocaleTimeString(undefined, { hour12: false });
		}

		/**
		 * Format a millisecond duration as `mm:ss`, or `h:mm:ss` past an hour.
		 * @param {number} ms - the duration.
		 * @returns {string} the readable duration, or "" for an unknown one.
		 */
		function formatDuration(ms) {
			if (!Number.isFinite(ms) || ms < 0) return "";
			const total = Math.floor(ms / 1000);
			const seconds = total % 60;
			const minutes = Math.floor(total / 60) % 60;
			const hours = Math.floor(total / 3600);
			const ss = String(seconds).padStart(2, "0");
			if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
			return `${String(minutes).padStart(2, "0")}:${ss}`;
		}

		/** The pipeline's four stages, in run order, for the stepper. */
		const PHASE_ORDER = ["analyzing", "catalog", "pages", "saving"];

		/**
		 * Read the phase caption map defensively: a translator that does not know
		 * the key returns a string, and indexing into it must degrade to the raw
		 * phase name rather than throw.
		 * @param {Function} t - the translator.
		 * @param {string} phase - the phase key.
		 * @returns {string} the caption.
		 */
		function phaseCaption(t, phase) {
			const phases = t("phase");
			return (phases !== null && typeof phases === "object" ? phases[phase] : undefined) ?? phase;
		}

		/**
		 * Render one task event as a log line.
		 *
		 * `usage` events are folded into the statistic chips instead of the log,
		 * and an unknown event type yields no line rather than a broken panel …		 * the log narrates a run, it never gets in its way.
		 * @param {object} event - the task event.
		 * @param {Function} t - the translator.
		 * @returns {string | null} the line, or null when the event is not logged.
		 */
		function describeEvent(event, t) {
			const labels = t("eventLog");
			const label = (key) => (labels !== null && typeof labels === "object" ? labels[key] : undefined) ?? key;
			switch (event.type) {
				case "phase": return `${label("phase")}: ${phaseCaption(t, event.phase)}`;
				case "catalog": return `${label("catalog")} · ${event.total ?? "?"} ${t("pageCount")}`;
				case "page": {
					if (event.status === "done") return `…${event.title}${typeof event.sources === "number" ? ` · ${event.sources} ${t("tokens")}` : ""}`;
					if (event.status === "failed") return `…${event.title} …${event.error ?? ""}`;
					return `…${event.title} (${(event.index ?? 0) + 1}/${event.total ?? "?"})`;
				}
				case "warning": return `…${event.message ?? ""}`;
				case "log": return event.message ?? "";
				case "model": return `${label("model")}: ${[event.provider, event.model].filter((part) => typeof part === "string" && part !== "").join("/")}`;
				case "done": return `…${label("done")} · ${event.pages ?? 0}${(event.failed ?? 0) > 0 ? ` (+${event.failed} …` : ""}`;
				case "failed": return `…${label("failed")} …${event.message ?? ""}`;
				case "stopped": return `…${label("stopped")}`;
				default: return null;
			}
		}

		/**
		 * The generating panel: a four-stage stepper, the progress bar, the run's
		 * vital statistics (pages, model, tokens), the degradation warning when
		 * there is one, and the activity log the pipeline narrates.
		 * @param {{task: object, t: Function, onStop: Function}} props - the panel props.
		 * @returns {any} the element.
		 */
		function ProgressBar(props) {
			const { task, t, onStop } = props;
			const { total, done, failed, title } = task.progress;
			const finished = done + failed;
			const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
			const activeStep = PHASE_ORDER.indexOf(task.phase);
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				const timer = window.setInterval(() => setNow(Date.now()), 1000);
				return () => window.clearInterval(timer);
			}, []);
			const started = Date.parse(task.startedAt ?? "");
			const ended = task.state === "running" || task.finishedAt === null || task.finishedAt === undefined
				? now
				: Date.parse(task.finishedAt);
			const elapsed = Number.isNaN(started) || Number.isNaN(ended) ? null : Math.max(0, ended - started);
			// A warning is the pipeline saying it degraded …a catalog that fell
			// back to the template, say. It travels with the run so the reader is
			// told, rather than discovering a generic structure silently.
			const warning = [...(task.events ?? [])].reverse().find((event) => event.type === "warning");
			const logLines = [...(task.events ?? [])].reverse()
				.map((event) => ({ event, line: describeEvent(event, t) }))
				.filter((entry) => entry.line !== null && entry.line !== "")
				.slice(0, 14);

			return h("section", { className: "rw-gen", "aria-live": "polite" },
				h("div", { className: "rw-gen-head" },
					h("span", { className: task.state === "running" ? "rw-spinner" : "rw-spinner rw-spinner-still", "aria-hidden": "true" }),
					h("span", { className: "rw-gen-phase" }, phaseCaption(t, task.phase)),
					elapsed !== null ? h("span", { className: "rw-gen-elapsed" }, formatDuration(elapsed)) : null,
					h("button", { type: "button", className: "rw-button rw-button-quiet rw-gen-stop", onClick: onStop }, t("stop"))),
				h("div", { className: "rw-steps", role: "list" },
					PHASE_ORDER.map((phase, stepIndex) => {
						const state = activeStep === -1 ? "pending" : stepIndex < activeStep ? "done" : stepIndex === activeStep ? "active" : "pending";
						return h("div", { key: phase, className: `rw-step rw-step-${state}`, role: "listitem" },
							h("span", { className: "rw-step-dot", "aria-hidden": "true" }, state === "done" ? "…" : String(stepIndex + 1)),
							h("span", { className: "rw-step-label" }, phaseCaption(t, phase)));
					})),
				h("div", { className: "rw-bar", role: "progressbar", "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 },
					h("div", { className: "rw-bar-fill", style: { width: `${percent}%` } })),
				h("div", { className: "rw-stats" },
					h("span", { className: "rw-chip" }, `${t("pagesDone")} ${done}/${total || "?"}`),
					failed > 0 ? h("span", { className: "rw-chip rw-chip-danger" }, `${t("pagesFailed")} ${failed}`) : null,
					title !== null && title !== undefined && task.phase === "pages"
						? h("span", { className: "rw-chip rw-chip-current", title }, `${t("currentPage")} ${title}`)
						: null,
					task.model !== null && task.model !== undefined && task.model.model !== null && task.model.model !== undefined
						? h("span", { className: "rw-chip" }, `${t("modelUsed")} ${[task.model.provider, task.model.model].filter(Boolean).join("/")}`)
						: null,
					task.usage !== null && task.usage !== undefined
						? h("span", { className: "rw-chip", title: `${t("tokenDetail")}: ${task.usage.inputTokens} / ${task.usage.outputTokens}` }, `${t("tokensUsed")} ${task.usage.inputTokens + task.usage.outputTokens}`)
						: null),
				warning !== undefined
					? h("div", { className: "rw-banner" }, h("span", null, warning.message))
					: null,
				logLines.length > 0
					? h("details", { className: "rw-log" },
						h("summary", null, t("activity")),
						h("ul", { className: "rw-log-list" },
							logLines.map((entry, entryIndex) => h("li", { key: entryIndex, className: `rw-log-item rw-log-${entry.event.type}` },
								h("time", { className: "rw-log-time" }, formatClock(entry.event.at)),
								h("span", null, entry.line)))))
					: null);
		}

		/**
		 * The card that answers "how did the last run end" …failed, stopped,
		 * interrupted mid-way, or done with casualties …and offers the obvious
		 * next action. Without it a failure looked exactly like a hang: pages
		 * stayed "waiting" and nothing said why.
		 * @param {{kind: "failed" | "stopped" | "interrupted" | "partial", task?: object | null, wiki?: object | null, t: Function, onRegenerate: Function, onRetryFailed?: Function, busy?: boolean}} props - the card props.
		 * @returns {any} the element.
		 */
		function OutcomeCard(props) {
			const { kind, task, wiki, t, onRegenerate, onRetryFailed, busy } = props;
			const lastTask = wiki?.meta?.lastTask ?? null;
			const counts = wiki?.counts ?? null;
			const progress = task?.progress ?? null;
			const tone = kind === "failed" ? "error" : kind === "stopped" ? "neutral" : "warn";
			const icon = kind === "failed" ? "…" : kind === "stopped" ? "…" : "…";
			const titleKey = { failed: "runFailed", stopped: "runStopped", interrupted: "interruptedRun", partial: "partialFailure" }[kind] ?? "runFailed";
			const hintKey = { failed: "runFailedHint", stopped: "runStoppedHint", interrupted: "interruptedHint", partial: "partialFailureHint" }[kind] ?? "runFailedHint";
			const error = task?.error ?? lastTask?.error ?? null;
			const doneCount = progress?.done ?? lastTask?.done ?? counts?.done ?? 0;
			const totalCount = progress?.total ?? counts?.total ?? 0;
			const failedCount = progress?.failed ?? lastTask?.failed ?? counts?.failed ?? 0;
			const when = task?.finishedAt ?? lastTask?.finishedAt ?? null;
			const facts = [];
			if (totalCount > 0) facts.push(`${t("pagesDone")} ${doneCount}/${totalCount}${failedCount > 0 ? ` · ${t("pagesFailed")} ${failedCount}` : ""}`);
			const clock = when === null ? "" : formatClock(when);
			if (clock !== "") facts.push(`${t("finishedAt")} ${clock}`);
			// A partial run's obvious next action is the failed pages, not the whole
			// Wiki: regenerate-all would rewrite the pages that are already good.
			// The full regenerate stays available as the quieter second choice.
			const retryFailedAction = typeof onRetryFailed === "function"
				? h("button", { type: "button", className: "rw-button rw-button-primary", onClick: onRetryFailed, disabled: busy === true },
					`${t("retryFailed")}${failedCount > 0 ? ` (${failedCount})` : ""}`)
				: null;
			const regenerateAction = h("button", {
				type: "button",
				className: retryFailedAction === null ? "rw-button rw-button-primary" : "rw-button rw-button-quiet",
				onClick: onRegenerate,
				disabled: busy === true,
			}, t("regenerate"));
			return h("section", { className: `rw-outcome rw-outcome-${tone}`, role: kind === "failed" ? "alert" : "status" },
				h("span", { className: "rw-outcome-icon", "aria-hidden": "true" }, icon),
				h("div", { className: "rw-outcome-body" },
					h("h3", { className: "rw-outcome-title" }, t(titleKey)),
					facts.length > 0 ? h("p", { className: "rw-outcome-text" }, facts.join(" · ")) : null,
					kind === "failed" && error !== null && error !== ""
						? h("pre", { className: "rw-outcome-error" }, error)
						: null,
					h("p", { className: "rw-outcome-hint" }, t(hintKey))),
				h("div", { className: "rw-outcome-actions" },
					retryFailedAction,
					regenerateAction));
		}

		/**
		 * Format an archive timestamp for the history list.
		 * @param {string} iso - the ISO timestamp.
		 * @returns {string} a short local date and time, or an em dash.
		 */
		function formatWhen(iso) {
			if (typeof iso !== "string" || iso === "") return "…";
			const time = new Date(iso);
			if (Number.isNaN(time.getTime())) return "…";
			return time.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
		}

		/**
		 * The archived versions: a collapsible list, newest first, each row
		 * carrying its archive time, page count and its own restore control.
		 *
		 * Listing more than one version is the point of the history: after a
		 * string of empty or wrong regenerations the reader can still pick an
		 * earlier finished version instead of being stuck with the newest one.
		 * @param {{history: object[], retentionDays?: number | null, t: Function, onRestore: Function, busy?: boolean}} props - the panel props.
		 * @returns {any} the element, or null when there is no history.
		 */
		function HistoryPanel(props) {
			const { history, retentionDays, t, onRestore, busy } = props;
			if (!Array.isArray(history) || history.length === 0) return null;
			const days = retentionDays === null || retentionDays === undefined ? 3 : retentionDays;
			return h("details", { className: "rw-history" },
				h("summary", null, `${t("history")} (${history.length})`),
				h("p", { className: "rw-history-hint" }, fillTemplate(t("historyHint"), { days })),
				h("ul", { className: "rw-history-list" },
					history.map((entry) => h("li", { key: entry.id, className: "rw-history-row" },
						h("span", { className: "rw-history-when" }, formatWhen(entry.archivedAt)),
						h("span", { className: "rw-history-pages" }, `${entry.done}/${entry.total} ${t("pagesDone")}`),
						h("button", {
							type: "button",
							className: "rw-button rw-button-quiet",
							onClick: () => { onRestore(entry.id); },
							disabled: busy === true,
							title: t("restoreVersion"),
						}, t("restoreVersion"))))));
		}

		//#region styles
		/**
		 * The tab's stylesheet, injected once when the plugin mounts.
		 *
		 * Scoped by a `rw-` prefix and expressed with the harness's own design
		 * tokens where it can be, so the tab follows the active theme instead of
		 * pinning its own colors.
		 */
		const CSS = `
.rw-root { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; color: var(--dsw-color-text, inherit); }
.rw-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); flex-wrap: wrap; }
.rw-toolbar-title { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-body { display: flex; min-height: 0; flex: 1; }
.rw-side { width: var(--rw-side-w, 240px); min-width: 140px; max-width: 60%; overflow: auto; border-right: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); padding: 6px 0; }
.rw-side-hidden { display: none; }
.rw-main { flex: 1; min-width: 0; overflow: auto; padding: 14px 18px 40px; }
@media (max-width: 760px) {
	.rw-body { flex-direction: column; }
	.rw-side { width: auto; max-width: none; max-height: 42%; border-right: 0; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); flex: 0 0 auto; }
	.rw-main { padding: 12px 12px 32px; }
	.rw-divider { display: none; }
	.rw-page { max-width: none; }
}
.rw-divider { width: 5px; cursor: col-resize; background: transparent; flex: 0 0 auto; }
.rw-divider:hover { background: var(--dsw-color-border, rgba(128,128,128,.35)); }
.rw-card { margin: 24px auto; max-width: 520px; padding: 18px; border: 1px solid var(--dsw-color-border, rgba(128,128,128,.3)); border-radius: 10px; }
.rw-card-title { margin: 0 0 6px; font-size: 15px; }
.rw-muted { opacity: .72; line-height: 1.6; }
.rw-fieldset { border: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); border-radius: 8px; margin: 14px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.rw-fieldset legend { padding: 0 4px; opacity: .8; }
.rw-field { display: flex; flex-direction: column; gap: 4px; }
.rw-field-inline { flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
.rw-hint { opacity: .6; }
.rw-number { width: 64px; }
.rw-button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--dsw-color-border, rgba(128,128,128,.4)); background: transparent; color: inherit; cursor: pointer; }
.rw-button:hover:not(:disabled) { border-color: currentColor; }
.rw-button:disabled { opacity: .5; cursor: default; }
.rw-button-primary { background: var(--dsw-color-accent, #3b6ef5); border-color: transparent; color: #fff; font-weight: 600; }
.rw-button-quiet { border-color: transparent; opacity: .8; }
.rw-progress { padding: 10px 12px; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); }
.rw-progress-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.rw-progress-phase { font-weight: 600; margin-right: auto; }
.rw-progress-count { font-variant-numeric: tabular-nums; opacity: .75; }
.rw-bar { height: 5px; border-radius: 3px; background: var(--dsw-color-border, rgba(128,128,128,.25)); overflow: hidden; }
.rw-bar-fill { height: 100%; background: var(--dsw-color-accent, #3b6ef5); transition: width .3s ease; }
.rw-progress-meta { display: flex; gap: 12px; margin-top: 6px; opacity: .8; flex-wrap: wrap; }
.rw-failed { color: var(--dsw-color-danger, #d64545); }
.rw-tree { list-style: none; margin: 0; padding: 0; }
.rw-tree-row { margin: 0; }
.rw-tree-line { display: flex; align-items: center; gap: 2px; padding-right: 6px; }
.rw-tree-depth-1 .rw-tree-button { padding-left: 22px; }
.rw-tree-depth-2 .rw-tree-button { padding-left: 34px; }
.rw-tree-depth-3 .rw-tree-button { padding-left: 46px; }
.rw-tree-button { display: flex; align-items: center; gap: 7px; flex: 1 1 auto; min-width: 0; text-align: left; font: inherit; color: inherit; background: transparent; border: 0; padding: 5px 10px; cursor: pointer; }
.rw-tree-button:hover:not(:disabled) { background: var(--dsw-color-hover, rgba(128,128,128,.12)); }
.rw-tree-button:disabled { cursor: default; opacity: .65; }
.rw-tree-retry { flex: 0 0 auto; font: inherit; font-size: 12px; line-height: 1; padding: 4px 7px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: inherit; opacity: .62; cursor: pointer; }
.rw-tree-retry:hover:not(:disabled) { opacity: 1; border-color: var(--dsw-color-border, rgba(128,128,128,.5)); background: var(--dsw-color-hover, rgba(128,128,128,.12)); }
.rw-tree-retry:disabled { opacity: .3; cursor: default; }
.rw-tree-active .rw-tree-button { background: var(--dsw-color-hover, rgba(128,128,128,.18)); font-weight: 600; }
.rw-tree-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-tree-status { margin-left: auto; font-size: 11px; opacity: .6; }
.rw-tree-warn { color: var(--dsw-color-warning, #c8860d); font-weight: 700; }
.rw-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: rgba(128,128,128,.5); }
.rw-dot-done { background: var(--dsw-color-success, #3aa76d); }
.rw-dot-failed { background: var(--dsw-color-danger, #d64545); }
.rw-dot-generating { background: var(--dsw-color-accent, #3b6ef5); animation: rw-pulse 1.1s ease-in-out infinite; }
@keyframes rw-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.rw-list li { margin: 5px 0; }
.rw-quote { margin: 10px 0; padding: 2px 12px; border-left: 3px solid var(--dsw-color-border, rgba(128,128,128,.4)); opacity: .9; }
.rw-code { background: var(--dsw-color-code-bg, rgba(128,128,128,.13)); padding: 10px 12px; border-radius: 7px; overflow: auto; }
.rw-inline-code { background: var(--dsw-color-code-bg, rgba(128,128,128,.15)); padding: 1px 5px; border-radius: 4px; font-size: .94em; }
.rw-cite { font: inherit; font-size: .94em; font-family: var(--dsw-font-mono, ui-monospace, monospace); background: var(--dsw-color-code-bg, rgba(128,128,128,.15)); border: 1px solid transparent; border-radius: 4px; padding: 1px 5px; color: inherit; cursor: pointer; }
.rw-cite:hover:not(:disabled) { border-color: var(--dsw-color-accent, #3b6ef5); }
.rw-cite-unverified { border-color: var(--dsw-color-warning, #c8860d); cursor: not-allowed; text-decoration: line-through dotted; }
.rw-cite-warn { margin-left: 3px; color: var(--dsw-color-warning, #c8860d); font-weight: 700; }
.rw-notice { margin: 12px 0; padding: 8px 12px; border-radius: 7px; background: rgba(128,128,128,.12); }
.rw-notice-error { background: rgba(214,69,69,.14); }
.rw-notice-warn { background: rgba(200,134,13,.14); }
.rw-restore { display: flex; align-items: center; gap: 10px; margin: 12px; }
.rw-restore-text { display: flex; flex-direction: column; gap: 2px; margin-right: auto; min-width: 0; }
.rw-restore-hint { opacity: .72; font-size: 12px; }
.rw-restore .rw-button { flex: 0 0 auto; }
.rw-history { margin: 12px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); }
.rw-history summary { cursor: pointer; font-weight: 600; }
.rw-history-hint { margin: 6px 0; font-size: 12px; opacity: .7; }
.rw-history-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rw-history-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; padding: 4px 0; border-top: 1px solid var(--dsw-color-border, rgba(128,128,128,.15)); }
.rw-history-row:first-child { border-top: 0; }
.rw-history-when { font-variant-numeric: tabular-nums; opacity: .8; }
.rw-history-pages { opacity: .8; }
.rw-history-row .rw-button { margin-left: auto; padding: 2px 10px; }
.rw-unverified { margin: 6px 0 0; padding-left: 20px; }
.rw-meta { margin: 0 0 14px; }
.rw-meta summary { cursor: pointer; opacity: .8; }
.rw-meta-list { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 8px 0 0; }
.rw-meta-list dt { opacity: .65; }
.rw-meta-list dd { margin: 0; }
.rw-meta-summary { margin: 10px 0 0; opacity: .85; line-height: 1.7; }
.rw-diagram { margin: 16px 0; padding: 0; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.04)); overflow: hidden; }
.rw-diagram-stage { overflow: auto; padding: 18px 14px; background: var(--dsw-alias-bg-base, transparent); }
.rw-diagram-svg { display: block; margin: 0 auto; height: auto; max-width: 100%; overflow: visible; }
.rw-diagram-node { fill: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.1)); stroke: var(--dsw-alias-border-l2, rgba(128,128,128,.5)); stroke-width: 1; }
.rw-diagram-node-accent { fill: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef5) 9%, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.1))); stroke: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef5) 45%, transparent); }
.rw-diagram-node-heading { fill: color-mix(in srgb, var(--dsw-alias-label-secondary, #61666b) 10%, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.1))); stroke: var(--dsw-alias-border-l3, rgba(128,128,128,.55)); }
.rw-diagram-edge { fill: none; stroke: var(--dsw-alias-label-tertiary, rgba(128,128,128,.85)); stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
.rw-diagram-arrow { fill: var(--dsw-alias-label-tertiary, rgba(128,128,128,.85)); }
.rw-diagram-label { font-size: 11.5px; fill: var(--dsw-alias-label-primary, currentColor); }
.rw-diagram-edge-label { font-size: 10px; fill: var(--dsw-alias-label-tertiary, currentColor); }
.rw-diagram-edge-label-bg { fill: var(--dsw-alias-bg-base, #fff); stroke: var(--dsw-alias-border-l1, rgba(128,128,128,.25)); stroke-width: .75; }
.rw-diagram-bar { display: flex; gap: 4px; align-items: center; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
.rw-diagram-bar .rw-button { font-size: 11.5px; padding: 3px 10px; }
.rw-diagram-details { border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); padding: 4px 10px 8px; }
.rw-diagram-source { padding: 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.rw-diagram-source figcaption, .rw-diagram-details summary { opacity: .65; font-size: 11.5px; }
.rw-diagram-details summary { cursor: pointer; padding: 4px 0; }
.rw-diagram-pre { overflow: auto; margin: 6px 0; padding: 0; font-size: 11.5px; max-height: 260px; }
.rw-diagram-caption { margin: 8px 2px 0; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }
.rw-stale { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(200,134,13,.14); font-size: 12px; }
.rw-stale span { margin-right: auto; }
.rw-side-heading { padding: 8px 10px 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; opacity: .55; }
.rw-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-page { max-width: 860px; line-height: 1.78; font-size: 13.5px; }
.rw-page-title { margin: 0 0 6px; font-size: 22px; line-height: 1.3; letter-spacing: -.01em; }
.rw-page-brief { margin: 0 0 16px; opacity: .72; font-size: 13.5px; }
.rw-h { margin: 26px 0 10px; line-height: 1.35; scroll-margin-top: 16px; }
.rw-h1 { font-size: 18px; padding-bottom: 6px; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.22)); }
.rw-h2 { font-size: 15.5px; } .rw-h3 { font-size: 14px; } .rw-h4, .rw-h5, .rw-h6 { font-size: 13px; opacity: .95; }
.rw-p { margin: 12px 0; }
.rw-rule { margin: 22px 0; border: 0; border-top: 1px solid var(--dsw-color-border, rgba(128,128,128,.3)); }
.rw-list { margin: 12px 0; padding-left: 22px; }
.rw-list li { margin: 5px 0; }
.rw-table-wrap { margin: 14px 0; overflow: auto; border: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); border-radius: 8px; }
.rw-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.rw-table th, .rw-table td { padding: 6px 10px; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.18)); vertical-align: top; }
.rw-table th { background: var(--dsw-color-code-bg, rgba(128,128,128,.1)); font-weight: 600; white-space: nowrap; }
.rw-table tbody tr:last-child td { border-bottom: 0; }
.rw-progress-current { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; opacity: .85; }
.rw-tree-busy { background: var(--dsw-color-hover, rgba(128,128,128,.08)); }
.rw-lightbox { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
.rw-lightbox-panel { background: var(--dsw-color-surface, #fff); color: var(--dsw-color-text, inherit); border: 1px solid var(--dsw-color-border, rgba(128,128,128,.35)); border-radius: 10px; max-width: 100%; max-height: 100%; display: flex; flex-direction: column; }
.rw-lightbox-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-color-border, rgba(128,128,128,.25)); font-variant-numeric: tabular-nums; }
.rw-lightbox-head span { margin-right: auto; opacity: .75; }
.rw-lightbox-body { overflow: auto; padding: 14px; }
.rw-tree-pending { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; }
.rw-skeleton { height: 10px; border-radius: 5px; background: var(--dsw-color-border, rgba(128,128,128,.22)); animation: rw-pulse 1.4s ease-in-out infinite; }
.rw-empty { padding: 28px 6px; text-align: center; }
.rw-empty-title { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.rw-banner { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 8px 12px; border-radius: 7px; background: rgba(200,134,13,.14); font-size: 12.5px; }

/* ── generation panel, outcome cards, hero card …on the shell's real theme tokens ── */
.rw-root { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-base, transparent); }
.rw-toolbar { background: var(--dsw-specific-sidebar-fill, transparent); border-bottom-color: var(--dsw-alias-border-l1, rgba(128,128,128,.25)); }
.rw-button { border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.4)); border-radius: 8px; padding: 6px 14px; transition: border-color .15s ease, background .15s ease, transform .05s ease; }
.rw-button:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #3b6ef5); }
.rw-button:active:not(:disabled) { transform: translateY(1px); }
.rw-button-primary { background: var(--dsw-alias-brand-primary, #3b6ef5); color: var(--dsw-alias-bg-base, #fff); border-color: transparent; }
.rw-button-quiet { border-color: transparent; }
.rw-button-retry { border-color: var(--dsw-alias-state-warn-primary, #c8860d); color: var(--dsw-alias-state-warn-primary, #c8860d); }

.rw-card { margin: 28px auto; max-width: 560px; padding: 0 0 18px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, transparent); box-shadow: 0 8px 28px rgba(0,0,0,.08); overflow: hidden; }
.rw-card-hero { padding: 26px 22px 6px; text-align: center; }
.rw-card-icon { display: inline-flex; width: 52px; height: 52px; align-items: center; justify-content: center; border-radius: 14px; color: var(--dsw-alias-brand-primary, #3b6ef5); background: rgba(59,110,245,.12); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef5) 12%, transparent); margin-bottom: 10px; }
.rw-card-svg { width: 28px; height: 28px; }
.rw-card .rw-card-title { font-size: 17px; }
.rw-card .rw-muted { color: var(--dsw-alias-label-secondary, inherit); }
.rw-card .rw-fieldset { margin: 14px 18px; border-color: var(--dsw-alias-border-l1, rgba(128,128,128,.25)); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, transparent); }
.rw-card-go { display: block; width: calc(100% - 36px); margin: 0 18px; padding: 9px 12px; font-size: 13.5px; }
.rw-card select, .rw-card input[type="number"] { font: inherit; color: inherit; background: var(--dsw-alias-bg-base, transparent); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4)); border-radius: 7px; padding: 5px 8px; }

.rw-gen { margin: 12px; padding: 14px 16px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, transparent); display: flex; flex-direction: column; gap: 10px; }
.rw-gen-head { display: flex; align-items: center; gap: 10px; }
.rw-gen-phase { font-weight: 600; font-size: 13.5px; }
.rw-gen-elapsed { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, inherit); }
.rw-gen-stop { flex: 0 0 auto; margin-left: auto; }
.rw-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35)); border-top-color: var(--dsw-alias-brand-primary, #3b6ef5); animation: rw-spin .8s linear infinite; flex: 0 0 auto; }
.rw-spinner-still { animation: none; border-top-color: var(--dsw-alias-border-l2, rgba(128,128,128,.35)); }
@keyframes rw-spin { to { transform: rotate(360deg) } }
.rw-steps { display: flex; gap: 4px; }
.rw-step { display: flex; align-items: center; gap: 6px; flex: 1 1 0; min-width: 0; padding: 5px 8px; border-radius: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.rw-step-dot { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15)); color: inherit; flex: 0 0 auto; }
.rw-step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-step-done { color: var(--dsw-alias-state-success-primary, #3aa76d); }
.rw-step-done .rw-step-dot { background: var(--dsw-alias-state-success-primary, #3aa76d); color: #fff; }
.rw-step-active { color: var(--dsw-alias-brand-primary, #3b6ef5); background: rgba(59,110,245,.1); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #3b6ef5) 10%, transparent); font-weight: 600; }
.rw-step-active .rw-step-dot { background: var(--dsw-alias-brand-primary, #3b6ef5); color: #fff; animation: rw-pulse 1.1s ease-in-out infinite; }
.rw-bar { height: 6px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18)); }
.rw-bar-fill { background: linear-gradient(90deg, var(--dsw-alias-brand-primary, #3b6ef5), var(--dsw-alias-brand-primary, #3b6ef5)); }
.rw-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.rw-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); color: var(--dsw-alias-label-secondary, inherit); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-chip-danger { background: rgba(214,69,69,.14); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 14%, transparent); color: var(--dsw-alias-state-error-primary, #d64545); }
.rw-chip-current { color: var(--dsw-alias-brand-primary, #3b6ef5); }
.rw-log { border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); padding-top: 8px; }
.rw-log summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.rw-log-list { list-style: none; margin: 8px 0 0; padding: 0; max-height: 180px; overflow: auto; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.rw-log-item { display: flex; gap: 8px; align-items: baseline; }
.rw-log-time { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, inherit); opacity: .8; }
.rw-log-page-failed, .rw-log-failed { color: var(--dsw-alias-state-error-primary, #d64545); }
.rw-log-warning { color: var(--dsw-alias-state-warn-primary, #c8860d); }

.rw-outcome { display: flex; gap: 12px; align-items: flex-start; margin: 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-1, transparent); }
.rw-outcome-icon { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
.rw-outcome-error { border-color: rgba(214,69,69,.4); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 40%, transparent); }
.rw-outcome-error .rw-outcome-icon { background: rgba(214,69,69,.15); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64545) 15%, transparent); color: var(--dsw-alias-state-error-primary, #d64545); }
.rw-outcome-error .rw-outcome-title { color: var(--dsw-alias-state-error-primary, #d64545); }
.rw-outcome-warn { border-color: rgba(200,134,13,.4); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c8860d) 40%, transparent); }
.rw-outcome-warn .rw-outcome-icon { background: rgba(200,134,13,.15); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c8860d) 15%, transparent); color: var(--dsw-alias-state-warn-primary, #c8860d); }
.rw-outcome-warn .rw-outcome-title { color: var(--dsw-alias-state-warn-primary, #c8860d); }
.rw-outcome-neutral .rw-outcome-icon { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15)); color: var(--dsw-alias-label-secondary, inherit); }
.rw-outcome-body { flex: 1; min-width: 0; }
.rw-outcome-title { margin: 2px 0 4px; font-size: 14px; }
.rw-outcome-text { margin: 0 0 4px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.rw-outcome-hint { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); opacity: .85; }
.rw-outcome-error { margin: 6px 0; padding: 8px 10px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto; }
.rw-outcome-actions { flex: 0 0 auto; margin-top: 2px; }

.rw-side { background: var(--dsw-specific-sidebar-fill, transparent); }
.rw-meta { margin: 6px 10px 12px; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
.rw-tree-status { padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); }
.rw-dot { background: var(--dsw-alias-state-idle-primary, rgba(128,128,128,.5)); }
.rw-dot-done { background: var(--dsw-alias-state-success-primary, #3aa76d); }
.rw-dot-failed { background: var(--dsw-alias-state-error-primary, #d64545); }
.rw-dot-generating { background: var(--dsw-alias-brand-primary, #3b6ef5); }
.rw-stale { background: rgba(200,134,13,.14); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c8860d) 14%, transparent); }
.rw-banner { background: rgba(200,134,13,.14); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c8860d) 14%, transparent); }
`;
		//#endregion

		//#region plugin
		/** This implementation's identity in the tab system; also the slot registration key. */
		const ID = "dsh-repo-wiki";
		/** The tab kind `openTab` names. */
		const KIND = "repo-wiki";
		/** The locale namespace this plugin registers under. */
		const NS = "repoWiki";
		/** The authenticated host routes, one per operation. */
		const API = {
			state: "/api/repoWiki.state",
			generate: "/api/repoWiki.generate",
			stop: "/api/repoWiki.stop",
			read: "/api/repoWiki.read",
			remove: "/api/repoWiki.remove",
			refresh: "/api/repoWiki.refresh",
			models: "/api/repoWiki.models",
			regeneratePage: "/api/repoWiki.regeneratePage",
			restore: "/api/repoWiki.restore",
		};

		/**
		 * Call one host route.
		 *
		 * The request rides the same authenticated same-origin channel as every
		 * other harness API, so the session cookie and the Host/Origin fence are the
		 * carrier's business rather than this function's.
		 * @param {string} path - the route.
		 * @param {{method?: string, body?: object, signal?: AbortSignal}} [options] - the call options.
		 * @returns {Promise<object>} the decoded JSON body.
		 */
		async function call(path, options = {}) {
			const init = { method: options.method ?? "GET", credentials: "same-origin", headers: {} };
			if (options.body !== undefined) {
				init.method = "POST";
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(options.body);
			}
			if (options.signal !== undefined) init.signal = options.signal;
			const response = await fetch(path, init);
			const text = await response.text();
			let decoded = {};
			try {
				decoded = text === "" ? {} : JSON.parse(text);
			} catch {
				decoded = { ok: false, error: text.slice(0, 400) };
			}
			if (!response.ok || decoded.ok === false) {
				// Keep the decoded body on the error: a read route answers
				// `not-found`/`absent`/`invalid` as a typed status rather than a
				// message, and the page pane has to tell "no such page" apart from
				// a transport failure to say the right thing.
				const error = new Error(decoded.error ?? decoded.message ?? decoded.reason ?? `HTTP ${response.status}`);
				error.payload = decoded;
				throw error;
			}
			return decoded;
		}

		/**
		 * The tab body: fetches state, drives the generation, and picks a view.
		 *
		 * Split from the views below on purpose …the views are pure functions of
		 * their props, so everything they render is asserted by a headless test
		 * without a browser, and this component holds the only state in the tab.
		 * @param {object} props - the slot-injected props.
		 * @returns {any} the element.
		 */
		function WikiBody(props) {
			// The slot framework injects the tab hook; its name has varied between
			// the framework's own surfaces, so resolve whichever one is present
			// rather than assuming one spelling.
			const useTabInfo = typeof props.useTabInfo === "function"
				? props.useTabInfo
				: props.hooks !== undefined && typeof props.hooks.tabInfo === "function"
					? props.hooks.tabInfo
					: null;
			const tabInfo = useTabInfo === null ? null : useTabInfo();
			const tab = tabInfo === null ? null : tabInfo.tab;
			const sessionId = props.sessionId;
			const t = typeof props.t === "function" ? props.t : (key) => (DICTIONARIES.en[key] ?? key);

			const [view, setView] = React.useState({ status: "loading" });
			// retries defaults to 2 to match the shipped config: a transient
			// transport error must not cost a whole page when generated from the UI.
			const [options, setOptions] = React.useState({ language: "zh-CN", model: "", diagrams: true, retries: 2 });
			const [providers, setProviders] = React.useState([]);
			const [activeId, setActiveId] = React.useState(null);
			const [page, setPage] = React.useState(null);
			const [message, setMessage] = React.useState(null);
			const [sideHidden, setSideHidden] = React.useState(false);
			const [sideWidth, setSideWidth] = React.useState(240);
			// True while a batch of single-page retries is working through the
			// failed pages: each retry is its own host task, so the button that
			// started the batch must stay disabled across all of them.
			const [retrying, setRetrying] = React.useState(false);
			const runningRef = React.useRef(false);
			// Guards against a slow read overwriting a newer page selection.
			const pageRequestRef = React.useRef(0);

			/** Reload the workspace's Wiki state. */
			const reload = React.useCallback(async () => {
				if (sessionId === undefined) return;
				try {
					const result = await call(`${API.state}?sessionId=${encodeURIComponent(sessionId)}`);
					setView({ status: "ready", state: result.state });
					if (result.wiki !== null && result.wiki !== undefined) {
						// The language of an existing Wiki seeds the next generation, so
						// regenerating does not silently flip it.
						setOptions((current) => ({ ...current, language: result.wiki.meta?.language ?? current.language, diagrams: result.wiki.meta?.diagrams ?? current.diagrams }));
					}
				} catch (error) {
					setView({ status: "error", error: error.message });
				}
			}, [sessionId]);

			React.useEffect(() => {
				void reload();
			}, [reload]);

			React.useEffect(() => {
				if (sessionId === undefined) return undefined;
				void call(API.models).then((result) => setProviders(result.providers ?? [])).catch(() => setProviders([]));
				return undefined;
			}, [sessionId]);

			// Poll only while a run is in flight, so an open tab costs nothing when
			// nothing is happening.
			const busy = view.status === "ready" && view.state.task !== null && view.state.task.state === "running";
			React.useEffect(() => {
				if (!busy) {
					runningRef.current = false;
					return undefined;
				}
				runningRef.current = true;
				const timer = window.setInterval(() => { void reload(); }, 1500);
				return () => window.clearInterval(timer);
			}, [busy, reload]);

			/** Switch to a page, fetching its body. */
			const openPage = React.useCallback(async (pageId) => {
				if (sessionId === undefined) return;
				const request = pageRequestRef.current + 1;
				pageRequestRef.current = request;
				setActiveId(pageId);
				setPage({ readState: "loading", id: pageId });
				try {
					const result = await call(`${API.read}?sessionId=${encodeURIComponent(sessionId)}&pageId=${encodeURIComponent(pageId)}`);
					if (request !== pageRequestRef.current) return;
					setPage(pageViewState(pageId, result));
				} catch (error) {
					if (request !== pageRequestRef.current) return;
					// A `not-found` answer is not a transport failure: the catalog and the
					// stored document disagree, and saying "no such page" is the truth.
					if (error.payload?.status === "not-found") setPage({ readState: "missing", id: pageId });
					else setPage({ readState: "error", id: pageId, error: error.message });
				}
			}, [sessionId]);

			// A page being generated updates itself in place: every poll that finds
			// the open page's status changed …queued …writing …done, or a retry
			// landing …refetches just that body, so the reader watching a
			// placeholder never has to refresh manually.
			const shownStatus = page !== null && page.readState === "ready" ? page.status : null;
			React.useEffect(() => {
				if (view.status !== "ready" || view.state.wiki === null || activeId === null) return;
				const summary = view.state.wiki.pages.find((candidate) => candidate.id === activeId);
				if (summary === undefined || shownStatus === null) return;
				if (summary.status !== shownStatus) void openPage(activeId);
			}, [view, activeId, shownStatus, openPage]);

			/**
			 * The model route and retry count a page rewrite should use, taken from
			 * the same options the full generation would use. Model ids may contain
			 * slashes themselves, so only the first one separates provider from model.
			 */
			const runOptions = React.useCallback(() => {
				const slash = options.model.indexOf("/");
				return {
					retries: Number(options.retries) || 0,
					provider: slash === -1 ? undefined : options.model.slice(0, slash),
					model: slash === -1 ? undefined : options.model.slice(slash + 1),
				};
			}, [options.model, options.retries]);

			/** Regenerate a single page in place. */
			const retryPage = React.useCallback(async (pageId) => {
				if (sessionId === undefined) return;
				setMessage(null);
				try {
					await call(API.regeneratePage, { body: { sessionId, pageId, ...runOptions() } });
					await reload();
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, reload, runOptions]);

			/** Wait until the workspace has no running task, polling the state route. */
			const waitForTask = React.useCallback(async () => {
				const deadline = Date.now() + 30 * 60 * 1000;
				while (Date.now() < deadline) {
					// The same cadence as the tab's own poll: a state read fingerprints
					// the workspace, so two different rates would only add work.
					await new Promise((resolve) => { window.setTimeout(resolve, 1500); });
					try {
						const result = await call(`${API.state}?sessionId=${encodeURIComponent(sessionId)}`);
						const task = result.state === undefined || result.state === null ? null : result.state.task;
						if (task === null || task === undefined || task.state !== "running") return true;
					} catch {
						return false;
					}
				}
				return false;
			}, [sessionId]);

			/**
			 * Regenerate every failed page, one page task at a time.
			 *
			 * The host keeps one task per workspace, so the batch is driven from
			 * here rather than from a host route: start a page, wait for that task to
			 * settle, then start the next one. Pages that already reached `done` are
			 * never touched, and a transport failure on one page does not abandon the
			 * rest …it is reported and the batch continues.
			 */
			const retryFailed = React.useCallback(async () => {
				if (sessionId === undefined) return;
				const wiki = view.status === "ready" ? view.state.wiki : null;
				const failedIds = wiki === null
					? []
					: wiki.pages.filter((candidate) => candidate.status === "failed").map((candidate) => candidate.id);
				if (failedIds.length === 0) {
					await reload();
					return;
				}
				setMessage(null);
				setRetrying(true);
				let left = failedIds.length;
				try {
					for (const pageId of failedIds) {
						try {
							await call(API.regeneratePage, { body: { sessionId, pageId, ...runOptions() } });
						} catch (error) {
							setMessage({ kind: "error", text: error.message });
							continue;
						}
						// Pick the new task up immediately so the progress panel and the
						// tab's own polling follow the rewrite instead of waiting for it.
						await reload();
						if (!(await waitForTask())) {
							setMessage({ kind: "error", text: t("retryStalled") });
							break;
						}
						try {
							const result = await call(`${API.state}?sessionId=${encodeURIComponent(sessionId)}`);
							setView({ status: "ready", state: result.state });
							left = result.state?.wiki?.counts?.failed ?? 0;
						} catch {
							// The final reload reports whatever the state is; the batch continues.
						}
						if (left === 0) break;
					}
					await reload();
					setMessage({ kind: "info", text: left === 0 ? t("retryFailedDone") : `${t("retryFailedLeft")} (${left})` });
				} finally {
					setRetrying(false);
				}
			}, [sessionId, view, reload, runOptions, waitForTask, t]);

			// Open the first page as soon as it exists, so a reader starts reading
			// while the rest of the Wiki is still generating rather than waiting for
			// the whole run. Following stops at the first selection: after that the
			// reader's own choice wins, even while later pages finish.
			React.useEffect(() => {
				if (view.status !== "ready" || view.state.wiki === null) return;
				if (activeId !== null) return;
				const first = view.state.wiki.pages.find((candidate) => candidate.status === "done");
				if (first !== undefined) void openPage(first.id);
			}, [view, activeId, openPage]);

			/**
			 * Ask before an action whose first effect is to overwrite pages.
			 *
			 * A full regeneration is one click away in the toolbar and on every
			 * outcome card, and its first save replaces the live document …which is
			 * exactly how a mis-click used to erase a finished Wiki. The host keeps
			 * the old version, so the dialog says recovery is available rather than
			 * pretending the action is harmless. With no completed pages there is
			 * nothing to lose and nothing is asked.
			 * @param {number} done - completed pages in the live Wiki.
			 * @param {string} [messageKey] - which confirmation sentence to use.
			 * @returns {boolean} whether the action may proceed.
			 */
			const confirmReplace = React.useCallback((done, messageKey = "regenerateConfirm") => {
				const ask = typeof window.confirm === "function" ? (text) => window.confirm(text) : undefined;
				return confirmOverwrite(done, t, ask, messageKey);
			}, [t]);

			/** Start a run. */
			const generate = React.useCallback(async () => {
				if (sessionId === undefined) return;
				const current = view.status === "ready" ? view.state.wiki : null;
				const done = current === null || current === undefined ? 0 : current.counts.done;
				if (!confirmReplace(done)) return;
				setMessage(null);
				try {
					await call(API.generate, {
						body: {
							sessionId,
							language: options.language,
							diagrams: options.diagrams,
							...runOptions(),
						},
					});
					await reload();
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, options, view, confirmReplace, runOptions, reload]);

			/** Restore an archived version: the undo for a regeneration or a delete. */
			const restore = React.useCallback(async (versionId) => {
				if (sessionId === undefined) return;
				setMessage(null);
				try {
					const body = { sessionId };
					if (typeof versionId === "string" && versionId !== "") body.versionId = versionId;
					await call(API.restore, { body });
					setActiveId(null);
					setPage(null);
					await reload();
					setMessage({ kind: "info", text: t("restored") });
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, reload, t]);

			/**
			 * Forget the previous version for good.
			 *
			 * Only reachable when no live Wiki is left, where `remove` treats the
			 * call as the permanent one. Without it the archive kept by a delete
			 * would have no way to be cleaned up from the tab.
			 */
			const purge = React.useCallback(async () => {
				if (sessionId === undefined) return;
				if (typeof window.confirm === "function" && !window.confirm(t("purgeConfirm"))) return;
				setMessage(null);
				try {
					await call(API.remove, { body: { sessionId } });
					await reload();
					setMessage({ kind: "info", text: t("purged") });
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, reload, t]);

			/** Ask the running task to stop. */
			const stop = React.useCallback(async () => {
				if (sessionId === undefined) return;
				try {
					await call(API.stop, { body: { sessionId } });
					await reload();
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, reload]);

			/** Delete the Wiki; the previous version stays recoverable. */
			const remove = React.useCallback(async () => {
				if (sessionId === undefined) return;
				if (typeof window.confirm === "function" && !window.confirm(t("removeConfirm"))) return;
				try {
					await call(API.remove, { body: { sessionId } });
					setActiveId(null);
					setPage(null);
					await reload();
					setMessage({ kind: "info", text: t("deletedRecoverable") });
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, reload, t]);

			/** Refresh when the code changed. */
			const refresh = React.useCallback(async () => {
				if (sessionId === undefined) return;
				const current = view.status === "ready" ? view.state.wiki : null;
				const done = current === null || current === undefined ? 0 : current.counts.done;
				if (!confirmReplace(done, "refreshConfirm")) return;
				try {
					const result = await call(API.refresh, { body: { sessionId, auto: true } });
					setMessage({ kind: "info", text: t(result.outcome === "unchanged" ? "unchanged" : "refreshed") });
					await reload();
				} catch (error) {
					setMessage({ kind: "error", text: error.message });
				}
			}, [sessionId, view, confirmReplace, reload, t]);

			/** Open a cited source location in the workspace viewer. */
			const onCite = React.useCallback((citation) => {
				if (tab === null || sessionId === undefined) return;
				const address = `dsh-resource://file/session/${sessionId}/${encodeURI(citation.path)}`;
				if (tab.actions !== undefined && typeof tab.actions.openResource === "function") {
					tab.actions.openResource(address, { params: { line: citation.start } });
				}
			}, [tab, sessionId]);

			const startDrag = React.useCallback((event) => {
				event.preventDefault();
				const startX = event.clientX;
				const startWidth = sideWidth;
				const move = (moveEvent) => {
					setSideWidth(Math.max(140, Math.min(560, startWidth + (moveEvent.clientX - startX))));
				};
				const up = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			}, [sideWidth]);

			// The toolbar is built before the ready/absent split, so the two facts it
			// needs about a loaded Wiki are read defensively here.
			const toolbarFailed = view.status === "ready" && view.state.wiki !== null && view.state.wiki !== undefined
				? view.state.wiki.counts.failed
				: 0;
			const working = busy || retrying;
			const toolbar = h("div", { className: "rw-toolbar" },
				h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => setSideHidden((value) => !value), title: sideHidden ? t("expand") : t("collapse") }, sideHidden ? "—" : "…"),
				h("span", { className: "rw-toolbar-title" }, view.status === "ready" ? (view.state.workspace?.name ?? t("title")) : t("title")),
				toolbarFailed > 0
					? h("button", {
						type: "button",
						className: "rw-button rw-button-retry",
						onClick: () => { void retryFailed(); },
						disabled: working,
						title: t("retryFailed"),
					}, `${retrying ? t("retryingFailed") : t("retryFailed")} (${toolbarFailed})`)
					: null,
				view.status === "ready" && view.state.exists
					? h("button", { type: "button", className: "rw-button", onClick: generate, disabled: working }, t("regenerate"))
					: null,
				view.status === "ready" && view.state.exists
					? h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: remove, disabled: working }, t("remove"))
					: null);

			if (view.status === "loading") {
				return h("div", { className: "rw-root" }, toolbar, h("div", { className: "rw-main" }, h("p", { className: "rw-muted" }, t("loading"))));
			}
			if (view.status === "error") {
				return h("div", { className: "rw-root" }, toolbar,
					h("div", { className: "rw-main" },
						h("div", { className: "rw-notice rw-notice-error" }, `${t("requestFailed")}: ${view.error}`),
						h("button", { type: "button", className: "rw-button", onClick: () => { void reload(); } }, t("retry"))));
			}

			const { state } = view;
			const task = state.task;
			const wiki = state.wiki;
			const history = Array.isArray(state.history) ? state.history : [];
			const newest = history.length > 0 ? history[0] : null;
			// The one-click notice appears when the newest archive would recover more
			// than the live Wiki currently has (a delete, a failed regeneration, a run
			// stopped before its pages landed). The full list below is always
			// available, including when the live Wiki is complete.
			const canRestore = restorableBackup(wiki, newest);
			const restoreNotice = canRestore
				? h("div", { className: "rw-notice rw-notice-warn rw-restore" },
					h("span", { className: "rw-restore-text" },
						h("strong", null, t("backupAvailable")),
						h("span", null, ` · ${fillTemplate(t("backupSummary"), { done: newest.done, total: newest.total })}`),
						h("span", { className: "rw-restore-hint" }, t("backupHint"))),
					wiki === null
						? h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: () => { void purge(); }, disabled: working }, t("purge"))
						: null,
					h("button", { type: "button", className: "rw-button", onClick: () => { void restore(newest.id); }, disabled: working }, t("restore")))
				: null;
			const historyPanel = h(HistoryPanel, {
				history,
				retentionDays: state.historyRetentionDays ?? null,
				t,
				onRestore: (versionId) => { void restore(versionId); },
				busy: working,
			});
			const running = task !== null && task.state === "running";
			// The task object only lives in the host's memory: after a restart it
			// is gone, and the document's `meta.lastTask` plus its page statuses
			// are the only record of how the last run ended.
			const unfinished = wiki !== null && wiki !== undefined && (wiki.counts.waiting + wiki.counts.generating) > 0;
			const outcomeCards = (() => {
				if (running || task === null) {
					if (running || wiki === null || wiki === undefined) return [];
					const cards = [];
					if (wiki.counts.failed > 0) cards.push(h(OutcomeCard, { key: "partial", kind: "partial", wiki, t, onRegenerate: generate, onRetryFailed: retryFailed, busy: working }));
					if (unfinished) cards.push(h(OutcomeCard, { key: "interrupted", kind: "interrupted", wiki, t, onRegenerate: generate, busy: working }));
					return cards;
				}
				if (task.state === "failed") return [h(OutcomeCard, { key: "failed", kind: "failed", task, wiki, t, onRegenerate: generate, busy: working })];
				if (task.state === "stopped") return [h(OutcomeCard, { key: "stopped", kind: "stopped", task, wiki, t, onRegenerate: generate, busy: working })];
				if (task.state === "done" && wiki !== null && wiki !== undefined) {
					const cards = [];
					if (wiki.counts.failed > 0) cards.push(h(OutcomeCard, { key: "partial", kind: "partial", task, wiki, t, onRegenerate: generate, onRetryFailed: retryFailed, busy: working }));
					if (unfinished) cards.push(h(OutcomeCard, { key: "interrupted", kind: "interrupted", task, wiki, t, onRegenerate: generate, busy: working }));
					return cards;
				}
				return [];
			})();

			if (wiki === null) {
				return h("div", { className: "rw-root" }, toolbar,
					h("div", { className: "rw-main" },
						state.unreadable !== null && state.unreadable !== undefined
							? h("div", { className: "rw-notice rw-notice-error" }, `${t("errorAt")}: ${state.unreadable}`)
							: null,
						...outcomeCards,
						restoreNotice,
						historyPanel,
						running
							? h(ProgressBar, { task, t, onStop: stop })
							: h(StatusCard, { options, providers, t, onChange: setOptions, onGenerate: generate, busy: false }),
						message !== null ? h("div", { className: `rw-notice rw-notice-${message.kind === "error" ? "error" : "warn"}` }, message.text) : null));
			}

			return h("div", { className: "rw-root" },
				toolbar,
				message !== null ? h("div", { className: `rw-notice rw-notice-${message.kind === "error" ? "error" : "warn"}` }, message.text) : null,
				running ? h(ProgressBar, { task, t, onStop: stop }) : null,
				...outcomeCards,
				restoreNotice,
				historyPanel,
				state.stale ? h("div", { className: "rw-stale" },
					h("span", null, t("stale")),
					h("button", { type: "button", className: "rw-button rw-button-quiet", onClick: refresh, disabled: working }, t("refresh"))) : null,
				h("div", { className: "rw-body", style: { "--rw-side-w": `${sideWidth}px` } },
					h("div", { className: sideHidden ? "rw-side rw-side-hidden" : "rw-side" },
						h(MetadataPanel, { wiki, t }),
						h("div", { className: "rw-side-heading" }, t("catalog")),
						h(CatalogTree, {
							pages: wiki.pages,
							activeId,
							pending: task !== null && task.state === "running",
							onSelect: (pageId) => { void openPage(pageId); },
							onRetry: (pageId) => { void retryPage(pageId); },
							busy: working,
							t,
						})),
					sideHidden ? null : h("div", { className: "rw-divider", onPointerDown: startDrag, role: "separator", "aria-orientation": "vertical" }),
					h("div", { className: "rw-main" },
						wiki.meta?.catalogDegraded === true
							? h("div", { className: "rw-banner" }, h("span", null, t("catalogDegraded")))
							: null,
						h(PagePane, { page, t, onCite, onRetry: retryPage }))));
		}

		/** The tab chip's own renderer, so a floating panel's header matches the chip. */
		function WikiTitle(props) {
			const useTabInfo = typeof props.useTabInfo === "function"
				? props.useTabInfo
				: props.hooks !== undefined && typeof props.hooks.tabInfo === "function"
					? props.hooks.tabInfo
					: null;
			const tabInfo = useTabInfo === null ? null : useTabInfo();
			const name = tabInfo === null ? null : tabInfo.tab?.navigation?.params?.workspaceName;
			const t = typeof props.t === "function" ? props.t : (key) => (DICTIONARIES.en[key] ?? key);
			return h("span", { className: "rw-title" }, name === undefined || name === null ? t("title") : `${t("title")} · ${name}`);
		}

		/** Services whose availability this plugin depends on. */
		const inject = ["slots", "locale", "sidebarRightTabs"];

		/**
		 * Mount the browser half.
		 * @param {object} ctx - the client context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);

			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", ID);
				style.setAttribute("data-plugin-css", ID);
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "repo-wiki: styles");

			ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), "repo-wiki: dictionaries");

			// Stage one: the tab type. A page type names no resource patterns …it is
			// opened by kind …and contributes the guide entry that makes it reachable
			// without knowing the kind.
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: ID,
				kind: KIND,
				priority: "extension",
				title: () => t("title"),
				guide: [{
					order: 40,
					title: () => t("guideTitle"),
					description: () => t("guideDescription"),
				}],
			}), "repo-wiki: tab type");

			// Stage two: the body and the chip, both keyed by the type's own id.
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: ID,
				locale: NS,
			}, WikiBody)), "repo-wiki: tab body");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: ID,
				locale: NS,
			}, WikiTitle)), "repo-wiki: tab title");
		}

		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		/**
		 * Exposed for the headless view tests: they assert the rendered element tree
		 * of the pure views and the parser output, neither of which needs a browser.
		 * Not part of the plugin's contract.
		 */
		exports.__internals = {
			ID,
			KIND,
			NS,
			API,
			DICTIONARIES,
			CSS,
			WikiBody,
			WikiTitle,
			PagePane,
			PageView,
			CatalogTree,
			MetadataPanel,
			StatusCard,
			ProgressBar,
			OutcomeCard,
			HistoryPanel,
			formatWhen,
			DiagramBlock,
			pageViewState,
			restorableBackup,
			confirmOverwrite,
			fillTemplate,
			parseBlocks,
			splitRow,
			parseMermaidFlowchart,
			layoutFlowchart,
			matchCitation,
			renderInline,
			describeEvent,
			formatDuration,
			formatClock,
		};
		return module.exports;
	}
});
