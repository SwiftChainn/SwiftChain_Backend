const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  transform: {
    ...tsJestTransformCfg,
  },
  // Allow enough time for MongoMemoryServer to start (and download the binary
  // on first run in a fresh environment).
  testTimeout: 30000,
};
