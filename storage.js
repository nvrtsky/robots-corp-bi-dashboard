const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

// Initialize DB if not exists
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ portals: {} }, null, 2));
}

const db = {
    // Read whole DB
    read: () => {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('DB Read Error:', e);
            return { portals: {} };
        }
    },

    // Write whole DB
    write: (data) => {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('DB Write Error:', e);
        }
    },

    // Save tokens for a domain
    saveTokens: (domain, tokens) => {
        const data = db.read();
        data.portals[domain] = {
            ...data.portals[domain],
            ...tokens,
            updatedAt: new Date().toISOString()
        };
        db.write(data);
        console.log(`[Storage] Saved tokens for ${domain}`);
    },

    // Get tokens for a domain
    getTokens: (domain) => {
        const data = db.read();
        return data.portals[domain];
    }
};

module.exports = db;
