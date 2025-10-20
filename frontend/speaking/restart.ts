(() => {
    type RestartState = 'initial' | 'ready' | 'busy';

    interface RestartableModuleState {
        level?: string;
        nextStartLevel?: string | null;
    }

    interface RestartSpeakingModule {
        moduleState?: RestartableModuleState;
        showSessionComplete: (finalScore: number) => unknown;
        handleStartSession: () => Promise<void>;
    }

    interface RestartSpeakingApi {
        startSession: (level?: string) => Promise<unknown>;
    }

    type RestartWindow = typeof window & {
        SpeakingModule?: RestartSpeakingModule;
        APIUtils?: { SpeakingAPI?: RestartSpeakingApi };
        restartSpeakingAssessment?: () => void;
    };

    const restartWindow = window as RestartWindow;

    function configureButton(state: RestartState, level?: string): void {
        const container = document.getElementById('finishSessionBtnContainer');
        if (!(container instanceof HTMLElement)) {
            return;
        }

        let button = document.getElementById('restartSpeakingBtn') as HTMLButtonElement | null;
        if (!button) {
            const existing = container.querySelector('button');
            if (existing instanceof HTMLButtonElement) {
                button = existing;
            } else {
                button = document.createElement('button');
            }
            button.id = 'restartSpeakingBtn';
            if (!button.parentElement) {
                container.appendChild(button);
            }
        }

        const isBusy = state === 'busy';
        const isInitial = state === 'initial';

        button.textContent = isBusy ? 'Starting...' : 'Assess again';
        button.disabled = isBusy;
        button.onclick = () => {
            if (button.disabled) return;
            restartWindow.restartSpeakingAssessment?.();
        };

        if (level) {
            button.setAttribute('data-level', level);
        } else {
            button.removeAttribute('data-level');
        }

        if (isInitial) {
            container.classList.add('hidden');
        } else {
            container.classList.remove('hidden');
        }
    }

    function initOverrides(): void {
        const mod = restartWindow.SpeakingModule;
        const api = restartWindow.APIUtils;

        if (!mod || !api || !api.SpeakingAPI) {
            window.setTimeout(initOverrides, 50);
            return;
        }

        if (mod.moduleState && typeof mod.moduleState === 'object' && !('nextStartLevel' in mod.moduleState)) {
            mod.moduleState.nextStartLevel = null;
        }

        const originalStartSession = api.SpeakingAPI.startSession.bind(api.SpeakingAPI) as RestartSpeakingApi['startSession'];
        api.SpeakingAPI.startSession = async function patchedStartSession(level?: string): Promise<unknown> {
            const state = mod.moduleState;
            const overrideLevel = typeof level === 'string' && level.trim().length > 0
                ? level.trim()
                : (state?.nextStartLevel || 'A2');

            if (state) {
                state.nextStartLevel = null;
            }

            const response = await originalStartSession(overrideLevel);
            configureButton('initial');
            return response;
        };

        const originalShowSessionComplete = mod.showSessionComplete.bind(mod);
        mod.showSessionComplete = function patchedShowSessionComplete(finalScore: number): unknown {
            const result = originalShowSessionComplete(finalScore);
            const state = mod.moduleState;
            if (state) {
                state.nextStartLevel = state.level || state.nextStartLevel || 'A2';
            }
            configureButton('ready', state?.nextStartLevel || state?.level || undefined);
            return result;
        };

        restartWindow.restartSpeakingAssessment = function restartSpeakingAssessment(): void {
            const state = mod.moduleState;
            if (!state) return;

            const level = state.nextStartLevel || state.level || 'A2';
            state.nextStartLevel = level;

            const status = document.getElementById('status');
            if (status) status.textContent = `Restarting at CEFR ${level}...`;

            const results = document.getElementById('results');
            if (results) {
                results.classList.add('hidden');
                results.innerHTML = '';
            }

            configureButton('busy');

            const startBtn = document.getElementById('startBtn');
            if (startBtn instanceof HTMLButtonElement) {
                startBtn.classList.remove('hidden');
                startBtn.disabled = true;
                startBtn.textContent = 'Starting...';
            }

            mod.handleStartSession()
                .then(() => {
                    if (status) status.textContent = '';
                })
                .catch((error: unknown) => {
                    console.error('Restart speaking session failed', error);
                    if (status) status.textContent = 'Failed to restart assessment. Please try again.';
                    configureButton('ready', level);
                });
        };

        configureButton('initial');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOverrides);
    } else {
        initOverrides();
    }
})();
