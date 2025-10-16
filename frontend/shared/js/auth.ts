/**
 * Authentication utilities for the ESL Assessment System
 * This file provides common authentication functions used across modules
 */

// Auth utilities namespace
const AuthUtils = {
    // Authentication state
    authState: {
        token: null as string | null,
        username: null as string | null,
        isAuthenticated: false
    },

    /**
     * Initialize authentication from localStorage
     */
    initializeAuth: async function(): Promise<void> {
        const token = localStorage.getItem("token");
        const username = localStorage.getItem("username");
        
        if (token && username) {
            this.authState.token = token;
            this.authState.username = username;
            this.authState.isAuthenticated = true;
            this.updateAuthHeader(token);
            this.updateUIForAuthStatus(true, username);
            
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
                this.clearAuth();
            }
        } else {
            this.updateUIForAuthStatus(false, "");
        }
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
                this.authState.token = data.access_token;
                this.authState.username = username;
                this.authState.isAuthenticated = true;
                
                localStorage.setItem("token", data.access_token);
                localStorage.setItem("username", username);
                
                this.updateAuthHeader(data.access_token);
                this.updateUIForAuthStatus(true, username);
                
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
    updateAuthHeader: function(token: string): void {
        // This would be used by API utilities
        if (typeof (window as any).APIUtils !== "undefined") {
            (window as any).APIUtils.updateAuthHeader(token);
        }
    },

    /**
     * Update UI based on authentication status
     */
    updateUIForAuthStatus: function(isAuthenticated: boolean, username: string): void {
        const authState = document.getElementById("authState");
        const loginLink = document.getElementById("loginLink");
        
        if (authState) {
            if (isAuthenticated) {
                authState.textContent = `Logged in as ${username}`;
            } else {
                authState.textContent = "Logged out";
            }
        }
        
        if (loginLink) {
            if (isAuthenticated) {
                loginLink.textContent = "Logout";
                loginLink.onclick = this.logout.bind(this);
            } else {
                loginLink.textContent = "Login";
                loginLink.onclick = null;
            }
        }
    },

    /**
     * Clear authentication state
     */
    clearAuth: function(): void {
        this.authState.token = null;
        this.authState.username = null;
        this.authState.isAuthenticated = false;
        
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        
        this.updateUIForAuthStatus(false, "");
    },

    /**
     * Logout user
     */
    logout: function(): void {
        this.clearAuth();
        window.location.reload();
    }
};

// Export for global access
(window as any).AuthUtils = AuthUtils;
