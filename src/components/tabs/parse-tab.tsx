'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { InputPanel } from '@/components/parse/input-panel';
import { FilterBar } from '@/components/parse/filter-bar';
import { PacketList } from '@/components/parse/packet-list';
import { PacketDetails } from '@/components/parse/packet-details';
import { PacketBytes } from '@/components/parse/packet-bytes';
import { ExportButtons } from '@/components/parse/export-buttons';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';
import type { ParsedField } from '@/lib/modbus';
import { AlertTriangle } from 'lucide-react';

export function ParseTab() {
  const { t } = useI18n();
  const frames = useAppStore((s) => s.frames);
  const parseError = useAppStore((s) => s.parseError);
  const pcapWarnings = useAppStore((s) => s.pcapWarnings);
  const detectedPorts = useAppStore((s) => s.detectedPorts);
  const selectedPort = useAppStore((s) => s.selectedPort);
  const setSelectedPort = useAppStore((s) => s.setSelectedPort);
  const filterRules = useAppStore((s) => s.filterRules);
  const [highlightedField, setHighlightedField] = useState<ParsedField | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);

  const activeFilterCount = filterRules.filter((r) => r.enabled && r.value.trim()).length;

  return (
    <div className="space-y-3">
      {/* Input panel — full width */}
      <InputPanel />

      {/* Compact toolbar: export + filter toggle + detected ports */}
      <div className="flex flex-wrap items-center gap-2">
        <ExportButtons />

        <div className="flex-1" />

        {/* Filter toggle button */}
        <Button
          variant={filterExpanded ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 shrink-0"
          onClick={() => setFilterExpanded((e) => !e)}
        >
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('filter.title')}</span>
          {activeFilterCount > 0 && (
            <span className="rounded bg-accent-foreground/20 px-1 text-[10px] font-mono">
              {activeFilterCount}
            </span>
          )}
          {filterExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>

        {/* Detected ports (only when pcap loaded) */}
        {detectedPorts.length > 0 && (
          <div className="flex items-center gap-1 text-xs shrink-0">
            <span className="text-muted-foreground hidden sm:inline">Ports:</span>
            {detectedPorts.map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPort(p)}
                className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                  selectedPort === p
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surfaceAlt hover:bg-accent/30'
                }`}
              >
                {p}
              </button>
            ))}
            {selectedPort !== null && (
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1"
                onClick={() => setSelectedPort(null)}
              >
                all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filter bar — collapsible */}
      {filterExpanded && <FilterBar />}

      {/* Errors / warnings */}
      {parseError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Parse error</div>
            <div className="font-mono text-[11px] mt-0.5">{parseError}</div>
          </div>
        </div>
      )}
      {pcapWarnings.length > 0 && (
        <details className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-amber-700 dark:text-amber-400 font-medium">
            {pcapWarnings.length} pcap warning(s)
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {pcapWarnings.slice(0, 20).map((w, i) => (
              <li key={i} className="font-mono text-[11px]">{w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* 3-pane Wireshark-style view */}
      {frames.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface overflow-hidden" style={{ height: 'calc(100vh - 340px)', minHeight: '380px' }}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Packet List */}
            <ResizablePanel defaultSize={32} minSize={20} maxSize={50}>
              <PacketList />
            </ResizablePanel>
            <ResizableHandle withHandle />
            {/* Right side: bytes (top) + details (bottom) */}
            <ResizablePanel defaultSize={68} minSize={40}>
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={55} minSize={20}>
                  <PacketBytes highlightedField={highlightedField} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={45} minSize={20}>
                  <PacketDetails
                    onHoverField={setHighlightedField}
                    onSelectField={setHighlightedField}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center">
          <div className="mx-auto max-w-md space-y-2">
            <div className="text-base font-medium">{t('pane.list')}</div>
            <div className="text-sm text-muted-foreground">
              Paste a hex dump, an ASCII frame (starting with <code className="font-mono">:</code>), or upload a
              <code className="font-mono"> .pcap</code> / <code className="font-mono">.pcapng</code> file above.
              Click <strong>{t('input.parse')}</strong> to decode.
            </div>
            <div className="text-xs text-muted-foreground">
              Supports Modbus RTU, ASCII, and TCP. Auto-detects protocol &amp; pairs request/response frames.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
