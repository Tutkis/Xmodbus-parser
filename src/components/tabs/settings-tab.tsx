'use client';

/* =============================================================================
 * SettingsTab
 * -----------------------------------------------------------------------------
 * Configuration hub for the Modbus Analyzer PWA. Six functional sections plus
 * an "About" panel, arranged in a responsive 1-column (mobile) / 2-column
 * (desktop) grid of shadcn Cards:
 *
 *   1. Parse Options   — protocol, byte order, data type, auto-detect switch
 *   2. Addressing      — base offset, format, color-code, prefix, live preview
 *   3. Register Map    — CSV upload / paste / template download / table view
 *   4. Theme           — preset list, JSON upload, swatch preview, export
 *   5. Language        — locale list, JSON upload, dictionary export
 *   6. Vendor FCs      — placeholder for future vendor-specific schema editor
 *   7. About           — app/version/tech-stack/links
 *
 * All settings flow through the zustand `useAppStore` (settings slice). Theme
 * and locale changes flow through their respective singletons (`@/lib/themes`,
 * `@/lib/i18n`) via the `useTheme` / `useI18n` hooks.
 *
 * CSV parsing is implemented inline (no papaparse) — quoted fields with
 * embedded commas are supported; per-row errors are collected and surfaced
 * inline.
 * ========================================================================== */

import * as React from 'react';
import {
  AlertCircle,
  Code2,
  Download,
  FileText,
  Info,
  Languages,
  Palette,
  Settings as SettingsIcon,
  Trash2,
  Upload,
} from 'lucide-react';

import { useAppStore, type ParseSettings } from '@/lib/store/app-store';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/hooks/use-i18n';
import { getDictionary } from '@/lib/i18n';
import type {
  ByteOrder,
  DataType,
  RegisterMapEntry,
} from '@/lib/modbus';
import type { ModbusProtocol } from '@/lib/modbus';
import type { ThemeJSON } from '@/lib/themes/types';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

/** App version — auto-imported from package.json at build time. */
import { APP_VERSION } from '@/lib/version';

/** GitHub URL placeholder — replace once the public repo is published. */
const GITHUB_URL = 'https://github.com/example/modbus-analyzer';

/** Modbus Application Protocol Specification v1.1b3 (PDF). */
const MODBUS_SPEC_URL =
  'https://www.modbus.org/file/secure/modbusprotocolspecification.pdf';

/** Required CSV columns; everything else is optional. */
const CSV_REQUIRED_COLUMNS = ['address', 'name'] as const;

/** All recognized CSV columns (used for template generation & validation). */
const CSV_ALL_COLUMNS = [
  'address',
  'name',
  'unit',
  'scale',
  'offset',
  'datatype',
  'byteorder',
  'size',
] as const;

/** Valid DataType values (mirrors `DataType` union from `@/lib/modbus`). */
const VALID_DATA_TYPES: readonly DataType[] = [
  'uint16',
  'int16',
  'uint32',
  'int32',
  'float32',
  'float64',
  'bits',
  'ascii',
] as const;

/** Valid ByteOrder values. */
const VALID_BYTE_ORDERS: readonly ByteOrder[] = [
  'ABCD',
  'DCBA',
  'BADC',
  'CDAB',
] as const;

/** A short label per ByteOrder value, shown in the Select dropdown. */
const BYTE_ORDER_LABELS: Record<ByteOrder, string> = {
  ABCD: 'ABCD — Big-endian',
  DCBA: 'DCBA — Little-endian',
  BADC: 'BADC — Big-endian byte-swap',
  CDAB: 'CDAB — Little-endian byte-swap',
};

/** Memory areas shown in the addressing live-preview. */
type MemoryArea = 'holding' | 'input' | 'coil' | 'discrete';

/** PLC-style area digit prefix (4=holding, 3=input, 0=coil, 1=discrete). */
const AREA_DIGIT: Record<MemoryArea, number> = {
  holding: 4,
  input: 3,
  coil: 0,
  discrete: 1,
};

/** Tailwind color classes per memory area, used for the colored badge variant. */
const AREA_BADGE_CLASS: Record<MemoryArea, string> = {
  holding:
    'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
  input:
    'bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800',
  coil:
    'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
  discrete:
    'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800',
};

/** A subset of byte roles whose colors are surfaced as the theme swatch preview. */
const SWATCH_ROLES = [
  'address',
  'function',
  'data',
  'crc_lo',
  'mbap_transaction_hi',
  'unknown',
] as const;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Trigger a client-side download of a text blob. No-op on the server.
 */
function downloadText(filename: string, contents: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has time to fire.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Read a `File` as text via the FileReader API. Returns a Promise<string>.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsText(file);
  });
}

/* ------------------------------------------------------------------ */
/* Address formatter                                                   */
/* ------------------------------------------------------------------ */

/**
 * Format a 0-based raw register address according to the user's addressing
 * settings.
 *
 * Rules (matching the spec example in the task brief):
 *   - relative + 0-based + no prefix  →  "0"
 *   - relative + 1-based + no prefix  →  "1"
 *   - absolute + 0-based + no prefix  →  "40000"
 *   - absolute + 1-based + no prefix  →  "40001"
 *   - relative + showPrefix           →  "4x0"   /  "4x1"
 *   - absolute + showPrefix           →  "4x0000" / "4x0001"
 *
 * The absolute numeric value is `digit*10000 + raw + baseOffset`. The prefix
 * form renders `digit` + "x" + the last 4 digits zero-padded (absolute) or
 * the bare display number (relative).
 */
function formatAddress(raw: number, area: MemoryArea, s: ParseSettings): string {
  const digit = AREA_DIGIT[area];
  const display = raw + s.baseOffset;
  if (s.addressFormat === 'relative') {
    return s.showPrefix ? `${digit}x${display}` : `${display}`;
  }
  // absolute
  const absolute = digit * 10000 + raw + s.baseOffset;
  if (s.showPrefix) {
    const tail = String(absolute - digit * 10000).padStart(4, '0');
    return `${digit}x${tail}`;
  }
  return `${absolute}`;
}

/* ------------------------------------------------------------------ */
/* Inline CSV parser (no papaparse)                                    */
/* ------------------------------------------------------------------ */

interface CsvParseResult {
  entries: RegisterMapEntry[];
  errors: string[];
}

/**
 * Parse a single CSV line into an array of string fields.
 *
 * - Supports double-quoted fields containing commas.
 * - Supports escaped quotes (`""` inside a quoted field → `"`).
 * - Trailing empty fields are preserved (a 3-column header still yields 3
 *   entries even if the last cell is empty).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a CSV document into a list of `RegisterMapEntry`.
 *
 * Header row is required and must include at least `address` and `name`.
 * Other recognized columns: `unit`, `scale`, `offset`, `datatype`,
 * `byteorder`, `size`. Unknown columns are ignored.
 *
 * Per-row errors are collected and returned alongside successfully parsed
 * entries; one bad row does not abort the rest.
 */
function parseRegisterCsv(text: string): CsvParseResult {
  const entries: RegisterMapEntry[] = [];
  const errors: string[] = [];

  // Normalize line endings and drop empty lines.
  const lines = text
    .replace(/^\uFEFF/, '') // strip BOM if present
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { entries, errors: ['CSV is empty.'] };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const colIdx: Record<string, number> = {};
  header.forEach((h, i) => {
    if (!(h in colIdx)) colIdx[h] = i;
  });

  // Validate required columns.
  const missing = CSV_REQUIRED_COLUMNS.filter((c) => !(c in colIdx));
  if (missing.length > 0) {
    errors.push(`Missing required column(s): ${missing.join(', ')}.`);
    return { entries, errors };
  }

  const optStr = (cols: string[], name: string): string => {
    const i = colIdx[name];
    return i === undefined ? '' : (cols[i] ?? '').trim();
  };

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const lineNo = rowIdx + 1;
    const cols = parseCsvLine(lines[rowIdx]);
    const addrStr = optStr(cols, 'address');
    const name = optStr(cols, 'name');

    if (!addrStr || !name) {
      errors.push(`Row ${lineNo}: missing address or name.`);
      continue;
    }

    const address = parseInt(addrStr, 10);
    if (Number.isNaN(address) || address < 0 || address > 65535) {
      errors.push(
        `Row ${lineNo}: invalid address "${addrStr}" (must be 0–65535).`,
      );
      continue;
    }

    const entry: RegisterMapEntry = { address, name };

    const unit = optStr(cols, 'unit');
    if (unit) entry.unit = unit;

    const scaleStr = optStr(cols, 'scale');
    if (scaleStr) {
      const n = parseFloat(scaleStr);
      if (!Number.isNaN(n)) entry.scale = n;
      else errors.push(`Row ${lineNo}: invalid scale "${scaleStr}" (ignored).`);
    }

    const offsetStr = optStr(cols, 'offset');
    if (offsetStr) {
      const n = parseFloat(offsetStr);
      if (!Number.isNaN(n)) entry.offset = n;
      else errors.push(`Row ${lineNo}: invalid offset "${offsetStr}" (ignored).`);
    }

    const dtStr = optStr(cols, 'datatype').toLowerCase();
    if (dtStr) {
      if ((VALID_DATA_TYPES as readonly string[]).includes(dtStr)) {
        entry.dataType = dtStr as DataType;
      } else {
        errors.push(`Row ${lineNo}: unknown dataType "${dtStr}" (ignored).`);
      }
    }

    const boStr = optStr(cols, 'byteorder').toUpperCase();
    if (boStr) {
      if ((VALID_BYTE_ORDERS as readonly string[]).includes(boStr)) {
        entry.byteOrder = boStr as ByteOrder;
      } else {
        errors.push(`Row ${lineNo}: unknown byteOrder "${boStr}" (ignored).`);
      }
    }

    const sizeStr = optStr(cols, 'size');
    if (sizeStr) {
      const n = parseInt(sizeStr, 10);
      if (!Number.isNaN(n) && n > 0) entry.size = n;
      else errors.push(`Row ${lineNo}: invalid size "${sizeStr}" (ignored).`);
    }

    entries.push(entry);
  }

  return { entries, errors };
}

/** Generate a sample 3-row CSV template for users to start from. */
function buildCsvTemplate(): string {
  const header = CSV_ALL_COLUMNS.join(',');
  const rows = [
    '0,Battery Voltage,V,0.1,0,uint16,ABCD,1',
    '1,Battery Current,A,0.01,0,int16,ABCD,1',
    '2,Temperature,°C,0.1,-40,float32,ABCD,2',
  ];
  return [header, ...rows].join('\n');
}

/* ------------------------------------------------------------------ */
/* Section 1: Parse Options                                            */
/* ------------------------------------------------------------------ */

function ParseOptionsCard(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="size-4" />
          {t('settings.parse_options')}
        </CardTitle>
        <CardDescription>
          {t('settings.parse_options_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Protocol */}
        <div className="space-y-2">
          <Label htmlFor="set-protocol">
            {t('settings.protocol')}
          </Label>
          <Select
            value={settings.protocol}
            onValueChange={(v) =>
              updateSettings({ protocol: v as ParseSettings['protocol'] })
            }
          >
            <SelectTrigger id="set-protocol" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.protocol_auto')}</SelectItem>
              <SelectItem value="rtu">{t('settings.protocol_rtu')}</SelectItem>
              <SelectItem value="ascii">{t('settings.protocol_ascii')}</SelectItem>
              <SelectItem value="tcp">{t('settings.protocol_tcp')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Byte Order */}
        <div className="space-y-2">
          <Label htmlFor="set-byteorder">{t('options.byte_order')}</Label>
          <Select
            value={settings.byteOrder}
            onValueChange={(v) => updateSettings({ byteOrder: v as ByteOrder })}
          >
            <SelectTrigger id="set-byteorder" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(VALID_BYTE_ORDERS as readonly ByteOrder[]).map((bo) => (
                <SelectItem key={bo} value={bo}>
                  {BYTE_ORDER_LABELS[bo]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Data Type */}
        <div className="space-y-2">
          <Label htmlFor="set-datatype">{t('options.data_type')}</Label>
          <Select
            value={settings.dataType}
            onValueChange={(v) => updateSettings({ dataType: v as DataType })}
          >
            <SelectTrigger id="set-datatype" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(VALID_DATA_TYPES as readonly DataType[]).map((dt) => (
                <SelectItem key={dt} value={dt}>
                  {dt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Auto-detect byte order */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="set-autodetect">
              {t('settings.auto_detect')}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t('settings.auto_detect_desc')}
            </p>
          </div>
          <Switch
            id="set-autodetect"
            checked={settings.autoDetectByteOrder}
            onCheckedChange={(v) => updateSettings({ autoDetectByteOrder: v })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2: Addressing (with live preview)                          */
/* ------------------------------------------------------------------ */

function AddressingCard(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { t } = useI18n();

  const previewAreas: MemoryArea[] = ['holding', 'input', 'coil', 'discrete'];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="size-4" />
          {t('settings.addressing')}
        </CardTitle>
        <CardDescription>
          {t('settings.addressing_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Base offset */}
        <div className="space-y-2">
          <Label>{t('options.address_base')}</Label>
          <RadioGroup
            value={String(settings.baseOffset)}
            onValueChange={(v) =>
              updateSettings({ baseOffset: v === '1' ? 1 : 0 })
            }
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="0" id="base-0" />
              <Label htmlFor="base-0" className="font-normal cursor-pointer">
                {t('settings.base_offset_0')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="1" id="base-1" />
              <Label htmlFor="base-1" className="font-normal cursor-pointer">
                {t('settings.base_offset_1')}
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* Address format */}
        <div className="space-y-2">
          <Label>{t('options.address_format')}</Label>
          <RadioGroup
            value={settings.addressFormat}
            onValueChange={(v) =>
              updateSettings({
                addressFormat: v as 'relative' | 'absolute',
              })
            }
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="relative" id="fmt-rel" />
              <Label htmlFor="fmt-rel" className="font-normal cursor-pointer">
                {t('options.relative')} {t('settings.relative_format_hint')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="absolute" id="fmt-abs" />
              <Label htmlFor="fmt-abs" className="font-normal cursor-pointer">
                {t('options.absolute')} {t('settings.absolute_format_hint')}
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        {/* Color-code memory areas */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="set-color-mem">
              {t('settings.color_code_memory')}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t('settings.color_code_memory_desc')}
            </p>
          </div>
          <Switch
            id="set-color-mem"
            checked={settings.colorCodeMemory}
            onCheckedChange={(v) => updateSettings({ colorCodeMemory: v })}
          />
        </div>

        {/* Show prefix */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="set-prefix">
              {t('settings.show_prefix')}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t('settings.show_prefix_desc')}
            </p>
          </div>
          <Switch
            id="set-prefix"
            checked={settings.showPrefix}
            onCheckedChange={(v) => updateSettings({ showPrefix: v })}
          />
        </div>

        <Separator />

        {/* Live preview */}
        <div className="space-y-2">
          <Label>
            {t('settings.preview')}
          </Label>
          <div className="bg-muted/40 rounded-md border p-3">
            <div className="space-y-1.5">
              {previewAreas.map((area) => {
                const formatted = formatAddress(0, area, settings);
                const areaKey = `memory.${area === 'holding' ? 'holding_register' : area === 'input' ? 'input_register' : area === 'coil' ? 'coil' : 'discrete_input'}`;
                const areaText = t(areaKey);
                return (
                  <div
                    key={area}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {areaText} 0
                    </span>
                    {settings.colorCodeMemory ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-mono text-xs',
                          AREA_BADGE_CLASS[area],
                        )}
                      >
                        {formatted}
                      </Badge>
                    ) : (
                      <span className="font-mono text-xs">{formatted}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 3: Register Map (CSV)                                       */
/* ------------------------------------------------------------------ */

function RegisterMapCard(): React.JSX.Element {
  const registerMap = useAppStore((s) => s.settings.registerMap);
  const loadRegisterMap = useAppStore((s) => s.loadRegisterMap);
  const clearRegisterMap = useAppStore((s) => s.clearRegisterMap);
  const { t } = useI18n();

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [pasteText, setPasteText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<string[]>([]);

  /** Apply a parsed CSV result: load entries, surface errors. */
  const applyCsv = React.useCallback(
    (text: string) => {
      const { entries, errors } = parseRegisterCsv(text);
      setRowErrors(errors);
      if (entries.length === 0 && errors.length > 0) {
        setError(errors[0] ?? t('settings.no_register_map'));
        return;
      }
      if (entries.length === 0) {
        setError(t('settings.no_register_map'));
        return;
      }
      setError(null);
      loadRegisterMap(entries);
    },
    [loadRegisterMap, t],
  );

  /** Handle a File from input or drop. */
  const handleFile = React.useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.csv') &&
          file.type !== 'text/csv' &&
          file.type !== 'application/vnd.ms-excel') {
        setError(t('settings.please_upload_csv'));
        return;
      }
      try {
        const text = await readFileAsText(file);
        applyCsv(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(t('toast.file_read_failed', { error: msg }));
      }
    },
    [applyCsv, t],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    // Reset so picking the same file twice still fires change.
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const onPasteLoad = () => {
    if (!pasteText.trim()) {
      setError(t('settings.paste_csv'));
      return;
    }
    applyCsv(pasteText);
  };

  const onDownloadTemplate = () => {
    downloadText('register-map-template.csv', buildCsvTemplate(), 'text/csv');
  };

  const onClear = () => {
    clearRegisterMap();
    setError(null);
    setRowErrors([]);
    setPasteText('');
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4" />
          {t('options.register_map')}
        </CardTitle>
        <CardDescription>
          {t('options.register_map')} — CSV:{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">
            {CSV_ALL_COLUMNS.join(',')}
          </code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Drag & drop zone + upload button */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          )}
        >
          <Upload className="text-muted-foreground size-6" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('settings.drag_drop_csv')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('settings.drag_drop_csv_hint')}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {t('settings.upload_csv')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDownloadTemplate}
            >
              <Download className="size-3.5" />
              {t('settings.download_template')}
            </Button>
            {registerMap.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClear}
              >
                <Trash2 className="size-3.5" />
                {t('settings.clear_map')}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel"
            onChange={onFileInputChange}
            className="hidden"
          />
        </div>

        {/* Inline error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('settings.csv_error')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Per-row warnings (non-fatal) */}
        {rowErrors.length > 0 && !error && (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>
              {t('settings.warnings_count', { count: rowErrors.length })}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-xs">
                {rowErrors.slice(0, 8).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {rowErrors.length > 8 && (
                  <li>{t('settings.and_more', { count: rowErrors.length - 8 })}</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Paste-CSV alternative */}
        <div className="space-y-2">
          <Label htmlFor="csv-paste">
            {t('settings.paste_csv')}
          </Label>
          <Textarea
            id="csv-paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`address,name,unit,scale,offset,dataType,byteOrder,size\n0,Battery Voltage,V,0.1,0,uint16,ABCD,1`}
            className="font-mono text-xs"
            rows={4}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onPasteLoad}>
              {t('settings.load_pasted_csv')}
            </Button>
            {pasteText && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPasteText('')}
              >
                {t('settings.clear')}
              </Button>
            )}
          </div>
        </div>

        {/* Loaded entries */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t('settings.loaded_entries')}
            </Label>
            <Badge variant="secondary">
              {t('settings.registers_loaded', { count: registerMap.length })}
            </Badge>
          </div>
          {registerMap.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('settings.no_register_map')}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>{t('settings.table_address')}</TableHead>
                    <TableHead>{t('settings.table_name')}</TableHead>
                    <TableHead>{t('settings.table_unit')}</TableHead>
                    <TableHead>{t('settings.table_scale')}</TableHead>
                    <TableHead>{t('settings.table_offset')}</TableHead>
                    <TableHead>{t('settings.table_type')}</TableHead>
                    <TableHead>{t('settings.table_byteorder')}</TableHead>
                    <TableHead>{t('settings.table_size')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registerMap.map((e, i) => (
                    <TableRow key={`${e.address}-${i}`}>
                      <TableCell className="font-mono text-xs">
                        {e.address}
                      </TableCell>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-xs">
                        {e.unit ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.scale ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.offset ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.dataType ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.byteOrder ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.size ?? 1}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 4: Theme                                                    */
/* ------------------------------------------------------------------ */

function ThemeCard(): React.JSX.Element {
  const { theme, setTheme, listThemes, loadCustomTheme, validateTheme } =
    useTheme();
  const { t } = useI18n();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);

  const themes = listThemes();

  const onFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') &&
        file.type !== 'application/json') {
      setError(t('settings.please_upload_json'));
      return;
    }
    try {
      const text = await readFileAsText(file);
      const obj: unknown = JSON.parse(text);
      const result = validateTheme(obj);
      if (!result.ok) {
        setError(null);
        setErrors(result.errors);
        return;
      }
      setErrors([]);
      setError(null);
      const loaded = loadCustomTheme(obj as ThemeJSON);
      setTheme(loaded.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(t('settings.failed_to_parse_json', { error: msg }));
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onFile(f);
    e.target.value = '';
  };

  const onDownloadCurrent = () => {
    // Strip the runtime `id` so the file is a clean ThemeJSON template.
    const exportable: ThemeJSON = {
      name: theme.name.startsWith('theme.') ? t('settings.my_custom_theme') : theme.name,
      isDark: theme.isDark,
      colors: theme.colors,
    };
    downloadText(
      'modbus-theme.json',
      JSON.stringify(exportable, null, 2),
      'application/json',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" />
          {t('settings.theme')}
        </CardTitle>
        <CardDescription>
          {t('settings.theme_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Theme list */}
        <RadioGroup
          value={theme.id}
          onValueChange={setTheme}
          className="gap-2"
        >
          {themes.map((td) => (
            <div key={td.id} className="flex items-center gap-2">
              <RadioGroupItem value={td.id} id={`theme-${td.id}`} />
              <Label
                htmlFor={`theme-${td.id}`}
                className="flex-1 font-normal cursor-pointer"
              >
                <span>{t(td.name)}</span>
                {td.isDark && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {t('common.dark')}
                  </Badge>
                )}
                {td.isCustom && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    {t('common.custom')}
                  </Badge>
                )}
              </Label>
            </div>
          ))}
        </RadioGroup>

        <Separator />

        {/* Active theme swatch preview */}
        <div className="space-y-2">
          <Label>
            {t('settings.byte_role_colors')}
          </Label>
          <div className="flex flex-wrap gap-2">
            {SWATCH_ROLES.map((role) => {
              const rc = theme.colors.roles[role] ?? theme.colors.roles.unknown;
              return (
                <div
                  key={role}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1"
                  style={{
                    backgroundColor: rc?.bg ?? 'transparent',
                    color: rc?.fg ?? theme.colors.textMuted,
                    borderColor: rc?.border ?? theme.colors.border,
                  }}
                >
                  <span className="font-mono text-[10px]">{role}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upload + download buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {t('theme.load_file')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDownloadCurrent}
          >
            <Download className="size-3.5" />
            {t('settings.download_current_theme')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={onFileInputChange}
            className="hidden"
          />
        </div>

        {/* Errors */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('settings.theme_load_failed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('settings.invalid_theme_json')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-xs">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 5: Language                                                  */
/* ------------------------------------------------------------------ */

function LanguageCard(): React.JSX.Element {
  const { locale, setLocale, listLocales, loadCustomDictionary } = useI18n();
  const { t } = useI18n();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const locales = listLocales();

  const onFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') &&
        file.type !== 'application/json') {
      setError(t('settings.please_upload_json'));
      return;
    }
    try {
      const text = await readFileAsText(file);
      const obj: unknown = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        setError(t('settings.language_must_be_flat'));
        return;
      }
      const dict = obj as Record<string, unknown>;
      // Sanitize: only string values pass through.
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v === 'string') clean[k] = v;
      }
      if (Object.keys(clean).length === 0) {
        setError(t('settings.language_no_strings'));
        return;
      }

      // Prompt for code + name. prompt() is fine here — we explicitly allow it
      // per the task spec ("use a small inline form or prompt()").
      const code =
        typeof window !== 'undefined'
          ? window.prompt(
              t('settings.locale_code_prompt'),
              file.name.replace(/\.json$/i, '').toLowerCase().slice(0, 8),
            )
          : null;
      if (!code) {
        setError(t('settings.locale_code_required'));
        return;
      }
      const name =
        typeof window !== 'undefined'
          ? window.prompt(t('settings.locale_name_prompt'), code)
          : null;
      const safeName = name && name.length > 0 ? name : code;

      loadCustomDictionary(code, safeName, clean);
      setLocale(code);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(t('settings.failed_to_parse_json', { error: msg }));
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onFile(f);
    e.target.value = '';
  };

  const onDownloadEn = () => {
    const en = getDictionary('en');
    if (!en) {
      setError(t('settings.english_unavailable'));
      return;
    }
    downloadText(
      'modbus-en-dictionary.json',
      JSON.stringify(en, null, 2),
      'application/json',
    );
  };

  /** Download the test German dictionary that ships with the PWA. */
  const onDownloadDe = async () => {
    try {
      const res = await fetch('test-de-dictionary.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      downloadText(
        'test-de-dictionary.json',
        text,
        'application/json',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(t('toast.file_read_failed', { error: msg }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4" />
          {t('locale.label')}
        </CardTitle>
        <CardDescription>
          {t('settings.language_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Locale list */}
        <RadioGroup
          value={locale}
          onValueChange={setLocale}
          className="gap-2"
        >
          {locales.map((ld) => (
            <div key={ld.code} className="flex items-center gap-2">
              <RadioGroupItem value={ld.code} id={`locale-${ld.code}`} />
              <Label
                htmlFor={`locale-${ld.code}`}
                className="flex-1 font-normal cursor-pointer"
              >
                <span>{ld.name}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  ({ld.code})
                </span>
                {ld.isCustom && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    {t('common.custom')}
                  </Badge>
                )}
              </Label>
            </div>
          ))}
        </RadioGroup>

        <Separator />

        {/* Upload + download buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {t('settings.language_upload')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDownloadEn}
          >
            <Download className="size-3.5" />
            {t('settings.language_download_en')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDownloadDe}
          >
            <Download className="size-3.5" />
            {t('settings.language_download_de')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={onFileInputChange}
            className="hidden"
          />
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('settings.language_load_failed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 6: Vendor Function Codes (placeholder)                     */
/* ------------------------------------------------------------------ */

function VendorFcsCard(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="size-4" />
          {t('settings.vendor_fcs')}
        </CardTitle>
        <CardDescription>
          {t('settings.vendor_fcs_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="size-4" />
          <AlertTitle>{t('settings.coming_soon')}</AlertTitle>
          <AlertDescription>
            {t('settings.vendor_fcs_soon')}
          </AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" disabled>
          <Code2 className="size-3.5" />
          {t('settings.add_vendor_fc')}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section 7: About                                                    */
/* ------------------------------------------------------------------ */

function AboutCard(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="size-4" />
          {t('settings.about')}
        </CardTitle>
        <CardDescription>
          {t('settings.about_version', { title: t('app.title'), version: APP_VERSION })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">
            {t('settings.about_desc')}
          </p>
          <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
            <li>
              <span className="font-medium text-foreground">{t('settings.about_tech_stack')}</span>{' '}
              {t('settings.about_tech_stack_desc')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('settings.about_pwa')}</span>{' '}
              {t('settings.about_pwa_desc')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('settings.about_zero_deps')}</span>{' '}
              {t('settings.about_zero_deps_desc')}
            </li>
          </ul>
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              {t('settings.github')}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a
              href={MODBUS_SPEC_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('settings.modbus_spec_pdf')}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

/**
 * Top-level Settings tab. Renders the seven section cards in a responsive
 * grid: 1 column on mobile, 2 columns on `lg+`. The Register Map and About
 * cards span both columns on wide screens.
 */
export function SettingsTab(): React.JSX.Element {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
      <ParseOptionsCard />
      <AddressingCard />
      <RegisterMapCard />
      <ThemeCard />
      <LanguageCard />
      <VendorFcsCard />
      <AboutCard />
    </div>
  );
}

export default SettingsTab;
