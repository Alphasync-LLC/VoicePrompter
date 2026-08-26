export interface MatchableScriptToken {
    clean: string;
    skip: boolean;
}

export interface OrderedMatchOptions {
    forwardWindow?: number;
    backwardWindow?: number;
    transcriptWindow?: number;
    minEvidenceForMovement?: number;
    minEvidenceForBackwardCorrection?: number;
}

const MAX_FORWARD_WINDOW = 10;
const MAX_BACKWARD_WINDOW = 4;
const MAX_TRANSCRIPT_TOKENS = 5;

export const DEFAULT_ORDERED_MATCH_OPTIONS: Required<OrderedMatchOptions> = {
    forwardWindow: MAX_FORWARD_WINDOW,
    backwardWindow: MAX_BACKWARD_WINDOW,
    transcriptWindow: MAX_TRANSCRIPT_TOKENS,
    minEvidenceForMovement: 2,
    minEvidenceForBackwardCorrection: 3,
};

/** Removes punctuation and case distinctions so speech and script tokens compare consistently. */
export function normalizeToken(token: string): string {
    return token.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(0, Math.floor(value!)));
}

/**
 * Returns the script index whose token ends the strongest ordered evidence sequence.
 * The bounded dynamic-programming pass is O(window × recent transcript tokens).
 */
export function findOrderedMatchIndex(
    scriptTokens: readonly MatchableScriptToken[],
    currentIndex: number,
    spokenTokens: readonly string[],
    options: OrderedMatchOptions = {},
): number | null {
    if (scriptTokens.length === 0 || currentIndex < 0 || currentIndex >= scriptTokens.length) {
        return null;
    }

    const forwardWindow = boundedInteger(
        options.forwardWindow,
        DEFAULT_ORDERED_MATCH_OPTIONS.forwardWindow,
        MAX_FORWARD_WINDOW,
    );
    const backwardWindow = boundedInteger(
        options.backwardWindow,
        DEFAULT_ORDERED_MATCH_OPTIONS.backwardWindow,
        MAX_BACKWARD_WINDOW,
    );
    const transcriptWindow = boundedInteger(
        options.transcriptWindow,
        DEFAULT_ORDERED_MATCH_OPTIONS.transcriptWindow,
        MAX_TRANSCRIPT_TOKENS,
    );
    const minEvidenceForMovement = Math.max(
        1,
        boundedInteger(
            options.minEvidenceForMovement,
            DEFAULT_ORDERED_MATCH_OPTIONS.minEvidenceForMovement,
            MAX_TRANSCRIPT_TOKENS,
        ),
    );
    const minEvidenceForBackwardCorrection = Math.max(
        minEvidenceForMovement,
        boundedInteger(
            options.minEvidenceForBackwardCorrection,
            DEFAULT_ORDERED_MATCH_OPTIONS.minEvidenceForBackwardCorrection,
            MAX_TRANSCRIPT_TOKENS,
        ),
    );
    const normalizedSpoken = spokenTokens
        .slice(-transcriptWindow)
        .map(normalizeToken)
        .filter(Boolean);

    if (normalizedSpoken.length === 0) return null;

    const startIndex = Math.max(0, currentIndex - backwardWindow);
    const endIndex = Math.min(scriptTokens.length, currentIndex + forwardWindow + 1);
    const bestEvidenceByTranscriptToken = new Array<number>(normalizedSpoken.length).fill(0);
    const evidenceEndingHere = new Array<number>(normalizedSpoken.length).fill(0);
    let selectedIndex: number | null = null;
    let selectedEvidence = 0;
    let selectedDistance = Number.POSITIVE_INFINITY;

    for (let scriptIndex = startIndex; scriptIndex < endIndex; scriptIndex++) {
        const scriptToken = scriptTokens[scriptIndex];
        if (scriptToken.skip) continue;

        const cleanScriptToken = normalizeToken(scriptToken.clean);
        if (!cleanScriptToken) continue;

        evidenceEndingHere.fill(0);
        let bestEarlierTranscriptEvidence = 0;
        let candidateEvidence = 0;

        for (let transcriptIndex = 0; transcriptIndex < normalizedSpoken.length; transcriptIndex++) {
            if (cleanScriptToken === normalizedSpoken[transcriptIndex]) {
                const evidence = bestEarlierTranscriptEvidence + 1;
                evidenceEndingHere[transcriptIndex] = evidence;
                candidateEvidence = Math.max(candidateEvidence, evidence);
            }
            bestEarlierTranscriptEvidence = Math.max(
                bestEarlierTranscriptEvidence,
                bestEvidenceByTranscriptToken[transcriptIndex],
            );
        }

        for (let transcriptIndex = 0; transcriptIndex < normalizedSpoken.length; transcriptIndex++) {
            bestEvidenceByTranscriptToken[transcriptIndex] = Math.max(
                bestEvidenceByTranscriptToken[transcriptIndex],
                evidenceEndingHere[transcriptIndex],
            );
        }

        const requiredEvidence = scriptIndex < currentIndex
            ? minEvidenceForBackwardCorrection
            : scriptIndex > currentIndex
                ? minEvidenceForMovement
                : 1;
        const distance = Math.abs(scriptIndex - currentIndex);

        if (
            candidateEvidence >= requiredEvidence
            && (
                candidateEvidence > selectedEvidence
                || (candidateEvidence === selectedEvidence && distance < selectedDistance)
            )
        ) {
            selectedIndex = scriptIndex;
            selectedEvidence = candidateEvidence;
            selectedDistance = distance;
        }
    }

    return selectedIndex;
}
