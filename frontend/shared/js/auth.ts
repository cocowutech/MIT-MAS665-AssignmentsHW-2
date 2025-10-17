/**
 * Authentication utilities for the ESL Assessment System
 * This file provides common authentication functions used across modules
 */

type AuthState = {
    token: string | null;
    username: string | null;
    isAuthenticated: boolean;
};

type AuthListener = (state: AuthState) => void;

// Auth utilities namespace
const AuthUtils = {
    // Authentication state
    authState: {
        token: null as string | null,
        username: null as string | null,
        isAuthenticated: false
    } as AuthState,

    // Registered callbacks that react to auth changes
    listeners: [] as AuthListener[],

    /**
     * Persist authentication data to localStorage
     */
    saveAuthToStorage: function(token: string | null, username: string | null): void {
        try {
            if (token) {
                localStorage.setItem("token", token);
            } else {
                localStorage.removeItem("token");
            }

            if (username) {
                localStorage.setItem("username", username);
            } else {
                localStorage.removeItem("username");
            }
        } catch (error) {
            console.warn("Unable to persist auth to storage:", error);
        }
    },

    /**
     * Load authentication data from localStorage
     */
    loadAuthFromStorage: function(): { token: string | null; username: string | null } {
        try {
            const token = localStorage.getItem("token");
            const username = localStorage.getItem("username");
            return { token, username };
        } catch (error) {
            console.warn("Unable to load auth from storage:", error);
            return { token: null, username: null };
        }
    },

    /**
     * Notify listeners and update UI when auth changes
     */
    notifyAuthChange: function(): void {
        const snapshot: AuthState = { ...this.authState };

        // Update standard UI elements
        this.updateUIForAuthStatus(snapshot.isAuthenticated, snapshot.username || "");

        // Dispatch DOM event for non-TypeScript consumers
        document.dispatchEvent(new CustomEvent("auth:status-changed", { detail: snapshot }));

        // Notify registered callbacks (defensive try/catch per listener)
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                console.error("Auth listener error:", error);
            }
        }
    },

    /**
     * Update internal auth state and persist changes
     */
    setAuthState: function(token: string | null, username: string | null, notify: boolean = true): void {
        this.authState.token = token;
        this.authState.username = username;
        this.authState.isAuthenticated = Boolean(token);

        this.saveAuthToStorage(token, username);
        this.updateAuthHeader(token || undefined);

        if (notify) {
            this.notifyAuthChange();
        }
    },

    /**
     * Initialize authentication from localStorage
     */
    initializeAuth: async function(): Promise<void> {
        const { token, username } = this.loadAuthFromStorage();

        if (token) {
            this.setAuthState(token, username, false);

            // Validate token with backend
            try {
                const response = await fetch("/auth/me", {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error("Token validation failed");
                }
            } catch (error) {
                console.error("Token validation failed:", error);
                this.clearAuth(false);
                this.notifyAuthChange();
                return;
            }
        } else {
            this.setAuthState(null, null, false);
        }

        this.notifyAuthChange();
    },

    /**
     * Authenticate user with backend
     */
    authenticateUser: async function(username: string, password: string): Promise<{success: boolean, error?: string}> {
        try {
            const response = await fetch("/auth/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
            });
            
            if (!response.ok) {
                throw new Error("Authentication failed");
            }
            
            const data = await response.json();
            
            if (data.access_token) {
                this.setAuthState(data.access_token, username);
                return { success: true };
            } else {
                return { success: false, error: "No token received" };
            }
        } catch (error) {
            console.error("Authentication error:", error);
            return { success: false, error: (error as Error).message };
        }
    },

    /**
     * Update authorization header for API requests
     */
    updateAuthHeader: function(token?: string): void {
        const effectiveToken = token ?? this.authState.token ?? undefined;
        if (typeof (window as any).APIUtils !== "undefined") {
            (window as any).APIUtils.updateAuthHeader(effectiveToken ?? null);
        }
    },

    /**
     * Update UI based on authentication status
     */
    updateUIForAuthStatus: function(isAuthenticated?: boolean, username?: string): void {
        const resolvedAuth = typeof isAuthenticated === 'boolean' ? isAuthenticated : this.authState.isAuthenticated;
        const resolvedUsername = username ?? this.authState.username ?? "";

        const authState = document.getElementById("authState");
        const loginLink = document.getElementById("loginLink");
        const loginMsg = document.getElementById("loginMsg");

        if (authState) {
            if (resolvedAuth) {
                authState.textContent = resolvedUsername
                    ? `Logged in as ${resolvedUsername}`
                    : "Logged in";
            } else {
                authState.textContent = "Logged out";
            }
        }

        if (loginMsg) {
            loginMsg.textContent = resolvedAuth
                ? (resolvedUsername ? `Logged in as ${resolvedUsername}` : "Logged in")
                : "";
        }

        if (loginLink) {
            if (resolvedAuth) {
                loginLink.textContent = "Logout";
                loginLink.setAttribute("href", "#");
                loginLink.onclick = (event) => {
                    event.preventDefault();
                    this.logout();
                };
            } else {
                loginLink.textContent = "Login";
                loginLink.setAttribute("href", "#login-card");
                loginLink.onclick = (event) => {
                    // Bring login form into view
                    event.preventDefault();
                    this.showLogin();
                };
            }
        }

        this.applyStandardAuthVisibility(resolvedAuth);
    },

    /**
     * Clear authentication state
     */
    clearAuth: function(notify: boolean = true): void {
        this.setAuthState(null, null, notify);
    },

    /**
     * Logout user
     */
    logout: function(): void {
        this.clearAuth();
        this.showLogin();
    },

    /**
     * Expose current auth state
     */
    getAuthState: function(): AuthState {
        return { ...this.authState };
    },

    /**
     * Subscribe to authentication status updates
     */
    onAuthChange: function(listener: AuthListener): () => void {
        this.listeners.push(listener);

        // Call immediately with current state for convenience
        try {
            listener({ ...this.authState });
        } catch (error) {
            console.error("Auth listener error:", error);
        }

        return () => {
            this.listeners = this.listeners.filter((item) => item !== listener);
        };
    },

    /**
     * Toggle standard auth visibility blocks
     */
    applyStandardAuthVisibility: function(isAuthenticated: boolean): void {
        const userNodes = document.querySelectorAll('[data-auth-visible="user"]');
        userNodes.forEach((node) => {
            node.classList.toggle('hidden', !isAuthenticated);
        });

        const guestNodes = document.querySelectorAll('[data-auth-visible="guest"]');
        guestNodes.forEach((node) => {
            node.classList.toggle('hidden', isAuthenticated);
        });

        if (!isAuthenticated) {
            const loginMsg = document.getElementById("loginMsg");
            if (loginMsg) {
                loginMsg.textContent = "";
            }
        }
    },

    /**
     * Ensure login form is visible and focused
     */
    showLogin: function(): void {
        const loginCard = document.getElementById('login-card');
        if (loginCard) {
            loginCard.classList.remove('hidden');
        }

        const guestNodes = document.querySelectorAll('[data-auth-visible="guest"]');
        guestNodes.forEach((node) => node.classList.remove('hidden'));

        const usernameInput = document.getElementById('username') as HTMLInputElement | null;
        if (usernameInput) {
            usernameInput.focus();
        }
    }
};

// Export for global access
(window as any).AuthUtils = AuthUtils;
