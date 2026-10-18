# DSH browser-side client plugin — API reconnaissance

Goal: enough verified API surface for an engineer to hand-write a **browser-side client plugin without a bundler**
(one hand-written `lib/client.js`, plain `React.createElement`, a `package.json` with a `dsh.client` block).

Everything below is quoted from shipped artifacts on this machine. Nothing is invented; where an API could not be
found, it is listed in **UNCERTAIN / NOT FOUND**. Inside a quoted block, `…` marks text this document elided
(the rest of that quote is byte-for-byte the shipped file; line numbers are given for every quote).

## Evidence sources (all absolute paths)

| Alias | Path | What it is |
|---|---|---|
| PROFILE | `$DSH_HOME\profiles\node_modules\@deepseek-ai\` | packages actually loaded by this profile |
| ASAR | `$DSH_INSTALL/resources/app.asar` | the Electron app archive (extracted copies used below live under `<temp>/asar-out`) |
| SHELL | `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\index-BKQ_L1z6.js` | the built web shell: it builds the module table and boots the plugin tree |

Two packages referenced by the task's READMEs are **not** installed under PROFILE (only compiled into SHELL):
`@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`,
`@deepseek-ai/dsh-client-store`. Their READMEs were recovered from ASAR
(`/dsh/node_modules/@deepseek-ai/<pkg>/README.md`) and are cited as such. `dsh-client-ui-slots` ships **no `.d.ts`**
(only `LICENSE`, `README*`, `lib/index.js`, `package.json`), so its API is quoted from its runtime implementation.

Note on tooling: the `grep` tool skips the hidden `.dsh` directory when given a directory, so directory-wide searches
below were run with PowerShell `Select-String`; `grep` works when given an explicit file path.

---

# A) LOADING & REGISTRATION

## A1. How a client plugin is discovered, served, loaded, and turned into a live plugin

### A1.1 The package declaration (what `package.json` must contain)

Authoritative type — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-package-manifest\lib\types\types.d.ts:38-52`:

```ts
/** Client module declaration read by client-modules and the client build. */
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /**
     * Exact module-table requests beyond the implicit client baseline, including
     * subpaths such as `<pkg>/client`; absent means baseline externals only.
     * Type-only imports are erased and create no module request.
     */
    external?: string[];
}
```

A real one — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-sidebar-documentpreview\package.json:16-39`:

```json
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-gateway",
        "@deepseek-ai/dsh-api-workspace-files",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "platform": "web"
    }
  },
```

Minimum for a no-bundler plugin: `"dsh": { "client": { "platform": "web" } }` plus an `exports` entry that resolves
`./client` to the hand-written `lib/client.js`. `inject` (package names) drives graph ordering; `external` is only
needed for non-baseline module requests (see A2).

A shipped package that declares `external` — `…\dsh-api-session-controller\package.json:44-54` (verbatim):

```json
  "dsh": {
    "client": {
      "external": [
        "@deepseek-ai/dsh-api-gateway/client"
      ],
      "inject": [
        "@deepseek-ai/dsh-api-gateway"
      ],
      "platform": "web"
    }
  },
```

Full inventory of `dsh.client` declarations in this profile (**55 packages** declare a `dsh.client` block) was enumerated; only `dsh-api-session-controller`
and `dsh-api-workspace-controller` use `external`, both with `"@deepseek-ai/dsh-api-gateway/client"`.

### A1.2 What the host does

`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-modules\README.md:34`:

> A browser plugin package declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and lists any non-baseline module requests under `dsh.client.external`. The host half turns each declaration into a served bundle under `/plugins`, ordered so dynamic providers load before their consumers.

Same file, `:12`:

> the host half scans enabled Loader entries and composes the boot graph, an available Web carrier serves each bundle over `/plugins`, and a shell-owned carrier dispatches the same exact bundle responses through `fetchBundle()`. The browser half loads those bundles lazily on demand. Plugin bundles execute lazily — running a bundle only registers a factory, and module side effects run at materialization — so nothing runs until a plugin is first used.

Same file, `:38`:

> The application combo scripts register plugin factories once during boot; module bodies remain lazy and run only at first import or materialization. Rows that share a combo URL share one in-flight script task. HMR switches one changed row to its revisioned one-resource combo URL. `<id>/client` and the bare id resolve to the same exports, because a plugin bundle is its package's client half.

Same file, `:46` (build requirement):

> The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly with one build instruction and a package/path list.

### A1.3 The wire the browser receives

`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-modules\lib\types\client\manifest.d.ts:46-85` (excerpt):

```ts
export interface WebBootEntry {
    /** Entry name == package name. */
    id: string;
    /** Revisioned single-resource combo endpoint used by HMR. */
    url: string;
    /** Opaque plugin-artifact revision used for HMR cache busting. */
    rev: string;
    /** Package-name dependency edges used for factory arrival and plugin composition. */
    inject?: string[];
    /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
    immediately?: boolean;
    /** Non-baseline module specifiers this row requests; omitted when it requests none. */
    external?: string[];
}
...
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
export interface WebBootGraph {
    /** Consistency anchor over the whole graph (content + bundle hashes). */
    rev: string;
    entries: WebBootEntry[];
    /** Initial combo descriptors; every entry belongs to exactly one descriptor. */
    batches: WebBootBatch[];
}
```

Window API — same file, `:185-191`:

```ts
export interface DshWindow {
    /** Host-composed entry graph, injected before the shell bundle runs; wire-boundary raw until {@link parseBootManifest}. */
    __DSH_BOOT__?: unknown;
    /** HTML-installed facade: a pending registration queue, then the live module-system target. */
    __ModuleLoader__?: ClientModuleLoaderTarget;
}
```

Registration shape — same file, `:147-157`:

```ts
/** One client bundle's factory registration submitted through `window.__ModuleLoader__.load`. */
export interface ClientBundleRegistration {
    /** Plugin id (package name) — the registration key; must match the graph row being executed. */
    id: string;
    /**
     * Closure factory holding the whole bundle body: receives the synchronous
     * require bound to the module table and returns the bundle's exports. Runs
     * once, at materialization.
     */
    factory: (require: (spec: string) => unknown) => Record<string, unknown>;
}
```

### A1.4 The exact outer form of `lib/client.js`

`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-sidebar-files\lib\client.js:1-10` (verbatim, full head):

```js
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-sidebar-files",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
```

and its tail, `…\dsh-client-ui-sidebar-files\lib\client.js:713-718`:

```js
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

Key mechanics from the loader (`…\dsh-client-modules\lib\client.js`):

* `:61-63` — `<id>/client` and `<id>` normalize to the same module (`stripClientSuffix`).
* `:229-233` — executing a bundle only registers the factory; a duplicate registration throws
  (`duplicate factory registration for "…" (bundle executed twice without invalidate?)`).
* `:300-309` — the synchronous `require` given to the factory resolves only against the **seed table → memoized module
  → registered factory**, else throws:
  `require("…") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`.
* `:278` — require cycles are fatal (`require cycle through "…" (factory-form CJS cannot deliver partial exports)`).

### A1.5 The plugin contract (yes: a Cordis plugin object)

The factory's return value is `module.exports`, and `module.exports` **is** the plugin. The vendored Loader unwraps it —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\cordis-plugin-loader\src\index.ts:191-199`:

```ts
  /** Normalize ESM/CJS/default export shapes before applying a plugin. */
  unwrapExports(exports: any) {
    if (isNullable(exports)) return exports
    exports = exports.default ?? exports
    // https://github.com/evanw/esbuild/issues/2623
    // https://esbuild.github.io/content-types/#default-interop
    if (!exports.__esModule) return exports
    return exports.default ?? exports
  }
```

then registers it — `…\cordis-plugin-loader\src\config\entry.ts:291-297`:

```ts
  private async _start(plugin: any) {
    let fiber: Fiber | undefined
    try {
      await this._patchContext([])
      this.loader.showLog(this, 'apply')
      fiber = this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack)
      await fiber.await()
```

The accepted plugin shapes — `$DSH_HOME\profiles\node_modules\@deepseek-ai\cordis\lib\types\registry.d.ts:47-93`:

```ts
/** Supported plugin entrypoint shapes. */
export type Plugin<T = any> = Plugin.Function<T> | Plugin.Constructor<T> | Plugin.Object<T>;
/** Types associated with plugin entrypoints and runtime records. */
export declare namespace Plugin {
    /** Shared metadata understood by the plugin registry and related tooling. */
    interface Base<T = any> {
        /** Display name used for fiber diagnostics and logger names. */
        name?: string;
        /** Standard-schema validator applied to config before the plugin starts. */
        Config?: StandardSchemaV1<any, T>;
        /** Services the plugin requires; it only loads while all are available. */
        inject?: Inject;
        /** Service name(s) the plugin provides (read by `Service` and by loaders). */
        provide?: string | string[];
        /** Service names whose intercept config the plugin declares it consumes. */
        intercept?: Dict<boolean>;
    }
    ...
    /** Object plugin with an `apply(ctx, config)` method. */
    interface Object<T = any> extends Base<T> {
        apply(ctx: Context, config: T): any;
    }
```

So a client plugin's factory should `return module.exports` carrying **named exports `apply` (required for the object
form), `inject` (service names), optionally `name` and `Config`**. Shipped examples:

* `…\dsh-client-ui-sidebar-files\lib\client.js:714-715` — `exports.apply`, `exports.inject`.
* `…\dsh-cordis-client-runner\lib\client.js:5165-5170` — `exports.apply`, `exports.inject`, `exports.name`.
* `…\dsh-client-ui-sidebar-right\lib\client.js:3647-3652` — `const inject = [ "slots", "layout", "locale", "resources" ];`

`Config` was not used by any shipped **client** plugin inspected (only `apply`/`inject`/`name` were exported).

### A1.6 The shell's boot sequence (browser side)

`…\dsh-web-frontend\dist\assets\index-BKQ_L1z6.js` (single line, tail of the bundle), verbatim fragment:

```js
async runPluginBoot(t,r){await t.plugin(Ba);const i=t.loader;i.internal=this.modules,t.on("internal/status",a=>{...});const s=this.manifest.plugins.map(a=>a.id);this.page.setTotal(s.length),await r,await Promise.all(s.map(async a=>{this.page.setState(a,"loading");const c=await i.create({name:a});i.resolve(c).fiber===void 0&&this.page.setState(a,"failed")})),await i.await(),this.assertEntriesActive(t)}
```

i.e. one Cordis Loader entry per graph row, named by package name; `loader.internal` is the client module system, so
`Entry._init()` → `tree.import(name)` → `ClientModuleSystem.import()` → materialize the factory → `unwrapExports` →
`registry.plugin(...)`. Entries still pending list the missing services:
`"${s}: pending (waiting for service${c.length===1?"":"s"}: ${c.join(", ")||"unknown"})"`.

`@deepseek-ai/dsh-client-hmr` (PROFILE `…\dsh-client-hmr\README.md:66`) adds a dev-only swap:

> On a `rebuilt` frame the revision makes `invalidate` select that plugin's immutable one-resource combo URL instead of its initial multi-resource URL. `prefetch` loads and registers the new factory while the old fiber still serves. … The swap is safe because execution is pure registration under the lazy-CJS model: every module side effect lives in the factory closure and runs at materialization.

`@deepseek-ai/dsh-client-resources` is **not** part of loading; it is the resource/`useResource` model (see C6).

## A2. The full list of shared modules available to `require(...)`

Mechanism: the shell seeds a **frozen module table**; the authoritative list is the shell's `staticModules` factory
`function by()` in SHELL (verbatim, single source of truth):

```js
function by(){return{react:ec,"react/jsx-runtime":ic,"react-dom":cc,"react-dom/client":fc,"@deepseek-ai/cordis":Ha,"@deepseek-ai/dsh-client-store":Hc,"@deepseek-ai/dsh-client-ui-slots":Ac,"@deepseek-ai/dsh-client-ui-primitives":Zg,"@deepseek-ai/dsh-client-ui-dockkit":Ey}}
```

That is the complete **baseline** — exactly nine specifiers:

| Specifier | Notes |
|---|---|
| `react` | React 18 (`react` is a devDependency pinned `^18.2.0` across packages) |
| `react/jsx-runtime` | what compiled JSX emits |
| `react-dom` | |
| `react-dom/client` | `createRoot`/`hydrateRoot` |
| `@deepseek-ai/cordis` | the plugin/context runtime |
| `@deepseek-ai/dsh-client-store` | observable/snapshot store primitives |
| `@deepseek-ai/dsh-client-ui-slots` | the slot registry core (`ctx.slots` is the renderer side) |
| `@deepseek-ai/dsh-client-ui-primitives` | shared React atoms + `--dsw-*` design tokens |
| `@deepseek-ai/dsh-client-ui-dockkit` | docking layout kit (tabs/panes) |

`…\dsh-client-modules\README.md:42`:

> The shell seeds a frozen module table (`PLATFORM_MODULES`: React, Cordis, and static UI libraries); every dynamic bundle resolves its externals against exactly that baseline. `dsh.client.external` adds only exact non-baseline requests, each answered by the dynamic package row it names or an exact static-table key. Type-only imports are erased and create no request. Composition rejects malformed requests, missing suppliers, self-requests, and synchronous request cycles.

Everything else a client plugin needs (another `@deepseek-ai/dsh-client-*` package, e.g. `dsh-client-locale`, or
`dsh-client-ui-sidebar-right`) must be declared in **`dsh.client.inject`** (package row) — requiring it without the row
present fails loudly at materialization. `dsh.client.external` is only for exact non-baseline *requests* such as
`@deepseek-ai/dsh-api-gateway/client`.

Practical rule for a no-bundler plugin: if you only `require("react")` and use slots, the baseline is enough —
no `external` needed. Observe that shipped packages which touch only baseline + injected rows declare **no**
`external` at all (e.g. `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-chat`).

## A3. Can a plugin use plain `React.createElement` with no build step? — Yes

Three independent pieces of evidence:

1. **The same bundle already calls `createElement` by hand.** Real first-party call sites (not strings, not examples):
   `…\dsh-client-ui-renderer\lib\client.js:1407` and `:1416`:

   ```js
   			if (ready) return props.app();
   			return (0, react.createElement)("div", {
   				className: props.boot.className,
   				"data-dsh-boot": "",
   				dangerouslySetInnerHTML: { __html: props.boot.html }
   			});
   …
   		function mountApp(container, app) {
   			const boot = container.querySelector(":scope > [data-dsh-boot]");
   			if (boot !== null) return (0, react_dom_client.hydrateRoot)(container, (0, react.createElement)(BootHandoff, {
   ```

   `…\dsh-client-ui-directory-picker-browse\lib\client.js:951`:

   ```js
   			return (0, react.createElement)(DirectoryBrowser, {
   				open: props.open,
   				busy: props.busy,
   ```

   (that file mixes hand-written `createElement` with compiled `react_jsx_runtime.jsx` calls).

2. **The product instructs exactly this for hand-written plain-JS client halves.**
   `…\dsh-cordis-client-runner\lib\client.js:169`:

   ```js
   				throw new Error(`client half failed to parse in this browser: ${error.message}\nThe browser half is plain JavaScript (no JSX, no TypeScript); build elements with React.createElement.`);
   ```

   and `:182-183`:

   ```js
   				if (returned === void 0) throw new Error("client half returned `undefined` — did you forget `return`?\n  ✅ return (ctx) => { … }\n  ✅ return { name: '…', inject: ['slots'], apply(ctx) { … } }");
   				throw new Error("client half must `return` a plugin: a function, or an object with an `apply(ctx)` method");
   ```

3. **The shipped slot catalog's own examples use `React.createElement`.** From the generated catalog
   `CLIENT_SLOT_API` in `…\dsh-cordis-client-runner\lib\client.js:2200+`, entry `sidebar.right.pane.tab`:

   ```js
   example: "return {\n  inject: ['slots'],\n  apply(ctx) {\n    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(\n      { name: 'sidebar.right.pane.tab', key: '<one key the owner dispatches>' },\n      () => React.createElement('div', null, 'hello'),\n    ))\n  },\n}"
   ```

Since `react` and `react/jsx-runtime` are both seed words, a component registered from a hand-written factory is
indistinguishable from a compiled one.

---

# B) SLOTS

## B4. The exact `ctx.slots` API

### B4.1 Package status

`@deepseek-ai/dsh-client-ui-slots` is seeded by the shell but **not installed** in PROFILE. README recovered from
ASAR (`/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/README.md`, 112 lines). It ships no `.d.ts`; the API below is
quoted from its runtime (`…\dsh-client-ui-slots\lib\index.js`, extracted to
`<temp>/asar-out\__dsh__node_modules__@deepseek-ai__dsh-client-ui-slots__lib__index.js`) and from real call sites.

> `dsh-client-ui-slots\README.md:13` — “`dsh-client-ui-slots` lets web client plugins define and compose typed UI regions. Ordinary Slots provide parent-owned extension positions; Component Factories provide reusable assemblies with caller-selected local Components. … Pair this React-free package with `ui-renderer` when the client needs rendering.”
> `:29` — “Compose UI through this package whenever you write a client plugin: register a component into a slot your parent declared, or declare child slots your component renders. The four kinds cover the composition shapes — `single` (one occupant), `list` (ordered entries), `keyed` (dispatch by a key), and `chain` (entries elect themselves).”
> `:47` — “Declaring a slot is claiming it: the registering entry becomes the only entry allowed to render that key, and registering into an undeclared slot, declaring an already-declared child, mounting one shared handle under two scopes, or registering a chain without `select` throws at load.”

The Cordis service object is a **renderer-owned** `SlotRegistry`, whose `register` is the core's, verbatim from
`…\dsh-client-ui-renderer\lib\types\client\registry.d.ts:84`:

```ts
    readonly register: SlotCore['register'];
```

### B4.2 `register(options, component)`

Runtime signature and validation — `…\dsh-client-ui-slots\lib\index.js` (extracted), `:164-237`:

```js
		register(options, component) {
			const rec = this.records.get(options.name);
			if (!rec?.spec) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
			const spec = rec.spec;
			const priority = options.priority ?? 0;
			const occupantHint = (occupant) => `at priority ${priority}${occupant.registrant !== void 0 ? ` (registered by ${occupant.registrant})` : ""} — register at a different priority to shadow it (lowest renders)`;
			switch (spec.kind) {
				case "single": {
					const occupant = rec.entries.find((e) => (e.options.priority ?? 0) === priority);
					if (occupant) throw new Error(`single slot "${options.name}" already has a registration ${occupantHint(occupant)}`);
					break;
				}
				case "keyed": {
					if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);
					...
				case "list": {
					if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
					...
				case "chain":
					if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`);
					break;
			}
			if (options.children) for (const childKey of Object.keys(options.children)) {
				const childRec = this.records.get(childKey);
				if (childRec?.spec) throw new Error(`slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`);
			}
			if (options.store !== void 0 && typeof options.store !== "function") {
				const pinned = this.handleScopes.get(options.store);
				if (pinned && pinned.scope !== spec.scope) throw new Error(`store handle mounted under "${options.name}" (scope "${spec.scope}") is already mounted under scope "${pinned.scope}" — one handle, one scope`);
				...
			const entry = {
				component,
				options: {
					...options.key !== void 0 ? { key: options.key } : {},
					...options.id !== void 0 ? { id: options.id } : {},
					...options.order !== void 0 ? { order: options.order } : {},
					...options.label !== void 0 ? { label: options.label } : {},
					...options.priority !== void 0 ? { priority: options.priority } : {}
				},
				...options.select !== void 0 ? { select: options.select } : {},
				...options.inject !== void 0 ? { inject: options.inject } : {},
				...options.children !== void 0 ? { children: options.children } : {},
				...options.store !== void 0 ? { store: options.store } : {},
				...options.locale !== void 0 ? { locale: options.locale } : {},
				...options.registrant !== void 0 ? { registrant: options.registrant } : {}
			};
			const next = [...rec.entries, entry];
			next.sort(spec.kind === "list" ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0) : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
			rec.entries = next;
			this.markDirty(options.name, rec);
```

So the option object fields are: `name` (slot key, required), `key` (required for `keyed`), `id` (required for `list`),
`order` + `label` (list ordering/labels), `priority` (higher/lower shadowing; **lowest renders**), `select`
(required for `chain`), `inject` (business-props factory), `children` (declare child slots this entry owns), `store`
(a store handle or a store factory), `locale` (namespace for the injected `t`), `registrant` (diagnostic).
It returns **a disposer** (`:238` onward) and each shipped caller wraps it in `ctx.effect(...)` for fiber-lifetime
cleanup.

### B4.3 Declaring/depending on a slot: `ctx.slots.inject`

`…\dsh-client-ui-renderer\lib\types\client\registry.d.ts:85-100`:

```ts
    /**
     * Install an effect for each declaration lifetime of a slot. The callback
     * runs synchronously when the declaration already exists; otherwise it runs
     * inside the declaring `register()` call after the declaration is committed.
     * Collapse disposes the effect and a later declaration runs it again.
     * ...
     * @param key - declared SlotMap key to depend on.
     * @param callback - creates one disposer or an iterable of disposers.
     * @returns idempotent disposer for the wait and active effect.
     * @throws callback setup failures synchronously when the slot is already declared.
     */
    inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void;
```

Real usage (note the generator form for several registrations on one declaration lifetime) —
`…\dsh-client-ui-sidebar-right\lib\client.js:3704-3711`:

```js
				const disposeSeat = ctx.slots.inject("rightbar", function* () {
					yield ctx.slots.register({
						name: "rightbar",
						children: { "rightbar.session": {
							kind: "single",
							scope: "session"
						} }
					}, RightbarRoot);
```

### B4.4 Slot semantics (single / list / keyed / chain)

* `single` — one occupant per priority; second registration at the same priority throws.
* `list` — many entries keyed by `id`; sorted by `(priority, order)` (runtime `:222`).
* `keyed` — dispatch by `key`; the owner renders the entry matching its key. A keyed slot may declare
  `kind: 'keyed'` children, and the seat renders "the owner's 'nothing can view this' notice rather than an empty pane"
  when no key matches (`…\dsh-client-ui-sidebar-right\lib\types\client\contract\slots.d.ts:19-31`).
* `chain` — entries elect themselves through `select`; `…\dsh-client-ui-slots\README.md:61`:
  > `ChainSelect` selectors run in ascending `priority` order (ties in registration order); the first non-null return elects its entry and becomes the component's `matched` prop, and all-null falls to the owner's `renderSlotChain` fallback (`ChainRenderOpts`).
  Chain registrants must supply `select` (`register` throws otherwise). Example of a chain owner seat:
  `…\dsh-client-ui-sidebar-right\lib\client.js:3748-3757` (the guide body registers a `kind: "chain"` child slot).

### B4.5 How injected props reach the component

`…\dsh-client-ui-slots\README.md:39`:

> Every registered component receives props composed from five framework shares: the runtime share (`owner` from the parent's render call site, plus the session standard kit and global seat), the child-render share (`renderSlot` statically narrowed to declared children), the Factory-render share (`renderFactorySlot`), the store share (the declared handle's selector hook and draft-stripped actions), and the business share (inferred from `inject`).

Concretely, from the shipped tab body props — `…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1409`:

```js
		function TextPreview({ useTabInfo, useResource, useStore, actions, loadPage, reloadPages, loadAll, reloadAll, useDocumentPreviews, renderSlot, t }) {
```

* `inject: (sessionId, actions) => ({...})` supplies the **business share** (e.g. `loadPage`, `loadAll`) plus extra hook
  seats (`hooks: { documentPreviews: source }`).
* `locale: NS` supplies `t` (namespace-bound translate).
* `store: <handle>` supplies `useStore` and the baked `actions`.
* declared children arrive as `renderSlot` calls with explicit props —
  `…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1664-1670`:

  ```js
  							content !== void 0 && renderSlot("sidebar.right.tab.document", {
  								resourceAddress: tab.contentId,
  								content,
  								wrap: state.wrap,
  								scrollportRef: bindScrollport
  							}, {
  								entryKey: selected.id,
  ```

* framework-injected hook seats are declared in the slot's own spec and read through the props, e.g.
  `…\dsh-client-ui-sidebar-right\lib\types\client\contract\slots.d.ts:140-145`:

  ```ts
  /** The slot-owned hook shared by every tab body and title registration. */
  export interface SidebarRightTabInjected {
      hooks: {
          tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo>;
      };
  }
  ```

### B4.6 Slot names available (authoritative catalog)

`…\dsh-cordis-client-runner\lib\client.js:2198-2200` carries a generated catalog of **every slot the shipped web
bundle declares**:

```js
		//#region lib/types/client/slot-catalog.js
		/** Every slot the shipped web bundle declares, sorted by key. */
		const CLIENT_SLOT_API = [
```

I extracted and parsed it (61 entries). Key/kind/scope/required register options:

| Slot key | kind | scope | required register option |
|---|---|---|---|
| `conversation.approval.detail` | single | session | – |
| `conversation.chat.assistant-actions` | list | session | `id` |
| `conversation.chat.commandview` | keyed | session | `key` |
| `conversation.chat.node` | keyed | session | `key` |
| `conversation.chat.turnTail` | chain | session | `select` |
| `conversation.composer` | chain | session | `select` |
| `conversation.composer.bar` | single | session-maybe | – |
| `conversation.composer.dock` | list | session | `id` |
| `conversation.hero.agentPreset` | single | root | – |
| `conversation.hero.brand.mark` | single | root | – |
| `conversation.hero.workspace` | single | root | – |
| `conversation.hero.workspace.directoryFlow` | single | root | – |
| `conversation.input.attachments` | single | session-maybe | – |
| `conversation.input.dock` | list | session | `id` |
| `conversation.input.left` | list | session | `id` |
| `conversation.input.model` | single | session | – |
| `conversation.input.overlay` | list | session | `id` |
| `conversation.input.plan` | single | session | – |
| `conversation.input.right` | list | session | `id` |
| `conversation.message.images` | single | session | – |
| `conversation.session` | single | session | – |
| `conversation.session.header` | single | session | – |
| `conversation.session.header.actions` | list | session | `id` |
| `conversation.session.header.corner` | single | session | – |
| `conversation.session.header.lineage` | single | session | – |
| `conversation.session.header.utilities` | list | session | `id` |
| `conversation.trajectory.images` | single | session | – |
| `conversation.view` | list | session | `id` |
| `main` | keyed | root | `key` |
| `main.conversation` | single | session-maybe | – |
| `rightbar` | single | root | – |
| `rightbar.session` | single | session | – |
| `root` | single | root | – |
| `settings.action` | list | root | `id` |
| `settings.close` | single | root | – |
| `settings.general.item` | list | root | `id` |
| `settings.header` | single | root | – |
| `settings.models.footer` | list | root | `id` |
| `settings.models.provider-card` | keyed | root | `key` |
| `settings.onboarding` | list | root | `id` |
| `settings.plugin.item` | keyed | root | `key` |
| `settings.plugins.tab` | list | root | `id` |
| `settings.section` | list | root | `id` |
| `settings.trigger` | single | root | – |
| `shell.overlay` | list | root | `id` |
| `sidebar` | single | root | – |
| `sidebar.brand.mark` | single | root | – |
| `sidebar.brand.name` | single | root | – |
| `sidebar.footer.action` | list | root | `id` |
| `sidebar.panellist` | list | root | `id` |
| `sidebar.right.pane.tab` | keyed | session | `key` |
| `sidebar.right.pane.tab.title` | keyed | session | `key` |
| `sidebar.right.tab.document` | keyed | session | `key` |
| `sidebar.right.tab.guide` | chain | session | `select` |
| `sidebar.right.tab.menu.item` | list | session | `id` |
| `sidebar.settings` | single | root | – |
| `sidebar.workspaces` | single | root | – |
| `sidebar.workspaces.directoryFlow` | single | root | – |
| `tool.call.images` | single | session | – |

Caveat (from the shell's own doc): `root` is single-occupant and **must not** be registered into —
`…\dsh-client-ui-renderer\lib\types\client\registry.d.ts:18-31`:

> DO NOT register here. This is a single slot, so a second entry does not sit beside the frame — it shadows it, and a dynamically registered entry is assigned a lower priority than the shipped one, which makes it the winner: the page would render your component alone, with every seat the frame declares gone. For a surface of your own that floats over the whole app, register into `shell.overlay` instead (a list slot: additive, and click-through until your entry opts into pointer events).

## B5. COMPLETE real example of a plugin registering into a slot (verbatim)

Package `@deepseek-ai/dsh-client-ui-sidebar-files`, file
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-sidebar-files\lib\client.js`.

Slot declaration owner (the tab seat), `…\dsh-client-ui-sidebar-right\lib\client.js:3712-3737` (the parent that declares
`sidebar.right.pane.tab` so extensions may register into it):

```js
					yield ctx.slots.register({
						name: "rightbar.session",
						locale: NS,
						children: {
							"sidebar.right.pane.tab": {
								kind: "keyed",
								scope: "session",
								inject: { hooks: { tabInfo: tabInfoFactory } }
							},
							"sidebar.right.pane.tab.title": {
								kind: "keyed",
								scope: "session",
								inject: { hooks: { tabInfo: tabInfoFactory } }
							},
							"sidebar.right.tab.menu.item": {
								kind: "list",
								scope: "session"
							}
						},
						store,
						inject: (sessionId) => ({
							...injected,
							keyedHooks: { tabNavigation: (key) => controller.tabDomain.occurrence(sessionId, { id: key }).navigation },
							occurrence: (tab) => controller.tabDomain.occurrence(sessionId, tab)
						})
					}, RightbarSeat);
```

The extension's full plugin body — `…\dsh-client-ui-sidebar-files\lib\client.js:674-716`:

```js
		//#region lib/types/client/index.js
		/** This package's copy namespace. */
		const NS = "sidebarFiles";
		/**
		* Required browser services: the tab registry, the keyed seat, the Remote
		* carrier and its namespace, and copy.
		*/
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs",
			"remote",
			"remote.workspaceFiles"
		];
		/**
		* Client plugin body: register the type, its dictionaries, its body, and its chip title.
		* @param ctx - client root context carrying the tab registry, the slots, and the Remote face.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.sidebarRightTabs.register(filesDefinition(t)), "ui-sidebar-files: files type");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-sidebar-files: dictionaries");
			const store = createFilesStore();
			const inject = filesFace(createList(ctx.remote));
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: FILES_ID,
				locale: NS,
				store,
				inject
			}, FilesBody)), "ui-sidebar-files: files tab body");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: FILES_ID
			}, FilesTitle)), "ui-sidebar-files: files tab title");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

---

# C) SIDEBAR-RIGHT TAB (the main target)

Source of truth: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-sidebar-right\`
(README `README.md`, 18 KB; types under `lib\types\client\`).

## C6. The exact registration and opening API

### C6.1 Stage one — the tab **type**: `ctx.sidebarRightTabs.register(definition)`

Type — `…\dsh-client-ui-sidebar-right\lib\types\client\tab-registry.d.ts:67-109`:

```ts
/** One registered tab type: its static face, and nothing else. */
export interface SidebarRightTabDefinition {
    /**
     * This implementation's identity in the tab system, unique across every
     * registration (a package name is the natural value). A kind is not unique —
     * an extension may take a builtin's over — so the implementation carries its
     * own name, and it is the key its body and title register under in the
     * `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats.
     */
    readonly id: string;
    /** Type discriminator: what the tabs of this type are, and what `openTab` names. */
    readonly kind: string;
    /**
     * Resource-address globs this type recognizes; omit for a page type, which is
     * opened by kind and recognizes no address.
     *
     * A pattern containing `:` is matched against the whole address
     * (`dsh-resource://file/**`); one without is matched against the URI's path at
     * any depth (`*.md` matches `dsh-resource://file/session/s1/home/me/notes.md`),
     * and an address that is not a URI matches no such pattern. Matching ignores
     * case and does not hide dotfiles.
     */
    readonly patterns?: readonly string[];
    /** Defaults to `extension`: a type that says nothing is one from outside the product. */
    readonly priority?: SidebarRightTabPriority;
    /**
     * Veto an address this type's globs matched.
     * ...
     */
    readonly canOpen?: (address: string) => boolean;
    /**
     * The tab chip's initial text, captured into the layout record at open time.
     * @param address - the address being opened.
     * @returns the title in the current language.
     */
    readonly title: (address: string) => string;
    /** Entry boxes for the guide page. Omit to stay off it. */
    readonly guide?: readonly SidebarRightGuideEntry[];
}
```

`register` itself — same file, `:130-153`:

```ts
export declare class SidebarRightTabRegistry {
    ...
    /**
     * Register one tab type for the caller's lifetime.
     *
     * The caller holds the returned disposer inside its own `ctx.effect`, so a
     * type's registration lives exactly as long as the plugin that contributed it.
     * An `extension` may register a kind a `builtin` already holds and takes it
     * over until it unregisters; a second registration in the same band, or any
     * registration meeting a `fallback` of the same kind, is a wiring mistake, and
     * so is an `id` already in use.
     * @param definition - the contributed type.
     * @returns idempotent disposer.
     * @throws when the id is taken, or the kind is already registered in a way this one cannot coexist with.
     */
    register(definition: SidebarRightTabDefinition): () => void;
```

Priority bands — same file, `:30-43`: `export type SidebarRightTabPriority = 'extension' | 'builtin' | 'fallback';`
with `extension` highest and the default.

Guide entry shape — same file, `:44-66`:

```ts
export interface SidebarRightGuideEntry {
    /** Ascending position among every registered type's entries. */
    readonly order: number;
    readonly title: () => string;
    readonly description?: () => string;
    /** Optional glyph, drawn before the title; without one the guide draws its cube placeholder. */
    readonly icon?: ComponentType<IconProps>;
}
```

### C6.2 Stage two — the tab **body** slot: `sidebar.right.pane.tab`

Declaration merged into the slot system by this package —
`…\dsh-client-ui-sidebar-right\lib\types\client\contract\slots.d.ts:19-45`:

```ts
        /**
         * One tab's body, dispatched with the `id` of the type in force for
         * `tab.kind`. A tab type registers here under its definition's `id` and
         * receives every tab of that kind, in every pane, docked or floating. A kind
         * with no type in force renders the owner's "nothing can view this" notice
         * rather than an empty pane.
         */
        'sidebar.right.pane.tab': {
            kind: 'keyed';
            scope: 'session';
            hookContext: TabHookContext;
            inject: SidebarRightTabInjected;
        };
        /**
         * A tab's title as its chip (and a floating panel's header) shows it,
         * dispatched with the same key and information hook as the body. ...
         */
        'sidebar.right.pane.tab.title': {
            kind: 'keyed';
            scope: 'session';
            hookContext: TabHookContext;
            inject: SidebarRightTabInjected;
        };
```

**Exact slot name:** `'sidebar.right.pane.tab'`, **kind** `keyed`, **scope** `session`,
**required register option** `key: <definition.id>`.

**Exact component props** (framework-injected hook + live tab info) —
same file, `:116-145`:

```ts
/** Live information shared by a tab's body, title, and guide replacement. */
export interface SidebarRightTabInfo {
    readonly sidebar: {
        readonly expanded: boolean;
        /** Presentation selected by manual mode or viewport width; preserved while collapsed. */
        readonly fullscreen: boolean;
    };
    readonly panel: {
        readonly id: PaneId;
    };
    readonly tab: TabRecord & {
        /** Docked bodies need an expanded sidebar and an active tab; expanded titles include inactive tabs. Floats stay visible. */
        readonly visible: boolean;
        readonly navigation: SidebarRightTabNavigation;
        /** Aborted only when the record disappears or this plugin unloads, not on hide or session switch. */
        readonly signal: AbortSignal;
        readonly actions: SidebarRightTabActions;
    };
}
/**
 * Read current tab information through the slot framework's subscriptions.
 * @returns the sidebar presentation, containing pane, and live tab record.
 */
export type UseSidebarRightTabInfo = () => SidebarRightTabInfo;
/** The slot-owned hook shared by every tab body and title registration. */
export interface SidebarRightTabInjected {
    hooks: {
        tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo>;
    };
}
```

The body **reads** it by destructuring the injected hook prop, exactly as `TextPreview` does:
`const { tab } = useTabInfo();` (`…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1410`).

Navigation record + tab actions — same file, `:73-115`:

```ts
/** Where a tab was last navigated to: what the `open` that created or revealed it carried. */
export interface SidebarRightTabNavigation {
    /** The address opened; for a tab record this is its `contentId`. */
    readonly address: string;
    /** The opener's `params` (see `contract/params.ts`); `undefined` when it gave none. */
    readonly params: SidebarRightNavigationParams;
    /**
     * Incremented on every navigation to this tab, whether or not `params`
     * changed, so a body can act on "navigated again" alone. `0` for a record
     * nobody opened by address: a seeded guide, or a tab restored by undo.
     */
    readonly revision: number;
}
/** Where an open from a tab lands. ... */
export interface SidebarRightTabPlacement {
    readonly paneId?: PaneId;
    readonly revealIfOpened?: boolean;
    /** `true` opens in this tab's place — its pane and strip slot — and closes this tab in the same step. */
    readonly replaceTab?: boolean;
}
/** The actions one tab may take on itself; each acts on the session the tab is in. */
export interface SidebarRightTabActions {
    openResource(address: string, options?: SidebarRightTabPlacement & {
        readonly params?: SidebarRightResourceParams;
    }): void;
    openTab<K extends string>(kind: K, options?: SidebarRightTabPlacement & {
        readonly params?: SidebarRightTabParamsFor<K>;
    }): void;
    /** Close this tab. */
    close(): void;
}
```

### C6.3 Opening a tab programmatically: `ctx.sidebarRight`

`…\dsh-client-ui-sidebar-right\lib\types\client\service.d.ts:80-125` (exact option objects):

```ts
/** Where an open lands; every field is optional and the defaults are the common case. */
export interface SidebarRightPlacement {
    /** Land a new tab in this pane instead of the active docked one. */
    readonly paneId?: PaneId;
    /** Take this tab's place — its pane and its strip slot — and close it in the same step. */
    readonly replaceTab?: TabId;
    /**
     * Resource tabs reveal an existing (kind, contentId) by default; `false`
     * permits duplicates. Pages always deduplicate within the target pane.
     */
    readonly revealIfOpened?: boolean;
}
/** How a caller wants a resource opened. */
export interface SidebarRightOpenResourceOptions extends SidebarRightPlacement {
    /** Name the opening type instead of letting the registry rank claims; its `canOpen` still applies. */
    readonly kind?: string;
    /** The resource's navigation parameters, typed by resource type; delivered as `navigation.params`. */
    readonly params?: SidebarRightResourceParams;
}
/** How a caller wants a page type opened. */
export interface SidebarRightOpenTabOptions<K extends string = string> extends SidebarRightPlacement {
    /** That kind's navigation parameters, typed by kind; delivered as `navigation.params`. */
    readonly params?: SidebarRightTabParamsFor<K>;
}
/** The outward right-Sidebar face (`ctx.sidebarRight`). */
export interface ISidebarRight {
    /**
     * Open a resource: claim it, place it, reveal the column, record the navigation.
     *
     * Without `options.kind` the registry ranks the types whose globs and
     * `canOpen` accept the address and the best band wins; with it, that kind's
     * type in force opens the address (its `canOpen` still applies). An address
     * outside `dsh-resource://`, or one no type will open, is a wiring mistake,
     * not a user error, so it throws. The column expands in the same step,
     * because content the user cannot see is not opened.
     * @param address - a `dsh-resource://<type>/…` address.
     * @param options - placement, the opening type, and navigation parameters.
     */
    openResource(address: string, options?: SidebarRightOpenResourceOptions): void;
    /**
     * Open a page type by kind: the type in force for it, at the address this
     * package records pages under. A kind nothing registered throws.
     * @param kind - the page type's kind.
     * @param options - placement and that kind's navigation parameters.
     */
    openTab<K extends string>(kind: K, options?: SidebarRightOpenTabOptions<K>): void;
    /** Close one tab of the mounted session; the sole docked guide remains open. */
    close(tabId: TabId): void;
    ...
}
```

Also on the face: `active()`, `isExpanded()`, `toggleExpanded()`, `focus(tabId)`, `split(paneId?)`, `float(tabId, rect?)`,
`dock(paneId)`, and the `@internal` `_undo()` / `_redo()` (service.d.ts `:126-288`).

### C6.4 What an "address" must look like

* **Resource addresses** are `dsh-resource://<type>/…` URIs. From the resource model —
  `…\dsh-client-resources\README.md:11`:
  > Resource addresses use `dsh-resource://<type>/…`; protocols that need a scope encode it in the path. Components receive the current value and later updates through the public `useResource` hook. Unsupported protocols and non-resource schemes, such as `sidebar://guide`, resolve to no resource.
* **The concrete `file` type address**, built by shipped code —
  `…\dsh-client-ui-sidebar-files\lib\client.js:136` and `:145-154`:

  ```js
  		/** The scheme and type every file address opens with. */
  		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
  ...
  		/**
  		* Build the address of a file read through one Session.
  		* @param sessionId - the Session whose Host workspace resolves the path.
  		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
  		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
  		*/
  		function sessionFileAddress(sessionId, path) {
  			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
  		}
  ```

  Scopes accepted when parsing back: `session` (`dsh-resource://file/session/<sessionId>/<path>`) and `absolute`
  (`dsh-resource://file/absolute/<path>`, Windows drives and UNC supported) —
  `…\dsh-client-ui-sidebar-documentpreview\lib\client.js:982-1009`.
* **Page tabs** are recorded at an address the package composes and nobody else spells —
  `…\dsh-client-ui-sidebar-right\lib\types\client\contract\seed.d.ts:27-34`:

  ```ts
  /**
   * The address a page tab is recorded under: `sidebar://<kind>`. The scheme is
   * this package's bookkeeping for `openTab`, spelled here and nowhere else; a
   * caller names the kind and never sees or composes the address.
   * @param kind - the page type's kind.
   * @returns the page's address.
   */
  export declare function pageAddress(kind: string): string;
  ```

  A caller therefore passes a **kind** to `openTab` and never builds that address.

Real calls:

* resource, with params — `…\dsh-client-ui-chat\lib\client.js:8317-8323`:

  ```js
  			openFile: async (path, options) => {
  				const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
  				const url = fileAddressFor(sessionId, cwd, path);
  				if (options?.line === void 0) ctx.sidebarRight.openResource(url);
  				else ctx.sidebarRight.openResource(url, { params: { line: options.line } });
  				await Promise.resolve();
  			},
  ```

* page (the strip's add control) — `…\dsh-client-ui-sidebar-right\lib\client.js:677-682`:

  ```js
  					addTab: (paneId) => {
  						openTab(GUIDE_KIND, {
  							paneId,
  							revealIfOpened: false
  						});
  					},
  ```

* page from inside a tab body (a guide capsule) — `…\dsh-client-ui-sidebar-right\lib\client.js:180-182`:

  ```js
  					onPick: (entry) => {
  						tab.actions.openTab(entry.kind, { replaceTab: true });
  					}
  ```

## C7. A SHIPPED package registering its own tab type through the public path

**`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`** — confirmed, and it is described as the proof by the sidebar
README (`…\dsh-client-ui-sidebar-right\README.md:75`), verbatim: “A tab type registers in two stages, and the shipped
guide type goes through exactly the same public path a type from another package does
(`ui-sidebar-documentpreview` is the live proof). Both stages sit inside the type's own `ctx.effect`, so the
registration lives exactly as long as the plugin that made it.”

### C7.1 Host `package.json` `dsh.client` block

`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-sidebar-documentpreview\package.json:21-39`:

```json
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-gateway",
        "@deepseek-ai/dsh-api-workspace-files",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "platform": "web"
    }
  },
```

### C7.2 The plugin body (`apply`), verbatim

`…\dsh-client-ui-sidebar-documentpreview\lib\client.js:26913-26977` (end of file):

```js
		//#region lib/types/client/index.js
		/** This package's copy namespace. */
		const NS = "sidebarDocumentPreview";
		/**
		* Required browser services: the tab registry, the slot registry, copy, and the
		* Remote carrier with its `workspaceFiles` namespace.
		*/
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs",
			"remote",
			"remote.workspaceFiles"
		];
		/**
		* Client plugin body: register the type, its dictionaries, its body, and its chip title.
		* @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
		*/
		function apply(ctx) {
			const previews = new DocumentPreviewRegistry();
			const disposePreviews = ctx.reflect.provide("documentPreviews", previews);
			ctx.effect(() => disposePreviews);
			ctx.effect(() => ctx.sidebarRightTabs.register(textDefinition()), "ui-sidebar-documentpreview: text type");
			ctx.effect(() => ctx.locale.register(NS, {
				zh: zh$5,
				en: en$5
			}), "ui-sidebar-documentpreview: dictionaries");
			const store = createTextStore();
			const face = textFace(createReadPage(ctx.remote), (file, signal) => ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal));
			const source = {
				getSnapshot: previews.getSnapshot,
				subscribe: previews.subscribe
			};
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TEXTPREVIEW_ID,
				locale: NS,
				store,
				children: { "sidebar.right.tab.document": {
					kind: "keyed",
					scope: "session",
					inject: { hooks: { tabInfo: documentTabInfoFactory } }
				} },
				inject: (sessionId, actions) => ({
					...face(sessionId, actions),
					hooks: { documentPreviews: source }
				})
			}, TextPreview)), "ui-sidebar-documentpreview: text body");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: TEXTPREVIEW_ID
			}, TextTitle)), "ui-sidebar-documentpreview: text title");
			apply$6(ctx);
			apply$5(ctx);
			apply$4(ctx);
			apply$3(ctx);
			apply$2(ctx);
			apply$1(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

(`TextTitle` is exported from the title module as `…\dsh-client-ui-sidebar-documentpreview\lib\types\client\TextTitle.d.ts`.)

### C7.3 The tab-type definition, verbatim

`…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1738-1775`:

```js
		//#region lib/types/client/definition.js
		/** The tab kind this package owns. */
		const TEXTPREVIEW_KIND = "text";
		/** This implementation's identity in the tab system: the key its body registers under. */
		const TEXTPREVIEW_ID = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview";
		/**
		* The tab title for one `file:` address: its decoded basename.
		*
		* The whole address stays the content identity, so two files with one name in
		* different directories are two tabs; only the chip text is shortened. Decoding
		* is per segment, matching how the address was built, so a name carrying `#`,
		* `?`, or a space reads as itself.
		* @param address - a `file:`-shaped address.
		* @returns the decoded last path segment, or the address itself when it has none.
		*/
		function basenameOf(address) {
			const name = address.slice(address.lastIndexOf("/") + 1);
			if (name === "") return address;
			try {
				return decodeURIComponent(name);
			} catch {
				return name;
			}
		}
		/**
		* The text type's registry definition.
		* @returns the definition to register.
		*/
		function textDefinition() {
			return {
				id: TEXTPREVIEW_ID,
				kind: TEXTPREVIEW_KIND,
				patterns: ["dsh-resource://file/**"],
				priority: "fallback",
				canOpen: (address) => parseFileAddress(address)?.scope === "session",
				title: basenameOf
			};
		}
```

The matching `.d.ts` — `…\dsh-client-ui-sidebar-documentpreview\lib\types\client\definition.d.ts:12-31`:

```ts
/** The tab kind this package owns. */
export declare const TEXTPREVIEW_KIND = "text";
/** This implementation's identity in the tab system: the key its body registers under. */
export declare const TEXTPREVIEW_ID = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview";
export declare function basenameOf(address: string): string;
export declare function textDefinition(): SidebarRightTabDefinition;
```

### C7.4 The tab-body component, verbatim (head)

`…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1404-1437`:

```js
		/**
		* The text type's body, registered under `sidebar.right.pane.tab` as `text`.
		* @param props - composed slot props.
		* @returns the content read so far with its controls, or a progress line.
		*/
		function TextPreview({ useTabInfo, useResource, useStore, actions, loadPage, reloadPages, loadAll, reloadAll, useDocumentPreviews, renderSlot, t }) {
			const { tab } = useTabInfo();
			const { navigation, signal } = tab;
			const meta = useResource(tab.contentId);
			const canRead = meta.status !== "none";
			const file = (0, react.useMemo)(() => hostFileOf(tab.contentId), [tab.contentId]);
			const state = useStore((s) => s.byTab[tab.id]);
			const definitions = useDocumentPreviews((value) => value);
			const candidates = (0, react.useMemo)(() => {
				const matched = matchingDocumentPreviews(definitions, file.path);
				const fallback = definitions.find((definition) => definition.id === PLAIN_BODY_ID);
				return fallback === void 0 ? matched : [...matched, fallback];
			}, [definitions, file.path]);
			const selected = candidates.find((candidate) => candidate.id === state?.rendererId) ?? candidates[0];
			const mode = selected?.loading;
			const current = (state?.mode ?? "text-pages") === mode ? state : void 0;
			const bodyRef = (0, react.useRef)(null);
			const scrollportRef = (0, react.useRef)(null);
			const storedScrollTopRef = (0, react.useRef)(0);
			const pathRef = (0, react.useRef)(null);
			const pathTextRef = (0, react.useRef)(null);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const displayPath = meta.value?.absolutePath ?? current?.complete?.absolutePath ?? file.path;
			usePathClipped(pathRef, pathTextRef, displayPath, state !== void 0);
			const line = navigation.params !== void 0 && "line" in navigation.params ? navigation.params.line : void 0;
```

### C7.5 A second, smaller shipped tab type: `@deepseek-ai/dsh-client-ui-sidebar-files`

Definition (`…\dsh-client-ui-sidebar-files\lib\client.js:11-42`):

```js
		//#region lib/types/client/definition.js
		/** The tab kind this package owns. */
		const FILES_KIND = "files";
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const FILES_ID = "@deepseek-ai/dsh-client-ui-sidebar-files";
		/** The type's coloured folder sheet at the guide capsule's glyph size, as the chip title draws it. */
		function FolderSheetGlyph({ size, className }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
				kind: "folder",
				size,
				className
			});
		}
		/**
		* The files type's registry definition.
		* @param t - namespace-bound translate, read fresh on every label call.
		* @returns the definition to register.
		*/
		function filesDefinition(t) {
			return {
				id: FILES_ID,
				kind: FILES_KIND,
				priority: "builtin",
				title: () => t("type.label"),
				guide: [{
					order: 10,
					title: () => t("guide.title"),
					description: () => t("guide.description"),
					icon: FolderSheetGlyph
				}]
			};
		}
```

This is a **page type** (no `patterns`), opened by `openTab('files', …)`; it contributes a guide entry, which makes it the
sole entry in the shipped composition and therefore the default page
(`…\dsh-client-ui-sidebar-right\README.md`, “The guide” section).

---

# D) CLIENT → HOST COMMUNICATION

Short answer: **not** plain `fetch()` to arbitrary paths, and not a raw WebSocket by hand. There are three layers, all
over one authenticated Connection:

1. **Typed Remote (recommended, what shipped UI uses):** `ctx.remote.<namespace>.<method>(...args, signal)` returning
   `Promise<RemoteResult<T>>` / `AsyncIterable<T>` for streams.
2. **Generic logical RPC:** `ctx.connection.rpc.call(channel, endpoint, payload, signal)` — what the Remote layer itself
   calls under the hood (`channel === "/api"`).
3. **Exact Fetch routes** for non-JSON bodies (downloads, binary upload, native opening): host registers
   `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`, and the client is expected to use plain
   `fetch("/api/…")` for those exact paths.

**Two different endpoint grammars — do not confuse them:**

* Remote endpoints are **slash-separated** `<namespace>/<method>`: the generated `TypertRemoteMap` keys are
  `'workspaceFiles/list'`, `'workspaceFiles/read'`, … (`…\dsh-api-workspace-files\lib\typert.remote-client.d.ts`), and
  the Gateway passes that exact string as `endpoint` to `connection.rpc.call("/api", endpoint, …)`
  (`…\dsh-api-gateway\lib\client.js:1617`).
* Hand-registered **exact Fetch routes** use **dotted** names: `/api/session.export`
  (`…\dsh-session-log-export\lib\index.js:463`), `/api/present.open` and `/api/present.host`
  (`…\dsh-client-ui-deliverables\lib\index.js:4-6`), `/api/session/uploadFileBinary`
  (`…\dsh-client-file-upload\lib\client.js:61`).

## D8. The wire layer

### D8.1 @deepseek-ai/dsh-client-connection (Client + Host halves)

`…\dsh-client-connection\README.md:28`:

> The browser uses HTTP POST for Remote unary calls. API Gateway owns the `/api/remote.mux` WebSocket and its logical streams; shell-owned compositions provide equivalent Remote streams through `connection.rpc.open` without opening a WebSocket. The Host half always provides the carrier-neutral RPC and exact `GET`/`HEAD`/`POST` route registries. When a Web carrier is present it also owns the sole `/api` route, Fetch bridge, browser authentication, and Host/Origin checks; a shell-owned carrier dispatches the shared Fetch handler directly. Each exact route declares buffered or streaming request-body handling before the bridge reads any bytes. Typert Gateway claims generated Remote endpoints, feature packages register non-JSON responses such as Session-log downloads and raw file uploads, and unclaimed requests return 404.

Authentication (`:35-39`): every Host RPC method and WebSocket stream requires the browser session cookie minted by the
`GET /` token exchange; failures return 401 (untrusted) / 403 (bad Host-Origin); loopback-only by default, extra
authorities via `trustedHosts`.

**Client-side service (`ctx.connection`)** — `…\dsh-client-connection\lib\types\client\index.d.ts:68-98` (excerpt):

```ts
export interface ConnectionHandle {
    readonly isLoopback: boolean;
    readonly generation: ConnectionGenerationState;
    readonly state: ConnectionStateSource;
    /** Generic logical RPC channels over the same Connection transport. */
    readonly rpc: ClientConnectionRpc;
    /** Reset retry progression and replace the current attempt immediately. */
    reconnect(): void;
    registerGenerationSource(source: ConnectionGenerationSource): () => void;
    start(sinks: ConnectionSinks, config?: ConnectionRecoveryConfig): ConnectionLoop;
}
```

**The exact client-side call** — `…\dsh-client-connection\lib\types\rpc.d.ts:172-193`:

```ts
/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
    /**
     * Call one endpoint through an already registered logical channel.
     * @param channel - absolute logical channel such as `/api`.
     * @param endpoint - channel-relative endpoint such as `goals/create`.
     * @param payload - channel-owned request payload.
     * @param signal - optional caller cancellation.
     * @returns the endpoint-owned success/error result; correlation stays inside Connection.
     */
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ConnectionRpcResult<unknown>>;
    readonly open?: (channel: string, endpoint: string, payload: unknown, signal: AbortSignal) => AsyncIterable<unknown>;
}
```

Result shape — same file, `:11-26`:

```ts
export interface ConnectionRpcFailure {
    readonly code: string;
    readonly message: string;
    readonly details: object;
}
export type ConnectionRpcResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: ConnectionRpcFailure;
};
```

**The exact host-side route/channel declarations** — same file, `:83-120`:

```ts
/** One exact, transport-independent Fetch route owned by a Host feature. */
export interface ConnectionFetchRoute {
    /** Absolute path below `/api`; query parameters remain available on the request URL. */
    readonly path: string;
    /** Methods this route owns. Other methods continue through normal shared-channel dispatch. */
    readonly methods: readonly ConnectionFetchMethod[];
    /** Buffered requests obey the configured JSON cap; streaming requests arrive with backpressure and no aggregate cap. */
    readonly requestBody: ConnectionRequestBodyMode;
    /** Handle one request after the physical carrier has applied its trust and authentication policy. */
    readonly fetch: (request: Request) => Promise<Response>;
}
/** Host registry for exact Fetch routes that cannot use JSON Remote invocation. */
export interface HostConnectionFetch {
    /**
     * Register one exact route on the shared API channel.
     * @param route - path, methods, and Fetch-shaped implementation.
     * @returns asynchronous disposer removing this exact contribution.
     */
    register(route: ConnectionFetchRoute): () => Promise<void>;
}
/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
    /**
     * Register one authenticated absolute channel prefix.
     * @param channel - absolute logical channel such as `/rpc`.
     * @param handler - decoded endpoint handler returning the existing RPC result shape.
     * @returns asynchronous disposer removing the channel and its physical route.
     */
    handle(channel: string, handler: ConnectionRpcHandler): () => Promise<void>;
    /**
     * Intercept owned endpoints on the shared `/api` channel before its fallback.
     * @param channel - reserved shared channel; currently `/api`.
     * @param matches - synchronous endpoint ownership test.
     * @param handler - decoded endpoint handler returning the existing RPC result shape.
     * @returns asynchronous disposer removing the interceptor.
     */
    intercept(channel: '/api', matches: ConnectionRpcEndpointMatcher, handler: ConnectionRpcHandler): () => Promise<void>;
}
```

Real **host route registrations** (verbatim):

* `…\dsh-client-ui-deliverables\lib\index.js:29-39`:

  ```js
  	/**
  	* Register native opening inside Connection's authentication fence.
  	* @param ctx - Session lookup, native opener, and route lifetime.
  	*/
  	function registerPresentOpen(ctx) {
  		ctx.connection.fetch.register({
  			path: PRESENT_HOST_PATH,
  			methods: ["GET"],
  			requestBody: "buffered",
  			fetch: () => Promise.resolve(Response.json(ctx.sessionController.workspaceDesktop(), { headers: { "cache-control": "no-store" } }))
  		});
  ```

  with `…\dsh-client-ui-deliverables\lib\index.js:4-6`:

  ```js
  	const PRESENT_OPEN_PATH = "/api/present.open";
  ...
  	const PRESENT_HOST_PATH = "/api/present.host";
  ```

* `…\dsh-session-log-export\lib\index.js:484-497` (a download route):

  ```js
  	connectionOf(ctx).fetch.register({
  		path: SESSION_LOG_EXPORT_PATH,
  		methods: ["GET", "HEAD"],
  		requestBody: "buffered",
  		fetch: async (request) => {
  			const response = await sessionLogExportResponse(ctx, request, config.compressionLevel ?? 6);
  			if (request.method === "GET") return response;
  			await response.body?.cancel();
  			return new Response(null, {
  				status: response.status,
  				headers: response.headers
  			});
  		}
  	});
  ```

  with `…\dsh-session-log-export\lib\index.js:463`: `const SESSION_LOG_EXPORT_PATH = "/api/session.export";`
  and the client-side path constant `…\dsh-client-file-upload\lib\client.js:61`:
  `const FILE_UPLOAD_PATH = "/api/session/uploadFileBinary";`

* The Gateway claims Remote endpoints on the shared channel — `…\dsh-api-gateway\lib\index.js:454-456`:

  ```js
  		ctx.inject(["connection"], (connectionCtx) => {
  			connectionCtx.connection.rpc.intercept("/api", (endpoint) => this.claimsEndpoint(endpoint), (endpoint, payload, signal) => this.dispatchRpc(endpoint, payload, signal));
  		});
  ```

### D8.2 @deepseek-ai/dsh-api-remotes + @deepseek-ai/dsh-api-gateway (the typed Remote)

`…\dsh-api-remotes\README.md:12`:

> Two-sided BFF for Host Remote capabilities selected by this application. The Host entry owns the forwarded-event selection and registers its application event source with API Gateway; the Client entry imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`, and re-exports their declaration merges.

`:30`: “This assembly mounts Commands, credentials, settings, Goal, dynamic Cordis, file and Session references, read-only Host plugin inventory, message feedback, Session Controller, and Workspace Controller contributions. … `@deepseek-ai/dsh-api-gateway/client` owns descriptor validation, traced namespace Services, direct and scoped methods, invocation, streams, and cancellation.”

Client service type — `…\dsh-api-remotes\lib\types\client\index.d.ts:51-55`:

```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Generated Remote namespaces selected by this Client assembly. */
        remote: ClientRemote;
    }
}
```

`ClientRemote` — `…\dsh-api-gateway\lib\types\client\index.d.ts:17-31`:

```ts
/** Typed Remote service augmented by generated direct namespaces and Gateway stream supervision. */
export interface ClientRemote extends TypertClientRemote {
    /**
     * Create one independently cancellable, reconnecting logical stream.
     * @param options - domain-owned opener and generation-end classification.
     * @returns a single-consumer stream annotated with physical generation ids.
     */
    $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item>;
    /**
     * Fixed Host facts as plain reads: no store, no subscription, no generation
     * counter. `home` stays undefined until the first ready frame and reflects
     * the latest one afterwards.
     */
    readonly $host: RemoteHostFacts;
}
```

The **generated** method surface for one namespace (this is what a host package declares on its Host face and the
generator turns into) — `…\dsh-api-workspace-files\lib\typert.remote-client.d.ts`:

```ts
/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$776f726b737061636546696c6573 {
    changes: (workspaceFileScopeId: SessionId, signal?: AbortSignal) => AsyncIterable<WorkspaceFileWatchFrame>
    list: (workspaceFileScopeId: SessionId, path: string, signal?: AbortSignal) => Promise<RemoteResult<WorkspaceDirectoryListing>>
    read: (workspaceFileScopeId: SessionId, path: string, range: WorkspaceFileRange, signal?: AbortSignal) => Promise<RemoteResult<WorkspaceFileText>>
    readAll: (workspaceFileScopeId: SessionId, path: string, signal?: AbortSignal) => Promise<RemoteResult<WorkspaceFileBytes>>
    ...
  }
  interface TypertRemoteMap {
    'workspaceFiles/list': (workspaceFileScopeId: SessionId, path: string, signal?: AbortSignal) => Promise<RemoteResult<WorkspaceDirectoryListing>>
    ...
  }
```

and how the typed call becomes a wire call — `…\dsh-api-gateway\lib\client.js:1610-1626`:

```js
  			async invoke(descriptor, projection, token, callerCtx, values, boundIdentity) {
  				const endpoint = endpointOf(descriptor);
  				if (!token.active) return withdrawn(endpoint);
  				const prepared = this.prepareInvocation(descriptor, projection, token, callerCtx, values, boundIdentity);
  				const connection = this.ownerCtx.get("connection");
  				if (connection === void 0) throw new Error(`client api: ${endpoint} has no active Connection`);
  				try {
  					const result = await connection.rpc.call("/api", endpoint, { args: prepared.args }, prepared.signal);
  					if (!mountActive(token)) return withdrawn(endpoint);
  					if (!result.ok) return {
  						ok: false,
  						error: rebuiltFailure(result.error)
  					};
  					return {
  						ok: true,
  						value: result.value
  					};
  				} catch (error) {
  ```

**Real client-side Remote calls (verbatim):**

* `…\dsh-client-ui-sidebar-files\lib\client.js:50-53`:

  ```js
  		function createList(remote) {
  			return async (sessionId, path, signal) => {
  				const result = await remote.workspaceFiles.list(sessionId, path, signal);
  				if (!result.ok) return result;
  ```

* `…\dsh-client-ui-sidebar-documentpreview\lib\client.js:26941`:

  ```js
  			const face = textFace(createReadPage(ctx.remote), (file, signal) => ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal));
  ```

For a plugin, the enablement is the plugin's own `inject` list: `"remote"` plus `"remote.<namespace>"`
(e.g. `["slots","locale","sidebarRightTabs","remote","remote.workspaceFiles"]`), and the package must have
`"@deepseek-ai/dsh-api-remotes"` in `dsh.client.inject`.

**Host side of a typed Remote:** a host package declares a FaceModel and ships a generated descriptor —
`…\dsh-api-workspace-files\package.json` exports `"./typert"` (host face) and `"./remote"` (client contribution),
with `"files": [ … "lib/typert.host.js", "lib/typert.remote-client.js" ]`; the runtime registration is the Gateway's
`remote` contribution mount. Exact host declaration source (`src/remote.ts` / `@deepseek-ai/dsh-typert-registry`) was
**not** readable in this profile — see UNCERTAIN.

## D9. `ctx.locale` — registering localized strings

`…\dsh-client-locale\README.md:36`:

> Call `ctx.locale.register(ns, { zh, en })` with a namespace merged into `LocaleNamespaceMap`; the compiler checks every key against the namespace's typed key union and requires both shipped locales. Consumers translate through `ctx.locale.bind(ns)` or the framework-injected `t` seat. A dictionary registered after the UI is already mounted is picked up without a remount.

`:42-58` (registering a language pack, verbatim README sample):

```js
export const inject = ['locale']

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }),
    'my-locale: language',
  )
  ctx.effect(
    () => ctx.locale.register('common', 'ja', {
      cancel: 'キャンセル',
      close: '閉じる',
    }),
    'my-locale: common dictionary',
  )
}
```

Exact API — `…\dsh-client-locale\lib\types\client\index.d.ts:95-215` (excerpt):

```ts
export declare class LocaleRuntime {
    getLocale(): LocaleSnapshot;
    getSnapshot(): LocaleSnapshot;
    subscribe(fn: () => void): () => void;
    setLocale(id: string): void;
    addLanguage(input: LanguageRegistration): () => void;
    /**
     * Register a declared namespace's dictionaries, all locales in one call — ...
     * @param ns - a namespace merged into LocaleNamespaceMap.
     * @param dicts - complete dictionaries keyed by built-in locale id.
     * @returns disposer removing every locale registered by this call (idempotent).
     */
    register<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void;
    /** Single-locale untyped form for language-pack contributions and namespaces outside the merge table. */
    register(ns: string, locale: string, dict: LocaleDict): () => void;
    /**
     * Bind a declared namespace to a translate function typed to its
     * dictionary key union (plus the shared common vocabulary) — the same key
     * domain the framework-injected `t` seat carries. ...
     */
    bind<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N): TranslateNS<N>;
    bind(ns: string): Translate;
}
```

`LocaleDict` is `Record<string, string>` with `{name}` placeholders (`:26-27`). Lookup order (`README.md:86`): active
language's fallback chain in the requested namespace → the same chain in `common` → the key itself.

Real registration — `…\dsh-client-ui-sidebar-documentpreview\lib\client.js:26936-26939`:

```js
  			ctx.effect(() => ctx.locale.register(NS, {
  				zh: zh$5,
  				en: en$5
  			}), "ui-sidebar-documentpreview: dictionaries");
```

Consumption inside a component: the slot's `locale: NS` option injects `t` as a prop
(`function TextPreview({ … t })`), or outside a component `ctx.locale.bind(NS)`
(`…\dsh-client-ui-sidebar-files\lib\client.js:693`: `const t = ctx.locale.bind(NS);`).

---

# E) STYLING (question 10)

**Three mechanisms, in order of what shipped plugins actually do:**

### E10.1 Own CSS, injected as a `<style data-plugin>` tag at materialization (the default)

Client bundles carry compiled CSS-module text and append it to `document.head` inside the factory closure, so the
module system can inventory and remove it on HMR unload.
Verbatim — `…\dsh-client-ui-sidebar-files\lib\client.js:213-241` (the CSS text itself and the class map are elided at
the `…` marks after the first line / first five map entries; the surrounding code is exact):

```js
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-sidebar-files/src/client/FilesBody.module.css.mjs
		const css = ".k-1LKG_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);…}";
		const tagId = "@deepseek-ai/dsh-client-ui-sidebar-files/FilesBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar-files";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FilesBody_module_css_default = {
			"body": "k-1LKG_body",
			"fileIcon": "k-1LKG_fileIcon",
			"header": "k-1LKG_header",
			…
		};
```

The class-name map is then used as `className: FilesBody_module_css_default.header`. This is the pattern **every**
shipped client plugin uses: **38 of the 55** `lib/client.js` files in PROFILE contain `createElement("style")`, and the
same 38 contain `data-plugin-css`. The loader's bookkeeping side is
`…\dsh-client-modules\lib\client.js:170-176` (`claimStyles`, tagging untagged `<style>` with `data-plugin`).

Colours/typography come from **design tokens**, not hard-coded values — the CSS above uses
`var(--dsw-alias-label-primary)`, `var(--dsw-alias-border-l3)`, `var(--dsw-alias-interactive-bg-hover)`,
`var(--dsh-content-font-size-secondary,13px)`.
`…\dsh-client-ui-primitives\README.md:13` (recovered from ASAR):

> The components import no Cordis runtime; callers supply localized labels, and theme-facing colors use `--dsw-*` design tokens.

### E10.2 The shared primitives package (name + real usage)

Package: **`@deepseek-ai/dsh-client-ui-primitives`** — one of the nine seed words, so a no-bundler plugin can use it with
no declaration at all. `…\dsh-client-ui-primitives\README.md:35`:

> Compose feature UI from these atoms whenever the web client needs a standard control or an agent-output renderer. They render through React only and take `--dsw-*` design tokens from the theme, so they fit any plugin without importing the theme or the slot system.

`:40`:

> Check this table before writing a control in a feature package. A plugin cannot import another plugin's component, so this package is the only place a control can be shared: reuse what fits, and lift a deliberate visual difference into a prop rather than starting a second copy.

Real usage (verbatim) — `…\dsh-client-ui-sidebar-files\lib\client.js:17-23` (above) and
`…\dsh-client-ui-sidebar-documentpreview\lib\client.js:1586`, `:1615`, `:1691-1692`, `:1705`:

```js
  			(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
  			selected.wrap === true && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
  			(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
  				kind: (0, _deepseek_ai_dsh_client_ui_primitives.classifyFileType)(name),
  			children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 }), t("retry")]
```

Catalog highlights (README `:44-75`): `Button`, `Switch`, `SegmentedControl`, `Checkbox`, `Input`, `Menu`/`MenuItemButton`,
`Pill`, `SegmentedTabs`, `Tag`, `PathLabel`, `StateDot`, `ConnectionIndicator`, `DisclosureRow`, `TextShimmer`, `Modal`,
`RiskConfirmation`, `Tooltip`, `HoverCard`, `ImageLightbox`, `Toast`, `SettingsForm*`, `JsonTree`/`JsonBlock`,
`MarkdownText`/`CodeBlock`, `TerminalBlock`/`ReadBlock`/`DiffBlock`/`SearchBlock`/`WebBlock`, `icons/*`,
`FileTypeIcon`/`classifyFileType`, `useCodeHighlighter`.

### E10.3 Inline `style` — acceptable and used

Yes. Shipped first-party components pass inline styles, mainly for CSS custom properties (a value React must compute) —
`…\dsh-client-ui-trajectory\lib\client.js:5439`:

```js
  									style: { "--trajectory-virtual-spacer-height": `${virtualTop}px` }
```

also `:5627` and `:6792`:

```js
  									style: { "--trajectory-hover-left": `${hover.fraction * 100}%` }
```

Counts across shipped client bundles (occurrences of `style: {`): trajectory 7, documentpreview 3, input-trigger 3,
layout 2, and 1 each in agent-preset, commands, conversation, renderer, settings-models, sidebar-right.

Practical rule consistent with the evidence: **static visuals → injected CSS classes + `--dsw-*` tokens; dynamic
per-render values (virtualization offsets, hover fractions, CSS variables) → inline `style`.**

---

# F) MINIMAL END-TO-END RECIPE (synthesis of the verified evidence above)

Every element below traces to a quote in A–E; nothing new is introduced.

```
my-plugin/
  package.json      # name, "exports": { "./client": "./lib/client.js" }, "dsh": { "client": { "platform": "web", ... } }
  lib/client.js     # hand-written, no build step
```

`package.json` essentials (A1.1):

```json
{
  "name": "@me/dsh-client-ui-my-thing",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": { "client": { "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"] } },
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.2" }
}
```
(`inject` must name any `@deepseek-ai/dsh-client-*` package the code `require`s; baseline words like `react`,
`react-dom`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives` need no entry.)

`lib/client.js` skeleton (A1.4 + B4 + C6 + C7):

```js
window.__ModuleLoader__.load({
  id: "@me/dsh-client-ui-my-thing",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    function MyBody(props) {
      const { tab } = props.useTabInfo();              // C6.2: hook seat from the slot declaration
      return React.createElement("div", null, tab.navigation.address);
    }

    const ID = "@me/dsh-client-ui-my-thing";
    const inject = ["slots", "locale", "sidebarRightTabs"];   // C7.2 shows this exact shape

    function apply(ctx) {
      const t = ctx.locale.bind("myThing");                   // D9
      ctx.effect(() => ctx.locale.register("myThing", { zh: {...}, en: {...} }), "my-thing: dictionaries");
      ctx.effect(() => ctx.sidebarRightTabs.register({        // C6.1
        id: ID, kind: "mything",
        patterns: ["dsh-resource://file/**"],                 // omit for a page type
        priority: "extension",                                // default band
        canOpen: (address) => true,
        title: (address) => t("title")
      }), "my-thing: type");
      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({  // B4.3/C6.2
        name: "sidebar.right.pane.tab", key: ID, locale: "myThing"
      }, MyBody)), "my-thing: body");
      ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
        name: "sidebar.right.pane.tab.title", key: ID
      }, MyTitle)), "my-thing: title");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

Opening it (C6.3/C6.4): `ctx.sidebarRight.openTab('mything')` for a page type, or
`ctx.sidebarRight.openResource('dsh-resource://file/session/<sessionId>/<path>', { params: { line: 12 } })` for a
resource type. Registering under `key: <definition.id>` is mandatory — the seat dispatches by the **type in force's
`id`**, not by kind.

Styling (E): append your CSS once inside the factory with `data-plugin`/`data-plugin-css` attributes set, use
`--dsw-*` tokens, `require("@deepseek-ai/dsh-client-ui-primitives")` for controls, and inline `style` only for dynamic
values.

---

# UNCERTAIN / NOT FOUND

1. **`@deepseek-ai/dsh-client-ui-slots` is not installed in this profile** (PROFILE has no such directory) and it is
   **not shipped with type declarations**. Its README was recovered from `app.asar`; its `register` signature is quoted
   from the runtime (`lib/index.js:164`) and from real call sites. The TypeScript type is only visible indirectly as
   `readonly register: SlotCore['register'];` in `…\dsh-client-ui-renderer\lib\types\client\registry.d.ts:84`. The
   upstream TS source (`src/*.ts`) is not on this machine, so parameter names/types of the `register` overloads could not
   be quoted verbatim — only the fields the runtime reads (B4.2) are certain.
2. **No repository checkout / docs tree exists locally.** `…\dsh-client-modules\README.md:94` points at
   `docs/subsystems/client-modules.md`, `:97` at `../AGENTS.md#shared-modules-and-the-module-graph`, and
   `…\dsh-client-ui-slots\README.md:77-79` at `.agents/notes/…`; none of those files exist under
   `$DSH_HOME\profiles\node_modules\@deepseek-ai\` nor in `app.asar` (only `dsh/package.json` +
   `dsh/node_modules/**`). Those cross-references are therefore unverifiable here.
3. **`dsh-client-ui-primitives`, `dsh-client-ui-dockkit`, `dsh-client-store` are not installed in PROFILE either**
   (they are compiled into SHELL). The primitives README and store README were recovered from `app.asar`; the
   **dockkit** README was not read, so `TabRecord`, `TabId`, `PaneId`, `FloatRect` are known only as types imported by
   sidebar-right and are not documented here.
4. **`ctx.slots.register` option fields beyond the runtime list** (e.g. exact TS names such as `PropsStore`,
   `SlotHookFactory`, `KeyedSnapshotSelectorHook`) are known only from consumer `.d.ts` imports, not from slots' own
   declarations.
5. **The `/plugins` combo URL format** (`/plugins/??…&rev=…`, partition at 3 KiB) is quoted from the
   `dsh-client-modules` README only; I did not observe a live `window.__DSH_BOOT__` payload or a served bundle. No
   page/CDP session was opened for this recon.
6. **The Host-side typed-Remote declaration path** (`@deepseek-ai/dsh-typert-registry` FaceModel / `src/remote.ts`)
   could not be read: the generated artifacts (`lib/typert.host.d.ts`, `lib/typert.remote-client.js`) are shipped, but
   the authoring API that produces them is not present in this profile. If the new plugin needs a **new** host route,
   the verified options here are `ctx.connection.fetch.register({...})` (host) + `fetch("/api/…")` (client) or the
   generic `ctx.connection.rpc.handle/intercept`; the typed Remote path requires the generator.
7. **`ctx.remote.$mount()` / `$on()` / `$stream()` shapes** are quoted from READMEs and the Gateway client bundle, but I
   did not read the full `TypertClientRemote` interface in `@deepseek-ai/dsh-typert-protocol`, so the complete Remote
   vocabulary (lookups, scoped methods, error codes) is not enumerated.
8. **The slot catalog in B4.6 is a generated projection** found in `dsh-cordis-client-runner/lib/client.js` of *this*
   installation. Dynamically contributed slots (from other installed plugins) may exist beyond those 61 entries; the
   catalog's own `source:` fields cite `packages/client/...` paths that are not on disk here.
9. **`Config` on a client plugin** was not observed in any shipped client plugin; the Cordis type permits it
   (`Plugin.Base.Config`), but no client-side example exists in this installation.
10. **`ctx.effect` semantics** are used everywhere in shipped client plugins (every registration is wrapped), but I did
    not read the `Context.effect` declaration; only that it exists and takes `(factory, label)` where the factory returns
    a disposer or (as in sidebar-right) an iterable/generator of disposers.
