import { GatewayError, ScriptGatewayClient } from './script-gateway';
import { GatewaySession } from './types';

/** Completes password sign-in with the gateway without retaining the credential in the browser. */
export async function signInWithPassword(username: string, password: string): Promise<GatewaySession> {
    return new ScriptGatewayClient().signInWithPassword({ username, password });
}

/**
 * Renders the private username/password sign-in control.
 * The export name remains temporarily compatible with the existing application bootstrap.
 */
export async function renderGoogleSignIn(
    container: HTMLElement,
    onSession: (session: GatewaySession) => void,
    onError?: (error: Error) => void,
): Promise<boolean> {
    const form = document.createElement('form');
    form.className = 'flex flex-col gap-2 sm:flex-row sm:items-end';

    const usernameField = document.createElement('div');
    usernameField.className = 'flex flex-col gap-1';
    const usernameLabel = document.createElement('label');
    usernameLabel.htmlFor = 'syncUsername';
    usernameLabel.className = 'text-xs text-neutral-400';
    usernameLabel.textContent = 'Username';
    const username = document.createElement('input');
    username.id = usernameLabel.htmlFor;
    username.name = 'username';
    username.type = 'text';
    username.autocomplete = 'username';
    username.required = true;
    username.className = 'rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white outline-none transition focus:border-[#FFBB00] focus:ring-2 focus:ring-[#FFBB00]/30';
    usernameField.append(usernameLabel, username);

    const passwordField = document.createElement('div');
    passwordField.className = 'flex flex-col gap-1';
    const passwordLabel = document.createElement('label');
    passwordLabel.htmlFor = 'syncPassword';
    passwordLabel.className = 'text-xs text-neutral-400';
    passwordLabel.textContent = 'Password';
    const password = document.createElement('input');
    password.id = passwordLabel.htmlFor;
    password.name = 'password';
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    password.className = 'rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white outline-none transition focus:border-[#FFBB00] focus:ring-2 focus:ring-[#FFBB00]/30';
    passwordField.append(passwordLabel, password);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'rounded bg-[#FFBB00] px-3 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-[#FFD54F] disabled:cursor-wait disabled:opacity-70';
    submit.textContent = 'Sign in';
    form.append(usernameField, passwordField, submit);
    container.replaceChildren(form);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;

        submit.disabled = true;
        void signInWithPassword(username.value, password.value)
            .then(onSession)
            .catch((error: unknown) => {
                password.value = '';
                onError?.(error instanceof Error ? error : new GatewayError('Password sign-in failed'));
            })
            .finally(() => {
                submit.disabled = false;
            });
    });

    username.focus();
    return true;
}
