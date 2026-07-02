// ── BDPS API Client v2 ──────────────────────────────────────────────────
// All requests include the Supabase JWT in the Authorization header.
// Auth state is managed via Supabase JS SDK (loaded in index.html).

const API = {
    baseUrl: 'https://bdps1.onrender.com/api',

    // ── Supabase Auth helpers ──────────────────────────────────────────
    _supabase: null,

    async _getToken() {
        const { data: { session } } = await this._supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');
        return session.access_token;
    },

    async _headers() {
        const token = await this._getToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    },

    async _req(method, path, body) {
        const headers = await this._headers();
        const opts = { method, headers };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(`${this.baseUrl}${path}`, opts);
        const json = await res.json().catch(() => ({ error: res.statusText }));
        if (!res.ok) throw { status: res.status, message: json.error || 'Unknown error', details: json.details };
        return json;
    },

    async _download(path) {
        const token = await this._getToken();
        const res = await fetch(`${this.baseUrl}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
    },

    // ── Auth ───────────────────────────────────────────────────────────
    async signUp(email, password, fullName) {
        return this._supabase.auth.signUp({
            email, password,
            options: { data: { full_name: fullName } }
        });
    },

    async signIn(email, password) {
        return this._supabase.auth.signInWithPassword({ email, password });
    },

    async signOut() {
        return this._supabase.auth.signOut();
    },

    async getSession() {
        return this._supabase.auth.getSession();
    },

    // ── Profile ────────────────────────────────────────────────────────
    async getMe() { return this._req('GET', '/me'); },
    async updateMe(data) { return this._req('PUT', '/me', data); },

    // ── Businesses ─────────────────────────────────────────────────────
    async getBusinesses(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this._req('GET', `/businesses${qs ? '?' + qs : ''}`);
    },
    async getBusiness(id) { return this._req('GET', `/businesses/${id}`); },
    async createBusiness(data) { return this._req('POST', '/businesses', data); },
    async updateBusiness(id, data) { return this._req('PUT', `/businesses/${id}`, data); },
    async deleteBusiness(id) { return this._req('DELETE', `/businesses/${id}`); },

    // ── Analytics & Rankings ───────────────────────────────────────────
    async getAnalytics() { return this._req('GET', '/analytics'); },
    async getRankings(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this._req('GET', `/rankings${qs ? '?' + qs : ''}`);
    },
    async getRecommendations(id) { return this._req('GET', `/recommendations/${id}`); },

    // ── Reports ────────────────────────────────────────────────────────
    async downloadCsv() { return this._download('/reports/csv'); },

    // ── Admin ──────────────────────────────────────────────────────────
    async adminGetUsers() { return this._req('GET', '/admin/users'); },
    async adminSetRole(userId, role) { return this._req('PUT', `/admin/users/${userId}/role`, { role }); },
    async adminSetActive(userId, isActive) { return this._req('PUT', `/admin/users/${userId}/active`, { isActive }); },

    // ── Health ─────────────────────────────────────────────────────────
    async health() {
        const res = await fetch(`${this.baseUrl}/health`);
        return res.ok;
    }
};
