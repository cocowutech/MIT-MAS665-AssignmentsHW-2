/**
 * Writing Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the writing assessment module.
 * It provides a complete writing evaluation system with text input, adaptive difficulty,
 * and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Writing prompt interface
 */
interface WritingPrompt {
    id: string;
    title: string;
    description: string;
    instructions: string[];
    word_limit: number;
    time_limit: number;
    level: string;
    type: string;
    structure_hints?: string[];
}

/**
 * Writing session interface
 */
interface WritingSession {
    session_id: string;
    current_prompt: WritingPrompt;
    asked: number;
    remaining: number;
    target_cefr: string;
    current_level: string;
    total?: number;
}

/**
 * Writing submission interface
 */
interface WritingSubmission {
    prompt_id: string;
    text: string;
    word_count: number;
    time_taken: number;
}

/**
 * Writing evaluation result interface
 */
interface WritingEvaluation {
    score: number;
    content_score: number;
    organization_score: number;
    language_score: number;
    feedback: string;
    suggestions?: string[];
    level_adjustment: number;
    band?: string;
}

/**
 * Normalize backend evaluation response to WritingEvaluation format
 */
function normalizeWritingEvaluation(data: any): WritingEvaluation {
    const scores = data?.scores || {};
    const overall = Number(data?.overall ?? 0);

    const toPercent = (value: any, fallback?: number): number => {
        const numeric = Number(value);
        const base = Number.isFinite(numeric) ? numeric : (fallback ?? overall);
        const clamped = Math.max(0, Math.min(base, 5));
        return Math.round(clamped * 20);
    };

    const averageScore = (keys: string[], fallback?: number): number => {
        const values = keys
            .map(key => Number(scores?.[key]))
            .filter(value => Number.isFinite(value));
        if (!values.length) {
            return toPercent(fallback ?? overall);
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        return toPercent(total / values.length, fallback ?? overall);
    };

    const suggestions = Array.isArray(data?.comments?.inline)
        ? data.comments.inline
            .map((item: any) => {
                const span = typeof item?.span === 'string' ? item.span.trim() : '';
                const comment = typeof item?.comment === 'string' ? item.comment.trim() : '';
                if (span && comment) return `${span}: ${comment}`;
                return span || comment || '';
            })
            .filter((entry: string) => entry.length > 0)
        : undefined;

    const estimatedBand = typeof data?.band === 'string' ? data.band.toUpperCase() : undefined;

    const feedbackParts: string[] = [];
    if (estimatedBand) {
        feedbackParts.push(`Estimated CEFR band: ${estimatedBand}`);
    }
    if (typeof data?.comments?.global === 'string' && data.comments.global.trim()) {
        feedbackParts.push(data.comments.global.trim());
    }

    const fallbackFeedback = 'Keep refining your ideas, organization, and language control to improve your writing.';

    return {
        score: toPercent(overall, 3),
        content_score: averageScore(['task_response', 'opinions_and_reasons'], overall),
        organization_score: averageScore(['coherence_cohesion', 'sequencing_words'], overall),
        language_score: averageScore([
            'vocabulary_complexity',
            'grammar_complexity',
            'verb_patterns',
            'comparatives_superlatives',
            'accuracy'
        ], overall),
        feedback: feedbackParts.length ? feedbackParts.join(' • ') : fallbackFeedback,
        suggestions,
        level_adjustment: 0,
        band: estimatedBand
    };
}

/**
 * Writing session response interface
 */
interface WritingSessionResponse {
    session: WritingSession;
    evaluation?: WritingEvaluation;
    finished: boolean;
    final_score?: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

declare const AuthUtils: any;
declare const APIUtils: any;

// ============================================================================
// WRITING MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the writing module
 */
class WritingModuleState {
    // Authentication state
    public token: string | null = null;
    public username: string | null = null;
    
    // Session state
    public session: WritingSession | null = null;
    public currentPrompt: WritingPrompt | null = null;
    public currentText: string = '';
    public currentImageFile: File | null = null;
    public sessionStartTime: number = 0;
    public promptStartTime: number = 0;
    public promptTimeLimitMs: number = 0;
    public promptDeadline: number = 0;
    public promptTimerId: number | null = null;
    public lastEvaluationLevel: string | null = null;
    public lastEvaluationScore: number | null = null;
    public evaluationScores: number[] = [];
    public lastEvaluation: WritingEvaluation | null = null;
    public isRestartInProgress: boolean = false;

    // UI state
    public isSubmissionInProgress: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;

    constructor() {
        if (typeof AuthUtils !== 'undefined' && typeof AuthUtils.getAuthState === 'function') {
            this.applyAuthState(AuthUtils.getAuthState());
        }

        if (typeof AuthUtils !== 'undefined' && typeof AuthUtils.onAuthChange === 'function') {
            AuthUtils.onAuthChange((state: { token: string | null; username: string | null; isAuthenticated: boolean }) => {
                this.applyAuthState(state);
            });
        }
    }

    /**
     * Sync module state with global auth status
     */
    private applyAuthState(state: { token: string | null; username: string | null; isAuthenticated: boolean }): void {
        this.token = state.token;
        this.username = state.username;

        if (!state.isAuthenticated) {
            this.resetSessionState();
            hideTimerCard();
        }
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(options?: { preserveRestartFlag?: boolean }): void {
        const preserveRestartFlag = options?.preserveRestartFlag ?? false;
        this.session = null;
        this.currentPrompt = null;
        this.currentText = '';
        this.currentImageFile = null;
        this.sessionStartTime = 0;
        this.promptStartTime = 0;
        this.promptDeadline = 0;
        this.promptTimeLimitMs = 0;
        this.lastEvaluationLevel = null;
        this.lastEvaluationScore = null;
        this.evaluationScores = [];
        this.lastEvaluation = null;
        if (!preserveRestartFlag) {
            this.isRestartInProgress = false;
        }
        this.stopPromptTimer();
        this.isSubmissionInProgress = false;
        this.showResults = false;
        this.isSessionActive = false;
    }
    
    /**
     * Start prompt timer
     */
    public startPromptTimer(limitMinutes?: number): void {
        this.stopPromptTimer();
        const minutes = Number.isFinite(limitMinutes) && limitMinutes ? Math.max(1, limitMinutes) : (this.currentPrompt?.time_limit ?? 30);
        this.promptTimeLimitMs = minutes * 60 * 1000;
        this.promptStartTime = Date.now();
        this.promptDeadline = this.promptStartTime + this.promptTimeLimitMs;
        updateTimerDisplay();
        this.promptTimerId = window.setInterval(() => updateTimerDisplay(), 1000);
    }

    /**
     * Stop prompt timer
     */
    public stopPromptTimer(): void {
        if (this.promptTimerId !== null) {
            window.clearInterval(this.promptTimerId);
            this.promptTimerId = null;
        }
    }
    
    /**
     * Get time taken for current prompt
     */
    public getPromptTime(): number {
        if (this.promptStartTime === 0) return 0;
        return Date.now() - this.promptStartTime;
    }
    
    /**
     * Get word count of current text
     */
    public getWordCount(): number {
        if (!this.currentText.trim()) return 0;
        return this.currentText.trim().split(/\s+/).length;
    }
}

// ============================================================================
// GLOBAL STATE INSTANCE
// ============================================================================

const moduleState = new WritingModuleState();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// $ function removed - use APIUtils.$element instead

/**
 * Show an element by removing the 'hidden' class
 * @param el - Element ID or DOM element
 */
function show(el: string | HTMLElement): void {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node) return;
    node.classList.remove('hidden');
}

/**
 * Hide an element by adding the 'hidden' class
 * @param el - Element ID or DOM element
 */
function hide(el: string | HTMLElement): void {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node) return;
    node.classList.add('hidden');
}

/**
 * Update the global status message with optional pending styling.
 * @param message - The message to display
 * @param pending - Whether the message represents an in-progress state
 * @param target - Optional specific status element to update
 */
function updateStatusMessage(message: string, pending = false, target?: HTMLElement | null): void {
    const statusEl = target ?? APIUtils.$element('status');
    if (!statusEl) return;
    statusEl.textContent = message;
    const shouldShowPending = pending && message.trim().length > 0;
    if (shouldShowPending) {
        statusEl.classList.add('status-pending');
    } else {
        statusEl.classList.remove('status-pending');
    }
}

/**
 * Clear the global status message.
 * @param target - Optional specific status element to clear
 */
function clearStatusMessage(target?: HTMLElement | null): void {
    updateStatusMessage('', false, target);
}

/**
 * Format time in milliseconds to readable format
 * @param ms - Time in milliseconds
 * @returns Formatted time string
 */
function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
}

/**
 * Calculate progress percentage
 * @param current - Current progress
 * @param total - Total progress
 * @returns Progress percentage
 */
function calculateProgress(current: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((current / total) * 100);
}

const TIMER_WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const VALID_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const TOTAL_WRITING_TASKS = 3;

function getSessionAverageScore(): number {
    if (moduleState.evaluationScores.length === 0) {
        const fallback = moduleState.lastEvaluationScore ?? 0;
        return Math.max(0, Math.min(100, Math.round(fallback)));
    }
    const total = moduleState.evaluationScores.reduce((sum, score) => sum + score, 0);
    const average = total / moduleState.evaluationScores.length;
    return Math.max(0, Math.min(100, Math.round(average)));
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return char;
        }
    });
}

function cleanPromptText(raw: string): string {
    if (typeof raw !== 'string') return '';
    let text = raw.trim();
    if (!text) return '';
    text = text.replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    const promptMatch = text.match(/"prompt"\s*:\s*"([\s\S]*?)"\s*}?$/i);
    if (promptMatch) {
        text = promptMatch[1];
    }
    text = text.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1);
    }
    return text.trim();
}

function formatCountdown(ms: number): string {
    const safeMs = Math.max(0, ms);
    const minutes = Math.floor(safeMs / 60000);
    const seconds = Math.floor((safeMs % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function resetTimerClasses(card: HTMLElement): void {
    card.classList.remove('timer-warning', 'timer-expired');
}

function updateTimerDisplay(): void {
    const timerCard = APIUtils.$element('timerCard');
    const timerValue = APIUtils.$element('timerValue');
    if (!timerCard || !timerValue) return;

    if (!moduleState.promptDeadline) {
        resetTimerClasses(timerCard);
        timerValue.textContent = '—';
        return;
    }

    const remaining = moduleState.promptDeadline - Date.now();

    resetTimerClasses(timerCard);

    if (remaining <= 0) {
        moduleState.stopPromptTimer();
        timerCard.classList.add('timer-expired');
        timerValue.textContent = '00:00';
        return;
    }

    if (remaining <= TIMER_WARNING_THRESHOLD_MS) {
        timerCard.classList.add('timer-warning');
    }

    timerValue.textContent = formatCountdown(remaining);
    show('timerCard');
}

function setTimerLimitDisplay(minutes: number): void {
    const limitEl = APIUtils.$element('timerLimit');
    if (!limitEl) return;
    const rounded = Math.max(1, Math.round(minutes));
    limitEl.textContent = `Up to ${rounded} minute${rounded === 1 ? '' : 's'}`;
}

function hideTimerCard(): void {
    const timerCard = APIUtils.$element('timerCard');
    if (!timerCard) return;
    resetTimerClasses(timerCard);
    hide(timerCard);
}

function normalizeLevel(level: string | null | undefined): string {
    if (!level) return 'A2';
    const upper = level.trim().toUpperCase();
    return VALID_LEVELS.includes(upper as typeof VALID_LEVELS[number]) ? upper : 'A2';
}

function scoreToCefr(score: number): string {
    if (!Number.isFinite(score)) return 'A2';
    if (score >= 96) return 'C2';
    if (score >= 88) return 'C1';
    if (score >= 76) return 'B2';
    if (score >= 64) return 'B1';
    if (score >= 50) return 'A2';
    return 'A1';
}

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Authenticate user with backend and store token
 * Backend: POST /auth/token (auth.py:login)
 * @param username - User login name
 * @param password - User password
 * @returns JWT access token
 * @throws Error if authentication fails
 */
async function login(username: string, password: string): Promise<string> {
    try {
        const result = await AuthUtils.authenticateUser(username, password);
        if (result.success) {
            // AuthUtils already handles token storage and UI updates
            return AuthUtils.authState.token;
        } else {
            throw new Error(result.error || 'Login failed');
        }
    } catch (error) {
        throw new Error('Login failed');
    }
}

// ============================================================================
// WRITING SESSION FUNCTIONS
// ============================================================================

/**
 * Initialize a new writing assessment session
 * Backend: POST /write/start (write.py:start)
 * @returns Session data with first writing task
 * @throws Error if session initialization fails
 */
async function startSession(overrideLevel?: string): Promise<WritingSessionResponse> {
    try {
        const normalizedOverride = overrideLevel ? normalizeLevel(overrideLevel) : null;
        const startingLevel = normalizedOverride ?? await APIUtils.WritingAPI.getDefaultLevel();
        const response = await APIUtils.WritingAPI.startSession(startingLevel);
        moduleState.session = response.session;
        if (moduleState.session) {
            const totalTasks = TOTAL_WRITING_TASKS;
            moduleState.session.total = totalTasks;
            moduleState.session.asked = 0;
            moduleState.session.remaining = totalTasks;
            moduleState.session.current_level = normalizeLevel(moduleState.session.current_level || startingLevel);
            moduleState.session.target_cefr = normalizeLevel(moduleState.session.target_cefr || startingLevel);
            moduleState.currentPrompt = moduleState.session.current_prompt;
            if (response.session) {
                response.session.total = moduleState.session.total;
                response.session.asked = moduleState.session.asked;
                response.session.remaining = moduleState.session.remaining;
            }
        } else {
            moduleState.currentPrompt = null;
        }
        moduleState.sessionStartTime = Date.now();
        moduleState.evaluationScores = [];
        moduleState.lastEvaluationScore = null;
        moduleState.lastEvaluationLevel = null;
        moduleState.lastEvaluation = null;
        moduleState.isSessionActive = true;
        moduleState.showResults = false;
        moduleState.isRestartInProgress = false;
        return response;
    } catch (error) {
        if (error instanceof Error) {
            const message = error.message || '';
            if (message.toLowerCase().includes('unauthorized') || message.includes('401')) {
                AuthUtils.clearAuth();
                throw new Error('Please log in to start a writing session.');
            }
            throw new Error(message);
        }
        throw new Error('Failed to start session');
    }
}

/**
 * Submit writing response for evaluation
 * Backend: POST /write/submit (write.py:submit)
 * @param submission - Writing submission data
 * @returns Evaluation result
 * @throws Error if submission fails
 */
async function submitWriting(submission: WritingSubmission): Promise<WritingEvaluation> {
    try {
        const response = await APIUtils.WritingAPI.submitAnswer(submission);
        return normalizeWritingEvaluation(response.evaluation);
    } catch (error) {
        throw new Error('Failed to submit writing');
    }
}

async function submitImageForEvaluation(file: File, text?: string): Promise<WritingEvaluation> {
    const response = await APIUtils.WritingAPI.submitImage(file, text);
    return normalizeWritingEvaluation(response.evaluation);
}

function dedupeSuggestions(...suggestionGroups: Array<string[] | undefined>): string[] | undefined {
    const merged: string[] = [];
    for (const group of suggestionGroups) {
        if (!group) continue;
        for (const entry of group) {
            const trimmed = entry.trim();
            if (trimmed.length > 0) {
                merged.push(trimmed);
            }
        }
    }
    if (!merged.length) return undefined;
    const unique = Array.from(new Set(merged));
    return unique.length ? unique : undefined;
}

function pickStrongerBand(primary?: string, secondary?: string): string | undefined {
    if (!primary && !secondary) return undefined;
    const order = VALID_LEVELS;
    const primaryIndex = primary ? order.indexOf(primary.toUpperCase() as typeof order[number]) : -1;
    const secondaryIndex = secondary ? order.indexOf(secondary.toUpperCase() as typeof order[number]) : -1;
    if (primaryIndex === -1 && secondaryIndex === -1) return undefined;
    if (primaryIndex >= secondaryIndex) return primary ?? secondary ?? undefined;
    return secondary ?? primary ?? undefined;
}

function mergeWritingEvaluations(primary: WritingEvaluation, secondary: WritingEvaluation): WritingEvaluation {
    const scoreDelta = Math.abs(primary.score - secondary.score);
    const correlated = scoreDelta <= 10;
    const blend = (a: number, b: number): number => {
        if (!Number.isFinite(a) && Number.isFinite(b)) return b;
        if (!Number.isFinite(b) && Number.isFinite(a)) return a;
        if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
        if (correlated) {
            return Math.round(Math.min(100, (a * 0.55) + (b * 0.45)));
        }
        return Math.max(a, b);
    };

    const combinedScore = blend(primary.score, secondary.score);
    const contentScore = blend(primary.content_score, secondary.content_score);
    const organizationScore = blend(primary.organization_score, secondary.organization_score);
    const languageScore = blend(primary.language_score, secondary.language_score);

    const feedbackParts: string[] = [];
    const primaryFeedback = primary.feedback?.trim();
    const secondaryFeedback = secondary.feedback?.trim();

    if (primaryFeedback) {
        feedbackParts.push(primaryFeedback);
    }
    if (secondaryFeedback && secondaryFeedback !== primaryFeedback) {
        const prefix = correlated
            ? 'We also incorporated your typed edits:'
            : 'Additional insights from your typed response:';
        feedbackParts.push(`${prefix} ${secondaryFeedback}`);
    }

    if (!feedbackParts.length) {
        feedbackParts.push('Combined analysis reflects both your typed response and uploaded image.');
    } else {
        feedbackParts.push('Combined analysis reflects both your typed response and uploaded image.');
    }

    const combinedSuggestions = dedupeSuggestions(primary.suggestions, secondary.suggestions);
    const combinedLevelAdjustment = (primary.level_adjustment + secondary.level_adjustment) / 2;
    const combinedBand = pickStrongerBand(primary.band, secondary.band);

    return {
        score: Math.min(100, Math.max(0, combinedScore)),
        content_score: Math.min(100, Math.max(0, contentScore)),
        organization_score: Math.min(100, Math.max(0, organizationScore)),
        language_score: Math.min(100, Math.max(0, languageScore)),
        feedback: feedbackParts.join('\n\n'),
        suggestions: combinedSuggestions,
        level_adjustment: combinedLevelAdjustment,
        band: combinedBand
    };
}

/**
 * Get next prompt in current session
 * Backend: POST /write/next (write.py:next)
 * @returns Next prompt or session completion status
 * @throws Error if request fails
 */
async function getNextPrompt(): Promise<WritingSessionResponse> {
    const existingSession = moduleState.session;
    const totalTasks = existingSession?.total ?? TOTAL_WRITING_TASKS;
    const askedCount = existingSession?.asked ?? 0;

    if (existingSession && askedCount >= totalTasks) {
        existingSession.remaining = 0;
        return {
            session: existingSession,
            finished: true,
            final_score: getSessionAverageScore()
        };
    }

    try {
        const level = moduleState.session?.current_level || 'A2';
        const response = await APIUtils.WritingAPI.getNextTask(level);
        const nextPrompt = response.session?.current_prompt ?? null;

        if (!moduleState.session) {
            moduleState.session = response.session ?? null;
        }

        if (moduleState.session) {
            moduleState.session.total = moduleState.session.total ?? TOTAL_WRITING_TASKS;
            if (nextPrompt) {
                moduleState.session.current_prompt = nextPrompt;
            }
            moduleState.session.current_level = normalizeLevel(response.session?.current_level || moduleState.session.current_level);
            moduleState.session.target_cefr = normalizeLevel(response.session?.target_cefr || moduleState.session.target_cefr);
            const askedSoFar = moduleState.session.asked ?? 0;
            moduleState.session.remaining = Math.max((moduleState.session.total ?? TOTAL_WRITING_TASKS) - askedSoFar, 0);
            moduleState.currentPrompt = nextPrompt;
        }

        const sessionSnapshot = moduleState.session
            ? { ...moduleState.session, current_prompt: moduleState.session.current_prompt }
            : response.session;

        return {
            session: sessionSnapshot as WritingSession,
            finished: false
        };
    } catch (error) {
        throw new Error('Failed to get next prompt');
    }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

/**
 * Display writing prompt
 * @param prompt - Writing prompt data
 */
function displayPrompt(prompt: WritingPrompt): void {
    const promptDiv = APIUtils.$element('prompt');
    if (!promptDiv) return;

    moduleState.currentPrompt = prompt;

    const title = escapeHtml(cleanPromptText(prompt.title));
    const descriptionText = cleanPromptText(prompt.description || '');
    const descriptionHtml = escapeHtml(descriptionText).replace(/\n+/g, '<br>');
    const instructionsHtml = (prompt.instructions || [])
        .map(instruction => `<li>${escapeHtml(cleanPromptText(instruction))}</li>`)
        .join('');
    const structureHintsHtml = (prompt.structure_hints || [])
        .map(hint => `<span class="chip struct">${escapeHtml(cleanPromptText(hint))}</span>`)
        .join('');

    const level = escapeHtml(prompt.level || 'A2');
    const type = escapeHtml(prompt.type || 'Essay');
    const wordLimit = Number(prompt.word_limit) || 350;
    const timeLimit = Number(prompt.time_limit) || 30;

    moduleState.startPromptTimer(timeLimit);
    setTimerLimitDisplay(timeLimit);
    updateTimerDisplay();

    
    promptDiv.innerHTML = `
        <div class="writing-prompt">
            <div class="prompt-header">
                <div class="prompt-title">${title}</div>
                <div class="prompt-meta">
                    <span class="meta-item">Level: ${level}</span>
                    <span class="meta-item">Type: ${type}</span>
                    <span class="meta-item">Words: ${wordLimit}</span>
                    <span class="meta-item">Time: ${timeLimit} min</span>
                </div>
            </div>
            <div class="prompt-body">
                <p>${descriptionHtml}</p>
                <div class="section-title">Instructions:</div>
                <ul>${instructionsHtml}</ul>
                ${structureHintsHtml ? `
                    <div class="section-title">Structure Hints:</div>
                    <div class="prompt-chips">${structureHintsHtml}</div>
                ` : ''}
            </div>
        </div>
    `;
    
    show('prompt');
    show('timerCard');
}

/**
 * Display writing editor
 */
function displayEditor(): void {
    const editorDiv = APIUtils.$element('editor');
    if (!editorDiv) return;
    
    editorDiv.innerHTML = `
        <div class="writing-editor">
            <div class="editor-header">
                <div class="editor-title">Your Writing</div>
                <div class="word-count" id="wordCount">0 words</div>
            </div>
            <textarea 
                id="writingTextarea" 
                class="writing-textarea" 
                placeholder="Start writing your response here..."
                oninput="updateWordCount()"
            ></textarea>
        </div>
        <div class="image-upload-section">
            <div class="editor-title" style="font-size: 16px; margin-top: 16px;">Or upload an image</div>
            <p class="small" style="margin: 4px 0 12px 0;">We will extract text from the image and analyze it just like a typed response.</p>
            <div class="image-upload-controls">
                <input type="file" id="imageUploadInput" accept="image/*">
                <button type="button" id="clearImageBtn" class="hidden" style="margin-left: 8px;">Remove image</button>
            </div>
            <div id="imageUploadStatus" class="small" style="margin-top: 8px;">No image selected.</div>
        </div>
    `;
    
    show('editor');
    const submitCard = APIUtils.$element('submitCard');
    if (submitCard) {
        show(submitCard);
    }
    
    // Focus on textarea
    const textarea = APIUtils.$element('writingTextarea') as HTMLTextAreaElement;
    if (textarea) {
        textarea.focus();
    }

    moduleState.currentText = '';
    moduleState.currentImageFile = null;
    updateWordCount();

    const imageInput = APIUtils.$element('imageUploadInput') as HTMLInputElement | null;
    if (imageInput) {
        imageInput.addEventListener('change', handleImageSelection);
    }

    const clearImageBtn = APIUtils.$element('clearImageBtn');
    if (clearImageBtn) {
        clearImageBtn.addEventListener('click', clearImageSelection);
    }

    clearImageSelection();
}

/**
 * Update word count display
 */
function updateWordCount(): void {
    const textarea = APIUtils.$element('writingTextarea') as HTMLTextAreaElement;
    const wordCountDiv = APIUtils.$element('wordCount');
    
    if (textarea && wordCountDiv) {
        moduleState.currentText = textarea.value;
        const wordCount = moduleState.getWordCount();
        wordCountDiv.textContent = `${wordCount} words`;
        
        // Update word count color based on limit
        if (moduleState.currentPrompt) {
            const limit = moduleState.currentPrompt.word_limit;
            if (wordCount > limit) {
                wordCountDiv.style.color = '#ef4444';
            } else if (wordCount > limit * 0.8) {
                wordCountDiv.style.color = '#fbbf24';
            } else {
                wordCountDiv.style.color = '#93c5fd';
            }
        }
    }
}

/**
 * Handle image selection for OCR submission
 */
function handleImageSelection(event: Event): void {
    const input = event.currentTarget as HTMLInputElement | null;
    const status = APIUtils.$element('imageUploadStatus');
    const clearBtn = APIUtils.$element('clearImageBtn');

    if (!input || !status) return;

    const file = input.files && input.files[0] ? input.files[0] : null;
    moduleState.currentImageFile = file;

    if (file) {
        status.textContent = `Image selected: ${file.name}. We will analyze the extracted text instead of the typed response.`;
        if (clearBtn) {
            clearBtn.classList.remove('hidden');
        }
    } else {
        status.textContent = 'No image selected.';
        if (clearBtn) {
            hide(clearBtn);
        }
    }
}

/**
 * Clear selected image
 */
function clearImageSelection(): void {
    const input = APIUtils.$element('imageUploadInput') as HTMLInputElement | null;
    const status = APIUtils.$element('imageUploadStatus');
    const clearBtn = APIUtils.$element('clearImageBtn');

    if (input) {
        input.value = '';
    }

    moduleState.currentImageFile = null;

    if (status) {
        status.textContent = 'No image selected.';
    }

    if (clearBtn) {
        hide(clearBtn);
    }
}

/**
 * Update progress display
 */
function updateProgress(): void {
    if (!moduleState.session) return;
    
    const progressDiv = APIUtils.$element('progress');
    if (!progressDiv) return;
    
    const rawTotal = moduleState.session.total ?? (moduleState.session.asked + moduleState.session.remaining);
    const total = rawTotal > 0 ? rawTotal : TOTAL_WRITING_TASKS;
    const asked = Math.min(moduleState.session.asked, total);
    const remaining = Math.max(total - asked, 0);
    if (moduleState.session.remaining !== remaining) {
        moduleState.session.remaining = remaining;
    }
    const progress = calculateProgress(asked, total);
    
    progressDiv.innerHTML = `
        <div class="writing-progress">
            <div class="progress-info">
                <span class="progress-text">Progress: ${asked}/${total}</span>
                <span class="writing-level">
                    Level: <span class="level-badge">${moduleState.session.current_level}</span>
                </span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
        </div>
    `;
    
    show('progress');

    const headerLevelBadge = document.querySelector('.writing-level .level-badge');
    if (headerLevelBadge && moduleState.session?.current_level) {
        headerLevelBadge.textContent = moduleState.session.current_level;
    }
}

/**
 * Display evaluation results
 * @param evaluation - Evaluation result data
 */
function renderEvaluationCard(evaluation: WritingEvaluation, options?: { heading?: string; includeTime?: boolean }): string {
    const heading = options?.heading ?? 'Writing Evaluation';
    const includeTime = options?.includeTime ?? true;
    const timeMarkup = includeTime
        ? `
                    <div class="score-item">
                        <div class="score-label">Time</div>
                        <div class="score-value">${formatTime(moduleState.getPromptTime())}</div>
                    </div>`
        : '';

    const suggestionMarkup = evaluation.suggestions && evaluation.suggestions.length
        ? `
                <div class="comment-title" style="margin-top: 12px;">Suggestions</div>
                <div class="comment-text">${evaluation.suggestions.join('<br>')}</div>`
        : '';

    return `
        <div class="writing-results">
            <div class="results-header">
                <h3 class="results-title">${heading}</h3>
                <div class="results-score">${evaluation.score}/100</div>
            </div>
            <div class="score-section">
                <div class="score-grid">
                    <div class="score-item">
                        <div class="score-label">Content</div>
                        <div class="score-value">${evaluation.content_score}/100</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Organization</div>
                        <div class="score-value">${evaluation.organization_score}/100</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Language</div>
                        <div class="score-value">${evaluation.language_score}/100</div>
                    </div>
                    ${timeMarkup}
                </div>
            </div>
            <div class="comment-box">
                <div class="comment-title">Feedback</div>
                <div class="comment-text">${evaluation.feedback}</div>
                ${suggestionMarkup}
            </div>
        </div>
    `;
}

function displayEvaluationResults(evaluation: WritingEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = renderEvaluationCard(evaluation);
    
    show('results');
    moduleState.showResults = true;
}

/**
 * Show session completion screen
 * @param finalScore - Final session score
 */
function showSessionComplete(finalScore: number, finalEvaluation?: WritingEvaluation | null): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const sessionTime = Date.now() - moduleState.sessionStartTime;
    const recordedScores = moduleState.evaluationScores.length
        ? moduleState.evaluationScores
        : (finalEvaluation ? [finalEvaluation.score] : []);
    const averageScoreRaw = recordedScores.length
        ? recordedScores.reduce((sum, score) => sum + score, 0) / recordedScores.length
        : finalScore;
    const averageScore = Math.max(0, Math.min(100, Math.round(averageScoreRaw)));
    const finalCefrLevel = scoreToCefr(averageScore);
    const finalScoreDisplay = `${finalCefrLevel} (${averageScore}/100)`;

    moduleState.lastEvaluationLevel = finalCefrLevel;
    if (moduleState.session) {
        moduleState.session.current_level = finalCefrLevel;
        moduleState.session.target_cefr = finalCefrLevel;
    }

    const evaluationHtml = finalEvaluation
        ? renderEvaluationCard(finalEvaluation, { heading: 'Final Prompt Feedback', includeTime: true })
        : '';
    const restartLevel = finalCefrLevel || 'A2';
    
    resultsDiv.innerHTML = `
        <div class="session-summary">
            <div class="summary-title">Writing Assessment Complete!</div>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Score</div>
                    <div class="summary-stat-value">${finalScoreDisplay}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Prompts</div>
                    <div class="summary-stat-value">${moduleState.session?.asked || 0}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Time Taken</div>
                    <div class="summary-stat-value">${formatTime(sessionTime)}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Level</div>
                    <div class="summary-stat-value">${finalCefrLevel}</div>
                </div>
            </div>
            <div class="comment-box">
                <div class="comment-title">Congratulations!</div>
                <div class="comment-text">
                    You have completed the writing assessment. Your performance has been evaluated
                    and your English writing level has been determined. Thank you for using the
                    ESL Assessment System.
                </div>
            </div>
        </div>
        ${evaluationHtml}
        <div class="session-actions">
            <button type="button" id="restartWritingBtn" data-level="${restartLevel}">Assess again</button>
        </div>
    `;
    
    show('results');
    moduleState.showResults = true;
    moduleState.isSessionActive = false;

    const restartBtn = document.getElementById('restartWritingBtn') as HTMLButtonElement | null;
    if (restartBtn) {
        restartBtn.addEventListener('click', () => restartWritingAssessment(restartBtn.dataset.level || undefined));
    }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle writing submission
 */
async function handleSubmitWriting(): Promise<void> {
    if (!moduleState.currentPrompt) {
        alert('No prompt is currently loaded.');
        return;
    }

    const trimmedText = moduleState.currentText.trim();
    const hasText = trimmedText.length > 0;
    const hasImage = moduleState.currentImageFile instanceof File;

    if (!hasText && !hasImage) {
        alert('Please write something or upload an image before submitting.');
        return;
    }
    
    const submitBtn = APIUtils.$element('submitBtn');
    const submitCard = APIUtils.$element('submitCard');
    const status = APIUtils.$element('status');
    const setPendingMessage = (message: string): void => updateStatusMessage(message, true, status);
    const setResolvedMessage = (message: string): void => updateStatusMessage(message, false, status);
    const clearResolvedMessage = (): void => clearStatusMessage(status);
    if (submitBtn) {
        submitBtn.textContent = 'Submitting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    if (submitCard) {
        hide(submitCard);
    }

    const evaluationContext = hasImage && hasText
        ? 'combined'
        : hasImage
            ? 'image'
            : 'text';
    switch (evaluationContext) {
        case 'combined':
            setPendingMessage('Evaluating your text and image together...');
            break;
        case 'image':
            setPendingMessage('Evaluating image submission...');
            break;
        default:
            setPendingMessage('Scoring your writing...');
            break;
    }
    
    moduleState.isSubmissionInProgress = true;
    
    try {
        let evaluation: WritingEvaluation | null = null;
        let imageWarning: string | null = null;
        let combinedEvaluationUsed = false;
        const textSubmission: WritingSubmission | null = hasText ? {
            prompt_id: moduleState.currentPrompt.id,
            text: trimmedText,
            word_count: moduleState.getWordCount(),
            time_taken: moduleState.getPromptTime()
        } : null;

        if (hasImage && moduleState.currentImageFile) {
            try {
                if (hasText && textSubmission) {
                    const [imageEval, textEval] = await Promise.all([
                        submitImageForEvaluation(moduleState.currentImageFile, trimmedText),
                        submitWriting(textSubmission)
                    ]);
                    evaluation = mergeWritingEvaluations(imageEval, textEval);
                    combinedEvaluationUsed = true;
                } else {
                    evaluation = await submitImageForEvaluation(moduleState.currentImageFile);
                }
            } catch (imageError) {
                console.warn('Image submission failed; falling back to text', imageError);
                if (hasText) {
                    imageWarning = 'We could not read the image clearly, so your typed response was evaluated instead.';
                    setPendingMessage('Scoring your writing...');
                } else {
                    const message = 'We could not read the uploaded image. Please try again with a clearer photo or type your response.';
                    if (status) {
                        setResolvedMessage(message);
                    } else {
                        alert(message);
                    }
                    const errorToThrow = imageError instanceof Error ? imageError : new Error(message);
                    throw errorToThrow;
                }
            }
        }

        if (!evaluation) {
            if (textSubmission) {
                setPendingMessage('Scoring your writing...');
                evaluation = await submitWriting(textSubmission);
            }
        }

        if (!evaluation) {
            throw new Error('Unable to score writing. Please try again.');
        }

        if (imageWarning) {
            if (status) {
                setResolvedMessage(imageWarning);
            } else {
                alert(imageWarning);
            }
        } else if (combinedEvaluationUsed) {
            setResolvedMessage('Combined analysis complete.');
        } else {
            clearResolvedMessage();
        }

        moduleState.stopPromptTimer();
        hideTimerCard();
        clearImageSelection();

        if (moduleState.session) {
            const totalTasks = moduleState.session.total ?? TOTAL_WRITING_TASKS;
            const asked = Math.min((moduleState.session.asked ?? 0) + 1, totalTasks);
            moduleState.session.asked = asked;
            moduleState.session.remaining = Math.max(totalTasks - asked, 0);
        }

        moduleState.lastEvaluationScore = evaluation.score;
        moduleState.evaluationScores.push(evaluation.score);
        moduleState.lastEvaluation = evaluation;

        const nextLevel = normalizeLevel(evaluation.band ?? scoreToCefr(evaluation.score));
        moduleState.lastEvaluationLevel = nextLevel;
        if (moduleState.session) {
            moduleState.session.current_level = nextLevel;
            moduleState.session.target_cefr = nextLevel;
        }

        // Display results
        displayEvaluationResults(evaluation);
        updateProgress();

        const sessionComplete = !!moduleState.session && (moduleState.session.asked ?? 0) >= (moduleState.session.total ?? TOTAL_WRITING_TASKS);

        if (sessionComplete) {
            const finalScore = getSessionAverageScore();
            showSessionComplete(finalScore, evaluation);
            const continueCard = APIUtils.$element('continueCard');
            if (continueCard) {
                hide(continueCard);
            }
            if (submitBtn) {
                submitBtn.textContent = 'Submit Writing';
                (submitBtn as HTMLButtonElement).disabled = true;
            }
        } else {
            const continueCard = APIUtils.$element('continueCard');
            const continueBtn = APIUtils.$element('continueBtn');
            if (continueBtn) {
                continueBtn.textContent = 'Next Prompt →';
                (continueBtn as HTMLButtonElement).disabled = false;
            }
            if (continueCard) {
                show('continueCard');
            }
            if (submitBtn) {
                submitBtn.textContent = 'Submit Writing';
                (submitBtn as HTMLButtonElement).disabled = false;
            }
        }

    } catch (error) {
        console.error('Submission failed:', error);
        const errorMessage = error instanceof Error && error.message
            ? error.message
            : 'Submission failed. Please try again.';
        if (status) {
            setResolvedMessage(errorMessage);
        } else {
            alert(errorMessage);
        }
        
        if (submitBtn) {
            submitBtn.textContent = 'Submit Writing';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
        if (submitCard) {
            show(submitCard);
        }
    }

    moduleState.isSubmissionInProgress = false;
}

/**
 * Handle continue to next prompt
 */
async function continueToNext(): Promise<void> {
    if (!moduleState.session) return;
    
    const continueBtn = APIUtils.$element('continueBtn');
    const continueCard = APIUtils.$element('continueCard');
    const totalTasks = moduleState.session.total ?? TOTAL_WRITING_TASKS;
    const askedCount = moduleState.session.asked ?? 0;
    if (askedCount >= totalTasks) {
        if (continueBtn) {
            continueBtn.textContent = 'Next Prompt →';
            (continueBtn as HTMLButtonElement).disabled = true;
        }
        if (continueCard) {
            hide(continueCard);
        }
        showSessionComplete(getSessionAverageScore(), moduleState.lastEvaluation);
        return;
    }

    if (continueBtn) {
        continueBtn.textContent = 'Loading...';
        (continueBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const nextResponse = await getNextPrompt();

        if (nextResponse.finished) {
            showSessionComplete(nextResponse.final_score || 0, moduleState.lastEvaluation);
            if (continueCard) {
                hide(continueCard);
            }
        } else {
            moduleState.currentText = '';
            moduleState.showResults = false;

            hide('results');
            if (continueCard) hide(continueCard);

            if (nextResponse.session.current_prompt) {
                displayPrompt(nextResponse.session.current_prompt);
                displayEditor();
                const submitBtn = APIUtils.$element('submitBtn');
                if (submitBtn) {
                    submitBtn.textContent = 'Submit Writing';
                    (submitBtn as HTMLButtonElement).disabled = false;
                }
                const submitCard = APIUtils.$element('submitCard');
                if (submitCard) {
                    show(submitCard);
                }
            }

            updateProgress();
        }
        
    } catch (error) {
        console.error('Failed to get next prompt:', error);
        const status = APIUtils.$element('status');
        if (status) {
            updateStatusMessage('Failed to load next prompt. Please try again.', false, status);
        }
        
        if (continueBtn) {
            continueBtn.textContent = 'Next Prompt →';
            (continueBtn as HTMLButtonElement).disabled = false;
        }
        if (continueCard) {
            show('continueCard');
        }
    }
}

interface BeginAssessmentOptions {
    skipStartButtonHandling?: boolean;
}

async function beginAssessment(level?: string, options: BeginAssessmentOptions = {}): Promise<void> {
    const { skipStartButtonHandling = false } = options;
    const startBtn = APIUtils.$element('startBtn');
    const status = APIUtils.$element('status');

    if (moduleState.isSubmissionInProgress || moduleState.isRestartInProgress) {
        return;
    }

    if (!skipStartButtonHandling && startBtn) {
        startBtn.textContent = 'Starting...';
        (startBtn as HTMLButtonElement).disabled = true;
    }

    try {
        moduleState.resetSessionState({ preserveRestartFlag: moduleState.isRestartInProgress });
        moduleState.stopPromptTimer();
        hideTimerCard();
        const response = await startSession(level);

        hide('results');
        hide('continueCard');
        hide('startBtn');
        show('assessment-interface');

        if (response.session.current_prompt) {
            displayPrompt(response.session.current_prompt);
            displayEditor();
        } else {
            moduleState.currentPrompt = null;
        }

        moduleState.currentText = '';
        moduleState.currentImageFile = null;
        moduleState.showResults = false;

        const submitBtn = APIUtils.$element('submitBtn');
        if (submitBtn) {
            submitBtn.textContent = 'Submit Writing';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
        const submitCard = APIUtils.$element('submitCard');
        if (submitCard) {
            show(submitCard);
        }

        updateProgress();
        clearStatusMessage(status);
    } catch (error) {
        console.error('Start session failed:', error);
        const message = error instanceof Error
            ? (error.message || 'Failed to start session. Please try again.')
            : 'Failed to start session. Please try again.';
        updateStatusMessage(message, false, status);

        if (!skipStartButtonHandling && startBtn) {
            startBtn.textContent = 'Start Writing Assessment';
            (startBtn as HTMLButtonElement).disabled = false;
        }
        throw error;
    } finally {
        if (!skipStartButtonHandling && startBtn) {
            (startBtn as HTMLButtonElement).disabled = false;
        }
    }
}

async function restartWritingAssessment(level?: string): Promise<void> {
    if (moduleState.isSubmissionInProgress || moduleState.isRestartInProgress) {
        return;
    }

    const status = APIUtils.$element('status');
    const targetLevel = normalizeLevel(level || moduleState.lastEvaluationLevel || moduleState.session?.current_level || 'A2');
    const restartBtn = document.getElementById('restartWritingBtn') as HTMLButtonElement | null;

    moduleState.isRestartInProgress = true;
    if (restartBtn) {
        restartBtn.disabled = true;
        restartBtn.textContent = 'Starting...';
    }
    updateStatusMessage(`Restarting at CEFR ${targetLevel}...`, true, status);

    try {
        await beginAssessment(targetLevel, { skipStartButtonHandling: true });
        updateStatusMessage(`Restarted at CEFR ${targetLevel}.`, false, status);
    } catch (error) {
        const message = error instanceof Error && error.message
            ? error.message
            : 'Failed to restart assessment. Please try again.';
        updateStatusMessage(message, false, status);
    } finally {
        moduleState.isRestartInProgress = false;
        if (restartBtn) {
            restartBtn.disabled = false;
            restartBtn.textContent = 'Assess again';
        }
    }
}

/**
 * Handle login form submission
 */
async function handleLogin(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const usernameInput = APIUtils.$element('username') as HTMLInputElement | null;
    const passwordInput = APIUtils.$element('password') as HTMLInputElement | null;
    const loginMsg = APIUtils.$element('loginMsg');
    const status = APIUtils.$element('status');
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        if (status) updateStatusMessage('Please enter both username and password.', false, status);
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (loginMsg) loginMsg.textContent = '…';

    try {
        await login(username, password);
        if (status) updateStatusMessage('Login successful!', false, status);
    } catch (error) {
        if (status) updateStatusMessage('Login failed. Please try again.', false, status);
        if (loginMsg) loginMsg.textContent = 'Login failed';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

/**
 * Handle start session button click
 */
async function handleStartSession(): Promise<void> {
    try {
        await beginAssessment();
    } catch {
        // beginAssessment already handles error messaging
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the writing module
 */
async function initializeWritingModule(): Promise<void> {
    // Initialize authentication first
    await AuthUtils.initializeAuth();
    
    // Set up event listeners
    const loginForm = APIUtils.$element('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', handleStartSession);
    }
    
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', handleSubmitWriting);
    }
    
    const continueBtn = APIUtils.$element('continueBtn');
    if (continueBtn) {
        continueBtn.addEventListener('click', continueToNext);
    }
    
    // Authentication state is managed by AuthUtils.updateUIForAuthStatus()
    
    // Initialize UI state
    hide('assessment-interface');
    hide('results');
    hide('continueCard');
    hideTimerCard();
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export functions for global access
(window as any).WritingModule = {
    initializeWritingModule,
    handleLogin,
    handleStartSession,
    handleSubmitWriting,
    continueToNext,
    beginAssessment,
    restartWritingAssessment,
    updateWordCount,
    displayPrompt,
    displayEditor,
    displayEvaluationResults,
    showSessionComplete,
    moduleState
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWritingModule);
} else {
    initializeWritingModule();
}
