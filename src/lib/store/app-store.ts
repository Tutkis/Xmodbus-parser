'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedFrame, ParseOptions, ByteOrder, DataType, ModbusProtocol } from '@/lib/modbus';
import type { RegisterMapEntry } from '@/lib/modbus/types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TabId = 'parse' | 'builder' | 'timeline' | 'settings';

export type FilterField =
  | 'station'
  | 'function'
  | 'register'
  | 'value'
  | 'direction'
  | 'status';

export type FilterOp = 'equals' | 'contains' | 'gt' | 'lt' | 'regex';

export interface FilterRule {
  id: string;
  field: FilterField;
  op: FilterOp;
  value: string;
  enabled: boolean;
}

export type FilterCombinator = 'and' | 'or';

export interface ParseSettings {
  protocol: ModbusProtocol | 'auto';
  byteOrder: ByteOrder;
  dataType: DataType;
  autoDetectByteOrder: boolean;
  baseOffset: 0 | 1;
  addressFormat: 'absolute' | 'relative';
  colorCodeMemory: boolean;
  showPrefix: boolean;
  registerMap: RegisterMapEntry[];
}

export interface AppState {
  /* Tab navigation */
  activeTab: TabId;

  /* Input */
  inputText: string;
  inputSource: 'paste' | 'file' | 'pcap' | 'sample' | null;

  /* Parsed frames */
  frames: ParsedFrame[];
  parseError: string | null;
  isParsing: boolean;

  /* Selected frame in the list pane */
  selectedFrameIndex: number | null;

  /* Filters */
  filterRules: FilterRule[];
  filterCombinator: FilterCombinator;

  /* Parse-time options */
  settings: ParseSettings;

  /* Pcap-specific */
  detectedPorts: number[];
  pcapFlowsCount: number;
  pcapWarnings: string[];
  selectedPort: number | null;

  /* Actions */
  setTab: (tab: TabId) => void;
  setInput: (text: string, source?: 'paste' | 'file' | 'pcap' | 'sample') => void;
  setFrames: (frames: ParsedFrame[], meta?: { ports?: number[]; flowsCount?: number; warnings?: string[] }) => void;
  setParseError: (err: string | null) => void;
  setParsing: (p: boolean) => void;
  selectFrame: (idx: number | null) => void;
  clearAll: () => void;

  addFilterRule: () => void;
  updateFilterRule: (id: string, patch: Partial<FilterRule>) => void;
  removeFilterRule: (id: string) => void;
  clearFilters: () => void;
  setFilterCombinator: (c: FilterCombinator) => void;

  updateSettings: (patch: Partial<ParseSettings>) => void;
  loadRegisterMap: (entries: RegisterMapEntry[]) => void;
  clearRegisterMap: () => void;

  setSelectedPort: (port: number | null) => void;
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS: ParseSettings = {
  protocol: 'auto',
  byteOrder: 'ABCD',
  dataType: 'uint16',
  autoDetectByteOrder: false,
  baseOffset: 0,
  addressFormat: 'relative',
  colorCodeMemory: true,
  showPrefix: false,
  registerMap: [],
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useAppStore = create<AppState>()(
  persist(
    (set, _get) => ({
      activeTab: 'parse',
      inputText: '',
      inputSource: null,
      frames: [],
      parseError: null,
      isParsing: false,
      selectedFrameIndex: null,
      filterRules: [],
      filterCombinator: 'and',
      settings: DEFAULT_SETTINGS,
      detectedPorts: [],
      pcapFlowsCount: 0,
      pcapWarnings: [],
      selectedPort: null,

      setTab: (tab) => set({ activeTab: tab }),

      setInput: (text, source = 'paste') =>
        set({ inputText: text, inputSource: source }),

      setFrames: (frames, meta) =>
        set({
          frames,
          selectedFrameIndex: frames.length > 0 ? 0 : null,
          parseError: null,
          detectedPorts: meta?.ports ?? [],
          pcapFlowsCount: meta?.flowsCount ?? 0,
          pcapWarnings: meta?.warnings ?? [],
        }),

      setParseError: (err) => set({ parseError: err, frames: [] }),
      setParsing: (p) => set({ isParsing: p }),
      selectFrame: (idx) => set({ selectedFrameIndex: idx }),
      clearAll: () =>
        set({
          inputText: '',
          inputSource: null,
          frames: [],
          parseError: null,
          selectedFrameIndex: null,
          detectedPorts: [],
          pcapFlowsCount: 0,
          pcapWarnings: [],
          selectedPort: null,
        }),

      addFilterRule: () =>
        set((s) => ({
          filterRules: [
            ...s.filterRules,
            {
              id: uid(),
              field: 'station',
              op: 'equals',
              value: '',
              enabled: true,
            },
          ],
        })),

      updateFilterRule: (id, patch) =>
        set((s) => ({
          filterRules: s.filterRules.map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        })),

      removeFilterRule: (id) =>
        set((s) => ({
          filterRules: s.filterRules.filter((r) => r.id !== id),
        })),

      clearFilters: () => set({ filterRules: [] }),
      setFilterCombinator: (c) => set({ filterCombinator: c }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      loadRegisterMap: (entries) =>
        set((s) => ({
          settings: { ...s.settings, registerMap: entries },
        })),

      clearRegisterMap: () =>
        set((s) => ({ settings: { ...s.settings, registerMap: [] } })),

      setSelectedPort: (port) => set({ selectedPort: port }),
    }),
    {
      name: 'modbus-analyzer-store',
      // Persist only UI preferences & settings, never the parsed frames
      // (they can be huge and are re-derived from inputText anyway).
      partialize: (s) => ({
        activeTab: s.activeTab,
        settings: s.settings,
        filterRules: s.filterRules,
        filterCombinator: s.filterCombinator,
      }),
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Derived selectors                                                   */
/* ------------------------------------------------------------------ */

/** Apply the active filter rules to the parsed frames. */
export function selectFilteredFrames(state: AppState): ParsedFrame[] {
  const { frames, filterRules, filterCombinator } = state;
  const active = filterRules.filter((r) => r.enabled && r.value.trim() !== '');
  if (active.length === 0) return frames;

  return frames.filter((frame) => {
    const results = active.map((rule) => matchRule(frame, rule));
    return filterCombinator === 'and'
      ? results.every(Boolean)
      : results.some(Boolean);
  });
}

function matchRule(frame: ParsedFrame, rule: FilterRule): boolean {
  const v = rule.value.trim();
  if (!v) return true;

  let target: string | number | undefined;

  switch (rule.field) {
    case 'station':
      target = frame.slaveAddress ?? frame.unitId;
      break;
    case 'function':
      target = frame.functionCode;
      break;
    case 'direction':
      target = frame.direction;
      break;
    case 'status':
      target = frame.status;
      break;
    case 'register': {
      const wanted = parseNumber(v);
      if (wanted === null) return false;
      const addrField = frame.fields.find(
        (f) => f.name.includes('start_address') || f.name.includes('address'),
      );
      if (addrField && typeof addrField.value === 'number' && addrField.value === wanted) {
        return true;
      }
      return false;
    }
    case 'value': {
      const wanted = v.toLowerCase();
      const hexHit = frame.tokens.some((tok) =>
        tok.value.toString(16).padStart(2, '0') === wanted,
      );
      if (hexHit) return true;
      const numHit = frame.tokens.some((tok) => tok.value === parseNumber(v));
      return numHit;
    }
  }

  if (target === undefined || target === null) return false;

  switch (rule.op) {
    case 'equals':
      return String(target) === v || target === parseNumber(v);
    case 'contains':
      return String(target).includes(v);
    case 'gt': {
      const n = parseNumber(v);
      return n !== null && typeof target === 'number' && target > n;
    }
    case 'lt': {
      const n = parseNumber(v);
      return n !== null && typeof target === 'number' && target < n;
    }
    case 'regex': {
      try {
        return new RegExp(v, 'i').test(String(target));
      } catch {
        return false;
      }
    }
  }
  return false;
}

function parseNumber(s: string): number | null {
  s = s.trim().toLowerCase();
  if (s.startsWith('0x')) {
    const n = parseInt(s.slice(2), 16);
    return Number.isNaN(n) ? null : n;
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Convert AppState.settings → ParseOptions for the parser. */
export function settingsToParseOptions(s: ParseSettings): ParseOptions {
  return {
    byteOrder: s.byteOrder,
    dataType: s.dataType,
    autoDetectByteOrder: s.autoDetectByteOrder,
    baseOffset: s.baseOffset,
    addressFormat: s.addressFormat,
    registerMap: s.registerMap,
  };
}
