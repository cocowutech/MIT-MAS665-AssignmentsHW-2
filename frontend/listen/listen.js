/**
 * Listening Module TypeScript Implementation
 *
 * This module handles the frontend logic for the ESL listening assessment system.
 * It provides functionality for:
 * - Text-to-speech audio playback
 * - Interactive multiple choice questions
 * - Adaptive difficulty based on user performance
 * - Real-time feedback and results display
 *
 * The system integrates with the backend API endpoints:
 *
 * @author ESL Assessment System
 * @version 1.0
 */
// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================
/**
 * Listening module specific state
 * Extends shared session state with listening-specific data
 */
class ListeningModuleState {
    constructor() {
        // Session state
        this.sessionId = null;
        this.clips = [];
        this.nextClips = null;
        // Assessment progress
        this.remaining = 0;
        this.asked = 0;
        // Text-to-speech state
        this.synth = null;
        this.speakingClipId = null;
        this.currentUtterances = [];
        // Voice management
        this.englishVoices = [];
        this.clipVoiceMap = {};
        // TTS Configuration constants
        this.DEFAULT_RATE = 0.92;
        this.DEFAULT_PITCH = 1.03;
        this.DEFAULT_VOLUME = 1.0;
    }
}
// Initialize module state
const moduleState = new ListeningModuleState();
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
// Using shared utilities from global scope
// $, APIUtils, AuthUtils are available from shared/js/api.js and shared/js/auth.js
// ============================================================================
// TEXT-TO-SPEECH FUNCTIONALITY
// ============================================================================
/**
 * Score and select the best available voice for TTS
 * Prioritizes English voices with natural/neural characteristics
 * @param voices - Array of available speech synthesis voices
 * @returns Best voice or null if none available
 */
function pickBestVoice(voices) {
    if (!voices || !voices.length)
        return null;
    const scored = voices.map(voice => {
        const name = (voice.name || '').toLowerCase();
        const lang = (voice.lang || '').toLowerCase();
        let score = 0;
        // Prefer en-US, then en-GB
        if (lang.startsWith('en-us'))
            score += 8;
        if (lang.startsWith('en-gb'))
            score += 7;
        // Prefer neural/natural/online voices
        if (name.includes('natural') || name.includes('neural') || name.includes('online'))
            score += 6;
        // Vendor preferences
        if (name.includes('microsoft'))
            score += 5;
        if (name.includes('google'))
            score += 4;
        if (name.includes('siri'))
            score += 5;
        // Mild bias to female voices for clarity
        if (name.includes('female'))
            score += 1;
        return { voice, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].voice;
}
/**
 * Populate English voices from available speech synthesis voices
 * Filters voices to only include English language variants
 */
function populateVoices() {
    if (!moduleState.synth)
        return;
    const voices = moduleState.synth.getVoices();
    moduleState.englishVoices = voices.filter(voice => /^en[-_]/i.test(voice.lang || ''));
}
/**
 * Initialize text-to-speech system
 * Sets up speech synthesis and voice management
 */
function initTTS() {
    moduleState.synth = window.speechSynthesis || null;
    if (!moduleState.synth) {
        const warningElement = document.getElementById('ttsWarning');
        if (warningElement) {
            warningElement.textContent = 'Browser TTS not available. Audio playback disabled.';
        }
        return;
    }
    // Populate voices now (if available) and when the list changes
    try {
        populateVoices();
    }
    catch (_) {
        // Ignore voice population errors
    }
    try {
        moduleState.synth.onvoiceschanged = populateVoices;
    }
    catch (_) {
        // Ignore voice change handler errors
    }
}
/**
 * Apply voice and speech options to a speech synthesis utterance
 * @param utterance - Speech synthesis utterance to configure
 * @param clipId - ID of the clip for voice assignment
 */
function applyUtterOptions(utterance, clipId) {
    let voice = null;
    const allVoices = (moduleState.synth && moduleState.synth.getVoices && moduleState.synth.getVoices()) || [];
    const assignedName = moduleState.clipVoiceMap[clipId];
    // Try to use previously assigned voice for this clip
    if (assignedName) {
        voice = (moduleState.englishVoices.find(v => v.name === assignedName) ||
            allVoices.find(v => v.name === assignedName)) || null;
    }
    // If no assigned voice, pick a random English voice or best available
    if (!voice) {
        if (moduleState.englishVoices && moduleState.englishVoices.length) {
            const idx = Math.floor(Math.random() * moduleState.englishVoices.length);
            voice = moduleState.englishVoices[idx];
            moduleState.clipVoiceMap[clipId] = voice.name;
        }
        else {
            voice = pickBestVoice(allVoices) || allVoices[0] || null;
        }
    }
    // Apply voice settings
    if (voice) {
        utterance.voice = voice;
        if (voice.lang)
            utterance.lang = voice.lang;
    }
    else {
        utterance.lang = 'en-US';
    }
    utterance.rate = moduleState.DEFAULT_RATE;
    utterance.pitch = moduleState.DEFAULT_PITCH;
    utterance.volume = moduleState.DEFAULT_VOLUME;
}
/**
 * Split text into chunks suitable for speech synthesis
 * Breaks text at sentence boundaries while respecting maximum length limits
 * @param text - Text to split into chunks
 * @returns Array of text chunks
 */
function splitIntoChunks(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return [];
    // Split by sentence enders, keep them attached
    const parts = cleaned.match(/[^.!?\n]+[.!?\u2026]+\s*|[^.!?\n]+$/g) || [cleaned];
    const chunks = [];
    let buffer = '';
    const MAX_LEN = 180;
    for (const part of parts) {
        if ((buffer + ' ' + part).trim().length > MAX_LEN && buffer) {
            chunks.push(buffer.trim());
            buffer = part;
        }
        else {
            buffer = (buffer ? buffer + ' ' : '') + part;
        }
    }
    if (buffer.trim())
        chunks.push(buffer.trim());
    return chunks;
}
/**
 * Speak text segments sequentially with proper voice management
 * @param clipId - ID of the clip being spoken
 * @param segments - Array of text segments to speak
 * @param onEnd - Callback when all segments are complete
 * @param onError - Callback when an error occurs
 */
function speakSegments(clipId, segments, onEnd, onError) {
    let idx = 0;
    moduleState.currentUtterances = [];
    function speakNext() {
        if (!moduleState.synth) {
            if (onEnd)
                onEnd();
            return;
        }
        if (idx >= segments.length) {
            if (onEnd)
                onEnd();
            return;
        }
        const utterance = new SpeechSynthesisUtterance(segments[idx]);
        applyUtterOptions(utterance, clipId);
        utterance.onend = () => {
            idx += 1;
            speakNext();
        };
        utterance.onerror = () => {
            if (onError)
                onError();
        };
        moduleState.currentUtterances.push(utterance);
        moduleState.synth.speak(utterance);
    }
    speakNext();
}
/**
 * Start speaking a listening clip
 * @param clipId - ID of the clip to speak
 */
function speakClip(clipId) {
    if (!moduleState.synth)
        return;
    stopSpeaking();
    const clip = moduleState.clips.find(c => c.id === clipId);
    if (!clip)
        return;
    const segments = splitIntoChunks(clip.transcript);
    moduleState.speakingClipId = clipId;
    updatePlayButtons();
    speakSegments(clipId, segments, () => {
        moduleState.speakingClipId = null;
        updatePlayButtons();
    }, () => {
        moduleState.speakingClipId = null;
        updatePlayButtons();
    });
}
/**
 * Stop all current speech synthesis
 */
function stopSpeaking() {
    if (!moduleState.synth)
        return;
    moduleState.synth.cancel();
    moduleState.currentUtterances = [];
    moduleState.speakingClipId = null;
    updatePlayButtons();
}
/**
 * Update play button states based on current speaking status
 */
function updatePlayButtons() {
    for (const clip of moduleState.clips) {
        const button = document.getElementById('play-' + clip.id);
        if (!button)
            continue;
        button.textContent = moduleState.speakingClipId === clip.id ? 'Stop' : 'Play';
    }
}
// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================
/**
 * Handle user login process using shared authentication utilities
 * Authenticates with backend and updates UI state
 */
async function login() {
    console.log('Listening module: Login function called');
    const loginForm = document.getElementById('loginForm');
    const loginMsg = document.getElementById('loginMsg');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    console.log('Listening module: Login elements found:', { loginForm, loginMsg, usernameInput, passwordInput });
    if (!loginForm || !loginMsg || !usernameInput || !passwordInput)
        return;
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (submitBtn)
        submitBtn.disabled = true;
    loginMsg.textContent = '…';
    try {
        console.log('Listening module: Attempting login with:', usernameInput.value, passwordInput.value);
        const result = await AuthUtils.authenticateUser(usernameInput.value, passwordInput.value);
        console.log('Listening module: Login result:', result);
        if (result.success) {
            loginMsg.textContent = 'Logged in';
            console.log('Listening module: Login successful, updating UI');
            AuthUtils.updateUIForAuthStatus();
            AuthUtils.updateAuthHeader();
        }
        else {
            loginMsg.textContent = result.error || 'Login failed';
        }
    }
    catch (error) {
        loginMsg.textContent = 'Login failed';
    }
    finally {
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        if (submitBtn)
            submitBtn.disabled = false;
    }
}
// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================
/**
 * Render listening clips and questions
 * Creates interactive UI elements for each clip
 */
function renderClips() {
    const submitBtn = document.getElementById('submitBtn');
    const nextClipsBtn = document.getElementById('nextClipsBtn');
    const clipsRoot = document.getElementById('clipsRoot');
    if (!submitBtn || !clipsRoot)
        return;
    submitBtn.disabled = false;
    submitBtn.classList.remove('hidden');
    if (nextClipsBtn)
        nextClipsBtn.classList.add('hidden');
    clipsRoot.innerHTML = '';
    moduleState.clips.forEach((clip, idx) => {
        const card = document.createElement('div');
        card.className = 'card';
        // Escape HTML in transcript and choices to prevent XSS
        const escapedTranscript = clip.transcript.replace(/</g, '&lt;');
        const escapedChoices = clip.choices.map(choice => choice.replace(/</g, '&lt;'));
        card.innerHTML = `
            <div class="clip-header">
                <h3 class="clip-title">Clip ${moduleState.asked + idx + 1}: ${clip.title}</h3>
                <div class="clip-badges">
                    <span class="badge">CEFR ${clip.level_cefr}</span>
                    <span class="badge">${clip.cambridge_level}</span>
                    <span class="badge">${clip.exam_task_type}</span>
                </div>
            </div>
            <div class="audio-controls">
                <button id="play-${clip.id}">Play</button>
                <button class="transcript-toggle" id="show-${clip.id}">Show transcript</button>
            </div>
            <div id="tx-${clip.id}" class="transcript-display hidden">${escapedTranscript}</div>
            <div style="margin-top:12px">
                <div style="margin-bottom:8px; font-weight: 500;">${clip.question}</div>
                <div class="choices" id="choices-${clip.id}">
                    ${escapedChoices.map((choice, i) => `
                        <div class="listening-choice-card" data-clip="${clip.id}" data-index="${i}">
                            <div class="listening-choice-key">${String.fromCharCode(65 + i)}</div>
                            <div class="listening-choice-text">${choice}</div>
                        </div>
                    `).join('')}
                </div>
                <div id="feedback-${clip.id}" class="listening-feedback"></div>
            </div>
        `;
        clipsRoot.appendChild(card);
        // Add event listeners for play button
        const playBtn = document.getElementById('play-' + clip.id);
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                if (moduleState.speakingClipId === clip.id) {
                    stopSpeaking();
                }
                else {
                    speakClip(clip.id);
                }
            });
        }
        // Add event listeners for transcript toggle
        const showBtn = document.getElementById('show-' + clip.id);
        if (showBtn) {
            showBtn.addEventListener('click', () => {
                const transcriptElement = document.getElementById('tx-' + clip.id);
                if (transcriptElement) {
                    transcriptElement.classList.toggle('hidden');
                }
            });
        }
        // Add event listeners for choice selection
        const choiceElements = card.querySelectorAll('.listening-choice-card');
        choiceElements.forEach(element => {
            element.addEventListener('click', () => {
                const index = parseInt(element.getAttribute('data-index') || '0');
                selectChoice(clip.id, index);
            });
        });
        // Reflect any existing selection
        if (Number.isInteger(clip._selected)) {
            highlightSelection(clip.id, clip._selected);
        }
    });
    updatePlayButtons();
}
/**
 * Highlight the selected choice for a clip
 * @param clipId - ID of the clip
 * @param index - Index of the selected choice
 */
function highlightSelection(clipId, index) {
    const container = document.getElementById('choices-' + clipId);
    if (!container)
        return;
    container.querySelectorAll('.listening-choice-card').forEach((element, i) => {
        if (i === index) {
            element.classList.add('selected');
        }
        else {
            element.classList.remove('selected');
        }
    });
}
/**
 * Select a choice for a clip
 * @param clipId - ID of the clip
 * @param index - Index of the choice to select
 */
function selectChoice(clipId, index) {
    const clip = moduleState.clips.find(c => c.id === clipId);
    if (!clip)
        return;
    clip._selected = index;
    highlightSelection(clipId, index);
}
/**
 * Reflect evaluation results in the UI
 * Shows correct/incorrect answers with visual feedback
 * @param results - Array of evaluation results
 */
function reflectEvaluation(results) {
    if (!Array.isArray(results))
        return;
    results.forEach(item => {
        if (!item || !item.clip_id)
            return;
        const container = document.getElementById('choices-' + item.clip_id);
        if (!container)
            return;
        const cards = container.querySelectorAll('.listening-choice-card');
        cards.forEach((card, idx) => {
            card.classList.remove('selected', 'correct', 'incorrect', 'locked');
            if (idx === item.correct_choice_index) {
                card.classList.add('correct');
            }
            if (idx === item.chosen_index && idx !== item.correct_choice_index) {
                card.classList.add('incorrect');
            }
            card.classList.add('locked');
        });
        const feedbackElement = document.getElementById('feedback-' + item.clip_id);
        if (feedbackElement) {
            const rationale = (item.rationale || '').trim();
            const label = item.correct ? 'Correct.' : 'Incorrect.';
            feedbackElement.textContent = rationale ? `${label} ${rationale}` : label;
            feedbackElement.className = `listening-feedback ${item.correct ? 'correct' : 'incorrect'}`;
        }
    });
}
/**
 * Render final session results
 * Displays comprehensive assessment results and recommendations
 * @param result - Complete session result data
 */
function renderResult(result) {
    const submitBtn = document.getElementById('submitBtn');
    const nextClipsBtn = document.getElementById('nextClipsBtn');
    const finishSessionBtnContainer = document.getElementById('finishSessionBtnContainer');
    const resultSection = document.getElementById('resultSection');
    const resultElement = document.getElementById('result');
    if (!resultElement || !resultSection)
        return;
    if (submitBtn)
        submitBtn.classList.add('hidden');
    if (nextClipsBtn)
        nextClipsBtn.classList.add('hidden');
    if (finishSessionBtnContainer)
        finishSessionBtnContainer.classList.remove('hidden');
    resultSection.classList.remove('hidden');
    const correct = parseInt(String(result.correct)) || 0;
    const incorrect = parseInt(String(result.incorrect)) || 0;
    const total = parseInt(String(result.total)) || (correct + incorrect);
    const band = result.final_level || result.estimated_band || '-'; // estimated_band is legacy - Might not be relevant anymore
    const exam = (result.exam_mapping && result.exam_mapping.exam) || '-';
    const vocab = (result.exam_mapping && result.exam_mapping.target_vocab) || [];
    const structs = (result.exam_mapping && result.exam_mapping.target_structures) || [];
    const perItem = Array.isArray(result.per_item) ? result.per_item : [];
    const perItemHtml = perItem.map((item, i) => `
        <div class="small per-item">
            Item ${i + 1} • 
            <span class="${item.correct ? 'ok' : 'bad'}">${item.correct ? 'Correct' : 'Incorrect'}</span> 
            (CEFR ${item.level_cefr}, ${item.cambridge_level})
        </div>
    `).join('');
    const vocabHtml = vocab.map(v => `<span class="pill">${String(v).replace(/</g, '&lt;')}</span>`).join(' ');
    const structsHtml = structs.map(s => `<span class="pill">${String(s).replace(/</g, '&lt;')}</span>`).join(' ');
    const rawJson = JSON.stringify(result, null, 2).replace(/</g, '&lt;');
    resultElement.innerHTML = `
        <div class="result-card">
            <div class="stats">
                <div class="stat">Score: <strong>${correct}/${total}</strong></div>
                <div class="stat">Final level: <strong>${band}</strong></div>
                <div class="stat">Exam: <strong>${exam}</strong></div>
            </div>
            ${perItemHtml}
            <div style="margin-top:8px">
                <div class="small" style="margin:4px 0">Target vocabulary:</div>
                <div class="flex">${vocabHtml || '<span class="small">—</span>'}</div>
                <div class="small" style="margin:8px 0 4px 0">Target structures:</div>
                <div class="flex">${structsHtml || '<span class="small">—</span>'}</div>
            </div>
            <details style="margin-top:10px">
                <summary class="small">Raw JSON</summary>
                <pre style="white-space:pre-wrap">${rawJson}</pre>
            </details>
        </div>
    `;
}
// ============================================================================
// SESSION MANAGEMENT FUNCTIONS
// ============================================================================
/**
 * Start a new listening session using shared API utilities
 * Initializes the assessment with backend API
 */
async function startSession() {
    const startBtn = document.getElementById('startBtn');
    const startMsg = document.getElementById('startMsg');
    const levelInput = document.getElementById('level');
    if (!startBtn || !startMsg || !levelInput)
        return;
    startBtn.disabled = true;
    startMsg.textContent = '…';
    try {
        // Set auth token for API client
        APIUtils.apiClient.setAuthToken(AuthUtils.authState.token);
        const data = await APIUtils.ListeningAPI.startSession();
        moduleState.sessionId = data.session_id;
        moduleState.clips = (data.clips || []).map((clip) => ({ ...clip, _selected: undefined }));
        moduleState.asked = parseInt(String(data.asked)) || 0;
        moduleState.remaining = parseInt(String(data.remaining)) || (10 - moduleState.asked);
        startMsg.textContent = `Level: ${data.target_cefr} (${data.cambridge_level}) • Questions: ${moduleState.asked}/${moduleState.asked + moduleState.remaining}`;
        const clipsCard = document.getElementById('clips-card');
        if (clipsCard)
            clipsCard.classList.remove('hidden');
        // Hide the start button since session has started
        startBtn.classList.add('hidden');
        renderClips();
    }
    catch (error) {
        startMsg.textContent = 'Start failed';
        console.error('Session start error:', error);
        // Re-enable start button only on error
        startBtn.disabled = false;
    }
}
/**
 * Submit answers for current clips
 * Sends answers to backend and handles response
 */
async function submitAnswers() {
    const submitBtn = document.getElementById('submitBtn');
    const submitMsg = document.getElementById('submitMsg');
    const resultElement = document.getElementById('result');
    if (!submitBtn || !submitMsg)
        return;
    submitBtn.disabled = true;
    submitMsg.textContent = '…';
    try {
        // Ensure each clip has a selection before submitting
        const missing = moduleState.clips.filter(clip => !Number.isInteger(clip._selected));
        if (missing.length) {
            submitMsg.textContent = 'Please select an answer for all clips.';
            return;
        }
        const answers = moduleState.clips.map(clip => ({
            clip_id: clip.id,
            choice_index: clip._selected
        }));
        // Set auth token for API client
        APIUtils.apiClient.setAuthToken(AuthUtils.authState.token);
        const data = await APIUtils.ListeningAPI.submitAnswers(moduleState.sessionId, answers);
        reflectEvaluation(data.evaluated);
        if (data.finished) {
            submitMsg.textContent = '';
            if (submitBtn)
                submitBtn.classList.add('hidden');
            const nextClipsBtn = document.getElementById('nextClipsBtn');
            if (nextClipsBtn)
                nextClipsBtn.classList.add('hidden');
            moduleState.nextClips = null;
            renderResult(data);
        }
        else {
            moduleState.asked = parseInt(String(data.asked)) || 0;
            moduleState.remaining = parseInt(String(data.remaining)) || (10 - moduleState.asked);
            const startMsg = document.getElementById('startMsg');
            if (startMsg) {
                startMsg.textContent = `Level: ${data.target_cefr} (${data.cambridge_level}) • Questions: ${moduleState.asked}/${moduleState.asked + moduleState.remaining}`;
            }
            submitMsg.textContent = 'Answers graded. Review feedback, then click Next.';
            moduleState.nextClips = Array.isArray(data.clips) ? data.clips.map(clip => ({ ...clip, _selected: undefined })) : [];
            const nextClipsBtn = document.getElementById('nextClipsBtn');
            if (nextClipsBtn) {
                if (moduleState.nextClips.length) {
                    nextClipsBtn.classList.remove('hidden');
                }
                else {
                    nextClipsBtn.classList.add('hidden');
                }
            }
            if (submitBtn)
                submitBtn.classList.add('hidden');
            const finishSessionBtnContainer = document.getElementById('finishSessionBtnContainer');
            if (finishSessionBtnContainer)
                finishSessionBtnContainer.classList.add('hidden');
        }
    }
    catch (error) {
        submitMsg.textContent = 'Submit failed';
        if (resultElement) {
            resultElement.innerHTML = `<div class="result-card">${String(error).replace(/</g, '&lt;')}</div>`;
        }
        console.error('Submit answers error:', error);
    }
    finally {
        submitBtn.disabled = false;
    }
}
/**
 * Load next batch of clips
 * Advances to the next set of questions in the assessment
 */
function loadNextClips() {
    const nextClipsBtn = document.getElementById('nextClipsBtn');
    const submitBtn = document.getElementById('submitBtn');
    const resultElement = document.getElementById('result');
    const resultSection = document.getElementById('resultSection');
    const submitMsg = document.getElementById('submitMsg');
    if (!Array.isArray(moduleState.nextClips) || !moduleState.nextClips.length) {
        if (nextClipsBtn)
            nextClipsBtn.classList.add('hidden');
        if (submitBtn)
            submitBtn.classList.remove('hidden');
        return;
    }
    stopSpeaking();
    moduleState.clips = moduleState.nextClips.map(clip => ({ ...clip }));
    moduleState.nextClips = null;
    moduleState.clips.forEach(clip => { clip._selected = undefined; });
    if (resultElement)
        resultElement.innerHTML = '';
    if (resultSection)
        resultSection.classList.add('hidden');
    if (submitMsg)
        submitMsg.textContent = '';
    if (submitBtn) {
        submitBtn.classList.remove('hidden');
        submitBtn.disabled = false;
    }
    if (nextClipsBtn)
        nextClipsBtn.classList.add('hidden');
    renderClips();
}
// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================
/**
 * Initialize the application when DOM is loaded
 * Sets up event listeners and initial state using shared utilities
 */
async function initializeApp() {
    console.log('Listening module: Initializing app...');
    // Initialize authentication using shared utilities
    await AuthUtils.initializeAuth();
    console.log('Listening module: Auth initialized');
    // Initialize text-to-speech
    initTTS();
    console.log('Listening module: TTS initialized');
    // Add event listeners
    const loginForm = document.getElementById('loginForm');
    if (loginForm)
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            login();
        });
    const startBtn = document.getElementById('startBtn');
    if (startBtn)
        startBtn.addEventListener('click', startSession);
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn)
        submitBtn.addEventListener('click', submitAnswers);
}
// Make loadNextClips available globally for HTML onclick handler
window.loadNextClips = loadNextClips;
// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);
