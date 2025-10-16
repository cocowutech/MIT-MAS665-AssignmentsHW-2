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
    public token: string | null = localStorage.getItem('token');
    public username: string | null = localStorage.getItem('username');
    
    // Session state
    public session: WritingSession | null = null;
    public currentPrompt: WritingPrompt | null = null;
    public currentText: string = '';
    public sessionStartTime: number = 0;
    public promptStartTime: number = 0;
    
    // UI state
    public isSubmissionInProgress: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;
    
    constructor() {
        this.initializeAuth();
    }
    
    /**
     * Initialize authentication state
     */
    private initializeAuth(): void {
        if (this.token && this.username) {
            AuthUtils.updateAuthHeader(this.token);
            AuthUtils.updateUIForAuthStatus(true, this.username);
        }
    }
    
    /**
     * Update authentication state
     */
    public updateAuth(token: string, username: string): void {
        this.token = token;
        this.username = username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', username);
        AuthUtils.updateAuthHeader(token);
        AuthUtils.updateUIForAuthStatus(true, username);
    }
    
    /**
     * Clear authentication state
     */
    public clearAuth(): void {
        this.token = null;
        this.username = null;
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        AuthUtils.updateUIForAuthStatus(false, '');
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.session = null;
        this.currentPrompt = null;
        this.currentText = '';
        this.sessionStartTime = 0;
        this.promptStartTime = 0;
        this.isSubmissionInProgress = false;
        this.showResults = false;
        this.isSessionActive = false;
    }
    
    /**
     * Start prompt timer
     */
    public startPromptTimer(): void {
        this.promptStartTime = Date.now();
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
async function startSession(): Promise<WritingSessionResponse> {
    try {
        const response = await APIUtils.WritingAPI.startSession('A2');
        moduleState.session = response.session;
        moduleState.currentPrompt = response.session.current_prompt;
        moduleState.sessionStartTime = Date.now();
        moduleState.isSessionActive = true;
        return response;
    } catch (error) {
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
        const response = await APIUtils.WritingAPI.submitResponse(submission);
        return response.evaluation;
    } catch (error) {
        throw new Error('Failed to submit writing');
    }
}

/**
 * Get next prompt in current session
 * Backend: POST /write/next (write.py:next)
 * @returns Next prompt or session completion status
 * @throws Error if request fails
 */
async function getNextPrompt(): Promise<WritingSessionResponse> {
    try {
        const response = await APIUtils.WritingAPI.getNextPrompt();
        if (response.session) {
            moduleState.session = response.session;
            moduleState.currentPrompt = response.session.current_prompt;
        }
        return response;
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
    
    const instructionsHtml = prompt.instructions.map(instruction => `<li>${instruction}</li>`).join('');
    const structureHintsHtml = prompt.structure_hints ? 
        prompt.structure_hints.map(hint => `<span class="chip struct">${hint}</span>`).join('') : '';
    
    promptDiv.innerHTML = `
        <div class="writing-prompt">
            <div class="prompt-header">
                <div class="prompt-title">${prompt.title}</div>
                <div class="prompt-meta">
                    <span class="meta-item">Level: ${prompt.level}</span>
                    <span class="meta-item">Type: ${prompt.type}</span>
                    <span class="meta-item">Words: ${prompt.word_limit}</span>
                    <span class="meta-item">Time: ${prompt.time_limit} min</span>
                </div>
            </div>
            <div class="prompt-body">
                <p>${prompt.description}</p>
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
    `;
    
    show('editor');
    
    // Focus on textarea
    const textarea = APIUtils.$element('writingTextarea') as HTMLTextAreaElement;
    if (textarea) {
        textarea.focus();
    }
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
 * Update progress display
 */
function updateProgress(): void {
    if (!moduleState.session) return;
    
    const progressDiv = APIUtils.$element('progress');
    if (!progressDiv) return;
    
    const progress = calculateProgress(moduleState.session.asked, moduleState.session.asked + moduleState.session.remaining);
    
    progressDiv.innerHTML = `
        <div class="writing-progress">
            <div class="progress-info">
                <span class="progress-text">Progress: ${moduleState.session.asked}/${moduleState.session.asked + moduleState.session.remaining}</span>
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
}

/**
 * Display evaluation results
 * @param evaluation - Evaluation result data
 */
function displayEvaluationResults(evaluation: WritingEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div class="writing-results">
            <div class="results-header">
                <h3 class="results-title">Writing Evaluation</h3>
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
                    <div class="score-item">
                        <div class="score-label">Time</div>
                        <div class="score-value">${formatTime(moduleState.getPromptTime())}</div>
                    </div>
                </div>
            </div>
            <div class="comment-box">
                <div class="comment-title">Feedback</div>
                <div class="comment-text">${evaluation.feedback}</div>
                ${evaluation.suggestions ? `
                    <div class="comment-title" style="margin-top: 12px;">Suggestions</div>
                    <div class="comment-text">${evaluation.suggestions.join('<br>')}</div>
                ` : ''}
            </div>
        </div>
    `;
    
    show('results');
    moduleState.showResults = true;
}

/**
 * Show session completion screen
 * @param finalScore - Final session score
 */
function showSessionComplete(finalScore: number): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const sessionTime = Date.now() - moduleState.sessionStartTime;
    
    resultsDiv.innerHTML = `
        <div class="session-summary">
            <div class="summary-title">Writing Assessment Complete!</div>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Score</div>
                    <div class="summary-stat-value">${finalScore}/100</div>
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
                    <div class="summary-stat-value">${moduleState.session?.current_level || 'N/A'}</div>
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
    `;
    
    show('results');
    moduleState.showResults = true;
    moduleState.isSessionActive = false;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle writing submission
 */
async function handleSubmitWriting(): Promise<void> {
    if (!moduleState.currentPrompt || !moduleState.currentText.trim()) {
        alert('Please write something before submitting.');
        return;
    }
    
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Submitting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    moduleState.isSubmissionInProgress = true;
    
    try {
        const submission: WritingSubmission = {
            prompt_id: moduleState.currentPrompt.id,
            text: moduleState.currentText.trim(),
            word_count: moduleState.getWordCount(),
            time_taken: moduleState.getPromptTime()
        };
        
        const evaluation = await submitWriting(submission);
        
        // Display results
        displayEvaluationResults(evaluation);
        
        // Get next prompt
        const nextResponse = await getNextPrompt();
        
        if (nextResponse.finished) {
            showSessionComplete(nextResponse.final_score || 0);
        } else {
            // Show continue button
            const continueBtn = APIUtils.$element('continueBtn');
            if (continueBtn) {
                continueBtn.textContent = 'Continue to Next Prompt';
                show('continueBtn');
            }
        }
        
    } catch (error) {
        console.error('Submission failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Submission failed. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Submit Writing';
            (submitBtn as HTMLButtonElement).disabled = false;
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
    if (continueBtn) {
        continueBtn.textContent = 'Loading...';
        (continueBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const nextResponse = await getNextPrompt();
        
        if (nextResponse.finished) {
            showSessionComplete(nextResponse.final_score || 0);
        } else {
            // Reset state for next prompt
            moduleState.currentText = '';
            moduleState.showResults = false;
            
            // Hide results and continue button
            hide('results');
            hide('continueBtn');
            
            // Display next prompt
            if (nextResponse.session.current_prompt) {
                displayPrompt(nextResponse.session.current_prompt);
                displayEditor();
                moduleState.startPromptTimer();
            }
            
            // Update progress
            updateProgress();
        }
        
    } catch (error) {
        console.error('Failed to get next prompt:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to load next prompt. Please try again.';
        
        if (continueBtn) {
            continueBtn.textContent = 'Continue to Next Prompt';
            (continueBtn as HTMLButtonElement).disabled = false;
        }
    }
}

/**
 * Handle login form submission
 */
async function handleLogin(event: Event): Promise<void> {
    event.preventDefault();
    
    const usernameInput = APIUtils.$element('username') as HTMLInputElement;
    const passwordInput = APIUtils.$element('password') as HTMLInputElement;
    
    if (!usernameInput || !passwordInput) return;
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
        alert('Please enter both username and password');
        return;
    }
    
    try {
        await login(username, password);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Login successful!';
        
        // Hide login form and show session interface
        const loginCard = APIUtils.$element('login-card');
        const sessionCard = APIUtils.$element('session-card');
        
        if (loginCard) loginCard.classList.add('hidden');
        if (sessionCard) sessionCard.classList.remove('hidden');
        
    } catch (error) {
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Login failed. Please try again.';
    }
}

/**
 * Handle start session button click
 */
async function handleStartSession(): Promise<void> {
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.textContent = 'Starting...';
        (startBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const response = await startSession();
        
        // Hide start button and show assessment interface
        hide('startBtn');
        show('assessment-interface');
        
        // Display first prompt and editor
        if (response.session.current_prompt) {
            displayPrompt(response.session.current_prompt);
            displayEditor();
            moduleState.startPromptTimer();
        }
        
        // Update progress
        updateProgress();
        
    } catch (error) {
        console.error('Start session failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start session. Please try again.';
        
        if (startBtn) {
            startBtn.textContent = 'Start Writing Assessment';
            (startBtn as HTMLButtonElement).disabled = false;
        }
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
    hide('continueBtn');
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
