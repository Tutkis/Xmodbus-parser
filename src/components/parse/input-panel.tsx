'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, Trash2, Play, FileUp, Sparkles } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { parseTextInput, parsePcapBuffer, SAMPLE_HEX } from '@/lib/parse-pipeline';

export function InputPanel() {
  const { t } = useI18n();
  const inputText = useAppStore((s) => s.inputText);
  const setInput = useAppStore((s) => s.setInput);
  const setFrames = useAppStore((s) => s.setFrames);
  const setParseError = useAppStore((s) => s.setParseError);
  const setParsing = useAppStore((s) => s.setParsing);
  const clearAll = useAppStore((s) => s.clearAll);
  const settings = useAppStore((s) => s.settings);
  const selectedPort = useAppStore((s) => s.selectedPort);
  const setDetectedPorts = useAppStore((s) => s.setSelectedPort);
  const isParsing = useAppStore((s) => s.isParsing);

  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pcapRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback(() => {
    const text = inputText.trim();
    if (!text) {
      toast.error(t('input.paste_hex'));
      return;
    }
    setParsing(true);
    setTimeout(() => {
      try {
        const frames = parseTextInput(text, settings);
        if (frames.length === 0) {
          setParseError('No frames could be parsed from the input.');
          toast.error('No frames parsed');
        } else {
          setFrames(frames);
          toast.success(`${frames.length} frame${frames.length === 1 ? '' : 's'} parsed`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setParseError(msg);
        toast.error(msg);
      } finally {
        setParsing(false);
      }
    }, 10);
  }, [inputText, settings, setFrames, setParseError, setParsing, t]);

  const handleClear = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleSample = useCallback(() => {
    setInput(SAMPLE_HEX, 'sample');
  }, [setInput]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        setInput(text, 'file');
        toast.success(`Loaded ${file.name}`);
      } catch (e) {
        toast.error(`Failed to read file: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [setInput],
  );

  const handlePcapUpload = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        const buf = await file.arrayBuffer();
        setTimeout(() => {
          try {
            const result = parsePcapBuffer(buf, settings, selectedPort);
            if (result.frames.length === 0) {
              setParseError('No Modbus frames found in pcap.');
              toast.error('No Modbus frames found');
            } else {
              setFrames(result.frames, {
                ports: result.ports,
                flowsCount: result.flowsCount,
                warnings: result.warnings,
              });
              if (result.ports.length > 0 && selectedPort === null) {
                setDetectedPorts(result.ports[0]);
              }
              if (result.warnings.length > 0) {
                toast.message(`${result.warnings.length} warning(s)`, {
                  description: result.warnings[0],
                });
              }
              toast.success(`${result.frames.length} frames from ${result.flowsCount} flow(s)`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setParseError(msg);
            toast.error(`PCAP parse error: ${msg}`);
          } finally {
            setParsing(false);
          }
        }, 10);
      } catch (e) {
        setParsing(false);
        toast.error(`Failed to read pcap: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [settings, selectedPort, setFrames, setParseError, setParsing, setDetectedPorts],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.name.toLowerCase().endsWith('.pcap') || file.name.toLowerCase().endsWith('.pcapng')) {
        handlePcapUpload(file);
      } else {
        handleFileUpload(file);
      }
    },
    [handleFileUpload, handlePcapUpload],
  );

  return (
    <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-medium">{t('input.paste_hex')} / ASCII / pcap</span>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleSample}>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('input.sample_data')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('input.sample_data')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('input.upload_file')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('input.upload_file')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => pcapRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('input.upload_pcap')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('input.upload_pcap')}</TooltipContent>
        </Tooltip>

        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleParse}
          disabled={isParsing}
        >
          <Play className="h-3.5 w-3.5" />
          {t('input.parse')}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleClear}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('input.clear')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('input.clear')}</TooltipContent>
        </Tooltip>
      </div>

      <div
        className={`relative rounded-md border-2 border-dashed transition-colors ${
          isDragging ? 'border-accent bg-accent/10' : 'border-border'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Textarea
          value={inputText}
          onChange={(e) => setInput(e.target.value, 'paste')}
          placeholder={t('input.drag_drop')}
          className="min-h-[120px] max-h-[280px] font-mono text-xs sm:text-sm leading-relaxed bg-transparent border-0 resize-y focus-visible:ring-0 focus-visible:ring-offset-0"
          spellCheck={false}
        />
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/10 pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-accent-foreground">
              <FileText className="h-8 w-8" />
              <span className="text-sm font-medium">Drop file…</span>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.hex,.log,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileUpload(f);
          e.target.value = '';
        }}
      />
      <input
        ref={pcapRef}
        type="file"
        accept=".pcap,.pcapng,.cap"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePcapUpload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
