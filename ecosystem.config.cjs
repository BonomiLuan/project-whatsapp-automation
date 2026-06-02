module.exports = {
  apps: [
    {
      name: 'wa-offers',
      script: 'dist/server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}
