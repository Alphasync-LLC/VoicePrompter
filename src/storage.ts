import { scriptRepository } from './script-repository';
import { HistoryItem, Script, ScriptPatch, ScriptSyncStatus } from './types';

function toHistoryItem(script: Script): HistoryItem {
    return {
        id: script.id,
        text: script.content,
        preview: script.preview,
        date: new Date(script.updatedAt).toLocaleDateString(),
        ...(script.tag ? { tag: script.tag } : {}),
        ...(script.googleDocUrl ? { googleDocUrl: script.googleDocUrl } : {}),
    };
}

/** Loads from the durable local cache immediately and syncs opportunistically. */
export async function loadScripts(): Promise<Script[]> {
    return scriptRepository.load();
}

export async function createScript(content: string, options: Omit<ScriptPatch, 'content'> = {}): Promise<Script> {
    return scriptRepository.create(content, options);
}

export async function getScript(id: string): Promise<Script | undefined> {
    return scriptRepository.get(id);
}

export async function updateScript(id: string, patch: ScriptPatch): Promise<Script | undefined> {
    return scriptRepository.update(id, patch);
}

export async function duplicateScript(id: string): Promise<Script | undefined> {
    return scriptRepository.duplicate(id);
}

export async function deleteScript(id: string): Promise<boolean> {
    return scriptRepository.delete(id);
}

export async function searchScripts(query: string): Promise<Script[]> {
    return scriptRepository.search(query);
}

export async function syncScripts(): Promise<void> {
    return scriptRepository.sync();
}

export function getScriptSyncStatus(): ScriptSyncStatus {
    return scriptRepository.getSyncStatus();
}

/** Backwards-compatible history view for the existing UI while it migrates to Script. */
export async function getHistory(): Promise<HistoryItem[]> {
    return (await loadScripts()).map(toHistoryItem);
}

/** Backwards-compatible local-first save for the existing autosave call site. */
export async function saveToHistory(text: string, googleDocUrl?: string | null, tag?: string): Promise<void> {
    const content = text.trim();
    if (!content) return;
    const existing = (await loadScripts()).find((script) => script.content === content);
    if (existing) {
        await updateScript(existing.id, {
            ...(googleDocUrl ? { googleDocUrl } : {}),
            ...(tag ? { tag } : {}),
        });
        return;
    }
    await createScript(content, {
        ...(googleDocUrl ? { googleDocUrl } : {}),
        ...(tag ? { tag } : {}),
    });
}

/** Clears the local history immediately; authenticated sync removes remote copies later. */
export async function clearAllHistory(): Promise<void> {
    await scriptRepository.clear();
}
