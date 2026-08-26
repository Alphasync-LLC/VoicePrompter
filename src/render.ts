import { els } from './elements';
import { state } from './state';
import { HistoryItem, Script, ScriptWord, ScrollingMode } from './types';

export interface SessionProgressInput {
    words: ReadonlyArray<Pick<ScriptWord, 'skip'>>;
    currentIndex: number;
    mode: ScrollingMode;
    speed: number;
}

export interface SessionProgress {
    completedSpeakableWords: number;
    totalSpeakableWords: number;
    remainingSpeakableWords: number;
    percentComplete: number;
    progressText: string;
    remainingTimeText: string;
}

function formatDuration(seconds: number): string {
    const roundedSeconds = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(roundedSeconds / 60);
    const remainingSeconds = roundedSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/** Derives HUD content without treating skipped cues or paragraph markers as spoken words. */
export function deriveSessionProgress({ words, currentIndex, mode, speed }: SessionProgressInput): SessionProgress {
    const boundedIndex = Number.isFinite(currentIndex)
        ? Math.max(0, Math.min(Math.trunc(currentIndex), words.length))
        : 0;
    let completedSpeakableWords = 0;
    let totalSpeakableWords = 0;

    for (let index = 0; index < words.length; index++) {
        if (words[index].skip) continue;

        totalSpeakableWords++;
        if (index < boundedIndex) completedSpeakableWords++;
    }

    const remainingSpeakableWords = totalSpeakableWords - completedSpeakableWords;
    const percentComplete = totalSpeakableWords === 0
        ? 0
        : (completedSpeakableWords / totalSpeakableWords) * 100;
    const progressText = totalSpeakableWords === 0
        ? 'No speakable words'
        : `${completedSpeakableWords} of ${totalSpeakableWords} words`;
    const remainingTimeText = mode === 'voice'
        ? 'Time remaining unavailable in voice mode'
        : speed > 0 && Number.isFinite(speed)
            ? `Time remaining: ${formatDuration(remainingSpeakableWords / speed)}`
            : 'Time remaining unavailable until a speed is set';

    return {
        completedSpeakableWords,
        totalSpeakableWords,
        remainingSpeakableWords,
        percentComplete,
        progressText,
        remainingTimeText
    };
}

/** Updates the passive HUD. Callers may pass state-like data for deterministic rendering. */
export function updateSessionHud(input: SessionProgressInput = {
    words: state.scriptWords,
    currentIndex: state.currentIndex,
    mode: state.config.scrollingMode,
    speed: state.config.scrollSpeed
}): SessionProgress {
    const progress = deriveSessionProgress(input);
    els.sessionProgress.textContent = progress.progressText;
    els.sessionProgress.setAttribute('aria-label', `Script progress: ${progress.progressText}`);
    els.remainingTime.textContent = progress.remainingTimeText;
    els.remainingTime.setAttribute('aria-label', progress.remainingTimeText);
    return progress;
}

export function renderScript(): void {
    els.scriptContent.innerHTML = '';
    state.scriptWords.forEach((obj, index) => {
        const span = document.createElement('span');
        span.textContent = obj.word;
        span.id = `word-${index}`;

        // Apply Classes
        let classList = "script-word transition-opacity duration-300 ";

        if (obj.isStop) {
            classList += "stop-marker ";
        } else if (obj.isBreak) {
            classList += "line-break ";
            span.style.display = 'block';
            span.style.width = '100%';
        } else if (obj.skip) {
            classList += "skipped-word ";
        } else {
            classList += "text-future ";
        }
        span.className = classList;

        // TAP TO ACTIVATE Logic
        span.onclick = () => {
            if (!obj.skip) {
                state.currentIndex = index;
                updateHighlight();
                scrollToCurrent();
            }
        };

        els.scriptContent.appendChild(span);
        obj.element = span;
    });

    // Apply current visibility setting
    if (state.config.showStopIcon) {
        els.scriptContent.classList.add('show-stops');
    } else {
        els.scriptContent.classList.remove('show-stops');
    }

    els.setupScreen.classList.add('hidden');
    els.prompterContainer.classList.remove('hidden');

    // Toggle Google Docs Sync panel
    if (state.googleDocUrl) {
        els.refreshGoogleDocContainer.classList.remove('hidden');
    } else {
        els.refreshGoogleDocContainer.classList.add('hidden');
    }

    state.currentIndex = 0;
    advancePastSkipped();
    updateHighlight();
    
    setTimeout(() => {
        scrollToCurrent();
    }, 50);
}

export function updateHighlight(): void {
    state.scriptWords.forEach((obj, idx) => {
        if (obj.skip) return;

        if (idx < state.currentIndex) {
            // Past words
            if (obj.element) {
                obj.element.classList.remove('current-word', 'text-future');
                obj.element.classList.add('text-neutral-500'); // Dimmed
            }
        } else if (idx === state.currentIndex) {
            // Current word
            if (obj.element) {
                obj.element.classList.remove('text-neutral-500', 'text-future');
                obj.element.classList.add('current-word');
            }
        } else {
            // Future words
            if (obj.element) {
                obj.element.classList.remove('current-word', 'text-neutral-500');
                obj.element.classList.add('text-future');
            }
        }
    });
    updateSessionHud();
}

export function scrollToCurrent(): void {
    if (state.currentIndex < state.scriptWords.length) {
        const currentWordObj = state.scriptWords[state.currentIndex];
        if (currentWordObj && currentWordObj.element) {
            const containerHeight = els.scrollContainer.clientHeight;
            // Position based on user setting (percentage from top)
            const positionRatio = state.config.activeLinePosition / 100;
            const targetPosition = currentWordObj.element.offsetTop - (containerHeight * positionRatio);

            if (state.config.smoothAnimations) {
                smoothScrollTo(els.scrollContainer, targetPosition, 600);
            } else {
                els.scrollContainer.scrollTo({
                    top: targetPosition,
                    behavior: 'auto'
                });
            }
        }
    }
}

function smoothScrollTo(element: HTMLElement, target: number, duration: number): void {
    const start = element.scrollTop;
    const change = target - start;
    const startTime = performance.now();

    function animateScroll(currentTime: number) {
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);

        // EaseInOutQuad
        const ease = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        element.scrollTop = start + change * ease;

        if (timeElapsed < duration) {
            requestAnimationFrame(animateScroll);
        }
    }

    requestAnimationFrame(animateScroll);
}

export function advancePastSkipped(): void {
    while (state.currentIndex < state.scriptWords.length && state.scriptWords[state.currentIndex].skip) {
        state.currentIndex++;
    }
}

export function restartScript(): void {
    state.currentIndex = 0;
    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}

export function navigateParagraphs(direction: 'back' | 'forward', paragraphCount: number): void {
    if (state.scriptWords.length === 0) return;

    // Find all paragraph boundary indices (words representing line breaks/stops)
    // Merge consecutive breaks into a single boundary
    const paragraphEnds: number[] = [];
    let lastWasBreak = false;
    state.scriptWords.forEach((w, i) => {
        if (w.isStop || w.isBreak) {
            if (!lastWasBreak) {
                paragraphEnds.push(i);
                lastWasBreak = true;
            } else {
                // Update to the last break in the sequence
                paragraphEnds[paragraphEnds.length - 1] = i;
            }
        } else if (!w.skip) {
            lastWasBreak = false;
        }
    });

    // If there are no explicit paragraph breaks, fallback to sentence boundaries
    if (paragraphEnds.length === 0) {
        state.scriptWords.forEach((w, i) => {
            if (!w.skip && /[.!?]$/.test(w.word)) {
                paragraphEnds.push(i);
            }
        });
    }

    if (direction === 'back') {
        // Find how many paragraph boundaries are before currentIndex
        let target = 0;
        let boundariesBefore = 0;
        for (let i = paragraphEnds.length - 1; i >= 0; i--) {
            if (paragraphEnds[i] < state.currentIndex) {
                boundariesBefore++;
                if (boundariesBefore >= paragraphCount) {
                    // Go to the word AFTER the previous paragraph end (start of that paragraph)
                    target = i > 0 ? paragraphEnds[i - 1] + 1 : 0;
                    break;
                }
            }
        }
        if (boundariesBefore < paragraphCount) {
            target = 0; // Go to the very beginning
        }
        state.currentIndex = target;
    } else {
        // Forward: skip ahead by paragraphCount paragraph endings
        let boundariesAfter = 0;
        let target = state.scriptWords.length - 1;
        for (let i = 0; i < paragraphEnds.length; i++) {
            if (paragraphEnds[i] >= state.currentIndex) {
                boundariesAfter++;
                if (boundariesAfter >= paragraphCount) {
                    target = paragraphEnds[i] + 1;
                    break;
                }
            }
        }
        state.currentIndex = Math.min(target, state.scriptWords.length - 1);
    }

    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}

export function applySettings(): void {
    els.appBody.style.backgroundColor = state.config.bgColor;
    els.appBody.style.color = state.config.textColor;
    els.appBody.style.setProperty('--base-color', state.config.textColor);

    // Apply background to prompter container for theme support
    els.prompterContainer.style.backgroundColor = state.config.bgColor;
    if (!(state.isVideoMode && state.videoLayoutMode === 'overlay')) {
        els.scrollContainer.style.backgroundColor = state.config.bgColor;
    }

    els.scriptContent.style.setProperty('--paragraph-spacing', `${state.config.paragraphSpacing}em`);
    els.scriptContent.style.lineHeight = `${state.config.lineHeight}`;
    els.scriptContent.style.textAlign = state.config.textAlign;
    els.scriptContent.style.direction = state.config.textDirection;

    if (state.config.smoothAnimations) {
        els.scriptContent.classList.add('smooth-animations');
    } else {
        els.scriptContent.classList.remove('smooth-animations');
    }

    if (state.config.highlightActiveWord) {
        els.scriptContent.classList.add('highlight-active-word');
    } else {
        els.scriptContent.classList.remove('highlight-active-word');
    }

    // Apply font family to script content
    const fontMap: Record<string, string> = {
        mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif',
        serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
        comicSans: '"Comic Sans MS", "Chalkboard SE", "Trebuchet MS", cursive',
        openDyslexic: '"OpenDyslexic", cursive'
    };
    const fontStack = fontMap[state.config.fontFamily] ?? fontMap['mono'];
    els.scriptContent.style.fontFamily = fontStack;
}

export function updateMicUI(isListening: boolean): void {
    const isVoice = state.config.scrollingMode === 'voice';
    const pathEl = els.micButton.querySelector('path');
    
    if (isListening) {
        els.micButton.classList.remove('bg-neutral-800', 'hover:bg-neutral-700');
        els.micButton.classList.add('bg-red-600', 'hover:bg-red-700', 'animate-pulse');
        els.micIcon.classList.add('text-white');
        
        els.statusIndicator.textContent = isVoice ? "Listening..." : "Scrolling...";
        els.statusIndicator.classList.remove('text-neutral-500');
        els.statusIndicator.classList.add('text-red-500');
        
        if (pathEl) {
            if (isVoice) {
                pathEl.setAttribute('d', 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z');
            } else {
                // Pause icon
                pathEl.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
            }
        }
    } else {
        els.micButton.classList.add('bg-neutral-800', 'hover:bg-neutral-700');
        els.micButton.classList.remove('bg-red-600', 'hover:bg-red-700', 'animate-pulse');
        els.micIcon.classList.remove('text-white');
        
        els.statusIndicator.textContent = isVoice ? "Tap mic to start" : "Tap play to start";
        els.statusIndicator.classList.add('text-neutral-500');
        els.statusIndicator.classList.remove('text-red-500');
        
        if (pathEl) {
            if (isVoice) {
                pathEl.setAttribute('d', 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z');
            } else {
                // Play icon
                pathEl.setAttribute('d', 'M8 5v14l11-7z');
            }
        }
    }
}

export type ScriptLibraryItem = Pick<Script, 'id' | 'title' | 'content' | 'preview' | 'updatedAt' | 'wordCount' | 'isFavorite' | 'tag' | 'googleDocUrl'>;

export interface ScriptLibraryCallbacks {
    onOpen?: (script: ScriptLibraryItem) => void;
    onRename?: (script: ScriptLibraryItem) => void;
    onDuplicate?: (script: ScriptLibraryItem) => void;
    onDelete?: (script: ScriptLibraryItem) => void;
    onSignIn?: () => void;
    syncStatus?: string;
}

function libraryButton(label: string, className: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}


function updatedLabel(updatedAt: number): string {
    const date = new Date(updatedAt);
    return Number.isNaN(date.getTime())
        ? 'Updated recently'
        : `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)}`;
}

/** Renders local or synced stable script entities without interpolating user content as HTML. */
export function renderScriptLibrary(items: readonly ScriptLibraryItem[], callbacks: ScriptLibraryCallbacks = {}): void {
    const query = els.scriptLibrarySearch.value.trim().toLocaleLowerCase();
    const scripts = items.filter(script => {
        if (!query) return true;
        const preview = script.preview || script.content.replace(/\s+/g, ' ').trim() || 'Empty script';
        return [script.title, preview, script.tag ?? '', script.content]
            .some(value => value.toLocaleLowerCase().includes(query));
    });

    els.scriptLibrarySyncStatus.textContent = callbacks.syncStatus ?? 'Saved on this device. Sign in to sync your scripts.';
    els.scriptLibrarySignInBtn.onclick = callbacks.onSignIn ?? null;
    els.scriptLibraryList.replaceChildren();

    if (scripts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'col-span-full rounded-lg border border-dashed border-neutral-700 px-4 py-8 text-center text-sm text-neutral-500';
        empty.textContent = items.length === 0 ? 'No scripts yet. Your saved scripts will appear here.' : 'No scripts match your search.';
        els.scriptLibraryList.appendChild(empty);
    } else {
        for (const script of scripts) {
            const card = document.createElement('article');
            card.className = 'flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-sm transition hover:border-[#FFBB00]/70';

            const heading = document.createElement('h4');
            heading.className = 'min-w-0 truncate text-sm font-semibold text-white';
            heading.textContent = script.title || 'Untitled script';
            card.appendChild(heading);

            const preview = document.createElement('p');
            preview.className = 'line-clamp-2 text-sm leading-relaxed text-neutral-400';
            preview.textContent = script.preview || script.content.replace(/\s+/g, ' ').trim() || 'Empty script';
            card.appendChild(preview);

            const metadata = document.createElement('div');
            metadata.className = 'flex flex-wrap items-center gap-2 text-xs text-neutral-500';
            const words = document.createElement('span');
            words.textContent = `${script.wordCount} ${script.wordCount === 1 ? 'word' : 'words'}`;
            metadata.appendChild(words);
            const updated = document.createElement('span');
            updated.textContent = updatedLabel(script.updatedAt);
            metadata.appendChild(updated);
            if (script.isFavorite) {
                const favorite = document.createElement('span');
                favorite.className = 'font-medium text-[#FFBB00]';
                favorite.setAttribute('aria-label', 'Favorite script');
                favorite.textContent = '★ Favorite';
                metadata.appendChild(favorite);
            }
            if (script.tag) {
                const tag = document.createElement('span');
                tag.className = 'rounded-full bg-[#FFBB00]/10 px-2 py-0.5 font-medium text-[#FFBB00]';
                tag.textContent = script.tag;
                metadata.appendChild(tag);
            }
            card.appendChild(metadata);

            const actions = document.createElement('div');
            actions.className = 'flex flex-wrap gap-2 border-t border-neutral-800 pt-3';
            const actionClass = 'rounded px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[#FFBB00]/70';
            actions.appendChild(libraryButton('Open', `${actionClass} bg-[#FFBB00] text-neutral-900 hover:bg-[#FFD54F]`, () => callbacks.onOpen?.(script)));
            actions.appendChild(libraryButton('Rename', `${actionClass} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`, () => callbacks.onRename?.(script)));
            actions.appendChild(libraryButton('Duplicate', `${actionClass} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`, () => callbacks.onDuplicate?.(script)));
            actions.appendChild(libraryButton('Delete', `${actionClass} bg-red-500/10 text-red-300 hover:bg-red-500/20`, () => callbacks.onDelete?.(script)));
            card.appendChild(actions);
            els.scriptLibraryList.appendChild(card);
        }
    }

    els.scriptLibrarySearch.oninput = () => renderScriptLibrary(items, callbacks);
}

/** Renders legacy history as simple quick-open shortcuts below the Script Library. */
export function renderHistoryList(history: HistoryItem[], onLoad: (text: string, googleDocUrl?: string | null) => void): void {
    els.historyList.replaceChildren();

    if (history.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'col-span-full rounded-lg border border-dashed border-neutral-800 px-4 py-5 text-center text-sm text-neutral-500';
        empty.textContent = 'Recently opened scripts will appear here.';
        els.historyList.appendChild(empty);
        return;
    }

    for (const item of history) {
        const shortcut = document.createElement('button');
        shortcut.type = 'button';
        shortcut.className = 'min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-left transition hover:border-[#FFBB00]/70 focus:outline-none focus:ring-2 focus:ring-[#FFBB00]/70';
        shortcut.setAttribute('aria-label', `Open recent script: ${item.preview || 'Untitled script'}`);
        shortcut.addEventListener('click', () => onLoad(item.text, item.googleDocUrl ?? null));

        const title = document.createElement('span');
        title.className = 'block truncate text-sm font-medium text-white';
        title.textContent = item.preview || 'Untitled script';
        shortcut.appendChild(title);

        const preview = document.createElement('span');
        preview.className = 'mt-1 block line-clamp-2 text-xs leading-relaxed text-neutral-500';
        preview.textContent = item.text.replace(/\s+/g, ' ').trim() || 'Empty script';
        shortcut.appendChild(preview);

        els.historyList.appendChild(shortcut);
    }
}
