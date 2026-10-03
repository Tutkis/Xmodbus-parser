/**
 * App version — read from package.json at build time.
 *
 * Next.js bundles this as a static string, so it's always in sync with
 * the version in package.json without any runtime file reads.
 */

// Import version from package.json. Next.js/Turbopack supports JSON
// imports out of the box. The rest of package.json is tree-shaken away.
import pkg from '../../../package.json' with { type: 'json' };

export const APP_VERSION: string = pkg.version;
export const APP_NAME: string = pkg.name;
