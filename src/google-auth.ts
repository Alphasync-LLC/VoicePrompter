import { GatewayError, ScriptGatewayClient } from './script-gateway';
import { GatewaySession } from './types';

interface GoogleCredentialResponse {
    credential?: string;
}

interface GoogleIdentityApi {
    initialize(configuration: { client_id: string; auto_select?: boolean; callback: (response: GoogleCredentialResponse) => void }): void;
    renderButton(parent: HTMLElement, options: Record<string, string | number | boolean>): void;
    prompt(): void;
}

declare global {
    interface Window {
        google?: { accounts?: { id?: GoogleIdentityApi } };
    }
}

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
let loader: Promise<GoogleIdentityApi> | undefined;

function clientId(): string | undefined {
    const value = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
    return value || undefined;
}

async function googleIdentity(): Promise<GoogleIdentityApi> {
    if (loader) return loader;
    loader = new Promise<GoogleIdentityApi>((resolve, reject) => {
        const existing = window.google?.accounts?.id;
        if (existing) {
            resolve(existing);
            return;
        }
        const script = document.createElement('script');
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.onload = () => {
            const identity = window.google?.accounts?.id;
            if (identity) resolve(identity);
            else reject(new Error('Google Identity Services did not load'));
        };
        script.onerror = () => reject(new Error('Google Identity Services is unavailable'));
        document.head.appendChild(script);
    });
    try {
        return await loader;
    } catch (error) {
        loader = undefined;
        throw error;
    }
}

/** Completes Google sign-in with the gateway; the browser only ever receives a public client ID. */
export async function signInWithGoogleCredential(idToken: string): Promise<GatewaySession> {
    return new ScriptGatewayClient().signInWithGoogle(idToken);
}

/**
 * Renders the Google-provided sign-in control when its public client ID is configured.
 * It returns false instead of throwing for missing configuration or an unavailable GIS script.
 */
export async function renderGoogleSignIn(
    container: HTMLElement,
    onSession: (session: GatewaySession) => void,
    onError?: (error: Error) => void,
): Promise<boolean> {
    const configuredClientId = clientId();
    if (!configuredClientId) return false;
    try {
        const identity = await googleIdentity();
        identity.initialize({
            client_id: configuredClientId,
            auto_select: false,
            callback: (response) => {
                if (!response.credential) {
                    onError?.(new Error('Google did not return an identity credential'));
                    return;
                }
                void signInWithGoogleCredential(response.credential).then(onSession).catch((error: unknown) => {
                    onError?.(error instanceof Error ? error : new GatewayError('Google sign-in failed'));
                });
            },
        });
        identity.renderButton(container, { theme: 'outline', size: 'large', type: 'standard' });
        return true;
    } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Google Identity Services is unavailable'));
        return false;
    }
}

/** Requests the GIS one-tap prompt when available without swallowing its credential. */
export async function promptGoogleSignIn(
    onSession: (session: GatewaySession) => void,
    onError?: (error: Error) => void,
): Promise<boolean> {
    const configuredClientId = clientId();
    if (!configuredClientId) return false;
    try {
        const identity = await googleIdentity();
        identity.initialize({
            client_id: configuredClientId,
            auto_select: false,
            callback: (response) => {
                if (!response.credential) {
                    onError?.(new Error('Google did not return an identity credential'));
                    return;
                }
                void signInWithGoogleCredential(response.credential).then(onSession).catch((error: unknown) => {
                    onError?.(error instanceof Error ? error : new GatewayError('Google sign-in failed'));
                });
            },
        });
        identity.prompt();
        return true;
    } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Google Identity Services is unavailable'));
        return false;
    }
}
