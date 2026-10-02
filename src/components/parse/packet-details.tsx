'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import {
  functionCodeName,
  EXCEPTION_CODES,
  type ParsedFrame,
  type ParsedField,
} from '@/lib/modbus';
import { ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Called when user hovers/selects a field — highlights bytes in PacketBytes. */
  onHoverField?: (field: ParsedField | null) => void;
  onSelectField?: (field: ParsedField | null) => void;
}

export function PacketDetails({ onHoverField, onSelectField }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const selectedFrameIndex = useAppStore((s) => s.selectedFrameIndex);
  const frames = useAppStore((s) => s.frames);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root', 'pdu', 'checksum']));
  const [selectedFieldName, setSelectedFieldName] = useState<string | null>(null);

  const frame: ParsedFrame | null =
    selectedFrameIndex !== null && frames[selectedFrameIndex] ? frames[selectedFrameIndex] : null;

  const tree = useMemo(() => buildTree(frame, t), [frame, t]);

  if (!frame) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-muted-foreground text-sm">
          {t('pane.details')} — select a frame
        </div>
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFieldClick = (field: ParsedField | null) => {
    setSelectedFieldName(field?.name ?? null);
    onSelectField?.(field);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">{t('pane.details')}</span>
        <span>·</span>
        <span className="font-mono">
          {frame.protocol.toUpperCase()} · {frame.direction}
        </span>
        {frame.isException && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400">
            EXCEPTION
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto py-1">
        <TreeNode
          node={tree}
          expanded={expanded}
          toggle={toggle}
          depth={0}
          theme={theme}
          selectedFieldName={selectedFieldName}
          onSelectField={handleFieldClick}
          onHoverField={onHoverField}
          t={t}
        />
      </div>
    </div>
  );
}

interface TreeNodeData {
  id: string;
  label: string;
  value?: string;
  field?: ParsedField;
  children?: TreeNodeData[];
  isException?: boolean;
  isError?: boolean;
}

function buildTree(frame: ParsedFrame, t: (k: string) => string): TreeNodeData {
  const fc = frame.functionCode;
  const fcName = fc !== undefined ? functionCodeName(fc, t) : 'Unknown';
  const station = frame.slaveAddress ?? frame.unitId;
  const excName = frame.isException && frame.exceptionCode !== undefined
    ? EXCEPTION_CODES[frame.exceptionCode]?.name ?? `Code ${frame.exceptionCode}`
    : null;

  const children: TreeNodeData[] = [];

  // Protocol root
  if (frame.protocol === 'tcp') {
    const mbapChildren: TreeNodeData[] = [];
    const txF = frame.fields.find((f) => f.name.includes('mbap_transaction'));
    const pF = frame.fields.find((f) => f.name.includes('mbap_protocol'));
    const lF = frame.fields.find((f) => f.name.includes('mbap_length'));
    const uF = frame.fields.find((f) => f.name.includes('unit_id'));
    if (txF) mbapChildren.push(toNode(txF, t));
    if (pF) mbapChildren.push(toNode(pF, t));
    if (lF) mbapChildren.push(toNode(lF, t));
    if (uF) mbapChildren.push(toNode(uF, t));
    children.push({
      id: 'mbap',
      label: 'MBAP Header',
      value: `Tx ${frame.transactionId ?? '—'}`,
      children: mbapChildren,
    });
  } else {
    const addrF = frame.fields.find((f) => f.name.includes('slave_address') || f.name.includes('address'));
    if (addrF) {
      children.push({
        ...toNode(addrF, t),
        label: frame.protocol === 'ascii' ? 'Slave Address' : 'Slave Address',
      });
    }
  }

  // Function code
  const fcField = frame.fields.find((f) => f.name.includes('function_code'));
  if (fcField) {
    children.push({
      id: 'fc',
      label: 'Function Code',
      value: `0x${(fc ?? 0).toString(16).padStart(2, '0').toUpperCase()} — ${fcName}`,
      field: fcField,
      isException: frame.isException,
      children: frame.isException && frame.exceptionCode !== undefined
        ? [{
            id: 'exc_code',
            label: 'Exception Code',
            value: `0x${frame.exceptionCode.toString(16).padStart(2, '0').toUpperCase()} — ${excName}`,
            isError: true,
          }]
        : undefined,
    });
  }

  // PDU body
  const pduFields = frame.fields.filter(
    (f) =>
      !f.name.includes('slave_address') &&
      !f.name.includes('unit_id') &&
      !f.name.includes('function_code') &&
      !f.name.includes('mbap_') &&
      !f.name.includes('crc') &&
      !f.name.includes('lrc'),
  );
  if (pduFields.length > 0) {
    children.push({
      id: 'pdu',
      label: 'PDU Data',
      value: `${pduFields.length} field(s)`,
      children: pduFields.map((f) => toNode(f, t)),
    });
  }

  // Checksum
  if (frame.protocol === 'rtu') {
    const crcValid = frame.crcValid;
    children.push({
      id: 'checksum',
      label: 'CRC-16',
      value: frame.crc !== undefined
        ? `0x${frame.crc.toString(16).padStart(4, '0').toUpperCase()} ${crcValid ? '✓' : '✗ INVALID'}`
        : '—',
      isError: crcValid === false,
    });
  } else if (frame.protocol === 'ascii') {
    const lrcValid = frame.lrcValid;
    children.push({
      id: 'checksum',
      label: 'LRC-8',
      value: frame.lrc !== undefined
        ? `0x${frame.lrc.toString(16).padStart(2, '0').toUpperCase()} ${lrcValid ? '✓' : '✗ INVALID'}`
        : '—',
      isError: lrcValid === false,
    });
  }

  // Status row
  const statusLabel: Record<string, string> = {
    valid: 'Valid',
    invalid_crc: 'Invalid CRC',
    invalid_lrc: 'Invalid LRC',
    truncated: 'Truncated',
    malformed: 'Malformed',
    exception: 'Exception Response',
  };
  children.push({
    id: 'meta',
    label: 'Meta',
    value: `${statusLabel[frame.status] ?? frame.status} · ${frame.raw.length} bytes`,
    isError: frame.status !== 'valid' && frame.status !== 'exception',
  });

  return {
    id: 'root',
    label: `${frame.protocol.toUpperCase()} ${frame.direction === 'unknown' ? '' : frame.direction}`,
    value: station !== undefined ? `station ${station}` : undefined,
    children,
  };
}

function toNode(field: ParsedField, t: (k: string) => string): TreeNodeData {
  return {
    id: field.name + field.startOffset,
    label: field.label || t(field.name) || field.name,
    value: field.displayValue ?? String(field.value),
    field,
  };
}

interface TreeNodeProps {
  node: TreeNodeData;
  expanded: Set<string>;
  toggle: (id: string) => void;
  depth: number;
  theme: ReturnType<typeof useTheme>['theme'];
  selectedFieldName: string | null;
  onSelectField: (f: ParsedField | null) => void;
  onHoverField?: (f: ParsedField | null) => void;
  t: (k: string) => string;
}

function TreeNode({
  node,
  expanded,
  toggle,
  depth,
  theme,
  selectedFieldName,
  onSelectField,
  onHoverField,
  t,
}: TreeNodeProps) {
  void t;
  const hasChildren = !!node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedFieldName === node.field?.name;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-surfaceAlt',
          isSelected && 'bg-accent/15 ring-1 ring-inset ring-accent',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (hasChildren) toggle(node.id);
          onSelectField(node.field ?? null);
        }}
        onMouseEnter={() => onHoverField?.(node.field ?? null)}
        onMouseLeave={() => onHoverField?.(null)}
      >
        {hasChildren ? (
          isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className={cn(
            'font-medium truncate',
            node.isException && 'text-red-600 dark:text-red-400',
            node.isError && 'text-red-600 dark:text-red-400',
          )}
          style={{ color: node.isError || node.isException ? undefined : theme.colors.text }}
        >
          {node.label}
          {node.isError && <AlertTriangle className="inline h-3 w-3 ml-1" />}
        </span>
        {node.value && (
          <span className="text-muted-foreground truncate font-mono text-[11px]">
            : {node.value}
          </span>
        )}
      </div>
      {hasChildren && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              expanded={expanded}
              toggle={toggle}
              depth={depth + 1}
              theme={theme}
              selectedFieldName={selectedFieldName}
              onSelectField={onSelectField}
              onHoverField={onHoverField}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
