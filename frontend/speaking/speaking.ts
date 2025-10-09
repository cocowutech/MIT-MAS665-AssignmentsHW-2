/**
 * Speaking Module TypeScript Implementation
 * 
 * This file contains the TypeScript implementation for the speaking assessment module.
 * It provides a complete speaking evaluation system with microphone recording, speech recognition,
 * and real-time feedback integration with the backend API.
 * 
 * @author ESL Assessment System
 * @version 1.0
 */

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

// Declare global utilities available from shared modules
declare const AuthUtils: any;
declare const APIUtils: any;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Speaking task interface
 */
interface SpeakingTask {
    id: string;
    prompt: string;
    instructions: string;
    prep_time: number;
    record_time: number;
    level: string;
}

/**
 * Speaking session interface
 */
interface SpeakingSession {
    session_id: string;
    current_task: SpeakingTask;
    asked: number;
    remaining: number;
    target_cefr: string;
    current_level: string;
}

/**
 * Speaking evaluation result interface
 */
interface SpeakingEvaluation {
    score: number;
    pronunciation_score: number;
    fluency_score: number;
    accuracy_score: number;
    feedback: string;
    transcript: string;
    level_adjustment: number;
}

/**
 * Speaking answer submission interface
 */
interface SpeakingAnswer {
    audio_data: string;  // Base64 encoded audio
    transcript: string;
    task_id: string;
}

/**
 * Speaking session response interface
 */
interface SpeakingSessionResponse {
    session: SpeakingSession;
    evaluation?: SpeakingEvaluation;
    finished: boolean;
    final_score?: number;
}

// ============================================================================
// GLOBAL DECLARATIONS
// ============================================================================

// Declarations already made above

// ============================================================================
// SPEAKING MODULE STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management for the speaking module
 */
class SpeakingModuleState {
    // Authentication state
    public token: string | null = localStorage.getItem('token');
    public username: string | null = localStorage.getItem('username');
    
    // Audio recording state
    public mediaRecorder: MediaRecorder | null = null;
    public recordedChunks: Blob[] = [];
    public recordedAudioBlob: Blob | null = null;
    
    // Session and UI state
    public countdownInterval: number | null = null;
    public recognition: any | null = null;
    public isRecording: boolean = false;
    public hasRecordedThisItem: boolean = false;
    public transcriptText: string = '';
    public submitTriggered: boolean = false;
    public asrFinalText: string = '';
    public session: SpeakingSession | null = null;
    public nextPendingItem: SpeakingTask | null = null;
    public micPermissionState: 'unknown' | 'granted' | 'denied' | 'unsupported' = 'unknown';
    
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
        this.nextPendingItem = null;
        this.isRecording = false;
        this.hasRecordedThisItem = false;
        this.transcriptText = '';
        this.submitTriggered = false;
        this.asrFinalText = '';
        this.recordedChunks = [];
        this.recordedAudioBlob = null;
        
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        if (this.recognition) {
            this.recognition.stop();
        }
    }
}

// ============================================================================
// GLOBAL STATE INSTANCE
// ============================================================================

const moduleState = new SpeakingModuleState();

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
 * Convert milliseconds to seconds (rounded up)
 * @param ms - Milliseconds
 * @returns Seconds
 */
function msToS(ms: number): number {
    return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * Clean and deduplicate speech recognition transcript
 * Removes repeated phrases and normalizes whitespace
 * Backend equivalent: speaking.py:_dedupe_transcript()
 * @param text - Raw transcript text
 * @returns Cleaned transcript
 */
function cleanTranscript(text: string): string {
    let s = (text || '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    
    const patterns = [
        [/(\b\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, '$1'],
        [/(\b\w+\s+\w+)(?:\s+\1\b)+/gi, '$1'],
        [/(\b\w+)(?:\s+\1\b)+/gi, '$1'],
    ];
    
    for (const [pat, rep] of patterns) {
        s = s.replace(pat as RegExp, rep as string);
    }
    
    return s.replace(/\s+/g, ' ').trim();
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
// SPEAKING SESSION FUNCTIONS
// ============================================================================

/**
 * Initialize a new speaking assessment session
 * Backend: POST /speaking/start (speaking.py:start)
 * @returns Session data with first speaking task
 * @throws Error if session initialization fails
 */
async function startSession(): Promise<SpeakingSessionResponse> {
    try {
        const response = await APIUtils.SpeakingAPI.startSession('A2');
        moduleState.session = response.session;
        return response;
    } catch (error) {
        throw new Error('Failed to start session');
    }
}

/**
 * Submit speaking answer for evaluation
 * Backend: POST /speaking/answer (speaking.py:answer)
 * @param answer - Speaking answer data
 * @returns Evaluation result
 * @throws Error if submission fails
 */
async function submitAnswer(answer: SpeakingAnswer): Promise<SpeakingEvaluation> {
    try {
        const response = await APIUtils.SpeakingAPI.submitAnswer(answer);
        return response.evaluation;
    } catch (error) {
        throw new Error('Failed to submit answer');
    }
}

/**
 * Get next task in current session
 * Backend: POST /speaking/next (speaking.py:next)
 * @returns Next task or session completion status
 * @throws Error if request fails
 */
async function getNextTask(): Promise<SpeakingSessionResponse> {
    try {
        const response = await APIUtils.SpeakingAPI.getNextTask();
        if (response.session) {
            moduleState.session = response.session;
        }
        return response;
    } catch (error) {
        throw new Error('Failed to get next task');
    }
}

// ============================================================================
// MICROPHONE AND AUDIO FUNCTIONS
// ============================================================================

/**
 * Request and validate microphone permissions
 * Handles browser compatibility and permission states
 * @returns True if microphone access granted
 */
async function ensureMicrophonePermission(): Promise<boolean> {
    if (moduleState.micPermissionState === 'granted') return true;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Microphone not supported in this browser. Please try Chrome or Firefox.';
        moduleState.micPermissionState = 'unsupported';
        return false;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        moduleState.micPermissionState = 'granted';
        return true;
    } catch (err) {
        moduleState.micPermissionState = 'denied';
        const status = APIUtils.$element('status');
        if (status) {
            status.textContent = 'Please allow microphone access to continue.';
        }
        alert('Microphone permission is required. Please allow access when prompted and try again.');
        return false;
    }
}

// ============================================================================
// SPEECH RECOGNITION FUNCTIONS
// ============================================================================

/**
 * Initialize browser speech recognition (ASR)
 * Provides real-time transcription of user speech
 * @returns ASR instance or null if unsupported
 */
function initASR(): any | null {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
        const warn = APIUtils.$element('asrWarning');
        if (warn) warn.textContent = 'Speech recognition not supported in this browser.';
        return null;
    }
    
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    
    r.onresult = (event: any) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
                moduleState.asrFinalText += res[0].transcript + ' ';
            } else {
                interimText += res[0].transcript;
            }
        }
        moduleState.transcriptText = (moduleState.asrFinalText + interimText).trim();
        const t = APIUtils.$element('transcript');
        if (t) t.textContent = cleanTranscript(moduleState.transcriptText);
    };
    
    r.onerror = () => {};
    r.onend = () => {
        // Manual submit required; no auto-submit on ASR end
    };
    
    return r;
}

// ============================================================================
// AUDIO RECORDING FUNCTIONS
// ============================================================================

/**
 * Start audio recording with MediaRecorder API
 * Captures audio data and provides real-time speech recognition
 * @param recordSeconds - Maximum recording duration
 */
async function beginRecording(recordSeconds: number): Promise<void> {
    console.log('beginRecording called');
    hide('prep');
    show('record');
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Stop';
        (recordBtn as HTMLButtonElement).disabled = false;
    }
    
    moduleState.isRecording = true;
    moduleState.hasRecordedThisItem = true;
    moduleState.transcriptText = '';
    moduleState.asrFinalText = '';
    moduleState.recordedChunks = [];
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        moduleState.mediaRecorder = new MediaRecorder(stream);
        
        moduleState.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                moduleState.recordedChunks.push(event.data);
            }
        };
        
        moduleState.mediaRecorder.onstop = () => {
            const blob = new Blob(moduleState.recordedChunks, { type: 'audio/webm' });
            moduleState.recordedAudioBlob = blob;
            
            const audioPlayback = APIUtils.$element('audioPlayback') as HTMLAudioElement;
            if (audioPlayback) {
                audioPlayback.src = URL.createObjectURL(blob);
            }
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        moduleState.mediaRecorder.start();
        
        // Initialize speech recognition
        moduleState.recognition = initASR();
        if (moduleState.recognition) {
            moduleState.recognition.start();
        }
        
        // Start recording timer
        let remaining = recordSeconds;
        const timer = APIUtils.$element('recordTimer');
        if (timer) timer.textContent = remaining.toString();
        
        moduleState.countdownInterval = window.setInterval(() => {
            remaining -= 1;
            if (timer) timer.textContent = remaining.toString();
            
            if (remaining <= 0) {
                if (moduleState.countdownInterval) {
                    clearInterval(moduleState.countdownInterval);
                    moduleState.countdownInterval = null;
                }
                stopRecording();
            }
        }, 1000);
        
    } catch (error) {
        console.error('Recording failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Recording failed. Please try again.';
    }
}

/**
 * Stop audio recording and speech recognition
 */
function stopRecording(): void {
    if (!moduleState.isRecording) return;
    
    moduleState.isRecording = false;
    
    if (moduleState.mediaRecorder && moduleState.mediaRecorder.state !== 'inactive') {
        moduleState.mediaRecorder.stop();
    }
    
    if (moduleState.recognition) {
        moduleState.recognition.stop();
    }
    
    if (moduleState.countdownInterval) {
        clearInterval(moduleState.countdownInterval);
        moduleState.countdownInterval = null;
    }
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Submit';
        (recordBtn as HTMLButtonElement).disabled = false;
    }
}

// ============================================================================
// UI STATE MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Start preparation phase with countdown timer
 * Manages UI state transitions between prep and recording phases
 * @param prepSeconds - Preparation time in seconds
 * @param recordSeconds - Recording time limit in seconds
 */
async function startPrepAndRecord(prepSeconds: number, recordSeconds: number): Promise<void> {
    const prepTimer = APIUtils.$element('prepTimer');
    const recordTimer = APIUtils.$element('recordTimer');
    
    if (prepTimer) prepTimer.textContent = prepSeconds.toString();
    if (recordTimer) recordTimer.textContent = Math.min(recordSeconds, 60).toString();
    
    show('prep');
    hide('record');
    
    moduleState.isRecording = false;
    moduleState.hasRecordedThisItem = false;
    moduleState.transcriptText = '';
    moduleState.submitTriggered = false;
    
    const audioPlayback = APIUtils.$element('audioPlayback') as HTMLAudioElement;
    if (audioPlayback) audioPlayback.src = '';
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Start';
        (recordBtn as HTMLButtonElement).disabled = false;
    }
    
    if (moduleState.countdownInterval) {
        clearInterval(moduleState.countdownInterval);
    }
    
    let remaining = prepSeconds;
    moduleState.countdownInterval = window.setInterval(() => {
        remaining -= 1;
        if (prepTimer) prepTimer.textContent = remaining.toString();
        
        if (remaining <= 0) {
            if (moduleState.countdownInterval) {
                clearInterval(moduleState.countdownInterval);
                moduleState.countdownInterval = null;
            }
            // Reveal recording controls and start 5s auto-start countdown
            showRecordUI(parseInt(recordTimer?.textContent || '60', 10));
        }
    }, 1000);
}

/**
 * Show recording UI and start auto-record countdown
 * @param recordSeconds - Recording time limit
 */
function showRecordUI(recordSeconds: number): void {
    hide('prep');
    show('record');
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Start';
        (recordBtn as HTMLButtonElement).disabled = false;
    }
    
    // Auto-start recording after 5 seconds
    let countdown = 5;
    const timer = APIUtils.$element('recordTimer');
    if (timer) timer.textContent = countdown.toString();
    
    moduleState.countdownInterval = window.setInterval(() => {
        countdown -= 1;
        if (timer) timer.textContent = countdown.toString();
        
        if (countdown <= 0) {
            if (moduleState.countdownInterval) {
                clearInterval(moduleState.countdownInterval);
                moduleState.countdownInterval = null;
            }
            beginRecording(recordSeconds);
        }
    }, 1000);
}

// ============================================================================
// SUBMISSION AND EVALUATION FUNCTIONS
// ============================================================================

/**
 * Submit current recording for evaluation
 * Handles audio encoding and API submission
 */
async function submitRecording(): Promise<void> {
    if (moduleState.submitTriggered || !moduleState.recordedAudioBlob || !moduleState.session) {
        return;
    }
    
    moduleState.submitTriggered = true;
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Submitting...';
        (recordBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
        // Convert audio blob to base64
        const arrayBuffer = await moduleState.recordedAudioBlob.arrayBuffer();
        const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        // Prepare answer data
        const answer: SpeakingAnswer = {
            audio_data: base64Audio,
            transcript: cleanTranscript(moduleState.transcriptText),
            task_id: moduleState.session.current_task.id
        };
        
        // Submit for evaluation
        const evaluation = await submitAnswer(answer);
        
        // Display results
        displayEvaluationResults(evaluation);
        
        // Get next task
        const nextResponse = await getNextTask();
        
        if (nextResponse.finished) {
            showSessionComplete(nextResponse.final_score || 0);
        } else {
            // Continue to next task
            setTimeout(() => {
                startPrepAndRecord(
                    nextResponse.session.current_task.prep_time,
                    nextResponse.session.current_task.record_time
                );
            }, 3000);
        }
        
    } catch (error) {
        console.error('Submission failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Submission failed. Please try again.';
        
        if (recordBtn) {
            recordBtn.textContent = 'Submit';
            (recordBtn as HTMLButtonElement).disabled = false;
        }
    }
    
    moduleState.submitTriggered = false;
}

/**
 * Display evaluation results
 * @param evaluation - Evaluation result data
 */
function displayEvaluationResults(evaluation: SpeakingEvaluation): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div class="evaluation-results">
            <div class="evaluation-header">
                <h3 class="evaluation-title">Evaluation Results</h3>
                <div class="evaluation-score">${evaluation.score}/100</div>
            </div>
            <div class="evaluation-breakdown">
                <div class="evaluation-item">
                    <div class="evaluation-item-label">Pronunciation</div>
                    <div class="evaluation-item-value">${evaluation.pronunciation_score}/100</div>
                </div>
                <div class="evaluation-item">
                    <div class="evaluation-item-label">Fluency</div>
                    <div class="evaluation-item-value">${evaluation.fluency_score}/100</div>
                </div>
                <div class="evaluation-item">
                    <div class="evaluation-item-label">Accuracy</div>
                    <div class="evaluation-item-value">${evaluation.accuracy_score}/100</div>
                </div>
            </div>
            <div class="evaluation-feedback">
                <strong>Feedback:</strong><br>
                ${evaluation.feedback}
            </div>
        </div>
    `;
    
    show('results');
}

/**
 * Show session completion screen
 * @param finalScore - Final session score
 */
function showSessionComplete(finalScore: number): void {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div class="evaluation-results">
            <div class="evaluation-header">
                <h3 class="evaluation-title">Session Complete!</h3>
                <div class="evaluation-score">${finalScore}/100</div>
            </div>
            <div class="evaluation-feedback">
                <p>Congratulations! You have completed the speaking assessment.</p>
                <p>Your final score: <strong>${finalScore}/100</strong></p>
                <p>Thank you for using the ESL Assessment System.</p>
            </div>
        </div>
    `;
    
    show('results');
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle record button click
 */
function handleRecordClick(): void {
    if (!moduleState.isRecording) {
        if (moduleState.hasRecordedThisItem) {
            submitRecording();
        } else {
            const recordTimer = APIUtils.$element('recordTimer');
            const recordSeconds = parseInt(recordTimer?.textContent || '60', 10);
            beginRecording(recordSeconds);
        }
    } else {
        stopRecording();
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
        
        // UI state is managed by AuthUtils.updateUIForAuthStatus()
        
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
        // Check microphone permission
        const micGranted = await ensureMicrophonePermission();
        if (!micGranted) {
            throw new Error('Microphone permission required');
        }
        
        // Start session
        const response = await startSession();
        
        // Hide start button and show task interface
        hide('startBtn');
        show('taskInterface');
        
        // Start first task
        startPrepAndRecord(
            response.session.current_task.prep_time,
            response.session.current_task.record_time
        );
        
    } catch (error) {
        console.error('Start session failed:', error);
        const status = APIUtils.$element('status');
        if (status) status.textContent = 'Failed to start session. Please try again.';
        
        if (startBtn) {
            startBtn.textContent = 'Start Speaking Assessment';
            (startBtn as HTMLButtonElement).disabled = false;
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the speaking module
 */
async function initializeSpeakingModule(): Promise<void> {
    // Initialize authentication first
    await AuthUtils.initializeAuth();
    
    // Set up event listeners
    const loginForm = APIUtils.$element('login-card');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', handleStartSession);
    }
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.addEventListener('click', handleRecordClick);
    }
    
    // Authentication state is managed by AuthUtils.updateUIForAuthStatus()
    
    // Initialize UI state
    hide('taskInterface');
    hide('results');
    hide('prep');
    hide('record');
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export functions for global access
(window as any).SpeakingModule = {
    initializeSpeakingModule,
    handleLogin,
    handleStartSession,
    handleRecordClick,
    startPrepAndRecord,
    beginRecording,
    stopRecording,
    submitRecording,
    displayEvaluationResults,
    showSessionComplete,
    moduleState
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpeakingModule);
} else {
    initializeSpeakingModule();
}
