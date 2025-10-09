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
// Declarations already made above
// ============================================================================
// SPEAKING MODULE STATE MANAGEMENT
// ============================================================================
/**
 * Centralized state management for the speaking module
 */
class SpeakingModuleState {
    constructor() {
        // Authentication state
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username');
        // Audio recording state
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordedAudioBlob = null;
        // Session and UI state
        this.countdownInterval = null;
        this.recognition = null;
        this.isRecording = false;
        this.hasRecordedThisItem = false;
        this.transcriptText = '';
        this.submitTriggered = false;
        this.asrFinalText = '';
        this.sessionId = null;
        this.currentTask = null;
        this.progressCurrent = 0;
        this.progressTotal = 0;
        this.level = 'A2';
        this.nextPendingItem = null;
        this.micPermissionState = 'unknown';
        this.initializeAuth();
    }
    /**
     * Initialize authentication state
     */
    initializeAuth() {
        if (this.token && this.username) {
            AuthUtils.updateAuthHeader(this.token);
            AuthUtils.updateUIForAuthStatus(true, this.username);
        }
    }
    /**
     * Update authentication state
     */
    updateAuth(token, username) {
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
    clearAuth() {
        this.token = null;
        this.username = null;
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        AuthUtils.updateUIForAuthStatus(false, '');
    }
    /**
     * Reset session state
     */
    resetSessionState() {
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
function show(el) {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node)
        return;
    node.classList.remove('hidden');
}
/**
 * Hide an element by adding the 'hidden' class
 * @param el - Element ID or DOM element
 */
function hide(el) {
    const node = typeof el === 'string' ? APIUtils.$element(el) : el;
    if (!node)
        return;
    node.classList.add('hidden');
}
/**
 * Convert milliseconds to seconds (rounded up)
 * @param ms - Milliseconds
 * @returns Seconds
 */
function msToS(ms) {
    return Math.max(0, Math.ceil(ms / 1000));
}
/**
 * Clean and deduplicate speech recognition transcript
 * Removes repeated phrases and normalizes whitespace
 * Backend equivalent: speaking.py:_dedupe_transcript()
 * @param text - Raw transcript text
 * @returns Cleaned transcript
 */
function cleanTranscript(text) {
    let s = (text || '').replace(/\s+/g, ' ').trim();
    if (!s)
        return s;
    const patterns = [
        [/(\b\w+\s+\w+\s+\w+)(?:\s+\1\b)+/gi, '$1'],
        [/(\b\w+\s+\w+)(?:\s+\1\b)+/gi, '$1'],
        [/(\b\w+)(?:\s+\1\b)+/gi, '$1'],
    ];
    for (const [pat, rep] of patterns) {
        s = s.replace(pat, rep);
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
async function login(username, password) {
    try {
        const result = await AuthUtils.authenticateUser(username, password);
        if (result.success) {
            // AuthUtils already handles token storage and UI updates
            return AuthUtils.authState.token;
        }
        else {
            throw new Error(result.error || 'Login failed');
        }
    }
    catch (error) {
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
async function startSession() {
    try {
        const response = await APIUtils.SpeakingAPI.startSession('A2');
        moduleState.sessionId = response.session_id;
        moduleState.currentTask = response.item;
        moduleState.progressCurrent = response.progress_current;
        moduleState.progressTotal = response.progress_total;
        moduleState.level = response.level;
        return response;
    }
    catch (error) {
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
async function submitAnswer(answer) {
    try {
        const response = await APIUtils.SpeakingAPI.submitAnswer(answer);
        return response.evaluation;
    }
    catch (error) {
        throw new Error('Failed to submit answer');
    }
}
/**
 * Get next task in current session
 * Backend: POST /speaking/next (speaking.py:next)
 * @returns Next task or session completion status
 * @throws Error if request fails
 */
async function getNextTask() {
    try {
        if (!moduleState.sessionId) {
            throw new Error('No active session');
        }
        const response = await APIUtils.SpeakingAPI.getNextTask(moduleState.sessionId);
        moduleState.sessionId = response.session_id;
        moduleState.currentTask = response.item;
        moduleState.progressCurrent = response.progress_current;
        moduleState.progressTotal = response.progress_total;
        moduleState.level = response.level;
        return response;
    }
    catch (error) {
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
async function ensureMicrophonePermission() {
    if (moduleState.micPermissionState === 'granted')
        return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Microphone not supported in this browser. Please try Chrome or Firefox.';
        moduleState.micPermissionState = 'unsupported';
        return false;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        moduleState.micPermissionState = 'granted';
        return true;
    }
    catch (err) {
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
function initASR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        const warn = APIUtils.$element('asrWarning');
        if (warn)
            warn.textContent = 'Speech recognition not supported in this browser.';
        return null;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (event) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
                moduleState.asrFinalText += res[0].transcript + ' ';
            }
            else {
                interimText += res[0].transcript;
            }
        }
        moduleState.transcriptText = (moduleState.asrFinalText + interimText).trim();
        const t = APIUtils.$element('transcript');
        if (t)
            t.textContent = cleanTranscript(moduleState.transcriptText);
    };
    r.onerror = () => { };
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
async function beginRecording(recordSeconds) {
    console.log('beginRecording called');
    hide('prep');
    show('record');
    // Update recording status
    const recordingStatus = document.querySelector('.recording-status');
    if (recordingStatus) {
        recordingStatus.innerHTML = '<div class="recording-dot"></div><span>Recording...</span>';
    }
    // Hide audio player
    const audioPlayer = APIUtils.$element('audioPlayer');
    if (audioPlayer) {
        audioPlayer.classList.add('hidden');
    }
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Stop';
        recordBtn.disabled = false;
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
            const audioPlayback = APIUtils.$element('audioPlayback');
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
        if (timer)
            timer.textContent = remaining.toString();
        moduleState.countdownInterval = window.setInterval(() => {
            remaining -= 1;
            if (timer)
                timer.textContent = remaining.toString();
            if (remaining <= 0) {
                if (moduleState.countdownInterval) {
                    clearInterval(moduleState.countdownInterval);
                    moduleState.countdownInterval = null;
                }
                stopRecording();
            }
        }, 1000);
    }
    catch (error) {
        console.error('Recording failed:', error);
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Recording failed. Please try again.';
    }
}
/**
 * Stop audio recording and speech recognition
 */
function stopRecording() {
    if (!moduleState.isRecording)
        return;
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
    // Update recording status
    const recordingStatus = document.querySelector('.recording-status');
    if (recordingStatus) {
        recordingStatus.innerHTML = '<div class="recording-dot" style="background-color: #10b981;"></div><span>Recording Complete</span>';
    }
    // Enable custom audio player
    const audioPlayer = APIUtils.$element('audioPlayer');
    const audioPlayback = APIUtils.$element('audioPlayback');
    if (audioPlayer && audioPlayback && moduleState.recordedAudioBlob) {
        const audioUrl = URL.createObjectURL(moduleState.recordedAudioBlob);
        audioPlayback.src = audioUrl;
        audioPlayer.classList.remove('hidden');
        setupAudioPlayer(audioPlayback);
    }
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Submit';
        recordBtn.disabled = false;
    }
}
// ============================================================================
// AUDIO PLAYER FUNCTIONS
// ============================================================================
/**
 * Setup custom audio player controls
 * @param audioElement - HTML audio element
 */
function setupAudioPlayer(audioElement) {
    const playBtn = APIUtils.$element('playBtn');
    const pauseBtn = APIUtils.$element('pauseBtn');
    const restartBtn = APIUtils.$element('restartBtn');
    const audioProgress = APIUtils.$element('audioProgress');
    const currentTimeEl = APIUtils.$element('currentTime');
    const durationEl = APIUtils.$element('duration');
    const progressBar = document.querySelector('.audio-progress-bar');
    if (!playBtn || !pauseBtn || !restartBtn || !audioProgress || !currentTimeEl || !durationEl || !progressBar) {
        return;
    }
    // Update duration when metadata loads
    audioElement.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(audioElement.duration);
    });
    // Update progress during playback
    audioElement.addEventListener('timeupdate', () => {
        const progress = (audioElement.currentTime / audioElement.duration) * 100;
        audioProgress.style.width = `${progress}%`;
        currentTimeEl.textContent = formatTime(audioElement.currentTime);
    });
    // Handle play/pause
    audioElement.addEventListener('play', () => {
        playBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
    });
    audioElement.addEventListener('pause', () => {
        playBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
    });
    // Play button
    playBtn.addEventListener('click', () => {
        audioElement.play();
    });
    // Pause button
    pauseBtn.addEventListener('click', () => {
        audioElement.pause();
    });
    // Restart button
    restartBtn.addEventListener('click', () => {
        audioElement.currentTime = 0;
        audioElement.play();
    });
    // Progress bar click
    progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const percentage = clickX / width;
        audioElement.currentTime = percentage * audioElement.duration;
    });
}
/**
 * Format time in MM:SS format
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
// ============================================================================
// LLM SCORING FUNCTIONS
// ============================================================================
/**
 * Get LLM-based score for the speaking response
 * @param transcript - Speech transcript
 * @param prompt - Original prompt
 * @param guidance - Guidance for the task
 * @returns Promise with score and feedback
 */
async function getLLMScore(transcript, prompt, guidance) {
    try {
        // For now, return a mock score based on transcript length and content
        // In a real implementation, this would call an LLM API
        const score = calculateMockScore(transcript, prompt);
        const feedback = generateMockFeedback(transcript, prompt, guidance);
        const level = determineLevel(score);
        return { score, feedback, level };
    }
    catch (error) {
        console.error('LLM scoring failed:', error);
        return { score: 0, feedback: 'Scoring unavailable', level: 'A1' };
    }
}
/**
 * Calculate mock score based on transcript analysis
 * @param transcript - Speech transcript
 * @param prompt - Original prompt
 * @returns Score from 0-100
 */
function calculateMockScore(transcript, prompt) {
    if (!transcript || transcript.trim().length === 0) {
        return 0;
    }
    let score = 0;
    const words = transcript.trim().split(/\s+/).length;
    // Base score for having content
    score += Math.min(words * 2, 40);
    // Bonus for answering the prompt
    const promptWords = prompt.toLowerCase().split(/\s+/);
    const transcriptLower = transcript.toLowerCase();
    const answeredPrompt = promptWords.some(word => word.length > 3 && transcriptLower.includes(word));
    if (answeredPrompt) {
        score += 30;
    }
    // Bonus for length (encouraging detailed responses)
    if (words >= 20)
        score += 20;
    else if (words >= 10)
        score += 10;
    // Bonus for coherence (simple check for sentence structure)
    const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length >= 2)
        score += 10;
    return Math.min(score, 100);
}
/**
 * Generate mock feedback based on transcript analysis
 * @param transcript - Speech transcript
 * @param prompt - Original prompt
 * @param guidance - Guidance for the task
 * @returns Feedback string
 */
function generateMockFeedback(transcript, prompt, guidance) {
    const words = transcript.trim().split(/\s+/).length;
    if (words === 0) {
        return "No speech detected. Please try speaking louder and closer to the microphone.";
    }
    if (words < 5) {
        return "Your response was very short. Try to provide more details and examples.";
    }
    if (words < 15) {
        return "Good start! Your response could be more detailed. Consider adding more examples or explanations.";
    }
    if (words >= 15) {
        return "Excellent! You provided a detailed response with good vocabulary and structure.";
    }
    return "Thank you for your response. Keep practicing to improve your speaking skills.";
}
/**
 * Determine CEFR level based on score
 * @param score - Score from 0-100
 * @returns CEFR level
 */
function determineLevel(score) {
    if (score >= 80)
        return 'B2';
    if (score >= 60)
        return 'B1';
    if (score >= 40)
        return 'A2';
    if (score >= 20)
        return 'A1';
    return 'A1';
}
// ============================================================================
// UI STATE MANAGEMENT FUNCTIONS
// ============================================================================
/**
 * Display the current speaking task prompt and instructions
 */
function displayCurrentTask() {
    if (!moduleState.currentTask)
        return;
    const promptText = APIUtils.$element('promptText');
    const promptInstructions = APIUtils.$element('promptInstructions');
    const taskProgress = APIUtils.$element('taskProgress');
    if (promptText) {
        promptText.textContent = moduleState.currentTask.prompt;
    }
    if (promptInstructions) {
        promptInstructions.textContent = moduleState.currentTask.guidance;
    }
    if (taskProgress) {
        taskProgress.textContent = `${moduleState.progressCurrent}/${moduleState.progressTotal}`;
    }
}
/**
 * Start preparation phase with countdown timer
 * Manages UI state transitions between prep and recording phases
 * @param prepSeconds - Preparation time in seconds
 * @param recordSeconds - Recording time limit in seconds
 */
async function startPrepAndRecord(prepSeconds, recordSeconds) {
    // Display the current task prompt and instructions
    displayCurrentTask();
    const prepTimer = APIUtils.$element('prepTimer');
    const recordTimer = APIUtils.$element('recordTimer');
    if (prepTimer)
        prepTimer.textContent = prepSeconds.toString();
    if (recordTimer)
        recordTimer.textContent = Math.min(recordSeconds, 60).toString();
    show('prep');
    hide('record');
    moduleState.isRecording = false;
    moduleState.hasRecordedThisItem = false;
    moduleState.transcriptText = '';
    moduleState.submitTriggered = false;
    const audioPlayback = APIUtils.$element('audioPlayback');
    if (audioPlayback)
        audioPlayback.src = '';
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Start';
        recordBtn.disabled = false;
    }
    if (moduleState.countdownInterval) {
        clearInterval(moduleState.countdownInterval);
    }
    let remaining = prepSeconds;
    moduleState.countdownInterval = window.setInterval(() => {
        remaining -= 1;
        if (prepTimer)
            prepTimer.textContent = remaining.toString();
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
function showRecordUI(recordSeconds) {
    hide('prep');
    show('record');
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Start';
        recordBtn.disabled = false;
    }
    // Auto-start recording after 5 seconds
    let countdown = 5;
    const timer = APIUtils.$element('recordTimer');
    if (timer)
        timer.textContent = countdown.toString();
    moduleState.countdownInterval = window.setInterval(() => {
        countdown -= 1;
        if (timer)
            timer.textContent = countdown.toString();
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
async function submitRecording() {
    if (moduleState.submitTriggered || !moduleState.recordedAudioBlob || !moduleState.sessionId) {
        return;
    }
    moduleState.submitTriggered = true;
    const recordBtn = APIUtils.$element('recordBtn');
    if (recordBtn) {
        recordBtn.textContent = 'Submitting...';
        recordBtn.disabled = true;
    }
    try {
        // Convert audio blob to base64
        const arrayBuffer = await moduleState.recordedAudioBlob.arrayBuffer();
        const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        // Prepare answer data
        const answer = {
            session_id: moduleState.sessionId || '',
            item_id: moduleState.currentTask?.id || '',
            transcript: cleanTranscript(moduleState.transcriptText),
            audio_data: base64Audio
        };
        // Submit for evaluation
        const evaluation = await submitAnswer(answer);
        // Get LLM-based score and feedback
        const llmScore = await getLLMScore(cleanTranscript(moduleState.transcriptText), moduleState.currentTask?.prompt || '', moduleState.currentTask?.guidance || '');
        // Combine backend evaluation with LLM scoring
        const combinedEvaluation = {
            ...evaluation,
            llm_score: llmScore.score,
            llm_feedback: llmScore.feedback,
            llm_level: llmScore.level
        };
        // Display results
        displayEvaluationResults(combinedEvaluation);
        // Get next task
        const nextResponse = await getNextTask();
        // Check if session is complete (progress_current >= progress_total)
        if (moduleState.progressCurrent >= moduleState.progressTotal) {
            showSessionComplete(0); // TODO: Calculate final score
        }
        else {
            // Continue to next task
            setTimeout(() => {
                startPrepAndRecord(nextResponse.item.prep_seconds, nextResponse.item.record_seconds);
            }, 3000);
        }
    }
    catch (error) {
        console.error('Submission failed:', error);
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Submission failed. Please try again.';
        if (recordBtn) {
            recordBtn.textContent = 'Submit';
            recordBtn.disabled = false;
        }
    }
    moduleState.submitTriggered = false;
}
/**
 * Display evaluation results
 * @param evaluation - Evaluation result data
 */
function displayEvaluationResults(evaluation) {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv)
        return;
    // Check if LLM scoring is available
    const hasLLMScore = evaluation.llm_score !== undefined;
    const llmScore = hasLLMScore ? evaluation.llm_score : 0;
    const llmFeedback = hasLLMScore ? evaluation.llm_feedback : 'LLM scoring unavailable';
    const llmLevel = hasLLMScore ? evaluation.llm_level : 'N/A';
    resultsDiv.innerHTML = `
        <div class="evaluation-results">
            <div class="evaluation-header">
                <h3 class="evaluation-title">Evaluation Results</h3>
                <div class="evaluation-score">${evaluation.score}/100</div>
            </div>
            
            ${hasLLMScore ? `
            <div class="llm-scoring-section">
                <div class="llm-score-header">
                    <h4>AI Assessment</h4>
                    <div class="llm-score">${llmScore}/100</div>
                </div>
                <div class="llm-level">
                    <span class="level-label">CEFR Level:</span>
                    <span class="level-badge">${llmLevel}</span>
                </div>
                <div class="llm-feedback">
                    <div class="feedback-label">Feedback:</div>
                    <div class="feedback-text">${llmFeedback}</div>
                </div>
            </div>
            ` : ''}
            
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
function showSessionComplete(finalScore) {
    const resultsDiv = APIUtils.$element('results');
    if (!resultsDiv)
        return;
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
function handleRecordClick() {
    if (!moduleState.isRecording) {
        if (moduleState.hasRecordedThisItem) {
            submitRecording();
        }
        else {
            const recordTimer = APIUtils.$element('recordTimer');
            const recordSeconds = parseInt(recordTimer?.textContent || '60', 10);
            beginRecording(recordSeconds);
        }
    }
    else {
        stopRecording();
    }
}
/**
 * Handle login form submission
 */
async function handleLogin(event) {
    event.preventDefault();
    const usernameInput = APIUtils.$element('username');
    const passwordInput = APIUtils.$element('password');
    if (!usernameInput || !passwordInput)
        return;
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
        alert('Please enter both username and password');
        return;
    }
    try {
        await login(username, password);
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Login successful!';
        // UI state is managed by AuthUtils.updateUIForAuthStatus()
    }
    catch (error) {
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Login failed. Please try again.';
    }
}
/**
 * Handle start session button click
 */
async function handleStartSession() {
    const startBtn = APIUtils.$element('startBtn');
    if (startBtn) {
        startBtn.textContent = 'Starting...';
        startBtn.disabled = true;
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
        startPrepAndRecord(response.item.prep_seconds, response.item.record_seconds);
    }
    catch (error) {
        console.error('Start session failed:', error);
        const status = APIUtils.$element('status');
        if (status)
            status.textContent = 'Failed to start session. Please try again.';
        if (startBtn) {
            startBtn.textContent = 'Start Speaking Assessment';
            startBtn.disabled = false;
        }
    }
}
// ============================================================================
// INITIALIZATION
// ============================================================================
/**
 * Initialize the speaking module
 */
async function initializeSpeakingModule() {
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
window.SpeakingModule = {
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
    displayCurrentTask,
    setupAudioPlayer,
    getLLMScore,
    moduleState
};
// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpeakingModule);
}
else {
    initializeSpeakingModule();
}
