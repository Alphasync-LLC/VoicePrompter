import { GatewayError, GatewayScript, ScriptGatewayClient } from './script-gateway';
import { Script, ScriptPatch, ScriptSyncStatus } from './types';

type StorageKind = ScriptSyncStatus['storage'];

interface CacheState {
    scripts: Script[];
    pendingUpserts: string[];
    pendingDeletes: string[];
    lastSyncedAt?: number;
}

const EMPTY_CACHE: CacheState = { scripts: [], pendingUpserts: [], pendingDeletes: [] };
const DATABASE_NAME = 'voiceprompter-scripts';
const STORE_NAME = 'cache';
const CACHE_KEY = 'scripts-v1';
const FALLBACK_KEY = 'voiceprompter-scripts-v1';
const LEGACY_HISTORY_KEY = 'teleprompter_history';

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function newId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function previewFor(content: string): string {
    const trimmed = content.trim();
    return trimmed.substring(0, 40) + (trimmed.length > 40 ? '...' : '');
}

function wordCountFor(content: string): number {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

function titleFor(content: string): string {
    const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
    return firstLine || 'Untitled script';
}

function scriptFromGateway(script: GatewayScript, id = script.id): Script {
    return {
        id,
        remoteId: script.id,
        title: script.title,
        content: script.content,
        preview: script.preview,
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
        ...(script.googleDocUrl ? { googleDocUrl: script.googleDocUrl } : {}),
        wordCount: script.wordCount,
        isFavorite: script.isFavorite,
        ...(script.tag ? { tag: script.tag } : {}),
    };
}

/** Imports the prior browser history format without deleting its source key. */
function legacyHistoryScripts(): Script[] {
    try {
        const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
        const items: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(items)) return [];
        return items.flatMap((item, index) => {
            if (!item || typeof item !== 'object') return [];
            const record = item as { text?: unknown; preview?: unknown; date?: unknown; googleDocUrl?: unknown; tag?: unknown };
            if (typeof record.text !== 'string' || !record.text.trim()) return [];
            const timestamp = Date.now() - index;
            return [{
                id: newId(),
                title: titleFor(record.text),
                content: record.text,
                preview: typeof record.preview === 'string' ? record.preview : previewFor(record.text),
                createdAt: timestamp,
                updatedAt: timestamp,
                ...(typeof record.googleDocUrl === 'string' ? { googleDocUrl: record.googleDocUrl } : {}),
                wordCount: wordCountFor(record.text),
                isFavorite: false,
                ...(typeof record.tag === 'string' ? { tag: record.tag } : {}),
            }];
        });
    } catch {
        return [];
    }
}

function mergeLegacyHistory(state: CacheState): CacheState {
    const existingContent = new Set(state.scripts.map(script => script.content));
    const recovered = legacyHistoryScripts().filter(script => !existingContent.has(script.content));
    return recovered.length === 0 ? state : { ...state, scripts: [...state.scripts, ...recovered] };
}

/** Durable local cache with IndexedDB first and a constrained browser fallback. */
class ScriptCache {
    private kind: StorageKind = 'memory';
    private database?: IDBDatabase;
    private fallback?: Storage;

    async initialize(): Promise<CacheState> {
        if (typeof indexedDB !== 'undefined') {
            try {
                this.database = await new Promise<IDBDatabase>((resolve, reject) => {
                    const request = indexedDB.open(DATABASE_NAME, 1);
                    request.onupgradeneeded = () => {
                        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                this.kind = 'indexeddb';
                const state = mergeLegacyHistory((await this.readIndexedDb()) ?? clone(EMPTY_CACHE));
                await this.save(state);
                return state;
            } catch {
                this.database?.close();
                this.database = undefined;
            }
        }

        try {
            if (typeof localStorage !== 'undefined') {
                this.fallback = localStorage;
                this.kind = 'localstorage';
                const serialized = this.fallback.getItem(FALLBACK_KEY);
                const state = mergeLegacyHistory(serialized ? this.parse(serialized) : clone(EMPTY_CACHE));
                await this.save(state);
                return state;
            }
        } catch {
            // Privacy modes can deny both IndexedDB and localStorage. Keep an in-memory cache rather than failing the editor.
        }
        return clone(EMPTY_CACHE);
    }

    async save(state: CacheState): Promise<void> {
        const copy = clone(state);
        if (this.database) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const transaction = this.database!.transaction(STORE_NAME, 'readwrite');
                    transaction.objectStore(STORE_NAME).put(copy, CACHE_KEY);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                    transaction.onabort = () => reject(transaction.error);
                });
                return;
            } catch {
                this.database.close();
                this.database = undefined;
                this.enableFallback();
            }
        }
        if (this.fallback) {
            try {
                this.fallback.setItem(FALLBACK_KEY, JSON.stringify(copy));
            } catch {
                this.kind = 'memory';
                this.fallback = undefined;
            }
        }
    }

    storageKind(): StorageKind {
        return this.kind;
    }

    private enableFallback(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                this.fallback = localStorage;
                this.kind = 'localstorage';
            }
        } catch {
            this.kind = 'memory';
        }
    }

    private async readIndexedDb(): Promise<CacheState | undefined> {
        return new Promise<CacheState | undefined>((resolve, reject) => {
            const transaction = this.database!.transaction(STORE_NAME, 'readonly');
            const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY);
            request.onsuccess = () => {
                if (request.result === undefined) resolve(undefined);
                else resolve(this.parse(JSON.stringify(request.result)));
            };
            request.onerror = () => reject(request.error);
        });
    }

    private parse(serialized: string): CacheState {
        try {
            const value: unknown = JSON.parse(serialized);
            if (!value || typeof value !== 'object' || !('scripts' in value) || !Array.isArray(value.scripts)) return clone(EMPTY_CACHE);
            const candidate = value as Partial<CacheState>;
            return {
                scripts: candidate.scripts as Script[],
                pendingUpserts: Array.isArray(candidate.pendingUpserts) ? candidate.pendingUpserts.filter((id): id is string => typeof id === 'string') : [],
                pendingDeletes: Array.isArray(candidate.pendingDeletes) ? candidate.pendingDeletes.filter((id): id is string => typeof id === 'string') : [],
                ...(typeof candidate.lastSyncedAt === 'number' ? { lastSyncedAt: candidate.lastSyncedAt } : {}),
            };
        } catch {
            return clone(EMPTY_CACHE);
        }
    }
}

/** Local-first script repository. Mutations are durable before any network request. */
export class ScriptRepository {
    private readonly cache = new ScriptCache();
    private readonly gateway = new ScriptGatewayClient();
    private readonly ready: Promise<void>;
    private state: CacheState = clone(EMPTY_CACHE);
    private syncStatus: ScriptSyncStatus = { state: 'unavailable', pendingChanges: 0, storage: 'memory' };
    private syncing?: Promise<void>;

    constructor() {
        this.ready = this.initialize();
    }

    async load(): Promise<Script[]> {
        await this.ready;
        void this.sync();
        return this.sortedScripts();
    }

    async create(content: string, options: Omit<ScriptPatch, 'content'> = {}): Promise<Script> {
        await this.ready;
        const now = Date.now();
        const script: Script = {
            id: newId(),
            title: options.title ?? titleFor(content),
            content,
            preview: previewFor(content),
            createdAt: now,
            updatedAt: now,
            ...(options.googleDocUrl ? { googleDocUrl: options.googleDocUrl } : {}),
            wordCount: wordCountFor(content),
            isFavorite: options.isFavorite ?? false,
            ...(options.tag ? { tag: options.tag } : {}),
        };
        this.state.scripts.push(script);
        this.queueUpsert(script.id);
        await this.persist();
        void this.sync();
        return clone(script);
    }

    async get(id: string): Promise<Script | undefined> {
        await this.ready;
        const script = this.state.scripts.find((item) => item.id === id);
        return script ? clone(script) : undefined;
    }

    async update(id: string, patch: ScriptPatch): Promise<Script | undefined> {
        await this.ready;
        const script = this.state.scripts.find((item) => item.id === id);
        if (!script) return undefined;
        Object.assign(script, patch, { updatedAt: Date.now() });
        if (patch.content !== undefined) {
            script.preview = previewFor(script.content);
            script.wordCount = wordCountFor(script.content);
        }
        this.queueUpsert(id);
        await this.persist();
        void this.sync();
        return clone(script);
    }

    async duplicate(id: string): Promise<Script | undefined> {
        await this.ready;
        const source = this.state.scripts.find((item) => item.id === id);
        if (!source) return undefined;
        return this.create(source.content, {
            title: `${source.title} (copy)`,
            googleDocUrl: source.googleDocUrl,
            tag: source.tag,
            isFavorite: source.isFavorite,
        });
    }

    async delete(id: string): Promise<boolean> {
        await this.ready;
        const index = this.state.scripts.findIndex((item) => item.id === id);
        if (index === -1) return false;
        const [script] = this.state.scripts.splice(index, 1);
        this.state.pendingUpserts = this.state.pendingUpserts.filter((pendingId) => pendingId !== id);
        if (script.remoteId && !this.state.pendingDeletes.includes(script.remoteId)) this.state.pendingDeletes.push(script.remoteId);
        await this.persist();
        void this.sync();
        return true;
    }

    async search(query: string): Promise<Script[]> {
        await this.ready;
        const normalized = query.trim().toLocaleLowerCase();
        if (!normalized) return this.sortedScripts();
        return this.sortedScripts().filter((script) =>
            `${script.title}\n${script.content}\n${script.tag ?? ''}`.toLocaleLowerCase().includes(normalized),
        );
    }

    async clear(): Promise<void> {
        await this.ready;
        const remoteIds = this.state.scripts.flatMap((script) => script.remoteId ? [script.remoteId] : []);
        this.state = {
            scripts: [],
            pendingUpserts: [],
            pendingDeletes: [...new Set([...this.state.pendingDeletes, ...remoteIds])],
            ...(this.state.lastSyncedAt ? { lastSyncedAt: this.state.lastSyncedAt } : {}),
        };
        await this.persist();
        void this.sync();
    }

    getSyncStatus(): ScriptSyncStatus {
        return { ...this.syncStatus, pendingChanges: this.pendingChangeCount(), storage: this.cache.storageKind() };
    }

    async sync(): Promise<void> {
        await this.ready;
        if (this.syncing) return this.syncing;
        this.syncing = this.syncOnce().finally(() => { this.syncing = undefined; });
        return this.syncing;
    }

    private async initialize(): Promise<void> {
        this.state = await this.cache.initialize();
        const queued = new Set(this.state.pendingUpserts);
        for (const script of this.state.scripts) {
            if (!script.remoteId) queued.add(script.id);
        }
        this.state.pendingUpserts = [...queued];
        await this.persist();
        this.syncStatus = {
            state: this.gateway.isConfigured ? 'offline' : 'unavailable',
            pendingChanges: this.pendingChangeCount(),
            storage: this.cache.storageKind(),
            ...(this.state.lastSyncedAt ? { lastSyncedAt: this.state.lastSyncedAt } : {}),
        };
    }

    private async syncOnce(): Promise<void> {
        if (!this.gateway.isConfigured) {
            this.syncStatus = { ...this.getSyncStatus(), state: 'unavailable' };
            return;
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.syncStatus = { ...this.getSyncStatus(), state: 'offline' };
            return;
        }
        try {
            const session = await this.gateway.session();
            if (!session.authenticated) {
                this.syncStatus = { ...this.getSyncStatus(), state: 'unauthenticated' };
                return;
            }
            for (const remoteId of [...this.state.pendingDeletes]) {
                await this.gateway.delete(remoteId);
                this.state.pendingDeletes = this.state.pendingDeletes.filter((id) => id !== remoteId);
            }
            for (const id of [...this.state.pendingUpserts]) {
                const script = this.state.scripts.find((item) => item.id === id);
                if (!script) continue;
                const remote = script.remoteId
                    ? await this.gateway.update(script.remoteId, this.gatewayPatch(script))
                    : await this.gateway.create(this.gatewayCreate(script));
                Object.assign(script, scriptFromGateway(remote, script.id));
                this.state.pendingUpserts = this.state.pendingUpserts.filter((pendingId) => pendingId !== id);
            }
            const remoteScripts = await this.gateway.list();
            const localRemoteIds = new Set(this.state.scripts.map((script) => script.remoteId).filter((id): id is string => Boolean(id)));
            for (const remote of remoteScripts) {
                if (!localRemoteIds.has(remote.id)) this.state.scripts.push(scriptFromGateway(remote));
            }
            this.state.lastSyncedAt = Date.now();
            await this.persist();
            this.syncStatus = { ...this.getSyncStatus(), state: 'synced', lastSyncedAt: this.state.lastSyncedAt };
        } catch (error) {
            const gatewayError = error instanceof GatewayError ? error : new GatewayError('Script sync failed');
            this.syncStatus = {
                ...this.getSyncStatus(),
                state: gatewayError.isUnauthenticated ? 'unauthenticated' : 'offline',
                error: gatewayError.message,
            };
        }
    }

    private gatewayCreate(script: Script): { title: string; content: string; googleDocUrl?: string; tag?: string } {
        return {
            title: script.title,
            content: script.content,
            ...(script.googleDocUrl ? { googleDocUrl: script.googleDocUrl } : {}),
            ...(script.tag ? { tag: script.tag } : {}),
        };
    }

    private gatewayPatch(script: Script): ScriptPatch {
        return {
            title: script.title,
            content: script.content,
            ...(script.googleDocUrl ? { googleDocUrl: script.googleDocUrl } : {}),
            ...(script.tag ? { tag: script.tag } : {}),
            isFavorite: script.isFavorite,
        };
    }

    private queueUpsert(id: string): void {
        if (!this.state.pendingUpserts.includes(id)) this.state.pendingUpserts.push(id);
    }

    private pendingChangeCount(): number {
        return this.state.pendingUpserts.length + this.state.pendingDeletes.length;
    }

    private async persist(): Promise<void> {
        await this.cache.save(this.state);
        this.syncStatus = { ...this.syncStatus, pendingChanges: this.pendingChangeCount(), storage: this.cache.storageKind() };
    }

    private sortedScripts(): Script[] {
        return clone(this.state.scripts).sort((left, right) => right.updatedAt - left.updatedAt);
    }
}

export const scriptRepository = new ScriptRepository();
