const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  transform: {
    ...tsJestTransformCfg,
  },
  // Set mongodb-memory-server env vars before any test file is loaded.
  // setupFiles runs inside each worker process, so env vars are visible to MMS.
  // This pins the binary to MongoDB 7.0 / ubuntu2204 to avoid glibc
  // compatibility issues with the default 6.0.9 build on this machine.
  setupFiles: ['./jest.setup.js'],
  // Individual test timeout — generous enough for the in-memory MongoDB to
  // start on first run (binary download already done after that).
  testTimeout: 30_000,
};
