/**
 * @file colorize/index.ts
 * @description Public entry point for the Modbus color tokenizer.
 *
 * Re-exports the tokenizer's public types and functions so consumers
 * can `import { tokenizeFrame, detectChanges, formatHexDump } from '@/lib/colorize'`.
 *
 * The tokenizer is a pure, framework-agnostic TS module. It accepts an
 * already-parsed frame shape (`ParsedFrameLike`) and an active theme,
 * and returns render-ready structures with theme colors baked in.
 */
export {
  detectChanges,
  formatHexDump,
  tokenizeFrame,
} from './tokenizer';

export type {
  ByteToken,
  HexDumpLine,
  HexDumpOptions,
  ParsedFrameLike,
  RenderableByte,
  RenderableField,
  RenderableFrame,
  TokenizeFrameOptions,
} from './tokenizer';
