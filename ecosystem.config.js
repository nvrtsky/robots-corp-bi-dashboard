module.exports = {
    apps: [{
        name: 'robots-bi',
        script: 'server.js',
        cwd: '/var/www/robots-bi',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '256M',
        env: {
            NODE_ENV: 'production',
            PORT: 3010
        }
    }]
};
