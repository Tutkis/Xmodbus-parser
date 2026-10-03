/**
 * App version — injected at build time via Next.js env variable
 * (configured in next.config.ts → env.NEXT_PUBLIC_APP_VERSION).
 *
 * The value is read from package.json by next.config.ts and inlined
 * into the bundle as a string constant. Always in sync with package.json,
 * no runtime file reads, no fragile JSON imports.
 */

export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0-dev';
export const APP_NAME: string = process.env.NEXT_PUBLIC_APP_NAME || 'modbus-analyzer';
