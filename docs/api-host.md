# DSH host-side plugin API recon

Scope: exact host-side APIs of the installed DSH (DeepSeek Harness) plugin framework needed to write a
host-side cordis plugin that (1) serves HTTP routes to the Web client, (2) persists per-workspace data,
(3) identifies workspaces, (4) touches the filesystem, (5) ships as a profile plugin, and (6) registers
commands and tools.

Evidence conventions used below:

- Every claim is followed by `ABSOLUTE-PATH:LINE` or `ABSOLUTE-PATH:LINE-LINE`.
- `README` = the package's authoritative `README.md`; `types` = the shipped real `.d.ts` declaration;
  `impl` = the shipped `lib/index.js`.
- All quoted text is verbatim, including original punctuation. Quotes from minified/bundled
  `lib/*.js` are still byte-exact source lines.
- Installed versions of the packages quoted here are `0.1.5-rc.3` (e.g.
  `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-workspace-files\package.json:4`),
  unless a line is quoted that says otherwise.
- The package root is `$DSH_HOME\profiles\node_modules\@deepseek-ai\`. Full absolute paths are
  written out in evidence lines; inside prose the bare package name is shorthand for that root.

**Headline correction to the brief's assumption.** The `/api/<name>.<method>` shape is *not* how
Typert "Remote" APIs are addressed. Remote endpoints are `<namespace>/<method>` (a **slash**), so the
HTTP path is `/api/<namespace>/<method>`. The **dotted** form is used by hand-registered *exact Fetch
routes* (`/api/session.export`, `/api/present.open`). Both families are registered differently; see
A.0.

---

## A. HTTP ROUTES / API

### A.0 The three route families a host plugin can use

| # | Family | Registration | Wire shape | Auth |
|---|---|---|---|---|
| 1 | Raw webserver route | `ctx.webServer.register({kind,path,handler})` | any absolute path | **none** (route owner enforces) |
| 2 | Typert Remote RPC endpoint | extend `TypertRemoteService` + `@Remote` decorators | `POST /api/<namespace>/<method>` | Connection's fence + cookie |
| 3 | Exact Fetch route | `ctx.connection.fetch.register({path,methods,requestBody,fetch})` | any path below `/api` | Connection's fence + cookie |

Evidence for each is in A.1–A.4. The single `/api` HTTP route that both families 2 and 3 ride on is
owned by `dsh-client-connection`, not by feature plugins:

- `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-connection\lib\types\api-path.d.ts:5-6`
  ```ts
  /** Route prefix owning every api request (`/api` and `/api/<anything>`). */
  export declare const API_PATH = "/api";
  ```
- `dsh-client-connection\lib\index.js:13`: `const API_PATH = "/api";`
- `dsh-client-connection\lib\index.js:767-781` (the shipped registration; this is a real, verbatim
  `ctx.webServer.register` call):
  ```js
  const fetchHandler = connection.createSharedFetchHandler(API_PATH);
  const route = {
      kind: "prefix",
      path: API_PATH,
      handler: async (req, res) => {
          const rejection = connection.requestRejection(req);
          if (rejection !== void 0) {
              res.writeHead(rejection);
              res.end(rejection === 401 ? "unauthorized" : "forbidden");
              return;
          }
          await bridge(req, res, fetchHandler, maxRequestBodyBytes);
      }
  };
  webCtx.effect(() => webCtx.webServer.register(route), "client-connection: /api route");
  ```

### A.1 `dsh-host-webserver` — the raw route API

Service key: `ctx.webServer`. `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-host-webserver\lib\types\index.d.ts:15-18`
```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: WebServer;
    }
```

Route types — `dsh-host-webserver\lib\types\index.d.ts:30-46`:
```ts
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix';
/** One named route registration. */
export interface WebRoute {
    kind: WebRouteKind;
    /** Absolute pathname, no trailing slash. */
    path: string;
    /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
    /** Absolute pathname, no trailing slash. */
    path: string;
    /** Owns protocol negotiation and the upgraded socket after dispatch. */
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}
```
(`IncomingMessage`/`ServerResponse` are `node:http`; `Duplex` is `node:stream` —
`dsh-host-webserver\lib\types\index.d.ts:8-9`.)

Registration API — `dsh-host-webserver\lib\types\index.d.ts:90`, `:97`, `:106`, `:114`:
```ts
    register(route: WebRoute): () => void;
    registerUpgrade(route: WebUpgradeRoute): () => void;
    registerFallback(handler: WebRoute['handler']): () => void;
    tapIndex(transform: (html: string) => string): () => void;
```
Also on the service: `get port(): number` (`:81`), `get host(): Config['host']` (`:83`),
`applyIndexTaps(html: string): string` (`:125`), `collectIndexInjections(): IndexInjection[]` (`:132`),
`renderIndex(html: string): string` (`:139`).

Config — `dsh-host-webserver\lib\types\index.d.ts:48-59`: `host: '127.0.0.1' | '0.0.0.0'`,
`port: number`, optional `compression?: 'none' | 'gzip'`, `compressionLevel?`,
`compressionThresholdBytes?`.

Matching, duplicates, failure semantics — `dsh-host-webserver\README.md:45`:
> `register(route)` adds a named `exact` or `prefix` HTTP route, `registerUpgrade(route)` adds an upgrade route for an exact pathname, and both return a disposer that removes the registration. A duplicate path within either table throws — route patterns are a composition-level contract, so a collision is a misconfiguration. HTTP matching is exact over the whole table, then longest prefix, then the fallback handler; upgrades match exactly and unmatched connections are closed.

Auth: **there is none at this layer** — `dsh-host-webserver\README.md:113`:
> - **No server-wide TLS, authentication, or origin policy** — route owners such as `dsh-client-connection` enforce their own request policy. Binding a non-loopback address still exposes unprotected routes and static assets to that network.

A route owner applies Connection's policy to its own route with
`ctx.connection.requestRejection(request)` → `401 | 403 | undefined`
(`dsh-client-connection\lib\types\rpc.d.ts:133-139`):
```ts
    /**
     * Apply Connection's Host/Origin checks and browser authentication to
     * another Web route.
     * @param request - request headers from the HTTP or upgrade request.
     * @returns rejection status, or undefined when the route may accept the request.
     */
    requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection;
```
(`ConnectionRequestRejection = 401 | 403 | undefined` — `dsh-client-connection\lib\types\rpc.d.ts:64`.)

Real shipped examples of raw registration:
- prefix route: `dsh-client-connection\lib\index.js:768-781` (quoted in A.0).
- fallback seat: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-host-frontend-static\lib\index.js:87-96`:
  ```js
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
      }
      /* v8 ignore next -- node:http always sets url on server requests */
      const rawPath = new URL(req.url ?? "/", "http://x").pathname;
      await serveStatic(decodeURIComponent(rawPath), res, distRoot, distIndex, () => ctx.connection.authorizeIndex(req, res), renderIndex);
  }), "frontend-static: fallback seat");
  ```
  its declared injections (`dsh-host-frontend-static\lib\index.js:21`):
  `const inject = ["webServer", "connection"];`
- upgrade/WebSocket route: `dsh-api-gateway\lib\index.js:476` registers the Remote mux as
  `` `api-gateway: ${REMOTE_STREAM_MUX_PATH} WebSocket` `` with `REMOTE_STREAM_MUX_PATH = "/api/remote.mux"`
  (`dsh-api-gateway\lib\index.js:11`).

### A.2 `dsh-api-workspace-files` — how a Remote API declares routes and client types

It declares **no** HTTP path and calls **no** `webServer.register`. It is a Typert Remote *service*: the
gateway discovers its methods and claims the endpoints under `/api`.

Route/endpoint convention (authoritative): the endpoint string is `<namespace>/<method>` —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-gateway\lib\index.js:990-992`:
```js
function endpointOf(namespace, method) {
	return `${namespace}/${method}`;
}
```
and the gateway claims only two-segment endpoints — `dsh-api-gateway\lib\index.js:510-517`:
```js
	claimsEndpoint(endpoint) {
		if (endpoint === "$events/result") return true;
		const segments = endpoint.split("/");
		if (segments.length !== 2 || segments[0] === "" || segments[1] === "") return false;
		if (this.ctx.typert.local.get(endpoint) !== void 0 || this.ctx.typert.local.hasSeen(endpoint)) return true;
		this.srcClaims ??= this.collectSrcClaims();
		return this.srcClaims.has(endpoint);
	}
```
The Client therefore sends `POST /api/workspaceFiles/stat` (channel `/api` + endpoint
`workspaceFiles/stat`); see `dsh-api-gateway\README.md:44` (quoted in A.3).

Declaration pattern (real, shipped). `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-workspace-files\lib\index.js:256`, `:259-265`, `:351-362`, `:368-374`:
```js
	return class WorkspaceFiles extends _classSuper {
...
			_read_decorators = [Remote];
			_readBytes_decorators = [Remote];
			_readAll_decorators = [Remote];
			_readRelated_decorators = [Remote];
			_stat_decorators = [Remote];
			_list_decorators = [Remote];
			_changes_decorators = [Remote({ mode: "stream" })];
...
		static inject = [
			"fs",
			"sandboxPolicy",
			"sessions",
			"typert"
		];
		static Config = z.object({
			maxBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
			maxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(32 * 1024 * 1024),
			maxLines: z.number().step(1).min(1).default(5e3),
			maxEntries: z.number().step(1).min(1).default(2e3)
		});
...
		constructor(ctx, config) {
			super(ctx, "workspaceFiles");
			this.config = config;
			this.feed = new WorkspaceChangeFeed(ctx);
			ctx.inject(["sessions", "typert"], (scope) => {
				scope.typert.lookups.register("workspaceFileScope", {
```
with `import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";`
(`dsh-api-workspace-files\lib\index.js:3`).

Method signatures are the Remote wire contract — `dsh-api-workspace-files\lib\types\index.d.ts:82`, `:92`, `:100`, `:109`, `:117`, `:125`, `:135`:
```ts
    read(workspaceFileScope: WorkspaceFileScope, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>;
    readBytes(workspaceFileScope: WorkspaceFileScope, path: string, range: WorkspaceByteRange, signal: AbortSignal): Promise<WorkspaceFileBytes>;
    readAll(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileBytes>;
    readRelated(workspaceFileScope: WorkspaceFileScope, path: string, relativePath: string, signal: AbortSignal): Promise<WorkspaceFileBytes>;
    stat(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>;
    list(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>;
    changes(workspaceFileScope: WorkspaceFileScope, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>;
```
Host-side binding to the gateway is inherited, not hand-written —
`dsh-api-workspace-files\lib\types\index.d.ts:64`: `export declare class WorkspaceFiles extends TypertRemoteService {`,
and `dsh-typert-protocol\lib\types\index.d.ts:60-70`:
```ts
export declare abstract class TypertRemoteService<out T = never> extends Service<T> {
    /** Visible binding consumed by the Gateway's source-mode discovery. */
    readonly typertRemote: TypertGatewayBinding<this>;
    /**
     * Register the Service and bind the same key to Typert Gateway.
     * ...
     */
    protected constructor(ctx: Context, serviceKey: string, options?: TypertGatewayBindingOptions);
}
```
Decorators — `dsh-typert-protocol\lib\types\index.d.ts:76`, `:82`, `:89`:
```ts
export declare function Remote<This extends object, Args extends unknown[], Result>(_method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>): void;
export declare function Remote(option: string | RemoteMethodOptions): RemoteMethodDecorator;
export declare function RemoteScope(key: Extract<keyof TypertContextMap, string>, exportName?: string): RemoteMethodDecorator;
```
Mapping the Host class onto client-facing types happens through package **export subpaths**, not through a
second declaration site — `dsh-api-workspace-files\package.json:16-39`:
```json
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
    "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
```
`./typert` and `./remote` are generated (`dsh-api-workspace-files\README.md:108`: "Typert generates the
Host and Client Remote artifacts exposed by `./typert` and `./remote`."), and the browser half is a
normal cordis client plugin registering into the client service — `dsh-api-workspace-files\lib\types\client\index.d.ts:10-16`:
```ts
/** Required browser services: the resource model, the Remote carrier and its namespace. */
export declare const inject: string[];
/**
 * Client plugin body: register the `file` provider for this plugin's lifetime.
 * @param ctx - client root context carrying `resources` and the Remote face.
 */
export declare function apply(ctx: ClientContext): void;
```

### A.3 `dsh-api-remotes` — exposing Host APIs to the Web client, and authorization

How Host capabilities reach the client — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-remotes\README.md:12`:
> Two-sided BFF for Host Remote capabilities selected by this application. The Host entry owns the forwarded-event selection and registers its application event source with API Gateway; the Client entry imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`, and re-exports their declaration merges.

`dsh-api-remotes\README.md:30`:
> The Client assembly mounts Commands, credentials, settings, Goal, dynamic Cordis, file and Session references, read-only Host plugin inventory, message feedback, Session Controller, and Workspace Controller contributions. Cordis effect ownership withdraws every contribution when this assembly unloads, while `@deepseek-ai/dsh-api-gateway/client` owns descriptor validation, traced namespace Services, direct and scoped methods, invocation, streams, and cancellation.

The typed remote map is a declaration merge driven by type-only imports of each domain's `/remote`
artifact — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-remotes\lib\types\client\index.d.ts:22-23`, `:51-55`, `:58`, `:64`:
```ts
export type {} from '@deepseek-ai/dsh-api-workspace-files/remote';
export type * from '@deepseek-ai/dsh-api-workspace-files/types';
...
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Generated Remote namespaces selected by this Client assembly. */
        remote: ClientRemote;
    }
}
/** Required service: the typed Client Remote contribution mount. */
export declare const inject: string[];
```
```ts
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
```
Client-side mounting rule (one `$mount` per contribution) — `dsh-api-gateway\README.md:42`:
> `ctx.remote.$mount()` validates and registers a generated Host-for-Client contribution, then installs concrete direct and scoped methods for the calling Cordis fiber. Each namespace is a traced `remote.<namespace>` child Service and unloads after its last method is withdrawn. Duplicate endpoints, namespace collisions, and descriptors without strict generated codecs fail before methods become callable.

And the unary call shape — `dsh-api-gateway\README.md:44`:
> Each unary call validates positional inputs, constructs the descriptor's exact named `args`, and sends it through `ctx.connection.rpc.call('/api', endpoint, ...)`. A generated stream method returns an `AsyncIterable` and opens one logical stream through an in-process Connection carrier when available, otherwise through the shared Gateway WebSocket.

**Route-authorization step.** There are two separate gates, both owned by `dsh-client-connection`, plus the
Gateway's trusted-host interceptor:

1. Gateway registers a trusted-host interceptor on Connection's shared `/api` handler —
   `dsh-api-gateway\README.md:31`:
   > The Host entry registers a trusted-host interceptor on Connection's shared `/api` FetchHandler. Connection passes this composite handler through its HTTP bridge; the handler dispatches claimed endpoints to Gateway and returns 404 for unclaimed requests unless an exact Fetch route owns them.
   Mechanically: `dsh-api-gateway\lib\index.js:455`:
   ```js
   connectionCtx.connection.rpc.intercept("/api", (endpoint) => this.claimsEndpoint(endpoint), (endpoint, payload, signal) => this.dispatchRpc(endpoint, payload, signal));
   ```
   and the interceptor API — `dsh-client-connection\lib\types\rpc.d.ts:112-119`:
   ```ts
       /**
        * Intercept owned endpoints on the shared `/api` channel before its fallback.
        * @param channel - reserved shared channel; currently `/api`.
        * @param matches - synchronous endpoint ownership test.
        * @param handler - decoded endpoint handler returning the existing RPC result shape.
        * @returns asynchronous disposer removing the interceptor.
        */
       intercept(channel: '/api', matches: ConnectionRpcEndpointMatcher, handler: ConnectionRpcHandler): () => Promise<void>;
   ```
2. Connection's browser fence and cookie authentication run **before** dispatch —
   `dsh-client-connection\README.md:39`:
   > Before authentication, every request still passes `src/api-request-trust.ts`. Its `Host` must be loopback or match a `trustedHosts` entry: exact on `host:port`, any port on port-less entries, both sides WHATWG-normalized. An attached `Origin` must equal that Host and `sec-fetch-site: cross-site` is refused. Malformed configured authorities fail plugin load. These checks defend DNS rebinding and cross-site browser requests; they never establish identity. A failed Host/Origin check returns 403, while a trusted but unauthenticated request returns 401. `dsh web --host 0.0.0.0` remains unsupported.
   `dsh-client-connection\lib\types\api-request-trust.d.ts:37`:
   ```ts
   export declare function isTrustedApiRequest(request: ConnectionTrustRequest, trustedHosts: readonly string[]): boolean;
   ```

There is no per-plugin route-authorization API beyond these: a plugin's Remote method is authorized by
being reachable over `/api` at all.

### A.4 `dsh-api-gateway` — relevance

Highly relevant: it *is* the dispatch layer for family 2, and its `fetch` registry sibling is family 3.

Host service — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-gateway\lib\types\index.d.ts:46-48`, `:69`, `:78`, `:84`:
```ts
 * @typert service typertGateway
 */
export declare class TypertGatewayService extends Service implements TypertGateway {
    static inject: string[];
    static Config: z<Config>;
```
```ts
    registerRemoteEvents(source: TypertRemoteEventSource, host: RemoteEventHostInfo): () => Promise<void>;
    invoke(request: InvokeRemoteRequest): Promise<unknown>;
    stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>;
```
`invoke` semantics — `dsh-api-gateway\README.md:27`:
> `ctx.typertGateway.invoke()` resolves the current descriptor and Cordis Service for each call, validates exact named arguments, resolves registered object or Context identities, invokes the public business method, and validates its result. Business Services extend `TypertRemoteService` and mark methods with `@Remote` or `@RemoteScope` from `dsh-typert-protocol`; `bindTypertRemote()` remains available when another base class owns inheritance.

Cancellation: "A cancellation-aware Remote method declares `signal: AbortSignal` as its final Host
parameter. The signal is descriptor metadata rather than a wire argument" (`dsh-api-gateway\README.md:33`).
Streams: "A stream Remote uses `@Remote({ mode: 'stream' })` and returns an `Iterable` or `AsyncIterable`"
(`dsh-api-gateway\README.md:35`). Client results are always `RemoteResult<T>` and never reject for carrier
problems (`dsh-api-gateway\README.md:46`).

The non-JSON exact-route registry (family 3) lives on Connection, not the Gateway —
`dsh-client-connection\lib\types\rpc.d.ts:83-102`:
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
```
with `ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'` (`:80`) and
`ConnectionRequestBodyMode = 'buffered' | 'streaming'` (`:82`).

Dispatch precedence inside the shared `/api` handler: an exact Fetch route wins for a declared method,
otherwise the interceptor (Gateway) handles the endpoint — `dsh-client-connection\lib\index.js:577-583`:
```js
		const pathname = new URL(request.url).pathname;
		...
		if (route?.methods.has(request.method) === true) return route.fetch(request);
		...
		return interceptor.fetchHandler.fetch(request);
```
The browser side builds the URL as `new URL(`${channel}/${endpoint}`, resolveBase())`
(`dsh-client-connection\lib\client.js:6206`), and the host strips the channel prefix back off —
`dsh-client-connection\lib\index.js:673-678`:
```js
function endpointFromPath(channel, pathname) {
	if (!pathname.startsWith(`${channel}/`)) return void 0;
	const endpoint = pathname.slice(channel.length + 1);
	if (endpoint.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return;
	return endpoint;
}
```
so a Remote method's HTTP path is literally `/api/<namespace>/<method>`.

Real shipped exact-route registrations (paths use the **dotted** convention):
- `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session-log-export\lib\index.js:463`:
  `const SESSION_LOG_EXPORT_PATH = "/api/session.export";`
  and `:484-497`:
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
- `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-deliverables\lib\index.js:4-6`, `:34-39`:
  ```js
  const PRESENT_OPEN_PATH = "/api/present.open";
  /** Authenticated desktop availability and destination metadata. */
  const PRESENT_HOST_PATH = "/api/present.host";
  ```
  ```js
  ctx.connection.fetch.register({
      path: PRESENT_HOST_PATH,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: () => Promise.resolve(Response.json(ctx.sessionController.workspaceDesktop(), { headers: { "cache-control": "no-store" } }))
  });
  ```
- streaming upload route: `dsh-client-file-upload\lib\index.js:73` `const FILE_UPLOAD_PATH = "/api/session/uploadFileBinary";`
  and `:170-173`:
  ```js
  ctx.effect(() => ctx.connection.fetch.register({
      path: FILE_UPLOAD_PATH,
      methods: ["POST"],
      requestBody: "streaming",
  ```

### A.5 The JSON/HTTP envelope the client must use (headers, auth token, CSRF)

`dsh-web-frontend` documents **nothing**: it ships only `dist/` and has **no README.md** and **no `dsh`
field**; its entire published surface is
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-web-frontend\package.json:14-17`:
```json
  "exports": {
    "./dist/*": "./dist/*",
    "./package.json": "./package.json"
  },
```
The envelope is documented and implemented by `dsh-client-connection`. `dsh-web-app` only says the server is
`dsh --profile web` and that "the root URL carries a fresh process token"
(`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-web-app\README.md:37`).

Envelope types — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-connection\lib\types\rpc.d.ts:43-57`:
```ts
/** Full request envelope carried by Connection RPC transports. */
export interface ClientRequest {
    readonly type: 'client-request';
    readonly rpcId: RpcId;
    readonly method: string;
    readonly payload: unknown;
}
/** Full response envelope carried by Connection RPC transports. */
export interface ServerResponse {
    readonly type: 'server-response';
    readonly rpcId: RpcId;
    readonly result: ConnectionRpcResult<unknown>;
}
/** Complete Connection RPC envelope union. */
export type RpcMessage = ClientRequest | ServerResponse;
```
with `ConnectionRpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ConnectionRpcFailure }`
and `ConnectionRpcFailure = { readonly code: string; readonly message: string; readonly details: object }`
(`dsh-client-connection\lib\types\rpc.d.ts:11-24`).

Runtime validation of that envelope — `dsh-client-connection\lib\index.js:501-507`:
```js
/** Client request envelope; endpoint payload validation belongs to its owner. */
const clientRequestSchema = z$1.object({
	type: z$1.literal("client-request"),
	rpcId: rpcIdSchema,
	method: z$1.string(),
	payload: z$1.unknown()
});
```

Wire rules enforced by the carrier (`dsh-client-connection\lib\index.js:635-663`), verbatim:
- endpoint must be a non-empty path below the channel and each segment must match
  `ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/` (`:521`, `:673-678`);
- method must be `POST` and the endpoint must exist, else **404** — `:640`
  `if (request.method !== "POST" || endpoint === void 0) return new Response("not found", { status: 404 });`
- `content-type` must be `application/json`, else **415** — `:641`
  `if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });`
- body must parse as JSON, else **400** (`:644-647`);
- envelope must validate, else a `gateway/bad-request` result (`:648-649`, `:665-672`);
- `message.method` must equal the URL endpoint, else `gateway/bad-request` (`:651-655`);
- response body is `{ type: "server-response", rpcId, result }` (`:685-692`).

**Auth token / cookie / CSRF** — `dsh-client-connection\README.md:35`:
> Every Host RPC method and WebSocket stream requires one browser session; there is no method-specific loopback tier. Each process mints a random launch token. `dsh-web-app` prints and opens the ordinary root URL with `?token=...`; `frontend-static` delegates root and index requests to `ctx.connection.authorizeIndex`, which accepts that token only on `GET /`, writes an authority-bound signed cookie, and redirects to clean `/`. A missing, expired, malformed, or wrong-authority cookie returns 401 before RPC dispatch. Static assets remain public. The HTTP carrier accepts no query token outside the root exchange and no Authorization-header token.

Cookie properties — `dsh-client-connection\README.md:37`:
> Cookies carry an absolute issue/expiry interval, defaulting to 30 days through `cookieMaxAgeDays`, and bind the normalized hostname plus port in both their deterministic name and signed payload. They are host-only, `Path=/`, `HttpOnly`, and `SameSite=Strict`; they deliberately omit `Secure` because the shipped server uses loopback HTTP.

The signing secret is a credential record — `dsh-client-connection\README.md:37`:
> The cookie signing secret is the owner-scoped `client-connection/browser-session` grant record in `ctx.credentials`. The local provider persists it in `$DSH_HOME/.credentials.yaml`;

So: **no CSRF token header exists**; cross-site protection is the Host/Origin + `sec-fetch-site` fence
(403) plus `SameSite=Strict` cookies. A host plugin that registers an exact Fetch route receives an
already-authenticated `Request` (`dsh-client-connection\lib\types\rpc.d.ts:91`:
"Handle one request after the physical carrier has applied its trust and authentication policy.").

Root-URL token construction — `dsh-client-connection\lib\types\browser-auth.d.ts:22-28`, `:37`, `:43`:
```ts
    static create(processOwner: object, credentials: CredentialProvider, maxAgeDays: number): Promise<BrowserAuth>;
    authenticatedUrl(baseUrl: string): string;
    authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean;
    isAuthenticated(request: ConnectionTrustRequest): boolean;
```

---

## B. STORAGE

### B.6 `ctx.storage` and the real read/write API (`ctx.storageDomain`)

`ctx.storage` is only a registration table; consumers use the domain form. Hub service —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-storage\lib\types\index.d.ts:23-27`, `:39-61`:
```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        storage: Storage;
    }
}
```
```ts
export declare class Storage extends Service {
    /** Named backend table; multiple backends stay mounted side by side. */
    readonly backend: BackendRegistry;
    private readonly forms;
    constructor(ctx: Context);
    mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void;
    form<K extends keyof StorageForms>(form: K): StorageForms[K];
    /** Domain data form; present once the domain layer plugin is loaded. */
    get domain(): StorageForms extends { domain: infer D; } ? D : never;
}
```
`dsh-storage\README.md:114`:
> Nothing. `ctx.storage` is a host-side registration table: the hub registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

The consumer-facing service is `ctx.storageDomain` —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-storage-domain\lib\types\index.d.ts:20-33`, `:83`, `:91`, `:98`, `:106`:
```ts
declare module '@deepseek-ai/dsh-storage' {
    interface StorageForms {
        domain: DomainFacility;
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        storageDomain: DomainFacility;
    }
}
/** Cordis plugin name. */
export declare const name = "storage-domain";
/** The storage hub must be present before the form can mount. */
export declare const inject: string[];
```
```ts
    open<S extends DomainSpec>(spec: S): Promise<Domain<S>>;
    get(name: string): DomainImpl | undefined;
    closeAll(): Promise<void>;
```

Declaring a domain/table — `dsh-storage-domain\lib\types\spec.d.ts:31-35`, `:43`, `:67`, `:80`, `:93`:
```ts
export interface DomainSpec {
    /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
    readonly name: string;
    /** Current domain format version; reads enforce it according to the selected layout. */
    readonly version: number;
    readonly layout?: 'single' | 'per-record';
...
    /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
    readonly tables: Record<string, DomainTableSpec>;
}
export declare function domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V>;
export declare function defineDomain<S extends DomainSpec>(spec: S): S;
```
record schemas are **zod**, plugin `Config` is **schemastery**
(`dsh-storage-domain\lib\types\index.d.ts:5-7`).

Read/write/list/delete surface — `dsh-storage-domain\lib\types\domain.d.ts:36-78`:
```ts
export interface KvTable<K extends string, V> {
    get(key: K): V | undefined;
    entries(): IterableIterator<[K, V]>;
    keys(): IterableIterator<K>;
    /** Current record count. */
    readonly size: number;
    put(key: K, value: V): Promise<void>;
    delete(key: K): Promise<boolean>;
    update(key: K, fn: (current: V) => V): Promise<V>;
}
```
Global singleton — `dsh-storage-domain\lib\types\domain.d.ts:15-30`:
```ts
export interface DomainGlobal<G> {
    get(): G;
    set(value: G): Promise<void>;
}
```
Domain handle — `dsh-storage-domain\lib\types\domain.d.ts:84-105`:
```ts
export interface Domain<S extends DomainSpec> {
    readonly name: string;
    readonly global: DomainGlobalHandleOf<S>;
    table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>;
    close(): Promise<void>;
}
```

Key naming: unit and table names must match `UNIT_NAME_RE`; record keys are plain strings whose
restrictions depend on the layout.
- `dsh-storage\lib\index.js:80`: `const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/;`
- `dsh-storage\lib\types\backend.d.ts:92-94` (KvUnit.putRecord):
  ```ts
       * @param key - Record key. In the `per-record` layout a key becomes a path
       * segment and must match `[a-zA-Z0-9_-]+` (an unsafe key rejects); in the
       * `single` layout keys stay opaque.
  ```
- `dsh-storage-json\README.md:56`: "Record keys must match `[a-zA-Z0-9_-]+`; an unsafe key rejects before any file operation."

Atomicity/durability — `dsh-storage\lib\types\backend.d.ts:70-78`:
```ts
/**
 * One opened unit. Values are opaque JSON to this layer: no schema, no
 * events, no domain meaning. The unit does NOT serialize concurrent writes —
 * write ordering is the caller's responsibility (the domain layer runs one
 * write chain per unit); the unit only guarantees that each single call is
 * atomic on the medium and durable once resolved (a crash after resolution
 * followed by a re-open observes the write). Any call after {@link close}
 * rejects with `closed`.
 */
```
and `dsh-storage-domain\README.md:88`:
> **Memory is authoritative; the medium is the durable projection.** Reads are synchronous from validated in-memory state. Every write queues on one per-domain write chain: backend durability first, then memory mutation, then `domain/changed` — a rejected backend write leaves memory untouched, so reads never diverge from the medium.

No migration: `dsh-storage-domain\README.md:153`: "**No data migration** — a domain whose stored version differs from its spec rejects at open (`version-mismatch`); changing a schema requires migrating the stored data by hand."

The shipped usage pattern (this is the one to copy) — `dsh-storage-domain\README.md:52-56`:
```
const domain = await ctx.storageDomain.open(workspaceSpec)
await domain.table('workspaces').put(id, { path: '/work/demo' })
const record = domain.table('workspaces').get(id) // synchronous, from memory
domain.table('workspaces').update(id, (r) => ({ ...r, path: newPath }))
```
plus lifecycle ownership — `dsh-storage-domain\README.md:58`:
> The caller owns the handle's lifecycle and releases it with `domain.close()` when the feature shuts down (typically its own `ctx.effect` disposer); domains still open when the plugin unmounts are closed by the facility.

### B.7 `dsh-storage-domain` vs `dsh-storage-json`; which to use for one JSON document per workspace

Division of labour: `dsh-storage-json` is a **backend** (media), `dsh-storage-domain` is the **form**
(semantics). A plugin never picks a backend in code; the *composition* routes domains to backends.

- `dsh-storage\README.md:72`:
  > **Backends own media, data forms own semantics.** The hub never performs IO; it only holds the name → backend table and the form-name → facility map.
- `dsh-storage-domain\lib\types\index.d.ts:40-45`:
  ```ts
  export interface Config {
      /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
      backend: string;
      /** Per-domain overrides: domain name → backend name. */
      routes?: Record<string, string>;
  }
  ```
- `dsh-storage\README.md:46`: "Several backends can stay mounted side by side; which backend serves which domain is the domain form's configuration, never a hub-wide choice."

`dsh-storage-json` facts — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-storage-json\lib\types\index.d.ts:12`, `:21-24`, `:34`:
```ts
/** Cordis plugin name. */
export declare const name = "storage-json";
```
```ts
export interface Config {
    /** Directory holding one `<unit>.json` file (or `<unit>/` tree) per unit. */
    root: string;
}
```
`dsh-storage-json\README.md:12`:
> `dsh-storage-json` stores domain data as readable JSON under a configured root and registers as backend `json`. Its default `single` layout keeps one complete `<unit>.json` file per unit; its `per-record` layout keeps one version-stamped document per record. Both layouts publish each changed file atomically, while the domain layer orders calls.

Layout is chosen by the **domain spec**, not the backend —
`dsh-storage-json\README.md:36`: "A domain specification selects its layout; this plugin has no layout override."

On-disk formats — `dsh-storage-json\README.md:78-88`:
```
{
  "unit": { "name": "workspace", "version": 1 },
  "global": null,
  "tables": { "workspaces": { "<key>": { "path": "/work/demo" } } }
}
```
> A `per-record` table document at `<root>/<unit>/<table>/<key>.json` has the form `{ "version": 1, "record": <value> }`; the optional global value uses `<root>/<unit>/global.json`. The format version comes from the domain specification.

**Which one for "one JSON document per workspace"?** Use `dsh-storage-domain` over the JSON backend, with
one record per workspace in a declared table (exactly what `dsh-workspace` ships). The precedent,
verbatim — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-workspace\lib\index.js:248-260`:
```js
const workspaceDomainSpec = defineDomain({
	name: "workspace",
	version: 2,
	global: {
		schema: workspaceDomainState,
		initial: {
			initialized: false,
			workspaceIds: [],
			archivedSessionIds: []
		}
	},
	tables: { workspaces: domainTable(workspaceRecord) }
});
```
with `import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";`
(`dsh-workspace\lib\index.js:7`), `static inject = ["storageDomain", "sessionPersistence"];`
(`dsh-workspace\lib\index.js:314`) and `const domain = await this.ctx.storageDomain.open(workspaceDomainSpec);`
(`dsh-workspace\lib\index.js:337`).
If you want a *separate file per workspace*, that is the `per-record` layout on the same domain spec
(`layout?: 'per-record'`, `dsh-storage-domain\lib\types\spec.d.ts:43`) — but note that the `single`
layout already gives one complete, pretty-printed `<unit>.json` for the whole domain, and
`dsh-storage-json\README.md:141` warns `single` rewrites the whole unit per write.

### B.8 `dsh-atomic-write` — atomic file writes

Whole API surface — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-atomic-write\lib\types\index.d.ts:45` and `:74`:
```ts
export declare function writeFileAtomic(filename: string, content: string, options: WriteFileAtomicOptions): Promise<void>;
export declare function withFileLock<T>(filename: string, operation: () => Promise<T>, options?: FileLockOptions): Promise<T>;
```
Options — `dsh-atomic-write\lib\types\index.d.ts:16-28`, `:47-57`:
```ts
export interface WriteFileAtomicOptions {
    mode: number;
    dirMode?: number;
}
export interface FileLockOptions {
    waitMs?: number;
}
```
Guarantees and limits — `dsh-atomic-write\README.md:12`:
> Its writer lock serializes read-modify-write cycles across processes so concurrent writers cannot overwrite one another with stale state. Each replacement uses caller-selected permission bits on a fresh inode, which safely narrows an existing file's permissions. This zero-dependency library accepts strings; it does not provide a `cordis.yml` plugin or crash durability because it does not call `fsync`.

Usage — `dsh-atomic-write\README.md:32-37`, `:51-54`:
```ts
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
declare const text: string
await writeFileAtomic('/home/u/.dsh/settings.yaml', text, { mode: 0o600 })
```
```text
await withFileLock('/home/u/.dsh/settings.yaml', async () => {
  const previous = await readCurrent()
  await writeFileAtomic('/home/u/.dsh/settings.yaml', render(previous), { mode: 0o600 })
})
```
Limit: "**Atomic, not durable** — no `fsync` of the file or its directory, so after a crash the rename may be observed unwound." (`dsh-atomic-write\README.md:123`).

### B.9 `dsh-home-paths` — the user data directory

Exact function names — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-home-paths\lib\types\index.d.ts:7`, `:9`, `:11`, `:25`, `:30`, `:36`, `:48`, `:54`, `:63`:
```ts
export declare const DSH_HOME_DIR_NAME = ".dsh";
export declare const DEFAULT_DSH_HOME_DISPLAY = "~/.dsh";
export declare const DSH_HOME_ENV = "DSH_HOME";
export declare function canonicalizeWatchPath(path: string): Promise<string>;
export declare function defaultDshHome(): string;
export declare function expandHomePath(path: string): string;
export declare function resolveDshHome(configured?: string, env?: Record<string, string | undefined>): string;
export declare function dshHomePath(...segments: string[]): string;
export declare function dshHomeDisplay(resolvedHome: string): string;
```
Precedence — `dsh-home-paths\README.md:12`:
> `@deepseek-ai/dsh-home-paths` lets package authors resolve one DeepSeek Harness data root and derive child paths from it. An explicit path wins over `$DSH_HOME`, which wins over `~/.dsh`; blank environment values are ignored.

Usage — `dsh-home-paths\README.md:31-36`:
```ts
import { resolveDshHome, dshHomePath } from '@deepseek-ai/dsh-home-paths'

const home = resolveDshHome()                // configured path, else $DSH_HOME, else ~/.dsh
const settings = dshHomePath('settings')     // join one child onto the resolved home
```
It is a library, not a plugin: "Use it as a direct library dependency, not through `cordis.yml`."
(`dsh-home-paths\README.md:12`). Observed live values on this machine:
`DSH_HOME` is unset in effect and the root is `$DSH_HOME` (the packages under
`$DSH_HOME\profiles\node_modules\@deepseek-ai\` and the profiles under
`$DSH_HOME\profiles\` confirm it; see D.13).

---

## C. WORKSPACE IDENTITY

### C.10 Learning the workspace root/id, and the missing hash helper

Registry service — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-workspace\lib\types\index.d.ts:42-46`, `:79`, `:85`, `:92`, `:101`, `:109`, `:124`, `:139`:
```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        workspaceRegistry: WorkspaceRegistry;
    }
}
```
```ts
    create(path: string, title?: string): Promise<Workspace>;
    get(id: WorkspaceId): Workspace | undefined;
    list(): Workspace[];
    delete(id: WorkspaceId): Promise<boolean>;
    insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>;
    archiveSession(sessionId: SessionId): Promise<void>;
    resolveByPath(path: string): Promise<Workspace | undefined>;
```
(Each of the seven signatures above is one exact declaration line: `dsh-workspace\lib\types\index.d.ts:79`, `:85`,
`:92`, `:101`, `:109`, `:124`, `:139`. The doc comments between them are elided.)

Entity surface — `dsh-workspace\lib\types\entity.d.ts:54-73`:
```ts
export declare class WorkspaceEntity implements Workspace {
    readonly id: WorkspaceId;
    get path(): string;
    get title(): string;
    get createdAt(): string;
    get updatedAt(): string;
    get sessionIds(): readonly SessionId[];
    setTitle(title: string): Promise<void>;
    attachSession(sessionId: SessionId): Promise<void>;
    insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
    detachSession(sessionId: SessionId): Promise<void>;
    status(): Promise<'ok' | 'missing-dir'>;
```

**Workspace id is a random UUID, and the canonical path is `fs.realpath`** — there is no path-derived key:
- `dsh-workspace\lib\index.js:1`: `import { randomUUID } from "node:crypto";`
- `dsh-workspace\lib\index.js:485`: `const id = WorkspaceId(randomUUID());`
- `dsh-workspace\lib\types\paths.d.ts:20-33`:
  ```ts
  /**
   * Canonicalize a fully qualified directory path via `fs.realpath`: trailing
   * slashes, `..` segments, and symlinks are all resolved. This is the ONE
   * uniqueness canon of the package — workspace paths are stored canonicalized,
   * uniqueness is string equality of canonicalized paths (a symlink to an
   * existing workspace's directory collides), and attach-time session `cwd`
   * checks go through the same canon.
   * ...
   */
  export declare function realpathNormalize(path: string): Promise<string>;
  ```
  re-exported as `export { realpathNormalize } from './paths.ts';` (`dsh-workspace\lib\types\index.d.ts:14`).
- `dsh-workspace\README.md:82`: "**One record per canonical path.** `fs.realpath` is the single uniqueness canon: paths are stored canonicalized, so a symlink to an owned directory collides, and uniqueness is string equality of canonical paths."

**Is there a canonical workspace key/hash helper?** No.
- The only crypto utility package, `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-util-crypto\lib\types\index.d.ts:18` and `:23`, exports exactly two functions:
  ```ts
  export declare function bytesToBase64(data: Uint8Array): string;
  export declare function randomUUID(): Uuid;
  ```
  (module doc: "UUID minting that works in every JavaScript context this repository ships to" — `:1-9`.)
- A full scan of every installed `@deepseek-ai/**/lib/types/**/*.d.ts` for `sha256|createHash|export declare function hash|digest\(` returned **no matches**.
- Therefore a wiki keyed by a hash of the workspace identifier must compute that hash itself (e.g.
  `node:crypto` in a host-only plugin). The canonical *input* to hash is either the realpath-canonical
  directory (`realpathNormalize`) or the `WorkspaceId` UUID; DSH itself stores records under the UUID
  (`workspaces` table keyed by `WorkspaceId`, `dsh-workspace\README.md:105`).

Where a plugin learns the *current* workspace root for a session: two documented sources.
- Session creation metadata / header (immutable, absolute): `dsh-session\lib\types\types.d.ts:68-69`
  `/** Absolute working directory the session was created in (if any). */ readonly cwd?: string;`
  and the create option at `:114-115` (`readonly meta?: { readonly cwd?: string; ...`).
- The sandbox policy resolves the per-call boundary — `dsh-sandbox-policy\lib\types\index.d.ts:76-77`, `:88`:
  ```ts
      /** The absolute `workspace-write` fallback root for calls without a session cwd. */
      readonly workspaceRoot: string;
  ```
  ```ts
      resolve(request?: SandboxPolicyRequest): SandboxExecutionPolicy;
  ```
  "A session cwd is its workspace-write boundary; the configured root is the fallback for agentless calls and sessions without a cwd."
  (`dsh-sandbox-policy\lib\types\index.d.ts:82-84`), with
  `SandboxExecutionPolicy = { mode: SandboxMode; workspaceRoot: string; sessionId?: SessionId }`
  (`dsh-sandbox\lib\types\index.d.ts:27-40`).
  This is the pattern the shipped API server uses — `dsh-client-ui-deliverables\lib\index.js:83-86`:
  ```js
  const { absolutePath: path } = await workspaceFiles.stat({
      sessionId: id,
      workspaceRoot: session.cwd ?? ctx.sandboxPolicy.workspaceRoot
  }, file.path, request.signal);
  ```
- On the client side, a `?path=`-style address carries the session instead:
  `dsh-util-workspace-path\README.md:25`: "`dsh-resource://file/session/<sessionId>/<path>` names the Session that authorizes the Host read and a workspace-relative or absolute path. … The `absolute/<path>` form remains parseable but carries no authorizing Session".

`dsh-util-workspace-path` exact helpers — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-util-workspace-path\lib\types\index.d.ts:6`, `:13`, `:20`, `:27`, `:37-40`, `:52`, `:59` and `file-address.d.ts:43`, `:50`, `:57`:
```ts
export declare function isAbsoluteWorkspacePath(path: string): boolean;
export declare function resolveWorkspacePath(cwd: string | undefined, path: string): string;
export declare function abbreviateHomePath(path: string, home?: string): string;
export declare function workspaceTitleOf(path: string): string;
export declare function pathPartsOf(path: string): { readonly directory: string; readonly name: string; };
export declare function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string;
export declare function relativizeToCwd(text: string, cwd: string | undefined): string;
export declare function sessionFileAddress(sessionId: string, path: string): string;
export declare function absoluteFileAddress(path: string): string;
export declare function parseFileAddress(address: string): FileAddress | undefined;
```
It has no Cordis service ("It has no Cordis service or runtime state", `dsh-util-workspace-path\README.md:12`).

### C.11 `ctx.fs` and `dsh-fs-local`

Service key and event vocabulary — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-fs\lib\types\index.d.ts:15-18`:
```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        fs: FileSystem;
    }
```
Events: `fs/write-intent`, `fs/edit-intent` (single-slot waterfalls) and `fs/observed` (fire-and-forget
recording) — `dsh-fs\lib\types\index.d.ts:19-53`.

Verbatim abstract signatures — `dsh-fs\lib\types\index.d.ts:75`, `:85-88`, `:97`, `:106`, `:114`, `:122`, `:129`, `:144-146`, `:153`, `:163`, `:174`, `:188-191`, `:199`, `:212`, `:226-228`:
```ts
    get sandboxMode(): SandboxMode | undefined;
    abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal; }): Promise<FsTarget>;
    abstract processPath(target: FsTarget): string;
    processPathFromHostPath(hostPath: string): string | undefined;
    abstract fileUrl(target: FsTarget): string;
    abstract contains(parent: FsTarget, child: FsTarget): boolean;
    abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    abstract lstat(path: string, opts?: { cwd?: string; }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    abstract readByteRange(target: FsTarget, range: { offset: number; length: number; }, signal?: AbortSignal): Promise<Uint8Array>;
    abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    abstract writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome>;
    abstract editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion; }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome>;
```
Path conventions: every operation starts from `resolve(path, { cwd })` which yields an opaque
`FsTarget { targetKey, displayPath }` — `dsh-fs\README.md:66`:
> Every ordinary operation starts with `resolve(path, { cwd })`, which produces a stable `FsTarget` (an opaque `targetKey` plus a `displayPath` for model/UI output); the same file reached through different paths yields the same key.
and "`targetKey` and `version` are branded opaque ids: consumers must not parse or interpret them; only
`displayPath` is for model/UI output." (`dsh-fs\README.md:74`).

**There is no `glob` on `ctx.fs`.** The README states the closed primitive list —
`dsh-fs\README.md:113`:
> - **Thirteen primitives only** — no delete, rename, copy, or watch; `listDir` lists a single level, with recursion, globbing, pagination, and search out of scope
Glob/grep live in the model-facing tool package `dsh-tool-fs-search`
(`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-tool-fs-search\lib\types\glob.d.ts`,
`...\lib\types\grep.d.ts`), not on `ctx.fs`. A host plugin needing globbing must implement it over
`resolve`+`listDir` (or reuse that tool package).

Sandbox interaction:
- Mutations accept the per-call policy and a sandboxing backend enforces it; the bare backend ignores it —
  `dsh-fs\lib\types\index.d.ts:207-209` ("`sandboxPolicy` - the per-call mode and workspace root this write runs under; a sandboxing backend fences the write by it, the bare backend ignores it.").
- `dsh-fs-local` is *not* a sandbox — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-fs-local\README.md:32`:
  > `config.cwd` is a resolution default, not a containment boundary: absolute paths and `..` escape it.
  and `:129`:
  > - **`config.cwd` is not a sandbox** — it is a resolution default, not containment: absolute paths and `..` escape it. Enforce containment with a stricter `ctx.fs` backend or a permission plugin on the `tools/execute` waterfall.
- Choose one backend only — `dsh-base\README.md:86`: "mounting `dsh-fs-local` alongside it would double-register `ctx.fs` and fail the load." (same statement at `dsh-base\README.md:137`).
- `fs-local` config and identity — `dsh-fs-local\lib\types\index.d.ts:12-20`, `:28-31`:
  ```ts
  export interface Config {
      /** Base directory for relative paths. Defaults to `process.cwd()`. */
      cwd?: string;
      diffBasisMaxBytes?: number;
  }
  export declare class LocalFileSystem extends FileSystem {
      static Config: z<Config>;
  ```
  `dsh-fs-local\README.md:71`: "**Realpath identity.** The `targetKey` is the file's `realpath`, so two input paths reaching the same file through symlinks share one identity, and writes land on the link target while preserving the link."
- Error codes (stable, branch on these) — `dsh-fs\lib\types\types.d.ts:162`:
  `export type FsErrorCode = 'FS_NOT_FOUND' | 'FS_NOT_DIRECTORY' | 'FS_NOT_TEXT' | 'FS_NOT_REGULAR_FILE' | 'FS_TOO_LARGE' | 'FS_PERMISSION_DENIED' | 'FS_SANDBOX_DENIED' | 'FS_IO_ERROR' | 'FS_STALE_VERSION' | 'FS_NOT_OBSERVED' | 'FS_AMBIGUOUS_EDIT' | 'FS_EDIT_NOT_FOUND' | 'FS_ABORTED';`

---

## D. PLUGIN PACKAGING & CONFIG

### D.12 The authoritative `package.json.dsh` schema

`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-package-manifest\lib\types\types.d.ts:6-52` (verbatim, abridged only where marked `...`):
```ts
/** The `dsh` property of an npm manifest; a package may declare several roles. */
export interface DshManifest {
    /** Bundle metadata consumed by the profile launcher. */
    bundle?: DshBundleManifest;
    /** Profile metadata consumed by the profile launcher. */
    profile?: DshProfileManifest;
    /** Client module loading and build metadata. */
    client?: DshClientManifest;
    /** Config directories consumed by the experimental deployment-image packer. */
    configTrees?: DshConfigTreeDeclaration[];
    /** Adjacent Session migration metadata consumed by the workspace catalog generator. */
    sessionFormatMigration?: DshSessionFormatMigrationManifest;
    moduleFallback?: DshModuleFallbackManifest;
}
/** The configuration layer exported by a bundle package. */
export interface DshBundleManifest {
    /** Patch file path relative to the declaring package root. */
    patch: string;
}
/** The bundle composition declared by a profile directory. */
export interface DshProfileManifest {
    /** Ordered bundle layer list, using installed package names. */
    bundles?: string[];
    /** User patch lifecycle; omitted means `live` for custom profiles. */
    patchReload?: ProfilePatchReload;
}
/** Whether user patch files reload while a profile remains active or apply only at startup. */
export type ProfilePatchReload = 'live' | 'startup';
/** Client module declaration read by client-modules and the client build. */
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /** Exact module-table requests beyond the implicit client baseline, including subpaths such as `<pkg>/client`; absent means baseline externals only. ... */
    external?: string[];
}
```
`moduleFallback` is declared `@internal` and documented as "Launcher-generated module proxy metadata, not
an author configuration entry." (`dsh-package-manifest\lib\types\types.d.ts:18-22`); `configTrees` and
`sessionFormatMigration` are declared for the image packer and the workspace catalog generator
(`dsh-package-manifest\README.md:75`).

Which fields are actually **required**? None: every DshManifest field is optional, and the readers own
validation/defaults — `dsh-package-manifest\README.md:12`:
> Use `DshManifest` to type a package's Harness metadata, or a member type such as `DshClientManifest` for one declaration. Boot, client, build, and external packages import the same types; each reader owns JSON validation and default resolution.

Role-by-role:
- **A bundle** (a package that contributes profile plugin rows) **must** declare `dsh.bundle.patch`; the
  launcher fails loud otherwise — `dsh-app-boot\lib\index.js:851-852`:
  ```js
  		const declared = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).dsh?.bundle?.patch;
  		if (declared === void 0) throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`);
  ```
- **A profile directory** declares `dsh.profile.bundles` (+ optional `patchReload`).
- **A package with a browser half** declares `dsh.client` (`platform`, `inject`, optional `immediately`,
  `external`), and the launcher discovers the browser bundle through the package's `./client` export
  (`dsh-client-ui-deliverables\lib\index.js:110-112`: "The browser half ships via exports["./client"],
  discovered through the package.json dsh.client declaration.").

Real shipped examples:
- browser-capable API package — `dsh-api-workspace-files\package.json:40-48`:
  ```json
    "dsh": {
      "client": {
        "inject": [
          "@deepseek-ai/dsh-api-gateway",
          "@deepseek-ai/dsh-client-resources"
        ],
        "platform": "web"
      }
    },
  ```
- client bundle with the full inject list — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-deliverables\package.json:28-41`:
  ```json
    "dsh": {
      "client": {
        "inject": [
          "@deepseek-ai/dsh-api-remotes",
          "@deepseek-ai/dsh-client-connection",
          "@deepseek-ai/dsh-client-locale",
          "@deepseek-ai/dsh-client-ui-chat",
          "@deepseek-ai/dsh-client-ui-conversation",
          "@deepseek-ai/dsh-client-ui-renderer",
          "@deepseek-ai/dsh-client-ui-tool"
        ],
        "platform": "web"
      }
    },
  ```
- **no `dsh` field at all** — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-web-frontend\package.json:1-24` (pure dist carrier: no `dsh`, no README).
- bundle declaration example: `dsh-package-manifest\README.md:32-38`:
  ```ts
  import type { DshClientManifest, DshManifest } from '@deepseek-ai/dsh-package-manifest'
  const client: DshClientManifest = { platform: 'web' }
  const dsh: DshManifest = {
    bundle: { patch: './cordis.patch.yml' },
    client,
  }
  ```

### D.13 Discovery/listing and installation; exact profile layout

**Discovery/listing (runtime).** `pluginInventory/list` projects the live Loader —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-host-plugin-inventory\README.md:12`:
> Clients can call `pluginInventory/list` to display the host’s current plugins in load order, including each entry’s identifier, module specifier, effective enablement, and live phase. … Each response is a point-in-time, read-only snapshot for display and diagnostics: it cannot mutate plugins and provides no history, provenance, or change subscription.

Implementation: "every `list()` call reads `ctx.loader.entries()` and maps each non-group entry to its
public row" (`dsh-host-plugin-inventory\README.md:52`). Row payload —
`dsh-host-plugin-inventory\lib\types\types.d.ts:5-14`:
```ts
export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null;
export interface PluginInventoryEntry {
    readonly entryId: PluginEntryId;
    /** Exact module specifier imported by the Loader entry. */
    readonly moduleName: string;
    /** Effective Loader enablement, including disabled ancestor groups. */
    readonly enabled: boolean;
    readonly fiberPhase: PluginFiberPhase;
}
```
It is Remote-only: "the service is Remote-only and deliberately declares no same-process Cordis `Context`
merge." (`dsh-host-plugin-inventory\README.md:28`).

**Installation command.** `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh\README.md:18`:
> | `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

It is a thin pnpm forwarder that reconciles `dsh.profile.bundles` —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh\lib\plugin-Ddi42qoW.js:7-15`:
```js
/**
* `dsh plugin --profile <name> <args...>` — profile plugin management as a
* thin pnpm forwarder: initialize the profile on first use, run
* `pnpm <args...>` in the profile directory, then reconcile the
* `dsh.profile.bundles` layer list against the installed state (a dependency
* resolving to a package that declares `dsh.bundle` joins the layer stack; a
* removed or bundle-less dependency leaves it). Reconciling by installed
* state, not by dependency diff, means `update` activates a package that
* gained its `dsh.bundle` declaration in a newer version.
* @module @deepseek-ai/dsh/plugin
*/
```
executed as (`dsh\lib\plugin-Ddi42qoW.js:109-113`):
```js
	const result = spawnSync("pnpm", args.map((argument) => anchorPathSpec(argument, process.cwd())), {
		cwd: dir,
		stdio: "inherit",
		shell: process.platform === "win32"
	});
```
and a bundle-less dependency only warns (`dsh\lib\plugin-Ddi42qoW.js:57-58`):
```js
		} else if (!isBundle && !beforeDeps.has(packageName)) process.stderr.write(`${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer (a later update that gains one activates it automatically)
```
Missing profile message names the exact command — `dsh-app-boot\lib\index.js:890`:
`` `${binName}: profile ${JSON.stringify(name)} does not exist; create it with 'dsh plugin --profile ${name} add <package>'` ``.

**Exact profile layout.** Authoritative description —
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js:288-308`:
```js
 * Profile discovery, initialization, and patch-layer composition for the
 * `dsh --profile` launcher family.
 *
 * A profile is a directory under `$DSH_HOME/profiles/<name>` holding a
 * `package.json` (out-of-tree plugin dependencies plus the profile manifest
 * `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml`
 * (the user's own patch layer, applied after every bundle layer). Bundles are
 * npm packages whose manifest declares
 * `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the tree is
 * composed by applying each bundle's patch list in `dsh.profile.bundles` order over
 * an empty entry list, then the profile's own patches, then any launcher
 * layers (`--patch` files and flag-derived patches).
 *
 * Module resolution is two-anchor by construction: a bundle name resolves
 * first from the dsh installation (the launcher's own package), then from the
 * profile directory. Pnpm-managed entries in the profile's `node_modules`
 * resolve first. Dsh-owned links add packages carried only by selected
 * bundles, while `$DSH_HOME/profiles/node_modules` supplies the installation
 * dependency closure through Node's ordinary parent-walk. Plain Node uses
 * symlinks for that shared fallback; packaged executables use ESM proxies so
 * external plugins retain the installation's module instances.
```
Constants: `PROFILES_DIR = "profiles"` (`:312`),
`PROFILE_PATCH_FILENAME = "cordis.patch.yml"` (`:314`),
profile dir = `join(home, PROFILES_DIR, name)` (`:325`).
Shipped templates: `web: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" }`
(`:333-336`), and `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]` (`:357`).
Composition order is restated for users — `@deepseek-ai/dsh\README.md:39-44`:
> The tree composes over an empty root:
> - each bundle's patch in `dsh.profile.bundles` order
> - then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
> - then `--patch` overlays
>
> Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (…), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

**Observed live layout on this machine** (real directory listing, `$DSH_HOME\profiles\web\`):
```
cordis.yml            223 B
cordis.patch.yml     4445 B
package.json          649 B
pnpm-lock.yaml      44624 B
pnpm-workspace.yaml   131 B
.plugin-manager\logs\operation-*\pnpm.log
node_modules\        (hoisted pnpm tree, incl. .package-map.json, .modules.yaml)
```
with `$DSH_HOME\profiles\web\package.json:11-21`:
```json
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-experimental-agent-team-profile",
        "some-third-party-bundle"
      ],
      "patchReload": "live"
    }
  }
```
The generated profile root config is empty by design —
`$DSH_HOME\profiles\web\cordis.yml:1-4`:
```yaml
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
```
and the pnpm settings file — `$DSH_HOME\profiles\web\pnpm-workspace.yaml:1-7`:
```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```
The template strings written by `initProfile` match these files byte-for-byte:
`PROFILE_PATCH_TEMPLATE` (`dsh-app-boot\lib\index.js:360-364`), `PROFILE_PNPM_WORKSPACE` (`:365-370`),
manifest writer (`:383-392`).

**How a non-bundle plugin package gets mounted.** It is added as profile-package dependency by pnpm, then
mounted with a patch row. Both styles appear in this install's `cordis.patch.yml`:
- id-targeted override/disable (`$DSH_HOME\profiles\web\cordis.patch.yml:9-14`):
  ```yaml
  - id: skill-filesystem
    name: "@deepseek-ai/dsh-skill-filesystem"
    disabled: false
    config:
      customSkillDirs:
        - D:\agents\dsh\skills
  ```
- insertion of new rows (`$DSH_HOME\profiles\web\cordis.patch.yml:42-55`):
  ```yaml
  - insert:
      # browser-use: Playwright MCP driven Chromium
      - id: browser-use
        name: "@deepseek-ai/dsh-browser-use"
      - id: browser-use-playwright-mcp
        name: "@deepseek-ai/dsh-experimental-browser-use-playwright-mcp"
        config:
          mode: launch
          headless: true
  ```
  whose packages are declared in `$DSH_HOME\profiles\web\package.json:4-10` as ordinary
  dependencies. This is the pattern for a third-party host plugin that is not itself a bundle.
- patch semantics: "A patch replaces the targeted row's whole `config` rather than merging into it."
  (`dsh-base\README.md:82`).

### D.14 Core services available on `ctx` (service name → providing package)

`dsh-base` itself mounts nothing: "The bundle is a static patch document: one `insert` list applied over
the empty profile root. It mounts no service, emits no events, and holds no mutable state"
(`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-base\README.md:78`);
its substance is the row list in `dsh-base\cordis.patch.yml`.

The table below was derived mechanically from the shipped declarations: every
`declare module '@deepseek-ai/cordis' { interface Context { … } }` augmentation in
`@deepseek-ai/**/lib/types/**/*.d.ts`, taking each `ctx` property name and its declaring file:line.
Services marked *(client)* live on the browser-side cordis root, not the host.

| Service (`ctx.<name>`) | Providing package | Declared at |
|---|---|---|
| `agents`, `agentLoop`, `agentDefaultModel`, `agentPresets` | `dsh-agent`, `dsh-agent-loop`, `dsh-agent-default-model`, `dsh-agent-presets` | `…\dsh-agent\lib\types\index.d.ts:20`; `…\dsh-agent-loop\lib\types\index.d.ts:28`; `…\dsh-agent-default-model\lib\types\index.d.ts:12`; `…\dsh-agent-presets\lib\types\index.d.ts:49` |
| `approval` | `dsh-user-approval` | `…\dsh-user-approval\lib\types\index.d.ts:13` |
| `attachments` | `dsh-attachment` | `…\dsh-attachment\lib\types\index.d.ts:13` |
| `authorization` | `dsh-authorization` | `…\dsh-authorization\lib\types\index.d.ts:35` |
| `codeRuntime` | `dsh-code-runtime` | `…\dsh-code-runtime\lib\types\index.d.ts:58` |
| `commands` | `dsh-commands` | `…\dsh-commands\lib\types\index.d.ts:61` |
| `compaction`, `toolResultPruner` | `dsh-compaction`, `dsh-compaction-tool-result-pruner` | `…\dsh-compaction\lib\types\index.d.ts:63`; `…\dsh-compaction-tool-result-pruner\lib\types\index.d.ts:15` |
| `connection` | `dsh-client-connection` | `…\dsh-client-connection\lib\types\rpc-host.d.ts:8` |
| `credentials` | `dsh-credentials` | `…\dsh-credentials\lib\types\index.d.ts:100` |
| `directoryPicker` | `dsh-host-directory-picker` | `…\dsh-host-directory-picker\lib\types\index.d.ts:82` |
| `fs` | `dsh-fs` (backend: `dsh-fs-local` / `dsh-fs-sandbox`) | `…\dsh-fs\lib\types\index.d.ts:17` |
| `goals` | `dsh-goal` | `…\dsh-goal\lib\types\index.d.ts:19` |
| `invariants` | `dsh-invariants` | `…\dsh-invariants\lib\types\index.d.ts:53` |
| `jobs` | `dsh-jobs` | `…\dsh-jobs\lib\types\index.d.ts:15` |
| `llm` | `dsh-llm` | `…\dsh-llm\lib\types\index.d.ts:30` |
| `loader` | `cordis-plugin-loader` | `…\cordis-plugin-loader\lib\types\index.d.ts:27` |
| `messageFeedback` | `dsh-message-feedback` | `…\dsh-message-feedback\lib\types\index.d.ts:18` |
| `permissionPresets` | `dsh-permission-presets` | `…\dsh-permission-presets\lib\types\index.d.ts:21` |
| `planMode` | `dsh-plan-mode` | `…\dsh-plan-mode\lib\types\index.d.ts:43` |
| `sandbox`, `sandboxPolicy` | `dsh-sandbox`, `dsh-sandbox-policy` | `…\dsh-sandbox\lib\types\index.d.ts:118`; `…\dsh-sandbox-policy\lib\types\index.d.ts:30` |
| `sessionPersistence`, `sessionQuery`, `sessionProjections`, `sessionProjectionCache`, `sessionTitle`, `sessionTelemetry` | `dsh-session-persistence`, `dsh-session-query`, `dsh-session-projection`, `dsh-session-projection-cache`, `dsh-session-title`, `dsh-session-telemetry` | `…\dsh-session-persistence\lib\types\index.d.ts:76`; `…\dsh-session-query\lib\types\index.d.ts:25`; `…\dsh-session-projection\lib\types\index.d.ts:25`; `…\dsh-session-projection-cache\lib\types\index.d.ts:27`; `…\dsh-session-title\lib\types\index.d.ts:33`; `…\dsh-session-telemetry\lib\types\index.d.ts:19` |
| `sessions`, `sessionController`, `sessionFileReferences`, `sessionSkillCatalog` | `dsh-session`, `dsh-api-session-controller` | `…\dsh-session\lib\types\index.d.ts:26`; `…\dsh-api-session-controller\lib\types\index.d.ts:17`; `…\dsh-api-session-controller\lib\types\file-references.d.ts:9`; `…\dsh-api-session-controller\lib\types\skill-catalog.d.ts:8` |
| `settings` | `dsh-settings` | `…\dsh-settings\lib\types\index.d.ts:113` |
| `shell`, `shellEnv`, `subprocess`, `terminals` | `dsh-shell`, `dsh-shell-env`, `dsh-subprocess`, `dsh-terminal` | `…\dsh-shell\lib\types\index.d.ts:26`; `…\dsh-shell-env\lib\types\index.d.ts:16`; `…\dsh-subprocess\lib\types\index.d.ts:43`; `…\dsh-terminal\lib\types\index.d.ts:15` |
| `skills` | `dsh-skill` | `…\dsh-skill\lib\types\index.d.ts:203` |
| `spillStore` | `dsh-spill` | `…\dsh-spill\lib\types\index.d.ts:22` |
| **`storage`**, **`storageDomain`** | `dsh-storage`, `dsh-storage-domain` | `…\dsh-storage\lib\types\index.d.ts:25`; `…\dsh-storage-domain\lib\types\index.d.ts:27` |
| `subagents` | `dsh-subagent` | `…\dsh-subagent\lib\types\index.d.ts:60` |
| `systemPrompt` | `dsh-system-prompt` | `…\dsh-system-prompt\lib\types\index.d.ts:12` |
| `tokenMeter` | `dsh-token-meter` | `…\dsh-token-meter\lib\types\index.d.ts:16` |
| **`tools`** | `dsh-tools` | `…\dsh-tools\lib\types\index.d.ts:26` |
| `typert`, `typertGateway` | `dsh-typert-protocol`, `dsh-api-gateway` | `…\dsh-typert-protocol\lib\types\types.d.ts:453`; `…\dsh-api-gateway\lib\types\types.d.ts:118` |
| `userQuestions` | `dsh-user-questions` | `…\dsh-user-questions\lib\types\index.d.ts:13` |
| `web` | `dsh-web` | `…\dsh-web\lib\types\index.d.ts:15` |
| `webhookRuntime` | `dsh-webhook` | `…\dsh-webhook\lib\types\index.d.ts:8` |
| **`webServer`** | `dsh-host-webserver` | `…\dsh-host-webserver\lib\types\index.d.ts:17` |
| **`workspaceRegistry`**, `workspaceFiles`, `workspaceController` | `dsh-workspace`, `dsh-api-workspace-files`, `dsh-api-workspace-controller` | `…\dsh-workspace\lib\types\index.d.ts:44`; `…\dsh-api-workspace-files\lib\types\index.d.ts:30`; `…\dsh-api-workspace-controller\lib\types\index.d.ts:10` |
| `workflowEngine` | `dsh-workflow` | `…\dsh-workflow\lib\types\index.d.ts:15` |
| *(client)* `remote` | `dsh-api-gateway` | `…\dsh-api-gateway\lib\types\client\index.d.ts:42` |
| *(client)* `slots`, `uiRenderer`, `resources`, `theme`, `locale`, `layout`, `sidebarRight`, `uiSession`, `uiConversation`, `uiWorkspace`, `modules`, `clientModules`, `fileUpload(s)`, `documentPreviews`, `inputTriggers`, `settingsSchema`, `settingsScope`, `commandUi`, `conversation`, `modelDirectories` | `dsh-client-ui-renderer`, `dsh-client-resources`, `dsh-client-ui-theme`, `dsh-client-locale`, `dsh-client-ui-layout`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-session`, `dsh-client-ui-conversation`, `dsh-client-ui-workspace`, `dsh-client-modules`, `dsh-client-file-upload`, `dsh-client-ui-sidebar-documentpreview`, `dsh-client-ui-input-trigger`, `dsh-client-ui-settings`, `dsh-client-ui-commands`, `dsh-client-ui-model-selection` | `…\dsh-client-ui-renderer\lib\types\client\index.d.ts:26`, `:28`; `…\dsh-client-resources\lib\types\client\contract.d.ts:29`; `…\dsh-client-ui-theme\lib\types\client\index.d.ts:86`; `…\dsh-client-locale\lib\types\client\index.d.ts:57`; `…\dsh-client-ui-layout\lib\types\client\index.d.ts:20`; `…\dsh-client-ui-sidebar-right\lib\types\client\index.d.ts:42`, `:44`; `…\dsh-client-ui-session\lib\types\client\index.d.ts:61`; `…\dsh-client-ui-conversation\lib\types\client\index.d.ts:31`, `:33`; `…\dsh-client-ui-workspace\lib\types\client\navigation.d.ts:66`; `…\dsh-client-modules\lib\types\client\manifest.d.ts:33`; `…\dsh-client-modules\lib\types\index.d.ts:34`; `…\dsh-client-file-upload\lib\types\client\index.d.ts:9`, `:12`; `…\dsh-client-ui-sidebar-documentpreview\lib\types\client\index.d.ts:26`; `…\dsh-client-ui-input-trigger\lib\types\client\index.d.ts:15`; `…\dsh-client-ui-settings\lib\types\client\schema.d.ts:69`, `…\settings-scope.d.ts:90`; `…\dsh-client-ui-commands\lib\types\client\index.d.ts:21`; `…\dsh-client-ui-model-selection\lib\types\client\service.d.ts:21` |

(cordis' own base `Context` members — `root`, `logger`, `reflect`, `registry`, `events`, `get`, `set`,
`inject`, `effect`, `provide` — come from the `cordis` package itself and are not plugin services.)

---

## E. TOOLS + COMMANDS

### E.15 Registering a user-facing slash command (`ctx.commands`)

Registration signature — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-commands\lib\types\index.d.ts:91`:
```ts
    register(definition: CommandDefinition): () => void;
```
Definition and invocation — `dsh-commands\lib\types\index.d.ts:37-52`, `:18-35`:
```ts
/** Plugin-owned command registration. */
export interface CommandDefinition {
    /** Lowercase command name without the leading slash. */
    readonly name: string;
    /** Human-readable summary used in discovery UI. */
    readonly description: string;
    /** Optional free-form input hint advertised to capable clients. */
    readonly input?: CommandInputDescriptor;
    /**
     * Whether `command/run` records `rawInput`. Defaults to true. ...
     */
    readonly recordInput?: boolean;
    /** Execute against the receiving agent without sending the command to the model. */
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
```
```ts
/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
    /** Pairing id already written to this invocation's `command/run` event. */
    readonly commandId: CommandId;
    /** Exact agent whose UI received the command. */
    readonly agent: Agent;
    /** Exact text following the registered command name, including separator whitespace. */
    readonly rawInput: string;
    readonly attachments: readonly (ImageBlock | FileBlock)[];
    /** Cancellation signal owned by the dispatching UI request. */
    readonly signal: AbortSignal;
}
```
Result / descriptor / input hint — `dsh-commands\lib\types\types.d.ts:20-31`, `:33-41`, `:55-62`:
```ts
export interface CommandInputDescriptor {
    /** Placeholder shown before the user supplies free-form input. */
    readonly hint: string;
    readonly attachments?: boolean;
}
```
```ts
export type CommandResult = {
    readonly kind: 'success';
    readonly text?: string;
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: SessionSeq;
} | {
    readonly kind: 'error';
    readonly text: string;
};
```
```ts
export interface CommandDescriptor {
    readonly name: string;
    readonly description: string;
    readonly input?: CommandInputDescriptor;
}
```
Other members — `dsh-commands\lib\types\index.d.ts:97`, `:103`, `:110`, `:139`, `:71`:
```ts
    registerFileReceiptResolver(resolver: CommandFileReceiptResolver): () => void;
    list(agent: Agent): readonly CommandDescriptor[];
    find(agent: Agent, name: string): CommandDefinition | undefined;
    execute(agent: Agent, line: string, submittedAttachments: readonly CommandSubmitAttachment[], signal: AbortSignal): Promise<CommandExecution | undefined>;
export declare function parseCommand(line: string): ParsedCommand | undefined;
```
Service key and change event — `dsh-commands\lib\types\index.d.ts:60-63`:
```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        commands: CommandRuntime;
    }
}
```
`dsh-commands\lib\types\types.d.ts:76-85` declares `'commands/change'(): void` on cordis `Events`.

README usage example — `dsh-commands\README.md:35-43`:
```
ctx.commands.register({
  name: 'plan',
  description: 'Enter plan mode',
  input: { hint: '<message>' },
  handler: ({ agent, rawInput }) => {
    // Runs directly against the agent; no model message is created.
    return { kind: 'success', text: 'plan mode selected' }
  },
})
```
**Real shipped example (verbatim)** — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-command-goal\lib\index.js:9`, `:172-183`:
```js
const inject = ["commands", "goals"];
```
```js
/** Register the Codex-shaped `/goal` command for every composed command adapter. */
function apply(ctx) {
	ctx.commands.register({
		name: "goal",
		description: "set or view the goal for a long-running task",
		input: {
			hint: "[<objective>|clear|edit <objective>|pause|resume]",
			attachments: true
		},
		handler: (invocation) => executeGoalCommand(ctx, invocation)
	});
}
```
Injection name is the service key `commands` (same file, `:9`). Scoping: "A plain registration is global.
A command-producing plugin mounted beneath an agent's own context declares its `commands` injection and
registers an exact agent-scoped command, which shadows the global definition of the same name for that
agent only." (`dsh-commands\README.md:54`). Syntax rule: "A command line starts with a slash at byte
zero, a lowercase name containing letters, digits, `_` or `-`, and then either end-of-input or
whitespace." (`dsh-commands\README.md:50`). The client reaches commands through the Remote assembly
(`dsh-api-remotes\lib\types\client\index.d.ts:7`, `:26` export `dsh-commands/remote` and
`dsh-commands/types`).

### E.16 `defineTool`, the parameter-schema spec, `output`, `execute(args, exec)`, progress

Registration: `ctx.tools.register(definition)` — `dsh-tools\lib\types\index.d.ts:601`:
```ts
    register(definition: ToolDefinition): () => void;
```
plus `restrict`, `guard`, `get`, `schemas`, `presentAs`, `execute` —
`dsh-tools\lib\types\index.d.ts:609`, `:620`, `:655`, `:676`, `:574`, `:730`:
```ts
    restrict(filter: ToolRestriction): () => void;
    guard(guard: ToolGuard): () => void;
    get(name: string, scope?: ScopeKey): ToolDefinition | undefined;
    schemas(scope?: ScopeKey): ToolSchema[];
    presentAs(mode: ToolPresentationMode): () => void;
    execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>;
```
Service key — `dsh-tools\lib\types\index.d.ts:26` (`tools: ToolRuntime` inside the cordis `Context`
augmentation).

`defineTool` — `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-tools\lib\types\schema.d.ts:239`:
```ts
export declare function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(options: DefineToolOptions<S, O>): ToolDefinition;
```
and its options — `dsh-tools\lib\types\schema.d.ts:178-231` (verbatim, with `...` marking elided doc text):
```ts
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
    /** Tool name (must be unique). */
    readonly name: string;
    /** Human-readable description sent to the model. */
    readonly description: string;
    /** Per-property parameter schema compiled to an implicit open object root. */
    readonly parameters: S;
    /** Canonical output schema plus pure Native and presentation projections. */
    readonly output: {
        /** Schema enforced against every successful body or policy-replaced value. */
        readonly schema: O;
        /** Pure Native/model rendering of one validated canonical value. */
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
        /** Pure replayable presentation metadata for direct top-level calls. */
        presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;
    };
    /** Optional positive cooperative timeout budget in milliseconds. */
    readonly timeoutMs?: number;
    isConcurrencySafe?(args: InferArgs<S>): boolean;
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    presentCall?(args: InferArgs<S>): ToolCallView | undefined;
    presentResult?(args: InferArgs<S>, result: ToolResult): ToolResultView | undefined;
}
```
README's complete example — `dsh-tools\README.md:34-57`:
```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const ctx: Context

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    // args is typed: { path: string; offset?: number; limit?: number }
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

**Parameter-schema spec** (allowed types, `required`, `enum`, `items`, `properties`,
`additionalProperties`) — `dsh-tools\lib\types\schema.d.ts:9-84`:
```ts
export interface ValueSchemaAnnotations {
    description?: string;
    title?: string;
    default?: JsonValue;
    examples?: JsonValue;
}
export interface StringValueSchemaSpec extends ValueSchemaAnnotations { type: 'string'; enum?: readonly string[]; const?: string; }
export interface NumberValueSchemaSpec extends ValueSchemaAnnotations { type: 'number'; enum?: readonly number[]; const?: number; }
export interface IntegerValueSchemaSpec extends ValueSchemaAnnotations { type: 'integer'; enum?: readonly number[]; const?: number; }
export interface BooleanValueSchemaSpec extends ValueSchemaAnnotations { type: 'boolean'; enum?: readonly boolean[]; const?: boolean; }
export interface NullValueSchemaSpec extends ValueSchemaAnnotations { type: 'null'; enum?: readonly null[]; const?: null; }
/** Array value schema; omitted `items` accepts any lossless JSON item. */
export interface ArrayValueSchemaSpec extends ValueSchemaAnnotations { type: 'array'; items?: ValueSchemaSpec; }
/**
 * Explicit object value schema. Openness is mandatory so a nested or output
 * object never acquires an accidental JSON Schema default.
 */
export interface ObjectValueSchemaSpec extends ValueSchemaAnnotations { type: 'object'; properties?: ParameterSchemaSpec; additionalProperties: boolean; }
/** Author-only unconstrained lossless JSON node. */
export interface JsonValueSchemaSpec extends ValueSchemaAnnotations { type: 'json'; }
/** Exact-one union schema; at least two branches are required. */
export interface OneOfValueSchemaSpec extends ValueSchemaAnnotations { oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]]; }
export type ValueSchemaSpec = StringValueSchemaSpec | NumberValueSchemaSpec | IntegerValueSchemaSpec | BooleanValueSchemaSpec | NullValueSchemaSpec | ArrayValueSchemaSpec | ObjectValueSchemaSpec | JsonValueSchemaSpec | OneOfValueSchemaSpec;
/** One implicit parameter-root property, optionally required. */
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true; };
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
export type ParameterSchemaSpec = { [key: string]: ParameterPropertySpec; [key: symbol]: never; };
```
Key points to note: `required` is a **per-property `required: true` annotation**, not a top-level array;
`additionalProperties` is **mandatory** on every `object` node; `json` is author-only; type inference is
bounded to 16 container levels then widens to `JsonValue` (`dsh-tools\lib\types\schema.d.ts:124`, `:148`).
The wire counterpart for arbitrary producers is `JsonSchemaNode`
(`dsh-tools\lib\types\json-schema.d.ts`; README:60: "A raw JSON Schema (`JsonSchemaNode`) is the wire-level
counterpart shared with subagents, workflows, and MCP.").

**`output` schema / render contract.** The registry-facing form is
`dsh-tools\lib\types\index.d.ts:96-104`:
```ts
export interface ToolOutputDefinition {
    /** Raw supported JSON Schema enforced against every successful canonical value. */
    readonly schema: JsonSchemaNode;
    /** Pure projection from validated arguments and value to Native/model content. */
    render(args: unknown, value: JsonValue): ContentBlock[];
    /** Pure replayable presentation projection, computed only for top-level calls. */
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}
```
The body returns **only** the canonical JSON value; the registry renders it and validates it —
`dsh-tools\lib\types\index.d.ts:110-119`:
```ts
    /**
     * Run one accepted call and return only its canonical lossless-JSON value.
     * Async work must observe or forward `exec.signal` and settle only after its
     * owned work reaches quiescence. ...
     */
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
```
A value violating `output.schema` raises `ToolOutputError` with `violations`
(`dsh-tools\lib\types\index.d.ts:383-388`).

**What `exec` provides** — `dsh-tools\lib\types\index.d.ts:284-301`:
```ts
export interface ToolRunContext extends ToolExecution {
    /**
     * Defer one context — typically a nested-dispatch context ferried by a
     * composite tool, or a fresh plugin-sourced instruction — until this tool's
     * final result reaches the agent loop. ...
     */
    deferContext(context: UserMessage): void;
    /**
     * Mark a successful final result as terminal for the current agent turn. ...
     */
    concludeTurn(): void;
}
```
with `ToolExecution extends ToolExecutionInput` adding only identity —
`dsh-tools\lib\types\index.d.ts:261-266`, and `ToolExecutionInput` carrying the rest
(`dsh-tools\lib\types\index.d.ts:197-221`):
```ts
export interface ToolExecutionInput {
    readonly callId: ToolCallId;
    readonly rootCallId?: ToolCallId;
    readonly name: string;
    /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
    readonly arguments: unknown;
    /** The agent on whose behalf the call runs (set by the agent loop). */
    readonly agent?: Agent;
    readonly parent?: ToolExecutionToken;
    /** Required caller-owned cancellation for this invocation. */
    readonly signal: AbortSignal;
}
```
So: **agent, session, and workspace are reached through `exec.agent`** — there is no `exec.session` or
`exec.workspace`. The agent exposes them (`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-agent\lib\types\runtime-types.d.ts:139-149`):
```ts
    interface Agent {
        readonly options: AgentOptions;
        /** The live session this agent drives; its log is the durable source of truth. */
        readonly session: Session;
        readonly inbox: Inbox;
        readonly status: AgentStatus;
        readonly ctx: Context;
```
and the session header carries the workspace root: `SessionHeader.cwd?: string`
(`dsh-session\lib\types\types.d.ts:68-69`), with `ctx.sandboxPolicy.resolve({session}).workspaceRoot`
as the documented resolution path (see C.10).

Cancellation contract — `dsh-tools\README.md:121`:
> Cancellation is cooperative and quiescent: every tool body receives the caller-owned `exec.signal` and must observe it; cancellation before body invocation is `ABORTED_BEFORE_DISPATCH`, after invocation it replaces only a successful outcome with `ABORTED`.

`timeoutMs` is declarative only — `dsh-tools\README.md:226`:
> - **`timeoutMs` on a definition is declarative only** — the registry never enforces deadlines; enforcement requires the `@deepseek-ai/dsh-tool-call-timeout-policy` wrapper.

**Progress / streaming: not part of this API.** A tool body returns exactly one canonical value; there is
no progress callback, no partial-result stream, and no update emitter. A target scan of the whole
`dsh-tools` package found no `progress` symbol at all (only `tools/change` and a comment mentioning "live
streaming" — `dsh-tools\lib\index.js:2593`, `dsh-tools\lib\types\index.d.ts:160`). The only
"in-flight" hook is a **pure** pending-state renderer, which cannot report progress because it is called
during replay too — `dsh-tools\lib\types\index.d.ts:154-163`:
```ts
    /**
     * Optional: how to present the PENDING state of one call in a UI, derived from
     * the call's `args` ... Pure and side-effect-free: a UI may
     * call it during live streaming AND a session-log replay, so it must depend
     * only on `args`.
     */
    presentCall?(args: unknown): ToolCallView | undefined;
```
Render-intent vocabulary (if you do implement presenters) —
`dsh-tools\lib\types\presentation.d.ts:13`, `:41`, `:130`:
```ts
export type ToolCallKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';
export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView;
export type ToolResultView = GenericResultView | TerminalResultView | DiffResultView | SearchResultView | ReadResultView | WebResultView;
```
**But the Web client does not consume them** — `dsh-tools\README.md:89`:
> A tool can retain pure `presentCall()` and `presentResult()` methods for Host-local consumers. The built-in Web Client does not consume those values. It selects a renderer through `tool.call.toolview` and derives card props from raw call arguments, result content, failure state, and persisted metadata.
and `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-tool\README.md:46`:
> Structured cards derive directly from first-party raw event fields; Host `presentCall` and `presentResult` values never enter the Client.
The client-side registration for your own card is a **keyed client slot** —
`dsh-client-ui-tool\README.md:34-40`:
```
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```
with the slot contract at
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-client-ui-tool\lib\types\client\contract\slots.d.ts:22`
(`'tool.call.toolview': { … }`).

---

## UNCERTAIN / NOT FOUND

1. **No workspace-hash helper exists.** Scans of every installed `@deepseek-ai/**/lib/types/**/*.d.ts`
   for `sha256`, `createHash`, `export declare function hash`, and `digest(` produced zero matches, and
   `dsh-util-crypto` exports only `randomUUID()` and `bytesToBase64()` (`…\dsh-util-crypto\lib\types\index.d.ts:18`, `:23`).
   If the wiki must be keyed by a hash of the workspace identifier, the plugin has to compute it itself.
   Whether ZCode's key is a hash of the path or of some other identifier cannot be determined from DSH
   alone — NOT FOUND.
2. **No documented per-plugin HTTP route authorization API.** The only mechanisms found are Connection's
   global fence/auth on `/api` and `ctx.connection.requestRejection()` /
   `ctx.connection.authorizeIndex()` for routes outside `/api`. No per-route ACL, no scopes, no token
   exchange for third-party routes was found. Route-path ownership is enforced only by the duplicate-path
   throw in `WebServer.register` (`dsh-host-webserver\lib\types\index.d.ts:90`).
3. **No CSRF token header.** `dsh-client-connection\README.md:35-39` documents cookie + Host/Origin +
   `sec-fetch-site` only, and states the carrier accepts "no Authorization-header token". A conventional
   `X-CSRF-Token` (or equivalent) was NOT FOUND anywhere.
4. **`dsh-web-app` and `dsh-web-frontend` do not document the wire envelope.** `dsh-web-frontend` ships no
   README at all and its `package.json` has no `dsh` field; the envelope is owned by
   `dsh-client-connection`. The `apps/web` shell's own source is not part of the installed tree, so any
   client-side convenience wrapper around the envelope is NOT FOUND.
5. **`api-remotes` README does not name a route-authorization step**; the authorization facts in A.3 come
   from `dsh-api-gateway\README.md:31` and `dsh-client-connection`'s README/types. Whether Gateway performs
   any *per-namespace* authorization beyond endpoint claiming and the Connection fence is NOT FOUND.
6. **`ctx.storage` has no generic read/write API.** It is a registry (`backend` table + `forms` map) and
   exposes only `mount`/`form`/`domain` (`…\dsh-storage\lib\types\index.d.ts:39-61`). Any "plugin declares a
   table and reads/writes" story goes through `ctx.storageDomain` (B.6). A `ctx.storage.domain` accessor is
   also usable (`dsh-storage\README.md:51`, `:57`), but the domain *facility* is the documented consumer
   entry point.
7. **No glob / no recursive listing on `ctx.fs`.** `dsh-fs\README.md:113` states the closed primitive list;
   globbing lives only in the model-facing `dsh-tool-fs-search` tool package. A host-side recursive find
   helper in the filesystem stack is NOT FOUND.
8. **No progress/streaming API for tools.** See E.16; the search covered the whole `dsh-tools` package.
   Long-running host work that must be observable has to publish its own events or a Remote stream
   (`@Remote({ mode: 'stream' })`) and render it in the client.
9. **Exact `UNIT_NAME_RE` semantics vs. domain record keys.** `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`
   (`dsh-storage\lib\index.js:80`) governs unit and table names; record keys are restricted to
   `[a-zA-Z0-9_-]+` only in the `per-record` layout (`dsh-storage\lib\types\backend.d.ts:92-94`). The
   `single` layout's "opaque" keys are only stated as opaque, with no documented length/charset bound —
   NOT FOUND (beyond the JSON-file round trip).
10. **Whether a host-only plugin package must declare any `dsh` field.** A package that is neither a bundle
    nor a client is mounted purely as a patch row (`$DSH_HOME\profiles\web\cordis.patch.yml:42-55`)
    and can ship with no `dsh` field at all (as `dsh-web-frontend` does). What `dsh plugin add` does with
    such a package is documented only as a warning
    (`dsh\lib\plugin-Ddi42qoW.js:57-58`); no schema entry makes it a plugin — NOT FOUND.
11. **`dsh-host-webserver` has no built-in auth or origin policy by design** (`dsh-host-webserver\README.md:113`);
    any plugin registering a raw `webServer` route outside `/api` must implement its own checks (or call
    `ctx.connection.requestRejection`). Whether a raw route outside `/api` is reachable from the browser
    page without the cookie was not exercised at runtime — UNCERTAIN (the cookie is `Path=/`, so it is
    *sent*, but nothing forces the route to verify it).
