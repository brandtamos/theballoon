module.exports = {
  apps: [
    {
      name: 'the-balloon',
      script: 'server.js',
      cwd: __dirname,
      // server.js loads .env itself, so PORT just needs to be set there.
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
