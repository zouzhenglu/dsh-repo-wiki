# DSH host-side LLM API reconnaissance (`ctx.llm`)

Scope: how a DSH cordis plugin running in the **Node/host** half makes a chat-completion / LLM request.
Method: read of the installed packages under `$DSH_HOME\profiles\node_modules\@deepseek-ai\`
(package versions: `@deepseek-ai/dsh-llm@0.1.5-rc.3`, per `dsh-llm\package.json`).
Every declaration below is copied **verbatim** from the installed files; the absolute path and line range follow each block.
Nothing here is invented: anything unconfirmed is in [UNCERTAIN / NOT FOUND](#uncertain--not-found).

---

## (a) Executive summary — the LLM call contract

1. The service is **`ctx.llm`**; the cordis service name is `llm` (`super(ctx, "llm")`) and the plugin `inject` key is **`'llm'`**.
2. There is **exactly one call API: streaming.** `ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>`. **No non-streaming / `complete()` / `generateText()` method exists** in the package. You assemble chunks yourself with `BlockAssembler`.
3. A request names a **provider route** (a string key such as `deepseek-official`, `local-route`) and an **adapter-owned model id**. There is no model-registry object to hold; both are plain strings on `GenerateOptions`.
4. Failures are **not thrown**: adapter selection, dispatch and iteration failures all become one **terminal `finish` chunk** — `{ type: 'finish', reason: { kind: 'error' | 'aborted', failure } }`. You must check `assembler.finish` after the loop; `for await` completes normally. (`llm/stream` waterfall-listener failures and failures in your own consumer code still throw — see b10.)
5. Cancellation is `GenerateOptions.signal?: AbortSignal`. On abort the runtime labels the terminal chunk `reason.kind === 'aborted'` whenever the request signal is aborted (the DeepSeek adapter reports `failure.code === 'ABORTED'`); other failures get `kind === 'error'`. `failure` is `{ message, code, status?, providerRetryAfterMs?, requestId? }` — route on `code`, never on `message`.
6. **There is no per-request timeout field.** Compose one yourself with `deadline(upstreamSignal, timeoutMs, code)` from `@deepseek-ai/dsh-timeout`, and `throwIfAborted()` around the loop. (Provider-level idle timeouts exist in adapter config, e.g. `dsh-llm-deepseek`'s `streamIdleTimeoutMs`.)
7. Messages are `Message[]`: `{ id, role: 'system' | 'user' | 'assistant', content: ContentBlock[], source: MessageSource }`; build them with `createUserMessage({ content, source })` / `createSystemMessage(text, plugin)`. Content parts are `text`, `reasoning`, `image` (needs a durable `ImageAttachmentRef`), `file`, `tool-call`, `tool-result`. For one-shot calls you can pass the prompt as `GenerateOptions.system` (a plain string) instead of a system message.
8. **"The current model for this session"**: the authoritative durable value is the latest logged request header — `session.requestHeader()?.config` (`{ provider, model, reasoningEffort? }`). The host's own precedence is `sessionProjections.stateOf(session, 'modelSelection')?.pending` → `session.requestHeader()?.config` → `ctx.agentDefaultModel.currentSelection()`. `ctx.agentDefaultModel.currentSelection()` alone is only the **process-wide deployment default**, not the session's.
9. Runtime enumeration exists: `ctx.llm.listProviders(): LlmProviderInfo[]` (`{ id, name }`), `ctx.llm.listModels(provider): Promise<LlmModelInfo[]>`, `ctx.llm.resolveModelInfo(provider, model, signal?)` (context window, `defaultMaxTokens`, reasoning efforts, `inputModalities`, `systemPromptUpdate`), and `ctx.llm.listConfigurableProviders()` (dormant/declared providers with `displayName`).
10. This service is **single-attempt**: retry lives in `@deepseek-ai/dsh-llm-retry` and only applies at agent-loop step boundaries, never to a direct `ctx.llm.stream()` call.

---

## (b) Verbatim declarations

### b1. The service name and the `ctx.llm` property

The service is registered under the name `llm`:

```js
		constructor(ctx) {
			super(ctx, "llm");
		}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\index.js` lines 1747–1749

TypeScript surface (`ctx.llm`) plus the `llm/stream` waterfall event:

```ts
declare module '@deepseek-ai/cordis' {
    interface Context {
        llm: LlmRuntime;
    }
    interface Events {
        /**
         * Waterfall around every streaming model call (retry, replay, routing).
         * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
         * adapter's stream, or yield your own chunks to short-circuit.
         * @param options - the full request. A LOOP-built request carries the
         *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
         *   (mutation throws): its content is a pure function of the session log (the
         *   reconstructability Agent Note), so listeners read it, never rewrite it.
         *   Hand-built calls do not carry that marker; their messages already obey
         *   the immutable creation contract.
         * @mode waterfall
         */
        'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
    }
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 28–47

The `inject` key is the same string, `'llm'` — proven by the shipped title-provider plugin:

```js
/** First-human-message model provider for `ctx.sessionTitle`. */
const name = "session-title-first-prompt-llm";
const inject = [
	"sessionTitle",
	"llm",
	"sessions"
];
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session-title-first-prompt-llm\lib\index.js` lines 4–10

### b2. The one call method — `stream()`

```ts
    /**
     * Stream one model call as raw chunks (token-level deltas). Replay state is
     * retained only when the same adapter instance owns its historical provider
     * and the target provider. Final adapter selection remains fixed through
     * asynchronous exact-model resolution and dispatch. Adapter selection,
     * dispatch, and iteration failures become terminal `error` or `aborted`
     * finish chunks; middleware, nested-call, cleanup, and consumer failures
     * remain thrown.
     * @param options - the full request; `options.provider` selects the adapter.
     * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
     */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 394–406

The class it belongs to (declaration head; `LlmRuntime` is the default export of the package):

```ts
/**
 * The abstract `llm` service: an adapter registry plus a streaming model-call
 * API, interceptable via the `llm/stream` waterfall.
 */
export declare class LlmRuntime extends TypertRemoteService {
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 227–231

### b3. `GenerateOptions` — the full parameter object (verbatim, complete)

```ts
/** A single model request, fully assembled. */
export interface GenerateOptions {
    /** Registered provider route selecting the adapter instance. */
    provider: string;
    model: string;
    /** Adapter-owned reasoning effort selected for this exact model. */
    reasoningEffort?: ReasoningEffortId;
    /**
     * Ordered conversation messages, exactly as the provider sees them. A
     * loop-built request passes the derived history (dsh-agent-loop), whose
     * leading system-role message carries the system prompt; a hand-built
     * one-shot passes any list.
     */
    messages: Message[];
    /**
     * System prompt text for one-shot callers; adapters map it to the provider's
     * system slot ahead of `messages`. Loop-built requests leave it undefined.
     */
    system?: string;
    /** Tool schemas (adapters map to the provider's `tools` field). */
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    /**
     * Stop sequences: generation halts as soon as the model produces any one of
     * these strings (adapters map to the provider's stop field, e.g. OpenAI
     * `stop`). The stop string itself is not included in the output.
     */
    stop?: string[];
    signal?: AbortSignal;
    /**
     * Session identity stamped by the loop for request routing. Replay uses it
     * to separate cursors; adapters may map it to model-hidden transport metadata.
     */
    sessionId?: Branded<'SessionId'>;
    /**
     * Provider-neutral classification for an auxiliary model call. Adapters may
     * map the purpose to model-hidden transport metadata or purpose-specific
     * generation policy. Ordinary conversation requests leave it unset.
     */
    purpose?: 'compaction' | 'session-title';
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 403–444

Note: there is **no** `timeout`, `timeoutMs`, `top_p`, `tool_choice`, or penalty field.

`ToolSchema` (for the optional `tools` field):

```ts
export interface ToolSchema {
    name: string;
    description: string;
    /** JSON Schema object for the arguments. */
    parameters: Record<string, unknown>;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 397–402

### b4. The return value — `StreamChunk` (verbatim, complete)

```ts
export type StreamChunk = {
    type: 'block-start';
    index: number;
    blockType: ContentBlockType;
} | {
    type: 'text-delta';
    index: number;
    text: string;
} | {
    type: 'reasoning-delta';
    index: number;
    text: string;
} | {
    type: 'tool-call-delta';
    index: number;
    id: ToolCallId;
    name?: string;
    argumentsDelta: string;
} | {
    type: 'block-end';
    index: number;
    block: ContentBlock;
} | {
    type: 'usage';
    usage: TokenUsage;
} | {
    type: 'finish';
    reason: FinishReason;
    /** Replay metadata for a successful response; see {@link ReplayEnvelope}. */
    replayState?: ReplayEnvelope;
};
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 359–389

Finish reasons (the terminal outcome you must inspect):

```ts
export interface FinishReasonMap {
    'stop': {
        kind: 'stop';
    };
    'tool-calls': {
        kind: 'tool-calls';
    };
    'max-tokens': {
        kind: 'max-tokens';
    };
    'aborted': {
        kind: 'aborted';
        failure: LlmFailure;
    };
    'error': {
        kind: 'error';
        failure: LlmFailure;
    };
}
/** Any known finish reason, derived from {@link FinishReasonMap}; switch on `kind` and fall through unknowns (merge-extensible). */
export type FinishReason = FinishReasonMap[keyof FinishReasonMap];
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 107–127

Failure facts and token usage:

```ts
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
export interface LlmFailure {
    /** Human-readable provider or transport failure. */
    readonly message: string;
    /** Stable provider-neutral machine-routing code. */
    readonly code: string;
    /** HTTP status returned by the provider, when available. */
    readonly status?: number;
    /** Provider-requested delay in milliseconds, when valid and available. */
    readonly providerRetryAfterMs?: number;
    /** Opaque provider-issued request identifier for diagnostics. */
    readonly requestId?: ProviderRequestId;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 25–37

```ts
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    /**
     * Exact full-call total including aggregate prompt and output tokens.
     *
     * Adapters preserve a provider total or derive it from authoritative
     * aggregate prompt/output counters; they omit it when unavailable or
     * inconsistent.
     */
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 136–150

### b5. Chunk assembly — `BlockAssembler`

```ts
export declare class BlockAssembler {
    private partials;
    private order;
    private _usage;
    private _finish;
    private _replayState;
    /**
     * Feed one chunk into the assembly state.
     * @param chunk - the next raw chunk, in stream order.
     */
    push(chunk: StreamChunk): void;
    private ensure;
    private assemble;
    /** Invariant accessor: every index in `order` has a partial. */
    private mustGet;
    /**
     * The one shared keep/drop decision over all seen blocks: max-token
     * truncation drops tool calls that cannot be executed safely. Emitted blocks
     * and replay metadata both derive from this result, so they cannot disagree.
     */
    private assembled;
    /**
     * Assemble all blocks seen so far, in stream order.
     * @returns one block per seen index, except that max-token truncation drops
     *   tool calls that cannot be executed safely; an open block assembles from
     *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
     */
    blocks(): ContentBlock[];
    /**
     * Assemble the prefix an interrupted stream can safely finalize: closed and
     * open text/reasoning blocks with non-whitespace content, in stream order.
     * Tool calls are omitted because interruption precedes dispatch; retaining
     * one would require a fabricated result. Open unknown blocks are also omitted.
     * @returns the kept blocks; empty when nothing streamed before the interruption.
     */
    interruptedBlocks(): ContentBlock[];
    /** Usage from the `usage` chunk; undefined until one arrives. */
    get usage(): TokenUsage | undefined;
    /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
    get finish(): FinishReason;
    /**
     * Replay metadata from the terminal finish chunk, if any, with per-block
     * entries pruned in step with {@link blocks}. Undefined when the envelope's
     * entries do not align with the emitted blocks.
     */
    get replayState(): ReplayEnvelope | undefined;
    /**
     * The assembled assistant message.
     * @param source - producer attribution for the assembled message.
     * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
     */
    message(source?: MessageSource): Message;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\assembler.d.ts` lines 22–75
(`BlockAssembler` is re-exported from the package root: `dsh-llm\lib\types\index.d.ts` line 25.)

### b6. Messages and content parts

```ts
/** One immutable message representation shared by delivery, durable history, and model requests. */
export interface Message {
    /** Stable identity preserved across every representation boundary. */
    readonly id: MessageId;
    /** Provider-neutral conversation role. */
    readonly role: 'system' | 'user' | 'assistant';
    /** Exact model-facing blocks. */
    readonly content: ContentBlock[];
    /** Required source fields supplied by the producer. */
    readonly source: MessageSource;
}
/** A user-role specialization of the one shared message representation. */
export interface UserMessage extends Message {
    readonly role: 'user';
}
/** A model-produced assistant specialization of the shared message representation. */
export interface AssistantMessage extends Message {
    readonly role: 'assistant';
    readonly source: ModelMessageSource;
}
/**
 * A system-role specialization of the shared message representation: one
 * rendered system prompt attributed to the plugin that assembled it. Empty
 * `content` means "no system prompt" and projects to no wire message.
 */
export interface SystemMessage extends Message {
    readonly role: 'system';
    readonly source: MessageSourceMap['plugin'];
}
/** A tool-result specialization whose model-facing block retains call correlation. */
export interface ToolResultMessage extends Message {
    readonly role: 'user';
    readonly content: [ToolResultBlock];
    readonly source: ToolMessageSource;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\message.d.ts` lines 119–153

Message constructors (these are the supported way to build a request's `messages`):

```ts
/**
 * Create one identified user-role message and freeze it before publication.
 * @param input - complete content and source for a new user message.
 * @returns an immutable user message with a fresh stable identity.
 */
export declare function createUserMessage<T extends NewUserMessage>(input: T & {
    readonly id?: never;
    readonly role?: never;
}): T & Pick<UserMessage, 'id' | 'role'>;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\message.d.ts` lines 175–183

```ts
/**
 * Create and freeze one identified system-role message holding a rendered
 * system prompt.
 * @param text - the complete rendered prompt; `''` records "no system prompt".
 * @param plugin - the plugin that assembled the prompt.
 * @returns an immutable system message with a fresh stable identity.
 */
export declare function createSystemMessage(text: string, plugin: string): SystemMessage;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\message.d.ts` lines 193–200

Message sources (`source` is required by `createUserMessage`):

```ts
export interface MessageSourceMap {
    user: {
        kind: 'user';
    };
    plugin: {
        kind: 'plugin';
        plugin: string;
    } & ContextFormed;
    model: ModelMessageSource;
    tool: ToolMessageSource;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\message.d.ts` lines 94–104

Content parts — text, reasoning, image, file, tool-call, tool-result:

```ts
/** Plain text visible to the end user. */
export interface TextBlock {
    type: 'text';
    text: string;
}
/** Reasoning / thinking content, distinct from visible text. */
export interface ReasoningBlock {
    type: 'reasoning';
    text: string;
}
/**
 * A durable raster image reference, valid in user or assistant content. The
 * block is deliberately role-neutral; assistant-side rendering is forward
 * compatibility — the current production adapters declare text-only output,
 * so only user messages may carry images.
 */
export interface ImageBlock {
    type: 'image';
    /** Immutable bytes and intrinsic display metadata owned by the attachment service. */
    attachment: ImageAttachmentRef;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 38–58

```ts
export interface ContentBlockMap {
    'text': TextBlock;
    'reasoning': ReasoningBlock;
    'image': ImageBlock;
    'file': FileBlock;
    'tool-call': ToolCallBlock;
    'tool-result': ToolResultBlock;
}
/** The block `type` tag vocabulary; widens as plugins add entries to {@link ContentBlockMap}. */
export type ContentBlockType = keyof ContentBlockMap;
/** Any known content block, derived from {@link ContentBlockMap}; switch on `type` and fall through unknowns (merge-extensible). */
export type ContentBlock = ContentBlockMap[ContentBlockType];
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 91–102

An image content part needs a **durable reference**, not bytes:

```ts
/** Durable, serializable reference to one immutable normalized image. */
export interface ImageAttachmentRef {
    /** Opaque storage identifier; never a filesystem path or bearer URL. */
    attachmentId: AttachmentId;
    /** Media type verified from the stored bytes. */
    mediaType: ImageMediaType;
    /** Exact encoded byte length. */
    bytes: number;
    /** Intrinsic encoded width in pixels. */
    width: number;
    /** Intrinsic encoded height in pixels. */
    height: number;
    /** Optional display name stripped of local path information. */
    name?: string;
    /**
     * Input dimensions after applying EXIF orientation and before normalization
     * scaling. Present only when normalization reduced the image.
     */
    originalDimensions?: {
        width: number;
        height: number;
    };
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-attachment\lib\types\types.d.ts` lines 6–28

Obtain one from the attachment service (`ctx.attachments`, service name `attachments`):

```ts
    /**
     * Validate and durably commit one image before its owning session event is appended.
     * The returned reference describes the persisted normalized image. When
     * normalization reduces the raster, its `originalDimensions` records the
     * orientation-applied input dimensions.
     * @param input - encoded bytes, declared media type, and optional display name.
     * @returns the durable content-addressed normalized image reference.
     */
    abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-attachment\lib\types\index.d.ts` lines 64–72

```ts
/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
    data: Uint8Array;
    /** Caller-declared media type, checked against fully decoded bytes. */
    mediaType: ImageMediaType;
    /** Optional browser/provider display name; it is never interpreted as a path. */
    name?: string;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-attachment\lib\types\types.d.ts` lines 114–121

### b7. Choosing a provider + model, and reading the current/default model

Exact-route metadata (context window, output default, reasoning efforts, modalities):

```ts
/** Exact-route model metadata resolved by its owning adapter. */
export interface LlmResolvedModelInfo extends LlmModelInfo {
    /** Provider-owned context capacity when known. */
    context?: LlmModelContext;
    /** Adapter-configured per-request output cap materialized when callers omit one. */
    defaultMaxTokens?: number;
    /** Adapter-owned selectable reasoning levels when exposed. */
    reasoning?: LlmModelReasoningInfo;
    /** Declared mid-conversation system prompt handling; absent means only a leading system message is read. */
    systemPromptUpdate?: SystemPromptUpdate;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 320–330

```ts
    /**
     * Resolve and validate all metadata from the adapter that owns one exact
     * route. The result is detached from adapter-owned objects; catalog
     * membership remains advisory and does not control request routing.
     * @param provider - registered provider route to inspect.
     * @param model - exact model id passed to the adapter.
     * @param signal - optional cancellation for adapter-owned asynchronous lookup.
     * @returns exact model identity plus available context and reasoning metadata.
     */
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 345–354

The session's **currently selected / logged** model — the durable request header:

```ts
    /**
     * The {@link EpochHeader} in force after the log's last header event — the
     * header the NEXT request will be compared against — or undefined before
     * the first `request/header` snapshot. The live, incrementally-maintained
     * form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
     * once, when first seen, so a per-step read costs O(new events).
     * @returns the folded header, or undefined when no header event exists yet.
     */
    requestHeader(): EpochHeader | undefined;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session\lib\types\index.d.ts` lines 243–251

```ts
export interface EpochHeader {
    /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
    config: LlmCallConfig;
    /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
    adapterDefaults?: LlmCallConfigAdapterDefaults;
    /** Assembled tool schemas; absent for a tool-less request. */
    tools?: ToolSchema[];
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session\lib\types\types.d.ts` lines 208–215

```ts
export interface LlmCallConfig {
    provider: string;
    model: string;
    reasoningEffort?: ReasoningEffortId;
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\call-config.d.ts` lines 16–23

The **user's pending selection** (durable `model/selection` fold) is exposed by the session-projection registry:

```ts
    /**
     * Read one unit's current host state after materializing every registered
     * unit at the Session cursor. Unrelated wire views are not produced.
     * The returned value is live; callers must not mutate it.
     * @param session - the session whose state is read.
     * @param key - the registered unit key.
     * @returns current state, or `undefined` when the key is not registered.
     */
    stateOf<K extends keyof SessionProjectionStateMap>(session: Session, key: K): SessionProjectionStateMap[K] | undefined;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session-projection\lib\types\index.d.ts` lines 167–175
(the service is `ctx.sessionProjections` — `dsh-session-projection\lib\types\index.d.ts` lines 23–27)

```ts
/** Host fold state for durable model selection. */
export interface ModelSelectionProjectionState {
    /** Selection consumed by the latest recorded model request. */
    readonly lastUsed: ModelSelection | null;
    /** Later user selection not yet consumed by a matching model request. */
    readonly pending: ModelSelection | null;
}
/** Client view of the durable model-selection fold. */
export interface ModelSelectionProjection {
    /** Selection consumed by the latest recorded model request. */
    readonly lastUsed: ModelSelection | null;
    /** Selection the next request should use, falling back to {@link lastUsed}. */
    readonly next: ModelSelection | null;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\types.d.ts` lines 82–95
(unit key registration and the `pending ?? lastUsed` view: `dsh-api-session-controller\lib\types\model-selection-projection.js` lines 42–52; the projection is only registered when `dsh-api-session-controller` is mounted.)

The **process-wide deployment default** (not the session's model):

```ts
/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export declare class AgentDefaultModelConfig extends Service {
    static Config: z<Config>;
    private source;
    constructor(ctx: Context, config: Config);
    /**
     * Read the current default model selection.
     * @returns a detached provider, model, and optional reasoning selection.
     */
    currentSelection(): ModelSelection;
    /**
     * Save the complete default model selection. A deployment without a settings
     * provider keeps its composition entry.
     * @param next - resolved selection accepted by an entry point.
     * @returns fulfillment after the optional settings write settles.
     */
    saveSelection(next: ModelSelection): Promise<void>;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-agent-default-model\lib\types\index.d.ts` lines 35–56
(service name `agentDefaultModel`: `dsh-agent-default-model\lib\index.js` line 38; `Config` accepts only `provider` + `model`, lines 32–35)

```ts
/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
    /** Registered provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
    reasoningEffort?: ReasoningEffortId;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-agent\lib\types\model-selection.d.ts` lines 7–15

**Fallback order the shipped host itself uses** (implementation evidence — `selectionFor(agent)`), which is the exact recipe for "default to the current workspace chat model":

```js
        const projectionState = this.ctx.sessionProjections.stateOf(agent.session, 'modelSelection');
        if (projectionState === undefined) {
            throw new Error('api-session: required modelSelection projection is not registered');
        }
        let picked = projectionState.pending === null
            ? undefined
            : agentModelSelection(projectionState.pending);
        const defaultModel = this.ctx.agentDefaultModel;
        const selection = {
            get current() {
                if (picked !== undefined)
                    return picked;
                const loggedHeader = agent.session.requestHeader();
                if (loggedHeader === undefined)
                    return defaultModel.currentSelection();
                const logged = loggedHeader.config;
                return {
                    provider: logged.provider,
                    model: logged.model,
                    // An effort the adapter defaulted is not a conversation choice: restoring
                    // it as one would make an unchanged default read as a request change.
                    ...(logged.reasoningEffort === undefined
                        || loggedHeader.adapterDefaults?.reasoningEffort === true
                        ? {}
                        : { reasoningEffort: logged.reasoningEffort }),
                };
            },
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\agent.js` lines 293–319

An `Agent` exposes both handles:

```ts
declare module './types.ts' {
    interface Agent {
        /** The provider route and model this agent's requests use. */
        readonly options: AgentOptions;
        /** The live session this agent drives; its log is the durable source of truth. */
        readonly session: Session;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-agent\lib\types\runtime-types.d.ts` lines 138–143

### b8. Runtime enumeration of providers and models

```ts
    /**
     * Describe provider routes with a registered adapter.
     * @returns detached provider metadata in registration order.
     */
    listProviders(): LlmProviderInfo[];
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 263–267

```ts
/** Display metadata for one registered provider route. */
export interface LlmProviderInfo {
    /** Provider route key used by {@link GenerateOptions.provider}. */
    id: string;
    /** Human-readable provider name for selectors and diagnostics. */
    name: string;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 179–185

```ts
    /**
     * Discover models advertised by one registered provider. Catalog membership
     * is advisory and never changes routing or request validation.
     * @param provider - registered provider route to inspect.
     * @returns detached model metadata in adapter-preferred order.
     */
    listModels(provider: string): Promise<LlmModelInfo[]>;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 338–344

```ts
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
export interface LlmModelInfo {
    /** Provider route that owns this model entry. */
    provider: string;
    /** Model id passed to {@link GenerateOptions.model}. */
    id: string;
    /** Human-readable model name for selectors. */
    name: string;
    /** Optional user-facing distinction from otherwise similar models. */
    description?: string;
    /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
    inputModalities?: readonly ModelModality[];
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 276–288

```ts
    /**
     * List every declared configurable provider, registered or dormant.
     * @returns detached directory entries in declaration order.
     */
    listConfigurableProviders(): LlmConfigurableProvider[];
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 277–281

```ts
export interface LlmConfigurableProvider {
    /** Provider route key this entry activates when configured. */
    provider: string;
    /** Human-readable provider name for configuration surfaces. */
    displayName: string;
    /** User-settings namespace whose section configures this provider. */
    settingsNs: string;
    /**
     * Path from that namespace's section root to this provider's profile
     * object; empty when the whole section is the profile.
     */
    settingsPath: readonly string[];
    /**
     * Whether the owning adapter knows this route only because configuration
     * declared it — a gateway or self-hosted server it ships nothing about.
     * Absent means the adapter draws no such distinction; false means it does
     * and this route is one of its own. Only the adapter can answer: a stored
     * profile is how a user-added route AND a corrected shipped one both look
     * from outside.
     */
    declared?: boolean;
    /** Configuration diagnostic for repair; unaffected models may remain serviceable. */
    error?: string;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\types.d.ts` lines 199–222

### b9. Per-request deadline (there is no timeout option)

```ts
/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
    /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
    readonly signal: AbortSignal;
    /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
    [Symbol.dispose](): void;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-timeout\lib\types\index.d.ts` lines 36–42

```ts
/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0` is
 * the internal no-timer sentinel; the returned disposer clears an armed timer.
 * The signal only notifies, so callers must stop their own work.
 *
 * @param upstream The caller's cancellation signal, if any, fused into the result.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link Deadline} (signal + timer cleanup).
 */
export declare function deadline(upstream: AbortSignal | undefined, timeoutMs: number, code: string): Deadline;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-timeout\lib\types\index.d.ts` lines 58–68

```ts
/** Largest delay Node schedules without clamping it to one millisecond. */
export declare const MAX_TIMER_DELAY_MS = 2147483647;
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-timeout\lib\types\index.d.ts` line 22

### b10. How a failure becomes a terminal chunk (and what an abort looks like)

```js
		streamWithRegistration(options, prepared) {
			return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
		}
	};
})();
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
	const failure = normalizeLlmFailure(error);
	return {
		type: "finish",
		reason: signal?.aborted || failure.code === "ABORTED" ? {
			kind: "aborted",
			failure
		} : {
			kind: "error",
			failure
		}
	};
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\index.js` lines 2306–2324
(the try/catch that converts selection + dispatch + iteration failures into that chunk: same file, lines 2223–2290)

Caller abort and idle timeout codes, from the shipped DeepSeek adapter:

```js
				if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== void 0) throw new LlmError(`DeepSeek stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, "TIMEOUT", { cause: error });
				if (options.signal?.aborted) throw new LlmError("DeepSeek request aborted by caller", "ABORTED", { cause: error });
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm-deepseek\lib\index.js` lines 1642–1643

What **is** thrown (as opposed to delivered as a terminal chunk): `prepareCall()` rejects with `LlmError` because it resolves the registration before any guard —

```js
		async prepareCall(config, signal) {
			const registration = this.registration(config.provider);
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\index.js` lines 2145–2146
(`registration()` throws `LlmError('no adapter registered for provider "…"', 'NO_ADAPTER')` — same file, lines 2177–2180.)

```ts
/**
 * Typed error for LLM-related failures. Extends {@link HarnessError}, so the
 * `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
 */
export declare class LlmError extends HarnessError {
    /** Serializable facts retained beside this live Error. */
    readonly failure: LlmFailure;
    /**
     * @param message - non-empty human-readable failure summary.
     * @param code - non-empty stable provider-neutral machine code.
     * @param options - optional cause and validated serializable provider facts.
     */
    constructor(message: string, code: string, options?: LlmErrorOptions);
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\lib\types\index.d.ts` lines 57–70

Stable codes seen in the installed packages (README of `dsh-llm` plus adapter README of `dsh-llm-deepseek`):
`NO_ADAPTER`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `AUTH`, `QUOTA`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`,
`INVALID_REQUEST`, `SERVER`, `HTTP_<status>`, `TRANSPORT`, `ABORTED`, `TIMEOUT`, `EMPTY_RESPONSE`, `STREAM_CLOSED`,
`MALFORMED_RESPONSE`, `REQUEST_EXTENSION`, `UNSUPPORTED_REASONING_EFFORT`, `INVALID_PREPARED_CALL`, `DUPLICATE_ADAPTER`.

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm\README.md` lines 68–70 and
`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-llm-deepseek\README.md` line 95

### b11. The canonical shipped call flow (pattern to copy)

```js
		const route = resolveRoute(config, request);
		const messages = [createUserMessage({
			content: [{
				type: "text",
				text: framedInput
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-session-title-llm"
			}
		})];
		const system = systemPrompt(config);
		const callDeadline = __addDisposableResource(env_1, deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE), false);
		const options = deepFreeze({
			provider: route.provider,
			model: route.model,
			messages,
			system,
			maxTokens: config.maxOutputTokens,
			sessionId: request.session.id,
			purpose: "session-title",
			signal: callDeadline.signal
		});
		request.session.append("session/title-llm-request", {
			titleProvider,
			messageSeqs: selectedMessages.map((message) => message.seq),
			route,
			system,
			messages,
			maxTokens: config.maxOutputTokens
		});
		callDeadline.signal.throwIfAborted();
		const assembler = new BlockAssembler();
		for await (const chunk of ctx.llm.stream(options)) {
			callDeadline.signal.throwIfAborted();
			assembler.push(chunk);
		}
		callDeadline.signal.throwIfAborted();
		const terminalError = finishError(assembler.finish);
		if (terminalError !== void 0) throw terminalError;
		const blocks = assembler.blocks();
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session-title-llm\lib\index.js` lines 196–236
(quoted without change; the `try { … } finally { __disposeResources(…) }` that the TypeScript `using` declaration lowers to, lines 190 and 245–250, is outside this range;
its `finishError()` maps `finish.kind === 'error' | 'aborted'` to `new Error(finish.failure.message)` with `error.code = finish.failure.code`: same file lines 160–174)

`resolveRoute` — explicit pair first, then the session's logged route:

```js
/** Resolve the explicit pair or the exact route captured from `request/header`. */
function resolveRoute(config, request) {
	if (config.provider !== void 0 && config.model !== void 0) return {
		provider: config.provider,
		model: config.model
	};
	if (request.route === void 0) throw new Error("session-title-llm: no logged request route is available; configure provider and model together");
	return request.route;
}
```

Source: `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-session-title-llm\lib\index.js` lines 138–146

### b12. In this deployment (facts, not API)

`$DSH_HOME\profiles\web\cordis.patch.yml` mounts the adapters that populate `listProviders()` in this profile:
`dsh-llm-deepseek` (line 23, route `deepseek-official`), `dsh-llm-pi-ai` (line 56, route = each key under `providers:`, here one `providers:` key),
a third-party provider plugin (line 126, its own route), and `dsh-agent-default-model` (line 35, the deployment's default route and model).
Provider display names come from the adapter (`providerInfo().name`), e.g. `dsh-llm-deepseek\lib\index.js` lines 1558–1563 returns `{ id: provider, name: "DeepSeek" }`,
and `dsh-llm-pi-ai\lib\index.js` lines 1775–1778 returns the profile's `displayName`.

---

## (c) Complete minimal working example

A host-side plugin module (`lib/index.js` of a plugin package, ESM, plain JavaScript — the same shape the shipped
`dsh-session-title-first-prompt-llm` uses: named exports `name`, `inject`, `Config`, `apply`).
Imports are the package entry points as declared in each `package.json` `exports`.

```js
// lib/index.js — host (Node) half of a DSH plugin that calls the model.
import z from '@deepseek-ai/schemastery'
import {
	BlockAssembler,
	createUserMessage,
	ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export const name = 'dsh-wiki-llm-example'

// Cordis loads this plugin only while every listed service is provided.
// 'llm' is the LLM service; the other two are only needed for the
// "default to the session's own model" resolution below.
export const inject = ['llm', 'agentDefaultModel']

export const Config = z.object({
	// Optional explicit route; when both are absent the session's own route wins.
	provider: z.string(),
	model: z.string(),
	// Optional adapter-owned effort id (e.g. 'off' | 'low' | 'high' | 'max').
	reasoningEffort: z.string(),
	systemPrompt: z.string(),
	maxOutputTokens: z.number().min(1).max(1_000_000).default(4096),
	requestTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(180000),
	// Wiring demonstration: perform one completion at load time.
	smokeTest: z.boolean().default(false),
})

const TIMEOUT_CODE = 'WIKI_LLM_TIMEOUT'

/**
 * Choose the route: explicit config pair, else the session's own logged
 * request header, else the process-wide deployment default.
 * @param {any} ctx - plugin context (needs `agentDefaultModel`).
 * @param {any} config - validated plugin config.
 * @param {any} [session] - session to read the logged route from, when the
 *   caller has one. Pass `agent.session` when a live agent is in hand.
 */
export function resolveRoute(ctx, config, session) {
	if (config.provider !== undefined && config.model !== undefined) {
		return { provider: config.provider, model: config.model }
	}
	const logged = session?.requestHeader()?.config
	if (logged !== undefined && logged.provider.length > 0 && logged.model.length > 0) {
		return { provider: logged.provider, model: logged.model }
	}
	const fallback = ctx.agentDefaultModel.currentSelection()
	return { provider: fallback.provider, model: fallback.model }
}

/**
 * One model request, assembled from the raw chunk stream.
 * @param {any} ctx - plugin context; `ctx.llm` is the LLM service.
 * @param {any} config - validated plugin config.
 * @param {{provider: string, model: string}} route - resolved provider + model.
 * @param {{prompt: string, system?: string, sessionId?: string, signal?: AbortSignal}} request
 * @returns {Promise<{text: string, usage: any, finish: any}>}
 */
export async function generate(ctx, config, route, request) {
	// There is no per-request timeout option: compose one from the caller's
	// signal plus a deadline, and dispose it when the call is over.
	const call = deadline(request.signal, config.requestTimeoutMs, TIMEOUT_CODE)
	try {
		const options = {
			provider: route.provider,
			model: route.model,
			system: request.system ?? config.systemPrompt,
			messages: [
				createUserMessage({
					content: [{ type: 'text', text: request.prompt }],
					source: { kind: 'plugin', plugin: name },
				}),
			],
			maxTokens: config.maxOutputTokens,
			signal: call.signal,
			...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
			...(config.reasoningEffort === undefined
				? {}
				: { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }),
		}

		const assembler = new BlockAssembler()
		for await (const chunk of ctx.llm.stream(options)) {
			// The stream itself never throws on abort; re-check our own deadline.
			call.signal.throwIfAborted()
			assembler.push(chunk)
		}
		call.signal.throwIfAborted()

		// The ONLY place a provider/transport failure surfaces.
		const finish = assembler.finish
		if (finish.kind !== 'stop') {
			const failure = finish.kind === 'error' || finish.kind === 'aborted' ? finish.failure : undefined
			const error = new Error(failure?.message ?? `${name}: model request ended with "${finish.kind}"`)
			error.code = failure?.code ?? `LLM_${String(finish.kind).toUpperCase()}`
			throw error
		}

		const text = assembler
			.blocks()
			.filter((block) => block.type === 'text')
			.map((block) => block.text)
			.join('')
		return { text, usage: assembler.usage, finish }
	} finally {
		call[Symbol.dispose]() // clears the deadline timer
	}
}

/** The plugin's own host-side surface, called by its tools / routes / commands. */
export const wikiLlm = { generate: undefined }

/**
 * Plugin entry point.
 * @param {any} ctx - context with the injected services.
 * @param {any} config - config validated against `Config`.
 */
export function apply(ctx, config) {
	/**
	 * @param {any} [session] - session whose model should be the default route.
	 * @param {{prompt: string, system?: string, signal?: AbortSignal}} request
	 */
	wikiLlm.generate = (session, request) => {
		const route = resolveRoute(ctx, config, session)
		return generate(ctx, config, route, { ...request, sessionId: session?.id })
	}

	// Wiring demonstration only: prove the whole contract once, on demand.
	// A real plugin calls `wikiLlm.generate(session, …)` from its own trigger.
	if (config.smokeTest === true) {
		void wikiLlm
			.generate(undefined, { prompt: 'Reply with the single word: ready' })
			.then(({ text }) => ctx.logger.info('%s: llm ok: %s', name, text.trim()))
			.catch((error) => ctx.logger.warn('%s: llm failed (%s): %s', name, error.code, error.message))
	}
}
```

### Notes on the example

* `inject: ['llm', 'agentDefaultModel']` makes the deployment default a **hard dependency**: without that service the whole plugin stays unloaded.
  If the fallback should be optional, drop it from `inject` and read it defensively — `ctx.get('agentDefaultModel')` returns `undefined` when the service is
  not provided (`$DSH_HOME\profiles\node_modules\@deepseek-ai\cordis\lib\types\reflect.d.ts` lines 6–16).
* `inject: ['llm']` alone is enough to *make* the call; `resolveRoute`'s second and third branches are the "default to the current workspace chat model" part.
* `finish.kind !== 'stop'` is treated as failure, matching the shipped title-provider policy. If you pass `tools` in the request you must also handle
  `finish.kind === 'tool-calls'` and dispatch on the assembled `tool-call` blocks instead of throwing.
* The module is plain ESM JavaScript. If you would rather keep TypeScript, the shipped plugins publish a hand-written `lib/types/index.d.ts` next to
  the compiled `lib/index.js` (see `dsh-session-title-first-prompt-llm\lib\types\index.d.ts`), so the runtime shape is identical.

### How it is installed / wired
1. The package must be resolvable by name from the profile (this workspace's plugin is installed into
   `$DSH_HOME\profiles\web\node_modules\` by `dsh plugin --profile web add <dir>`).
2. The bundle patch (`cordis.patch.yml` in the plugin package, declared as `dsh.bundle.patch` in its `package.json`)
   inserts a loader row: `- insert: [{ id: <row-id>, name: <package-name>, config: { … } }]`.
   That is exactly how `repo-wiki` is declared in `<repo>\cordis.patch.yml` lines 14–31.
3. `name` / `inject` / `Config` / `apply` are read off the module by the cordis loader
   (`Plugin.Base.inject` — `$DSH_HOME\profiles\node_modules\@deepseek-ai\cordis\lib\types\registry.d.ts` lines 50–81).
   Cordis starts `apply(ctx, config)` only when every `inject` entry is provided, and unloads it when one goes away.
4. Nothing needs to be registered on `ctx` to *call* the LLM: after injection, `ctx.llm.stream(...)` is directly callable.

---

## (d) UNCERTAIN / NOT FOUND

1. **No non-streaming API.** I searched every `lib/types/*.d.ts` of `dsh-llm` (all `export declare function|const|class` matches are listed in b1–b11) and found no
   `complete()`, `generateText()`, `chat()`, or one-shot helper. The only request entry points are `LlmRuntime.stream()` and `PreparedLlmCall.stream()`.
   If a non-streaming helper exists elsewhere in the harness, it is not in `@deepseek-ai/dsh-llm@0.1.5-rc.3`.
2. **No per-request `timeout`/`timeoutMs` option** in `GenerateOptions` (b3 is complete and verbatim). Any timeout must be composed by the caller (`deadline`, b9).
   Provider-side idle/HTTP timeouts are adapter *config* (`dsh-llm-deepseek`'s `streamIdleTimeoutMs`, `filesApiTimeoutMs`) — they are not per-request.
3. **Exact abort error type.** The runtime classifies `reason.kind === 'aborted'` from `signal?.aborted || failure.code === 'ABORTED'`, but the *value* of
   `failure.message` for an abort is adapter-owned text (DeepSeek: `"DeepSeek request aborted by caller"`) and is not part of the contract.
   Likewise, what each adapter throws when the caller's signal aborts is adapter-owned (DeepSeek throws `LlmError(…, 'ABORTED')`); the service-level rule is only
   `signal.aborted || code === 'ABORTED' → kind 'aborted'`. Route on `finish.kind` / `failure.code`, never on the message.
4. **`GenerateOptions.messages` immutability for hand-built calls.** The README states loop-built requests arrive deep-frozen and mutation throws; it does not state that
   hand-built requests are re-frozen. `LlmRuntime.adapterStream` defensive-copies only when it must materialize adapter defaults, so mutation after dispatch is unspecified.
   The shipped code deep-freezes its own request before dispatch (b11) — recommend the same.
5. **`ctx.llm.listModels(provider)` for an unregistered provider throws** (`NO_ADAPTER` via `registration()`); I verified the code path in `dsh-llm\lib\index.js` lines 2018–2019
   but did not verify that every adapter's `listModels` resolves rather than rejects for registered-but-unreachable endpoints.
6. **`sessionProjections` availability.** `stateOf(session, 'modelSelection')` returns `undefined` unless `dsh-api-session-controller` (the package that registers the
   `modelSelection` unit) is mounted. I verified the registration (`model-selection-projection.js` lines 42–65) but not which profile bundles always include that package.
7. **`agentDefaultModel` composition `reasoningEffort`.** The README (lines 46) and the `Config` schema (`agent-default-model\lib\index.js` lines 32–35) say `reasoningEffort`
   is deliberately **not** a composition config field, but the live profile patch sets `reasoningEffort: high` under that row
   (`$DSH_HOME\profiles\web\cordis.patch.yml` lines 35–40). Whether the loader rejects or silently drops that unknown key was **not** verified.
   Do not rely on a config-level effort; only the settings section (`AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA`, which does declare `reasoningEffort`) carries one.
8. **`Agent.options` vs. the live selection.** `Agent.options` is the *initial* route passed to `agents.create()`/`resume()`; the docs do not say it tracks later
   `model/selection` changes. I did not verify whether it is re-assigned on selection change — use `session.requestHeader()` / the `modelSelection` projection instead.
9. **Message `source` for a `system` message in a one-shot request.** `createSystemMessage(text, plugin)` exists, but for hand-built one-shot calls I used the
   `GenerateOptions.system` string (documented as "System prompt text for one-shot callers"). Which of the two a caller *should* prefer for auxiliary calls is not specified.
10. **Tool-result messages.** `createToolResultMessage()` exists (b6, `message.d.ts` lines 201–212) but there is no `'tool'` role: tool results are user-role messages whose
    single block is a `tool-result`. Multi-turn tool conversations were not exercised, and the `ToolCallId` branding requirement is only nominal at runtime.
11. **Not read / not verified:** `dsh-llm-pi-ai` wire behavior and its per-profile route/config surface beyond `providerInfo`; `dsh-token-meter`; `@deepseek-ai/dsh-llm-retry`
    runtime wiring; anything about the browser/client half of the LLM service (`ctx.llm` is remote-exposed via `TypertRemoteService`, which these notes do not cover).
