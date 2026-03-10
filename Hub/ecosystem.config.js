// PM2 Configuration for Revamp Hub
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'revamp-hub',
    script: 'server.js',
    cwd: __dirname,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
