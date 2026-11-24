const { MongoMemoryServer } = require('mongodb-memory-server');
console.log('Starting download...');
MongoMemoryServer.create().then(async (m) => {
  console.log('MongoMemoryServer started at', m.getUri());
  await m.stop();
  console.log('Done');
}).catch(console.error);