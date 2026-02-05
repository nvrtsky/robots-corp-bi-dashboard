const axios = require('axios');
const storage = require('./storage');

class BitrixClient {
    constructor(domain) {
        this.domain = domain;
        this.baseUrl = `https://${domain}/rest`;
    }

    async call(method, params = {}) {
        const tokens = storage.getTokens(this.domain);
        if (!tokens || !tokens.AUTH_ID) {
            throw new Error(`No tokens found for domain ${this.domain}`);
        }

        const url = `${this.baseUrl}/${method}`;
        const requestParams = {
            auth: tokens.AUTH_ID,
            ...params
        };

        try {
            console.log(`[Bitrix API] Calling ${method} for ${this.domain}`);
            const response = await axios.post(url, requestParams);

            if (response.data.error) {
                // Handle token expiration
                if (response.data.error === 'expired_token' || response.data.error === 'NO_AUTH_FOUND') {
                    console.log(`[Bitrix API] Token expired for ${this.domain}, refreshing...`);
                    await this.refreshToken(tokens);
                    // Retry original request
                    return this.call(method, params);
                }
                throw new Error(`Bitrix API Error: ${response.data.error_description || response.data.error}`);
            }

            return response.data;
        } catch (error) {
            // Check if it's an axios error with a response
            if (error.response && error.response.data && (error.response.data.error === 'expired_token' || error.response.data.error === 'NO_AUTH_FOUND')) {
                console.log(`[Bitrix API] Token expired (401) for ${this.domain}, refreshing...`);
                await this.refreshToken(tokens);
                return this.call(method, params);
            }
            throw error;
        }
    }

    async refreshToken(tokens) {
        if (!tokens.REFRESH_ID) {
            throw new Error('No refresh token available');
        }

        // We strictly need client_id and client_secret to refresh via OAuth, 
        // BUT for a "Local Application" (server-side) inside the portal, 
        // sometimes just calling the refresh URL provided in the install payload is enough,
        // OR we need to ask the user for CLIENT_ID (Application ID) and CLIENT_SECRET (Application Key).
        // 
        // For this MVP, if we don't have client credentials, we might be stuck if the token expires.
        // However, standard OAuth requires client_id/secret.
        // 
        // Strategy: Assume we might receive CLIENT_ID/SECRET via env vars or just fail for now.
        // Alternatively, reuse the special 'https://oauth.bitrix.info/oauth/token/' endpoint if applicable.

        const CLIENT_ID = process.env.BITRIX_CLIENT_ID;
        const CLIENT_SECRET = process.env.BITRIX_CLIENT_SECRET;

        if (!CLIENT_ID || !CLIENT_SECRET) {
            throw new Error('BITRIX_CLIENT_ID and BITRIX_CLIENT_SECRET env vars are required for token refresh');
        }

        const url = 'https://oauth.bitrix.info/oauth/token/';
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('client_id', CLIENT_ID);
        params.append('client_secret', CLIENT_SECRET);
        params.append('refresh_token', tokens.REFRESH_ID);

        try {
            const response = await axios.post(url, params);
            const newTokens = {
                AUTH_ID: response.data.access_token,
                REFRESH_ID: response.data.refresh_token,
                expires_in: response.data.expires_in
            };

            storage.saveTokens(this.domain, newTokens);
            console.log(`[Bitrix API] Token refreshed successfully for ${this.domain}`);
        } catch (error) {
            console.error('[Bitrix API] Refresh failed:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

module.exports = BitrixClient;
