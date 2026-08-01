import { HistoryItem } from './types';

const HISTORY_KEY = 'teleprompter_history';

export function getHistory(): HistoryItem[] {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

export function saveToHistory(text: string, googleDocUrl?: string | null): void {
    let history = getHistory();
    if (history.length > 0 && history[0].text === text) return;

    const item: HistoryItem = {
        id: Date.now(),
        text: text,
        preview: text.substring(0, 40) + (text.length > 40 ? '...' : ''),
        date: new Date().toLocaleDateString(),
        ...(googleDocUrl ? { googleDocUrl } : {})
    };

    history.unshift(item);
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            // Remove oldest item and retry
            history.pop();
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            } catch (e2) {
                console.error('Failed to save history after quota cleanup:', e2);
            }
        }
    }
}

export function clearAllHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
}
