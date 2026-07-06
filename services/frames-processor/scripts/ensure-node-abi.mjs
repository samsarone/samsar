const expectedNodeMajor = 22;
const expectedNodeModuleVersion = '127';
const actualNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (actualNodeMajor !== expectedNodeMajor || process.versions.modules !== expectedNodeModuleVersion) {
  console.error(
    `This service must install dependencies with Node ${expectedNodeMajor}.x ` +
      `(NODE_MODULE_VERSION ${expectedNodeModuleVersion}). Current runtime is ` +
      `Node ${process.versions.node} (NODE_MODULE_VERSION ${process.versions.modules}).`
  );
  console.error('Run `nvm install 22 && nvm use 22`, then reinstall or rebuild native dependencies.');
  process.exit(1);
}
