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
import { authState, authenticateUser, logout, updateAuthHeader, updateUIForAuthStatus, initializeAuth } from '../shared/js/auth.js';
declare const APIUtils: any;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Speaking task interface
 */
interface SpeakingTask {
    id: string;
    cefr: string;
    exam_target: string;
    prompt: string;
    prep_seconds: number;
    record_seconds: number;
    guidance: string;
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
    session_id: string;
    item_id: string;
    transcript: string;
    audio_data?: string;  // Base64 encoded audio
    was_correct?: boolean;
}

/**
 * Speaking session response interface
 */
interface SpeakingSessionResponse {
    session_id: string;
    item: SpeakingTask;
    progress_current: number;
    progress_total: number;
    level: string;
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
    public sessionId: string | null = null;
    public currentTask: SpeakingTask | null = null;
    public progressCurrent: number = 0;
    public progressTotal: number = 0;
    public level: string = 'A2';
    public nextPendingItem: SpeakingTask | null = null;
    public micPermissionState: 'unknown' | 'granted' | 'denied' | 'unsupported' = 'unknown';
    
    constructor() {
    }
    
    /**
     * Reset session state
     */
    public resetSessionState(): void {
        this.sessionId = null;
        this.currentTask = null;
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

/**
 * Initialize the speaking module
 */
async function initializeSpeakingModule(): Promise<void> {
    // Initialize authentication first
    await initializeAuth();
    
    // Set up event listeners
    const loginBtn = APIUtils.$element('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const usernameInput = APIUtils.$element('username') as HTMLInputElement;
            const passwordInput = APIUtils.$element('password') as HTMLInputElement;
            const loginMsgElement = APIUtils.$element('loginMsg') as HTMLElement;

            if (!usernameInput || !passwordInput || !loginMsgElement) return;

            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (!username || !password) {
                loginMsgElement.className = 'message error';
                loginMsgElement.textContent = 'Please enter both username and password';
                return;
            }

            try {
                const authResult = await authenticateUser(username, password);
                if (authResult.success) {
                    loginMsgElement.className = 'message success';
                    loginMsgElement.textContent = `Successfully logged in as ${authState.username}!`;
                } else {
                    loginMsgElement.className = 'message error';
                    loginMsgElement.textContent = `Login failed: ${authResult.error || 'Unknown error'}`;
                }
            } catch (error) {
                loginMsgElement.className = 'message error';
                loginMsgElement.textContent = `Login failed: ${(error as Error).message}`;
            }
        });
    }
    
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', handleStartSession);
    }
    
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.addEventListener('click', handleRecordClick);
    }
    
    // Authentication state is managed by updateUIForAuthStatus()
    
    // Initialize UI state
    hide('taskInterface');
    hide('results');
    hide('prep');
    hide('record');
}
