/**
 * Reading Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the reading assessment module.
 * It provides a complete reading evaluation system with adaptive difficulty,
 * multiple choice questions, and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Reading passage interface
 */
interface ReadingPassage {
    text: string;
    index: number;
}

/**
 * Reading question interface
 */
interface ReadingQuestion {
    id: string;
    number: number;
    text: string;
    choices: string[];
    level_cefr: string;
    cambridge_level: string;
    correct_choice_index: number;
    rationale: string;
}

/**
 * Reading session interface
 */
interface ReadingSession {
    session_id: string;
    target_cefr: string;
    cambridge_level: string;
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    total_questions: number;
}

/**
 * Reading answer interface
 */
interface ReadingAnswer {
    session_id: string;
    question_id: string;
    choice_index: number;
}

/**
 * Reading evaluation result interface
 */
interface ReadingEvaluation {
    correct: boolean;
    correct_choice_index: number;
    rationale: string;
    updated_target_cefr: string;
    cambridge_level: string;
    streak_correct: number;
    streak_incorrect: number;
    asked: number;
    remaining: number;
    finished: boolean;
    summary?: {
        total: number;
        correct: number;
        incorrect: number;
        start_cefr: string;
        end_cefr: string;
    };
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    new_passage?: string;
    next_question?: ReadingQuestion;
}

/**
 * Reading session response interface
 */
interface ReadingSessionResponse {
    session_id: string;
    passage: string;
    target_cefr: string;
    cambridge_level: string;
    passage_index: number;
    max_passages: number;
    questions_per_passage: number;
    question: ReadingQuestion;
    total_questions: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

declare const AuthUtils: any;
declare const APIUtils: any;

// ============================================================================
// READING MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the reading module
 */
class ReadingModuleState {
    // Authentication state
    public token: string | null = null;
    public username: string | null = null;

    // Session state
    public session: ReadingSession | null = null;
    public currentPassage: ReadingPassage | null = null;
    public currentQuestion: ReadingQuestion | null = null;
    public selectedAnswer: number | null = null;
    public questionStartTime: number = 0;
    public sessionStartTime: number = 0;
    public questionsAsked: number = 0;
    public questionsRemaining: number = 0;

    // UI state
    public isQuestionAnswered: boolean = false;
    public showResults: boolean = false;
    public isSessionActive: boolean = false;
    public lastEvaluation: any = null;
    public finalLevel: string | null = null;
    public isPreloadingNextPassage: boolean = false;
    public lastPreloadTriggerQuestion: number | null = null;

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
     * Sync local module state with global auth status
     */
    private applyAuthState(state: { token: string | null; username: string | null; isAuthenticated: boolean }): void {
        this.token = state.token;
        this.username = state.username;

        if (!state.isAuthenticated) {
            this.resetSessionState();
        }
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.session = null;
        this.currentPassage = null;
        this.currentQuestion = null;
        this.selectedAnswer = null;
        this.questionStartTime = 0;
        this.sessionStartTime = 0;
        this.questionsAsked = 0;
        this.questionsRemaining = 0;
        this.isQuestionAnswered = false;
        this.showResults = false;
        this.isSessionActive = false;
        this.isPreloadingNextPassage = false;
        this.lastPreloadTriggerQuestion = null;
    }
    
    /**
     * Start question timer
     */
    public startQuestionTimer(): void {
        this.questionStartTime = Date.now();
    }
    
    /**
     * Get time taken for current question
     */
    public getQuestionTime(): number {
        if (this.questionStartTime === 0) return 0;
        return Date.now() - this.questionStartTime;
    }
}

// ============================================================================
// GLOBAL STATE INSTANCE
// ============================================================================

const moduleState = new ReadingModuleState();

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

/**
 * Determine whether we should kick off a background preload for the next passage
 */
function shouldPreloadNextPassage(questionNumber: number | null): boolean {
    if (!moduleState.session) return false;
    if (typeof questionNumber !== 'number' || questionNumber < 3) return false;
    const perPassage = moduleState.session.questions_per_passage || 0;
    if (perPassage === 0) return false;
    return (questionNumber - 3) % perPassage === 0;
}

/**
 * Fire-and-forget preload of the next passage without blocking the UI
 */
function schedulePreloadNextPassage(payload: ReadingAnswer, questionNumber: number | null): void {
    if (!shouldPreloadNextPassage(questionNumber)) return;
    if (moduleState.isPreloadingNextPassage) return;
    if (moduleState.lastPreloadTriggerQuestion === questionNumber) return;

    moduleState.isPreloadingNextPassage = true;
    moduleState.lastPreloadTriggerQuestion = questionNumber;

    APIUtils.ReadingAPI.preloadNextPassage(payload)
        .then(() => console.log('Next passage preloaded successfully'))
        .catch((error: unknown) => console.log('Preloading failed (non-critical):', error))
        .finally(() => {
            moduleState.isPreloadingNextPassage = false;
        });
}

/**
 * Update local session metadata using the latest evaluation payload
 */
function updateSessionFromEvaluation(evaluation: ReadingEvaluation): void {
    if (!moduleState.session) return;
    moduleState.session.target_cefr = evaluation.updated_target_cefr;
    moduleState.session.cambridge_level = evaluation.cambridge_level;
    moduleState.session.passage_index = evaluation.passage_index;
    moduleState.session.max_passages = evaluation.max_passages;
    moduleState.session.questions_per_passage = evaluation.questions_per_passage;
    moduleState.questionsAsked = evaluation.asked;
    moduleState.questionsRemaining = evaluation.remaining;
}

/**
 * Ensure the displayed passage matches the latest evaluation state
 */
async function refreshPassageIfNeeded(evaluation: ReadingEvaluation): Promise<void> {
    if (!moduleState.session) return;

    const nextPassageIndex = evaluation.passage_index;
    const currentIndex = moduleState.currentPassage?.index;

    // If we already have the passage text from the evaluation payload, use it directly
    if (evaluation.new_passage) {
        moduleState.currentPassage = {
            text: evaluation.new_passage,
            index: nextPassageIndex
        };
        displayPassage(moduleState.currentPassage);
        return;
    }

    // When the index changes without an inline passage payload (preloaded case), fetch session state
    if (typeof currentIndex === 'number' && currentIndex === nextPassageIndex) {
        // Same passage; just refresh meta data so the header reflects new index/levels
        if (moduleState.currentPassage) {
            moduleState.currentPassage.index = nextPassageIndex;
            displayPassage(moduleState.currentPassage);
        }
        return;
    }

    try {
        const sessionState = await APIUtils.ReadingAPI.getSessionState(moduleState.session.session_id);
        moduleState.session.target_cefr = sessionState.target_cefr;
        moduleState.session.cambridge_level = sessionState.cambridge_level;
        moduleState.session.passage_index = sessionState.passage_index;
        moduleState.session.max_passages = sessionState.max_passages;
        moduleState.session.questions_per_passage = sessionState.questions_per_passage;
        moduleState.currentPassage = {
            text: sessionState.passage,
            index: sessionState.passage_index
        };
        displayPassage(moduleState.currentPassage);
    } catch (error) {
        console.warn('Failed to refresh reading passage state:', error);
    }
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
// READING SESSION FUNCTIONS
// ============================================================================

/**
 * Initialize a new reading assessment session
 * Backend: POST /read/start (read.py:start)
 * @param startLevel - CEFR level to start the assessment with
 * @returns Session data with first reading task
 * @throws Error if session initialization fails
 */
async function startSession(startLevel: string = 'A2'): Promise<ReadingSessionResponse> {
    try {
        const response = await APIUtils.ReadingAPI.startSession(startLevel);
        // Backend returns data at top level, not nested under 'session'
        moduleState.session = {
            session_id: response.session_id,
            target_cefr: response.target_cefr,
            cambridge_level: response.cambridge_level,
            passage_index: response.passage_index,
            max_passages: response.max_passages,
            questions_per_passage: response.questions_per_passage,
            total_questions: response.total_questions
        };
        moduleState.currentPassage = {
            text: response.passage,
            index: response.passage_index
        };
        moduleState.currentQuestion = response.question;
        moduleState.sessionStartTime = Date.now();
        moduleState.isSessionActive = true;
        moduleState.questionsAsked = response.question?.number || 1;
        moduleState.questionsRemaining = Math.max(0, (response.total_questions || 0) - moduleState.questionsAsked);
        moduleState.isPreloadingNextPassage = false;
        moduleState.lastPreloadTriggerQuestion = null;
        return response;
    } catch (error) {
        throw new Error('Failed to start session');
    }
}

/**
 * Submit reading answer for evaluation
 * Backend: POST /read/answer (read.py:answer)
 * @param answer - Reading answer data
 * @returns Evaluation result
 * @throws Error if submission fails
 */
async function submitAnswer(answer: ReadingAnswer): Promise<ReadingEvaluation> {
    try {
        const response = await APIUtils.ReadingAPI.submitAnswer(answer);
        // Backend returns evaluation data at top level, not nested under 'evaluation'
        return response;
    } catch (error) {
        throw new Error('Failed to submit answer');
    }
}

/**
 * Get next question in current session
 * Backend: POST /read/next (read.py:next)
 * @returns Next question or session completion status
 * @throws Error if request fails
 */
async function getNextQuestion(): Promise<ReadingSessionResponse> {
    try {
        const response = await APIUtils.ReadingAPI.getNextQuestion();
        // This function is deprecated - next question comes from submit response
        throw new Error('getNextQuestion is deprecated - use submit response instead');
    } catch (error) {
        throw new Error('Failed to get next question');
    }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

/**
 * Display reading passage
 * @param passage - Reading passage data
 */
function displayPassage(passage: ReadingPassage): void {
    const passageDiv = APIUtils.$element('passage');
    if (!passageDiv) return;
    
    passageDiv.innerHTML = `
        <div class="reading-passage">
            <div class="passage-title">Reading Passage ${passage.index}</div>
            <div class="passage-text">${passage.text}</div>
            <div class="passage-meta">
                Level: ${moduleState.session?.target_cefr || 'A2'} | Cambridge: ${moduleState.session?.cambridge_level || 'KET'}
            </div>
        </div>
    `;
    
    show('passage');
}

/**
 * Display reading question
 * @param question - Reading question data
 */
function displayQuestion(question: ReadingQuestion): void {
    const questionDiv = APIUtils.$element('question');
    if (!questionDiv) return;
    
    const choicesHtml = question.choices.map((choice, index) => `
        <div class="reading-choice" data-index="${index}" onclick="selectAnswer(${index})">
            <span class="choice-key">${String.fromCharCode(65 + index)}</span>
            <span class="choice-text">${choice}</span>
        </div>
    `).join('');
    
    questionDiv.innerHTML = `
        <div class="reading-question">
            <div class="question-header">
                <span class="question-number">Question ${question.number}</span>
                <span class="question-difficulty">${question.level_cefr}</span>
            </div>
            <div class="question-text">${question.text}</div>
            <div class="reading-choices">
                ${choicesHtml}
            </div>
        </div>
    `;
    
    show('question');
    moduleState.startQuestionTimer();
    
    // Reset submit button for new question
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Submit Answer';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
}

/**
 * Update progress display
 */
function updateProgress(): void {
    if (!moduleState.session) return;
    
    const progressDiv = APIUtils.$element('progress');
    if (!progressDiv) return;
    
    const totalQuestions = moduleState.session?.total_questions || 15;
    const currentQuestionRaw = moduleState.questionsAsked || moduleState.currentQuestion?.number || 1;
    const currentQuestion = Math.min(currentQuestionRaw, totalQuestions);
    const progress = calculateProgress(currentQuestion, totalQuestions);
    
    progressDiv.innerHTML = `
        <div class="reading-progress">
            <div class="progress-info">
                <span class="progress-text">Progress: ${currentQuestion}/${totalQuestions}</span>
                <span class="reading-level">
                    Level: <span class="level-badge">${moduleState.session?.target_cefr || 'A2'}</span>
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
function displayEvaluationResults(evaluation: ReadingEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const isCorrect = evaluation.correct;
    const scoreColor = isCorrect ? '#22c55e' : '#ef4444';
    
    resultsDiv.innerHTML = `
        <div class="reading-results">
            <div class="results-header">
                <h3 class="results-title">Question Result</h3>
                <div class="results-score" style="color: ${scoreColor}">
                    ${isCorrect ? 'Correct' : 'Incorrect'}
                </div>
            </div>
            <div class="results-breakdown">
                <div class="result-item">
                    <div class="result-label">Progress</div>
                    <div class="result-value">${evaluation.asked}/${evaluation.asked + evaluation.remaining}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Time</div>
                    <div class="result-value">${formatTime(moduleState.getQuestionTime())}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Level</div>
                    <div class="result-value">${evaluation.updated_target_cefr}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Explanation</div>
                <div class="feedback-text">${evaluation.rationale}</div>
            </div>
        </div>
    `;
    
    show('results');
    moduleState.showResults = true;
}

/**
 * Show session completion screen
 * @param correctCount - Total number of correct answers
 * @param totalQuestions - Total number of questions in the session
 */
function showSessionComplete(correctCount: number, totalQuestions?: number): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    const sessionTime = Date.now() - moduleState.sessionStartTime;
    const finalLevel = moduleState.lastEvaluation?.updated_target_cefr || moduleState.session?.target_cefr || 'A2';
    const total = totalQuestions ?? moduleState.session?.total_questions ?? moduleState.lastEvaluation?.summary?.total ?? 0;
    const finalScoreDisplay = total > 0 ? `${correctCount}/${total}` : `${correctCount}`;

    // Store final level for assess again functionality
    moduleState.finalLevel = finalLevel;
    moduleState.questionsRemaining = 0;
    if (moduleState.session) {
        moduleState.questionsAsked = moduleState.session.total_questions;
    }
    
    resultsDiv.innerHTML = `
        <div class="session-summary">
            <div class="summary-title">Reading Assessment Complete!</div>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Score</div>
                    <div class="summary-stat-value">${finalScoreDisplay}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Questions</div>
                    <div class="summary-stat-value">${moduleState.session?.total_questions || 0}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Time Taken</div>
                    <div class="summary-stat-value">${formatTime(sessionTime)}</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-label">Final Level</div>
                    <div class="summary-stat-value">${finalLevel}</div>
                </div>
            </div>
            <div class="results-feedback">
                <div class="feedback-title">Congratulations!</div>
                <div class="feedback-text">
                    You have completed the reading assessment. Your performance has been evaluated
                    and your English reading level has been determined. Thank you for using the
                    ESL Assessment System.
                </div>
            </div>
        </div>
    `;
    
    // Update submit button to "Assess again"
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Assess again';
        (submitBtn as HTMLButtonElement).disabled = false;
    }
    
    show('results');
    moduleState.showResults = true;
    moduleState.isSessionActive = false;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle answer selection
 * @param index - Selected answer index
 */
function selectAnswer(index: number): void {
    if (moduleState.isQuestionAnswered) return;
    
    moduleState.selectedAnswer = index;
    
    // Update UI to show selection
    const choices = document.querySelectorAll('.reading-choice');
    choices.forEach((choice, i) => {
        choice.classList.remove('selected');
        if (i === index) {
            choice.classList.add('selected');
        }
    });
    
    // Enable submit button
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        (submitBtn as HTMLButtonElement).disabled = false;
    }
}

/**
 * Handle answer submission
 */
async function handleSubmitAnswer(): Promise<void> {
    const submitBtn = APIUtils.$element('submitBtn');
    
    // Check if this is a continue action
    if (submitBtn && submitBtn.textContent === 'Continue to Next Question') {
        await continueToNext();
        return;
    }
    
    // Check if this is an assess again action
    if (submitBtn && submitBtn.textContent === 'Assess again') {
        await handleAssessAgain();
        return;
    }
    
    if (!moduleState.currentQuestion || moduleState.selectedAnswer === null) {
        return;
    }
    
    if (submitBtn) {
        submitBtn.textContent = 'Submitting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        const answer: ReadingAnswer = {
            session_id: moduleState.session?.session_id || '',
            question_id: moduleState.currentQuestion.id,
            choice_index: moduleState.selectedAnswer
        };
        
        const evaluation = await submitAnswer(answer);
        moduleState.isQuestionAnswered = true;
        moduleState.lastEvaluation = evaluation; // Store for continueToNext
        updateSessionFromEvaluation(evaluation);
        
        // Kick off background preload after the third question in each passage
        schedulePreloadNextPassage(answer, moduleState.currentQuestion?.number ?? null);
        
        // Display results
        displayEvaluationResults(evaluation);
        
        // Check if session is finished or get next question from submit response
        if (evaluation.finished) {
            showSessionComplete(
                evaluation.summary?.correct || 0,
                evaluation.summary?.total ?? (moduleState.session?.total_questions || 0)
            );
        } else if (evaluation.next_question) {
            // Update submit button to continue button
            if (submitBtn) {
                submitBtn.textContent = 'Continue to Next Question';
                (submitBtn as HTMLButtonElement).disabled = false;
            }
        }
        
    } catch (error) {
        console.error('Submission failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Submission failed. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Submit Answer';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
    }
}

/**
 * Handle continue to next question
 */
async function continueToNext(): Promise<void> {
    if (!moduleState.session) return;
    
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Loading...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        // Get next question from the stored response
        const evaluation = moduleState.lastEvaluation;
        if (!evaluation || !evaluation.next_question) {
            throw new Error('No next question available');
        }
        
        if (evaluation.finished) {
            showSessionComplete(
                evaluation.summary?.correct || 0,
                evaluation.summary?.total ?? (moduleState.session?.total_questions || 0)
            );
        } else {
            // Reset state for next question
            moduleState.selectedAnswer = null;
            moduleState.isQuestionAnswered = false;
            moduleState.showResults = false;

            // Hide results
            hide('results');

            // Ensure passage and session metadata reflect the new state
            updateSessionFromEvaluation(evaluation);
            await refreshPassageIfNeeded(evaluation);

            // Display next question
            if (evaluation.next_question) {
                moduleState.currentQuestion = evaluation.next_question;
                displayQuestion(evaluation.next_question);
            }

            // Update progress
            updateProgress();
        }
        
    } catch (error) {
        console.error('Failed to get next question:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to load next question. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Continue to Next Question';
            (submitBtn as HTMLButtonElement).disabled = false;
        }
    }
}

/**
 * Handle assess again functionality
 */
async function handleAssessAgain(): Promise<void> {
    const submitBtn = APIUtils.$element('submitBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Starting...';
        (submitBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        // Reset module state
        moduleState.session = null;
        moduleState.currentPassage = null;
        moduleState.currentQuestion = null;
        moduleState.selectedAnswer = null;
        moduleState.isQuestionAnswered = false;
        moduleState.showResults = false;
        moduleState.isSessionActive = false;
        moduleState.lastEvaluation = null;
        moduleState.questionsAsked = 0;
        moduleState.questionsRemaining = 0;
        moduleState.isPreloadingNextPassage = false;
        moduleState.lastPreloadTriggerQuestion = null;
        
        // Hide results and assessment interface
        hide('results');
        hide('assessment-interface');
        
        // Start new session with final level
        const startLevel = moduleState.finalLevel || 'A2';
        await startSession(startLevel);
        
        // Show assessment interface
        show('assessment-interface');
        
        // Display first passage and question
        if (moduleState.currentPassage) {
            displayPassage(moduleState.currentPassage);
        }
        if (moduleState.currentQuestion) {
            displayQuestion(moduleState.currentQuestion);
        }
        
        // Update progress
        updateProgress();
        
    } catch (error) {
        console.error('Failed to start new assessment:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start new assessment. Please try again.';
        
        if (submitBtn) {
            submitBtn.textContent = 'Assess again';
            (submitBtn as HTMLButtonElement).disabled = false;
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
        if (status) status.textContent = 'Please enter both username and password.';
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (loginMsg) loginMsg.textContent = '…';

    try {
        await login(username, password);
        if (status) status.textContent = 'Login successful!';
    } catch (error) {
        if (status) status.textContent = 'Login failed. Please try again.';
        if (loginMsg) loginMsg.textContent = 'Login failed';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
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
        // Use final level from previous assessment if available, otherwise default to A2
        const startLevel = moduleState.finalLevel || 'A2';
        const response = await startSession(startLevel);
        
        // Hide start button and show assessment interface
        hide('startBtn');
        show('assessment-interface');
        
        // Display first passage and question
        if (moduleState.currentPassage) {
            displayPassage(moduleState.currentPassage);
        }
        if (moduleState.currentQuestion) {
            displayQuestion(moduleState.currentQuestion);
        }
        
        // Update progress
        updateProgress();
        
    } catch (error) {
        console.error('Start session failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start session. Please try again.';
        
        if (startBtn) {
            startBtn.textContent = 'Start Reading Assessment';
            (startBtn as HTMLButtonElement).disabled = false;
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the reading module
 */
async function initializeReadingModule(): Promise<void> {
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
        submitBtn.addEventListener('click', handleSubmitAnswer);
    }
    
    // Continue button functionality is now handled by submitBtn
    
    // Authentication state is managed by AuthUtils.updateUIForAuthStatus()
    
    // Initialize UI state
    hide('assessment-interface');
    hide('results');
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export functions for global access
(window as any).ReadingModule = {
    initializeReadingModule,
    handleLogin,
    handleStartSession,
    selectAnswer,
    handleSubmitAnswer,
    continueToNext,
    handleAssessAgain,
    displayPassage,
    displayQuestion,
    displayEvaluationResults,
    showSessionComplete,
    moduleState
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeReadingModule);
} else {
    initializeReadingModule();
}
