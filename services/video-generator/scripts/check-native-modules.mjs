const expectedNodeModuleVersion = '127';

if (process.versions.modules !== expectedNodeModuleVersion) {
  console.error(
    `Expected NODE_MODULE_VERSION ${expectedNodeModuleVersion}, got ${process.versions.modules}. ` +
      'Use Node 22 before installing or starting this service.'
  );
  process.exit(1);
}

try {
  await import('sharp');
  console.log(`sharp native module OK for Node ${process.versions.node} ABI ${process.versions.modules}`);
} catch (error) {
  console.error('sharp native module failed to load for the current Node runtime.');
  console.error('Run `npm run rebuild:native` or reinstall with `npm install --omit=dev` under Node 22.');
  throw error;
}
