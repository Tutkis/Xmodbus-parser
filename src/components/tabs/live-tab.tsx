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
  Network,
  Server,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
/* Web Serial API type shims                                          */
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
const FLUSH_INTERVAL = 250;
const MAX_BUFFER = 4096;

type CaptureMode = 'serial' | 'tcp';

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function LiveTab() {
  const { t } = useI18n();
  const setFrames = useAppStore((s) => s.setFrames);
  const settings = useAppStore((s) => s.settings);

  const [mode, setMode] = useState<CaptureMode>('serial');

  // Serial state
  const [isSerialSupported, setIsSerialSupported] = useState<boolean | null>(null);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD);
  const [dataBits, setDataBits] = useState<8 | 7>(8);
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none');
  const [serialProtocol, setSerialProtocol] = useState<ModbusProtocol>('rtu');

  // TCP state
  const [tcpHost, setTcpHost] = useState('127.0.0.1');
  const [tcpPort, setTcpPort] = useState(502);
  const [isTcpConnected, setIsTcpConnected] = useState(false);
  const [tcpProtocol, setTcpProtocol] = useState<ModbusProtocol>('tcp');

  // Shared state
  const [capturedFrames, setCapturedFrames] = useState<ParsedFrame[]>([]);
  const [byteCount, setByteCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [highlightedField, setHighlightedField] = useState<ParsedFrame['fields'][number] | null>(null);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const keepReadingRef = useRef(false);
  const bufferRef = useRef<Uint8Array[]>([]);
  const bufferLenRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const tcpBufferRef = useRef<Uint8Array[]>([]);
  const tcpBufferLenRef = useRef(0);

  // Detect Web Serial API support on mount.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as NavigatorWithSerial;
    setIsSerialSupported(typeof nav.serial?.requestPort === 'function');
  }, []);

  const activeProtocol = mode === 'serial' ? serialProtocol : tcpProtocol;

  /* ---------------------------------------------------------------- */
  /* Shared flush + parse                                             */
  /* ---------------------------------------------------------------- */

  const flushBuffer = useCallback(() => {
    const buf = mode === 'serial' ? bufferRef : tcpBufferRef;
    const lenRef = mode === 'serial' ? bufferLenRef : tcpBufferLenRef;
    if (lenRef.current === 0) return;

    const chunks = buf.current;
    const total = lenRef.current;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    buf.current = [];
    lenRef.current = 0;

    try {
      const newFrames = parseStream(merged, {
        protocol: activeProtocol,
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
          setFrames(next);
          return next;
        });
        setFrameCount((n) => n + newFrames.length);
      }
    } catch {
      /* skip */
    }
  }, [mode, activeProtocol, settings, setFrames]);

  const startFlushTimer = useCallback(() => {
    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    flushTimerRef.current = setInterval(flushBuffer, FLUSH_INTERVAL);
  }, [flushBuffer]);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Serial: connect / disconnect                                     */
  /* ---------------------------------------------------------------- */

  const handleSerialConnect = useCallback(async () => {
    setError(null);
    const nav = navigator as NavigatorWithSerial;
    if (!nav.serial) {
      setError('Web Serial API not supported. Use Chrome, Edge, or Opera (v78+).');
      toast.error('Web Serial not supported');
      return;
    }
    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate, dataBits, stopBits, parity, flowControl: 'none' });
      portRef.current = port;
      setIsSerialConnected(true);
      toast.success('Serial port connected');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('No port selected') && !msg.includes('cancelled')) {
        setError(msg);
        toast.error(`Connection failed: ${msg}`);
      }
    }
  }, [baudRate, dataBits, stopBits, parity]);

  const handleSerialDisconnect = useCallback(async () => {
    keepReadingRef.current = false;
    stopFlushTimer();
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch { /* ignore */ }
      try { readerRef.current.releaseLock(); } catch { /* ignore */ }
      readerRef.current = null;
    }
    if (portRef.current) {
      try { await portRef.current.close(); } catch { /* ignore */ }
      portRef.current = null;
    }
    setIsSerialConnected(false);
    setIsCapturing(false);
  }, [stopFlushTimer]);

  const startSerialCapture = useCallback(async () => {
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
    startFlushTimer();

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
            if (bufferLenRef.current >= MAX_BUFFER) flushBuffer();
          }
        }
      } catch { /* */ }
      finally {
        try { reader.releaseLock(); } catch { /* */ }
        readerRef.current = null;
      }
      flushBuffer();
      setIsCapturing(false);
      stopFlushTimer();
    })();
  }, [startFlushTimer, flushBuffer, stopFlushTimer]);

  const stopSerialCapture = useCallback(() => {
    keepReadingRef.current = false;
    stopFlushTimer();
    if (readerRef.current) {
      try { readerRef.current.cancel(); } catch { /* */ }
    }
    setIsCapturing(false);
    flushBuffer();
    toast.success(`Captured ${frameCount} frames`);
  }, [stopFlushTimer, flushBuffer, frameCount]);

  /* ---------------------------------------------------------------- */
  /* TCP: connect / disconnect via WebSocket bridge                   */
  /* ---------------------------------------------------------------- */

  const handleTcpConnect = useCallback(() => {
    setError(null);
    // Connect via WebSocket to the tcp-bridge mini-service.
    // The gateway (Caddy :81) forwards ?XTransformPort=3030 to localhost:3030.
    // For self-hosted deployments, users run the bridge locally and
    // connect to ws://localhost:3030 or wss://their-host.
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    // Use XTransformPort so Caddy gateway forwards to the bridge on :3030.
    const wsUrl = `${wsProtocol}//${wsHost}/?XTransformPort=3030`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      setError(`WebSocket failed: ${e instanceof Error ? e.message : String(e)}`);
      toast.error('WebSocket connection failed');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      // Send connect command to the bridge.
      ws.send(JSON.stringify({ type: 'connect', host: tcpHost, port: tcpPort }));
    };

    ws.onmessage = (ev) => {
      let msg: { type: string; payload?: string; direction?: string; message?: string; host?: string; port?: number };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'connected':
          setIsTcpConnected(true);
          toast.success(`TCP connected to ${tcpHost}:${tcpPort}`);
          // Start capture mode — accumulate incoming data.
          setCapturedFrames([]);
          setFrameCount(0);
          setByteCount(0);
          tcpBufferRef.current = [];
          tcpBufferLenRef.current = 0;
          setIsCapturing(true);
          startFlushTimer();
          break;
        case 'data':
          if (msg.payload && msg.direction === 'rx') {
            // Convert hex string to bytes.
            const hex = msg.payload;
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < bytes.length; i++) {
              bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
            }
            tcpBufferRef.current.push(bytes);
            tcpBufferLenRef.current += bytes.length;
            setByteCount((n) => n + bytes.length);
            if (tcpBufferLenRef.current >= MAX_BUFFER) flushBuffer();
          }
          break;
        case 'disconnected':
          setIsTcpConnected(false);
          setIsCapturing(false);
          stopFlushTimer();
          flushBuffer();
          break;
        case 'error':
          setError(msg.message || 'TCP error');
          toast.error(msg.message || 'TCP error');
          setIsTcpConnected(false);
          setIsCapturing(false);
          stopFlushTimer();
          break;
      }
    };

    ws.onerror = () => {
      setError('WebSocket bridge unreachable. Is the tcp-bridge service running?');
      toast.error('Bridge unreachable');
      setIsTcpConnected(false);
      setIsCapturing(false);
      stopFlushTimer();
    };

    ws.onclose = () => {
      setIsTcpConnected(false);
      setIsCapturing(false);
      stopFlushTimer();
    };
  }, [tcpHost, tcpPort, startFlushTimer, stopFlushTimer, flushBuffer]);

  const handleTcpDisconnect = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'disconnect' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsTcpConnected(false);
    setIsCapturing(false);
    stopFlushTimer();
    flushBuffer();
    toast.success(`Captured ${frameCount} frames`);
  }, [stopFlushTimer, flushBuffer, frameCount]);

  /* ---------------------------------------------------------------- */
  /* Shared: clear                                                    */
  /* ---------------------------------------------------------------- */

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
      stopFlushTimer();
      if (readerRef.current) {
        try { readerRef.current.cancel(); } catch { /* */ }
      }
      if (portRef.current) {
        try { portRef.current.close(); } catch { /* */ }
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* */ }
      }
    };
  }, [stopFlushTimer]);

  const isSerialMode = mode === 'serial';
  const isConnected = isSerialMode ? isSerialConnected : isTcpConnected;
  const isSerialNotSupported = isSerialMode && isSerialSupported === false;

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  if (isSerialNotSupported) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2 min-w-0">
            <h3 className="font-semibold text-amber-700 dark:text-amber-400">
              Web Serial API not supported
            </h3>
            <p className="text-sm text-muted-foreground">
              Serial capture requires <strong>Chrome</strong>, <strong>Edge</strong>, or <strong>Opera</strong> (v78+).
              Firefox and Safari do not support direct serial port access from the browser.
            </p>
            <p className="text-sm text-muted-foreground">
              You can still use <strong>TCP mode</strong> (via the WebSocket bridge) or the <strong>Parse</strong> tab.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setMode('tcp')}>
                <Network className="h-3.5 w-3.5 mr-1.5" />
                Switch to TCP mode
              </Button>
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
      {/* Mode tabs + connection panel */}
      <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {isSerialMode ? <Radio className="h-4 w-4 text-accent shrink-0" /> : <Network className="h-4 w-4 text-accent shrink-0" />}
          <span className="text-sm font-medium">Live Capture</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {isSerialMode ? 'Web Serial API · Modbus RTU/ASCII' : 'WebSocket Bridge · Modbus TCP'}
          </span>
          <div className="flex-1" />
          {isConnected && (
            <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 shrink-0">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          )}
          {isCapturing && (
            <Badge variant="outline" className="gap-1 text-red-600 dark:text-red-400 border-red-500/40 animate-pulse shrink-0">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              REC
            </Badge>
          )}
        </div>

        {/* Mode selector */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as CaptureMode)}>
          <TabsList className="mb-3">
            <TabsTrigger value="serial" className="text-xs gap-1.5">
              <Usb className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Serial (RTU)</span>
              <span className="sm:hidden">RTU</span>
            </TabsTrigger>
            <TabsTrigger value="tcp" className="text-xs gap-1.5">
              <Network className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">TCP</span>
              <span className="sm:hidden">TCP</span>
            </TabsTrigger>
          </TabsList>

          {/* Serial config */}
          <TabsContent value="serial" className="mt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Baud</Label>
                <Select value={String(baudRate)} onValueChange={(v) => setBaudRate(Number(v))} disabled={isSerialConnected}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BAUD_RATES.map((b) => <SelectItem key={b} value={String(b)}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Data</Label>
                <Select value={String(dataBits)} onValueChange={(v) => setDataBits(Number(v) as 7 | 8)} disabled={isSerialConnected}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="8">8</SelectItem>
                    <SelectItem value="7">7</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Stop</Label>
                <Select value={String(stopBits)} onValueChange={(v) => setStopBits(Number(v) as 1 | 2)} disabled={isSerialConnected}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Parity</Label>
                <Select value={parity} onValueChange={(v) => setParity(v as 'none' | 'even' | 'odd')} disabled={isSerialConnected}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="even">Even</SelectItem>
                    <SelectItem value="odd">Odd</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Protocol</Label>
                <Select value={serialProtocol} onValueChange={(v) => setSerialProtocol(v as ModbusProtocol)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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

            <div className="flex flex-wrap items-center gap-2">
              {!isSerialConnected ? (
                <Button onClick={handleSerialConnect} size="sm" className="h-8 gap-1.5 shrink-0">
                  <Usb className="h-3.5 w-3.5" />
                  <span>Connect</span>
                </Button>
              ) : (
                <>
                  {!isCapturing ? (
                    <Button onClick={startSerialCapture} size="sm" variant="default" className="h-8 gap-1.5 shrink-0">
                      <Play className="h-3.5 w-3.5" />
                      <span>Start</span>
                    </Button>
                  ) : (
                    <Button onClick={stopSerialCapture} size="sm" variant="destructive" className="h-8 gap-1.5 shrink-0">
                      <Square className="h-3.5 w-3.5" />
                      <span>Stop</span>
                    </Button>
                  )}
                  <Button onClick={handleSerialDisconnect} size="sm" variant="outline" className="h-8 gap-1.5 shrink-0">
                    <Cable className="h-3.5 w-3.5" />
                    <span>Disconnect</span>
                  </Button>
                </>
              )}
              <Button onClick={handleClear} size="sm" variant="ghost" className="h-8 gap-1.5 shrink-0" disabled={capturedFrames.length === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear</span>
              </Button>
            </div>
          </TabsContent>

          {/* TCP config */}
          <TabsContent value="tcp" className="mt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Host</Label>
                <Input
                  value={tcpHost}
                  onChange={(e) => setTcpHost(e.target.value)}
                  placeholder="192.168.1.10"
                  className="h-8 text-xs font-mono"
                  disabled={isTcpConnected}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Port</Label>
                <Input
                  type="number"
                  value={tcpPort}
                  onChange={(e) => setTcpPort(Number(e.target.value))}
                  min={1}
                  max={65535}
                  className="h-8 text-xs font-mono"
                  disabled={isTcpConnected}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Protocol</Label>
                <Select value={tcpProtocol} onValueChange={(v) => setTcpProtocol(v as ModbusProtocol)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="rtu">RTU-over-TCP</SelectItem>
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

            <div className="flex flex-wrap items-center gap-2">
              {!isTcpConnected ? (
                <Button onClick={handleTcpConnect} size="sm" className="h-8 gap-1.5 shrink-0">
                  <Server className="h-3.5 w-3.5" />
                  <span>Connect</span>
                </Button>
              ) : (
                <Button onClick={handleTcpDisconnect} size="sm" variant="destructive" className="h-8 gap-1.5 shrink-0">
                  <Square className="h-3.5 w-3.5" />
                  <span>Disconnect</span>
                </Button>
              )}
              <Button onClick={handleClear} size="sm" variant="ghost" className="h-8 gap-1.5 shrink-0" disabled={capturedFrames.length === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear</span>
              </Button>
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground cursor-help whitespace-nowrap">
                    Requires tcp-bridge service
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Run the bridge locally: <code>cd mini-services/tcp-bridge &amp;&amp; bun run dev</code></p>
                  <p className="mt-1">Then connect from the browser — the bridge proxies WebSocket to raw TCP.</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="font-mono break-all">{error}</span>
          </div>
        )}
      </div>

      {/* Captured frames — reuse Parse tab's 3-pane view */}
      {capturedFrames.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface overflow-hidden" style={{ height: 'calc(100vh - 420px)', minHeight: '380px' }}>
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
            {isSerialMode ? (
              <Radio className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
            ) : (
              <Network className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
            )}
            <div className="text-base font-medium">No frames captured yet</div>
            {isSerialMode ? (
              <div className="text-sm text-muted-foreground">
                {isSerialSupported === null
                  ? 'Checking Web Serial API support…'
                  : <>Connect a USB-to-RS485 adapter, click <strong>Connect</strong>, then <strong>Start</strong>. Frames appear here in real time.</>
                }
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Enter the Modbus TCP device address, click <strong>Connect</strong>. The bridge service proxies WebSocket to raw TCP.
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-2">
              {isSerialMode
                ? 'Tip: USB-to-RS485 adapters based on FTDI FT232, CH340, CP2102 all work.'
                : 'Tip: Run the tcp-bridge service locally (mini-services/tcp-bridge) to enable browser-to-TCP proxying.'
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
