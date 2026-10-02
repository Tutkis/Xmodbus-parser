'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Radio,
  Usb,
  Play,
  Square,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Cable,
} from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useAppStore } from '@/lib/store/app-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  parseStream,
  pairFrames,
  type ParsedFrame,
  type ModbusProtocol,
} from '@/lib/modbus';
import { PacketList } from '@/components/parse/packet-list';
import { PacketDetails } from '@/components/parse/packet-details';
import { PacketBytes } from '@/components/parse/packet-bytes';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ------------------------------------------------------------------ */
/* Web Serial API type shims (not in TS DOM lib yet)                  */
/* ------------------------------------------------------------------ */

interface SerialPortLike {
  open(opts: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; flowControl?: 'none' | 'hardware' }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike>;
}

interface NavigatorWithSerial extends Navigator {
  serial?: SerialLike;
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const DEFAULT_BAUD = 9600;
const DEFAULT_PROTOCOL: ModbusProtocol = 'rtu';
// Buffer flush interval (ms) — parse accumulated bytes every X ms.
const FLUSH_INTERVAL = 250;
// Max bytes to accumulate before forcing a flush.
const MAX_BUFFER = 4096;

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function LiveTab() {
  const { t } = useI18n();
  const setFrames = useAppStore((s) => s.setFrames);
  const settings = useAppStore((s) => s.settings);

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD);
  const [dataBits, setDataBits] = useState<8 | 7>(8);
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none');
  const [protocol, setProtocol] = useState<ModbusProtocol>(DEFAULT_PROTOCOL);
  const [capturedFrames, setCapturedFrames] = useState<ParsedFrame[]>([]);
  const [byteCount, setByteCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReadingRef = useRef(false);
  const bufferRef = useRef<Uint8Array[]>([]);
  const bufferLenRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [highlightedField, setHighlightedField] = useState<ParsedFrame['fields'][number] | null>(null);

  // Detect Web Serial API support on mount.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as NavigatorWithSerial;
    setIsSupported(typeof nav.serial?.requestPort === 'function');
  }, []);

  /* ---------------------------------------------------------------- */
  /* Connect / Disconnect                                             */
  /* ---------------------------------------------------------------- */

  const handleConnect = useCallback(async () => {
    setError(null);
    const nav = navigator as NavigatorWithSerial;
    if (!nav.serial) {
      setError('Web Serial API not supported in this browser. Use Chrome, Edge, or Opera (v78+).');
      toast.error('Web Serial not supported');
      return;
    }
    try {
      // Request port from user (browser prompts permission).
      const port = await nav.serial.requestPort();
      await port.open({ baudRate, dataBits, stopBits, parity, flowControl: 'none' });
      portRef.current = port;
      setIsConnected(true);
      toast.success('Serial port connected');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('No port selected') || msg.includes('cancelled')) {
        // User cancelled — silent.
      } else {
        setError(msg);
        toast.error(`Connection failed: ${msg}`);
      }
    }
  }, [baudRate, dataBits, stopBits, parity]);

  const handleDisconnect = useCallback(async () => {
    keepReadingRef.current = false;
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch { /* ignore */ }
      try { readerRef.current.releaseLock(); } catch { /* ignore */ }
      readerRef.current = null;
    }
    if (portRef.current) {
      try { await portRef.current.close(); } catch { /* ignore */ }
      portRef.current = null;
    }
    setIsConnected(false);
    setIsCapturing(false);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Capture loop                                                     */
  /* ---------------------------------------------------------------- */

  const flushBuffer = useCallback(() => {
    if (bufferLenRef.current === 0) return;
    // Concatenate accumulated chunks.
    const chunks = bufferRef.current;
    const total = bufferLenRef.current;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    bufferRef.current = [];
    bufferLenRef.current = 0;

    try {
      const newFrames = parseStream(merged, {
        protocol,
        byteOrder: settings.byteOrder,
        dataType: settings.dataType,
        baseOffset: settings.baseOffset,
        addressFormat: settings.addressFormat,
        registerMap: settings.registerMap,
      });
      if (newFrames.length > 0) {
        setCapturedFrames((prev) => {
          const next = [...prev, ...newFrames];
          if (next.length <= 256) pairFrames(next);
          // Push to global store so other tabs (timeline) see them.
          setFrames(next);
          return next;
        });
        setFrameCount((n) => n + newFrames.length);
      }
    } catch {
      /* skip unparseable chunk */
    }
  }, [protocol, settings, setFrames]);

  const startCapture = useCallback(async () => {
    if (!portRef.current?.readable) {
      toast.error('Port not open');
      return;
    }
    setCapturedFrames([]);
    setFrameCount(0);
    setByteCount(0);
    bufferRef.current = [];
    bufferLenRef.current = 0;
    keepReadingRef.current = true;
    setIsCapturing(true);

    // Periodic flush: parse accumulated bytes every FLUSH_INTERVAL ms.
    flushTimerRef.current = setInterval(flushBuffer, FLUSH_INTERVAL);

    // Read loop — runs in background until stopped.
    const reader = portRef.current.readable.getReader();
    readerRef.current = reader;
    (async () => {
      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            bufferRef.current.push(value);
            bufferLenRef.current += value.length;
            setByteCount((n) => n + value.length);
            // Force flush if buffer is large.
            if (bufferLenRef.current >= MAX_BUFFER) {
              flushBuffer();
            }
          }
        }
      } catch {
        // Read error — stop capture.
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        readerRef.current = null;
      }
      // Final flush.
      flushBuffer();
      setIsCapturing(false);
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    })();
  }, [flushBuffer]);

  const stopCapture = useCallback(() => {
    keepReadingRef.current = false;
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (readerRef.current) {
      try { readerRef.current.cancel(); } catch { /* ignore */ }
    }
    setIsCapturing(false);
    // Final flush.
    flushBuffer();
    toast.success(`Captured ${frameCount} frames`);
  }, [flushBuffer, frameCount]);

  const handleClear = useCallback(() => {
    setCapturedFrames([]);
    setFrameCount(0);
    setByteCount(0);
    setFrames([]);
  }, [setFrames]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      keepReadingRef.current = false;
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (readerRef.current) {
        try { readerRef.current.cancel(); } catch { /* ignore */ }
      }
      if (portRef.current) {
        try { portRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  // Browser not supported.
  if (isSupported === false) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2 min-w-0">
            <h3 className="font-semibold text-amber-700 dark:text-amber-400">
              Web Serial API not supported
            </h3>
            <p className="text-sm text-muted-foreground">
              Live capture requires <strong>Chrome</strong>, <strong>Edge</strong>, or <strong>Opera</strong> (v78+).
              Firefox and Safari do not support direct serial port access from the browser.
            </p>
            <p className="text-sm text-muted-foreground">
              You can still use the <strong>Parse</strong> tab to paste hex dumps or upload pcap files.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => useAppStore.getState().setTab('parse')}>
                Go to Parse tab
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Connection panel */}
      <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Radio className="h-4 w-4 text-accent shrink-0" />
          <span className="text-sm font-medium">Live Serial Capture</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Web Serial API · Modbus RTU only
          </span>
          <div className="flex-1" />
          {isConnected && (
            <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          )}
          {isCapturing && (
            <Badge variant="outline" className="gap-1 text-red-600 dark:text-red-400 border-red-500/40 animate-pulse">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              REC
            </Badge>
          )}
        </div>

        {/* Serial config */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Baud</Label>
            <Select value={String(baudRate)} onValueChange={(v) => setBaudRate(Number(v))} disabled={isConnected}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAUD_RATES.map((b) => (
                  <SelectItem key={b} value={String(b)}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Data bits</Label>
            <Select value={String(dataBits)} onValueChange={(v) => setDataBits(Number(v) as 7 | 8)} disabled={isConnected}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">8</SelectItem>
                <SelectItem value="7">7</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Stop bits</Label>
            <Select value={String(stopBits)} onValueChange={(v) => setStopBits(Number(v) as 1 | 2)} disabled={isConnected}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Parity</Label>
            <Select value={parity} onValueChange={(v) => setParity(v as 'none' | 'even' | 'odd')} disabled={isConnected}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="even">Even</SelectItem>
                <SelectItem value="odd">Odd</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Protocol</Label>
            <Select value={protocol} onValueChange={(v) => setProtocol(v as ModbusProtocol)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rtu">RTU</SelectItem>
                <SelectItem value="ascii">ASCII</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Stats</Label>
            <div className="h-8 flex items-center gap-2 text-xs font-mono px-2 rounded-md border border-border bg-surfaceAlt">
              <span title="Frames">{frameCount}f</span>
              <span className="text-muted-foreground">·</span>
              <span title="Bytes">{byteCount}b</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {!isConnected ? (
            <Button onClick={handleConnect} size="sm" className="h-8 gap-1.5">
              <Usb className="h-3.5 w-3.5" />
              <span>Connect</span>
            </Button>
          ) : (
            <>
              {!isCapturing ? (
                <Button onClick={startCapture} size="sm" variant="default" className="h-8 gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  <span>Start capture</span>
                </Button>
              ) : (
                <Button onClick={stopCapture} size="sm" variant="destructive" className="h-8 gap-1.5">
                  <Square className="h-3.5 w-3.5" />
                  <span>Stop</span>
                </Button>
              )}
              <Button onClick={handleDisconnect} size="sm" variant="outline" className="h-8 gap-1.5">
                <Cable className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </Button>
            </>
          )}
          <Button onClick={handleClear} size="sm" variant="ghost" className="h-8 gap-1.5" disabled={capturedFrames.length === 0}>
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </Button>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground cursor-help">
                Chrome/Edge/Opera only
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>Web Serial API requires a secure context (HTTPS or localhost) and a Chromium-based browser v78+.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="font-mono break-all">{error}</span>
          </div>
        )}
      </div>

      {/* Captured frames — reuse Parse tab's 3-pane view */}
      {capturedFrames.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface overflow-hidden" style={{ height: 'calc(100vh - 380px)', minHeight: '380px' }}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={32} minSize={20} maxSize={50}>
              <PacketList />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={68} minSize={40}>
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={45} minSize={20}>
                  <PacketDetails
                    onHoverField={setHighlightedField}
                    onSelectField={setHighlightedField}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={55} minSize={20}>
                  <PacketBytes highlightedField={highlightedField} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 sm:p-12 text-center">
          <div className="mx-auto max-w-md space-y-2">
            <Radio className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
            <div className="text-base font-medium">No frames captured yet</div>
            <div className="text-sm text-muted-foreground">
              {isSupported === null
                ? 'Checking Web Serial API support…'
                : 'Connect a USB-to-RS485 adapter, click <strong>Connect</strong>, then <strong>Start capture</strong>. Frames appear here in real time.'
              }
            </div>
            <div className="text-xs text-muted-foreground pt-2">
              Tip: USB-to-RS485 adapters based on FTDI FT232, CH340, CP2102 all work. Plug it in, click Connect, and your browser will ask for permission.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
