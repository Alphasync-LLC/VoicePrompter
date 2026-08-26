import { GatewaySession, ScriptPatch } from './types';

export class GatewayError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'GatewayError';
    }

    get isUnauthenticated(): boolean {
        return this.status === 401;
    }
}

export interface GatewayScript {
    id: string;
    title: string;
    content: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    googleDocUrl?: string;
    wordCount: number;
    isFavorite: boolean;
    tag?: string;
}

export interface CreateScriptInput {
    title: string;
    content: string;
    googleDocUrl?: string;
    tag?: string;
}
export interface PasswordCredentials {
    username: string;
    password: string;
}


function configuredGatewayUrl(): string | undefined {
    const value = import.meta.env.VITE_SYNC_GATEWAY_URL?.trim();
    return value ? value.replace(/\/$/, '') : undefined;
}

function asGatewayScript(value: unknown): GatewayScript {
    if (!value || typeof value !== 'object') throw new GatewayError('Gateway returned an invalid script');
    const script = value as Partial<GatewayScript>;
    if (
        typeof script.id !== 'string' ||
        typeof script.title !== 'string' ||
        typeof script.content !== 'string' ||
        typeof script.preview !== 'string' ||
        typeof script.createdAt !== 'number' ||
        typeof script.updatedAt !== 'number' ||
        typeof script.wordCount !== 'number' ||
        typeof script.isFavorite !== 'boolean'
    ) {
        throw new GatewayError('Gateway returned an invalid script');
    }
    return script as GatewayScript;
}

async function readResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new GatewayError('Gateway returned invalid JSON', response.status);
    }
}

/** Typed cookie-authenticated client for the private sync gateway. */
export class ScriptGatewayClient {
    readonly baseUrl = configuredGatewayUrl();

    get isConfigured(): boolean {
        return Boolean(this.baseUrl);
    }

    private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        if (!this.baseUrl) throw new GatewayError('Script sync is not configured');
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                credentials: 'include',
                headers: {
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    ...init.headers,
                },
            });
        } catch {
            throw new GatewayError('Script sync is unavailable');
        }

        const body = await readResponse(response);
        if (!response.ok) {
            const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
                ? (body as { error: string }).error
                : `Gateway request failed (${response.status})`;
            throw new GatewayError(message, response.status);
        }
        return body as T;
    }

    async session(): Promise<GatewaySession> {
        const response = await this.request<unknown>('/v1/auth/session');
        if (!response || typeof response !== 'object' || typeof (response as { authenticated?: unknown }).authenticated !== 'boolean') {
            throw new GatewayError('Gateway returned an invalid session');
        }
        return response as GatewaySession;
    }

    async list(): Promise<GatewayScript[]> {
        const response = await this.request<{ scripts?: unknown }>('/v1/scripts');
        if (!Array.isArray(response.scripts)) throw new GatewayError('Gateway returned an invalid script list');
        return response.scripts.map(asGatewayScript);
    }

    async get(remoteId: string): Promise<GatewayScript> {
        const response = await this.request<{ script?: unknown }>(`/v1/scripts/${encodeURIComponent(remoteId)}`);
        return asGatewayScript(response.script);
    }

    async create(input: CreateScriptInput): Promise<GatewayScript> {
        const response = await this.request<{ script?: unknown }>('/v1/scripts', {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return asGatewayScript(response.script);
    }

    async update(remoteId: string, patch: ScriptPatch): Promise<GatewayScript> {
        const response = await this.request<{ script?: unknown }>(`/v1/scripts/${encodeURIComponent(remoteId)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
        return asGatewayScript(response.script);
    }

    async duplicate(remoteId: string): Promise<GatewayScript> {
        const response = await this.request<{ script?: unknown }>(`/v1/scripts/${encodeURIComponent(remoteId)}/duplicate`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        return asGatewayScript(response.script);
    }

    async delete(remoteId: string): Promise<void> {
        await this.request<void>(`/v1/scripts/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
    }

    async signInWithPassword(credentials: PasswordCredentials): Promise<GatewaySession> {
        const response = await this.request<{ user?: GatewaySession['user'] }>('/v1/auth/password', {
            method: 'POST',
            body: JSON.stringify(credentials),
        });
        if (!response.user) throw new GatewayError('Gateway did not return a signed-in user');
        return { authenticated: true, user: response.user };
    }

    async signOut(): Promise<void> {
        await this.request<void>('/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    }
}
