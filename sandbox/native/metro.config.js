// Monorepo Metro config: watch the workspace root so Metro picks up the linked
// @dunky.dev/* + @sandbox/* source packages, and resolve modules from both the
// app's and the root's node_modules. Mirrors the standard Expo monorepo setup.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Force a single React instance. The @dunky.dev/* packages are consumed as
// source and carry their own react@19.2 in devDependencies; without this Metro
// would bundle that copy (resolved via packages/react/node_modules/react)
// alongside the app's react@19.1 — the one react-native renders with — giving
// two React instances and "Invalid hook call" errors. Unlike webpack, Metro
// doesn't dedupe, and extraNodeModules won't help because the wrong copy
// resolves normally; we redirect every `react`/`react-dom` request to the
// app's copy via resolveRequest.
const reactRoot = path.resolve(projectRoot, 'node_modules')
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(reactRoot, 'noop.js') },
      moduleName,
      platform,
    )
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
