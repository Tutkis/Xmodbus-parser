'use client';

import { useCallback } from 'react';
import { Download, FileJson, FileText, FileSpreadsheet } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { functionCodeName, EXCEPTION_CODES } from '@/lib/modbus';

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportButtons() {
  const { t } = useI18n();
  const frames = useAppStore((s) => s.frames);

  const exportCsv = useCallback(() => {
    if (frames.length === 0) {
      toast.error(t('toast.no_frames_to_export'));
      return;
    }
    const headers = [
      'index', 'protocol', 'direction', 'status', 'isException',
      'station', 'functionCode', 'functionName', 'exceptionCode', 'exceptionName',
      'startAddress', 'quantity', 'byteCount', 'transactionId',
      'crc', 'crcValid', 'lrc', 'lrcValid', 'length', 'hex', 'ascii',
    ];
    const rows = frames.map((f, i) => {
      const addrField = f.fields.find((fld) => fld.name.includes('start_address'));
      const qtyField = f.fields.find((fld) => fld.name.includes('quantity'));
      const bcField = f.fields.find((fld) => fld.name.includes('byte_count'));
      const hex = Array.from(f.raw).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const ascii = Array.from(f.raw).map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
      return [
        i,
        f.protocol,
        f.direction,
        f.status,
        f.isException,
        f.slaveAddress ?? f.unitId ?? '',
        f.functionCode ?? '',
        f.functionCode !== undefined ? functionCodeName(f.functionCode, t) : '',
        f.exceptionCode ?? '',
        f.exceptionCode !== undefined ? (EXCEPTION_CODES[f.exceptionCode]?.name ?? '') : '',
        addrField?.value ?? '',
        qtyField?.value ?? '',
        bcField?.value ?? '',
        f.transactionId ?? '',
        f.crc ?? '',
        f.crcValid ?? '',
        f.lrc ?? '',
        f.lrcValid ?? '',
        f.raw.length,
        `"${hex}"`,
        `"${ascii.replace(/"/g, '""')}"`,
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    download(`modbus-frames-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
    toast.success(t('toast.exported_csv', { count: frames.length }));
  }, [frames, t]);

  const exportJson = useCallback(() => {
    if (frames.length === 0) {
      toast.error(t('toast.no_frames_to_export'));
      return;
    }
    const data = frames.map((f, i) => ({
      index: i,
      protocol: f.protocol,
      direction: f.direction,
      status: f.status,
      isException: f.isException,
      station: f.slaveAddress ?? f.unitId ?? null,
      functionCode: f.functionCode ?? null,
      functionName: f.functionCode !== undefined ? functionCodeName(f.functionCode, t) : null,
      exceptionCode: f.exceptionCode ?? null,
      exceptionName: f.exceptionCode !== undefined ? (EXCEPTION_CODES[f.exceptionCode]?.name ?? null) : null,
      transactionId: f.transactionId ?? null,
      crc: f.crc ?? null,
      crcValid: f.crcValid ?? null,
      lrc: f.lrc ?? null,
      lrcValid: f.lrcValid ?? null,
      length: f.raw.length,
      hex: Array.from(f.raw).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
      fields: f.fields.map((fld) => ({
        name: fld.name,
        label: fld.label,
        value: fld.value,
        displayValue: fld.displayValue ?? null,
        startOffset: fld.startOffset,
        endOffset: fld.endOffset,
      })),
      pairedWith: f.pairedWith ?? null,
      sourceLabel: f.sourceLabel ?? null,
      timestamp: f.timestamp ?? null,
    }));
    const json = JSON.stringify(data, null, 2);
    download(`modbus-frames-${Date.now()}.json`, json, 'application/json');
    toast.success(t('toast.exported_json', { count: frames.length }));
  }, [frames, t]);

  const exportPdf = useCallback(async () => {
    if (frames.length === 0) {
      toast.error(t('toast.no_frames_to_export'));
      return;
    }
    // Lazy-load PDF libs only when needed (keeps initial bundle small for PWA).
    toast.message(t('toast.generating_pdf'));
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);
      // Build a temporary off-screen DOM node containing the report.
      const report = buildReportDom(frames, t);
      document.body.appendChild(report);
      const canvas = await html2canvas(report, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
      document.body.removeChild(report);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`modbus-report-${Date.now()}.pdf`);
      toast.success(t('toast.exported_pdf', { count: frames.length }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t('toast.pdf_export_failed', { error: msg }));
    }
  }, [frames, t]);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={exportCsv} disabled={frames.length === 0}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('export.csv')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={exportJson} disabled={frames.length === 0}>
            <FileJson className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">JSON</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('export.json')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={exportPdf} disabled={frames.length === 0}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('export.pdf')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function buildReportDom(
  frames: ReturnType<typeof useAppStore.getState>['frames'],
  t: (k: string, params?: Record<string, string | number>) => string,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;left:-99999px;top:0;width:794px;padding:32px;background:#fff;color:#000;font-family:sans-serif;font-size:11px;line-height:1.4;';
  const title = document.createElement('h1');
  title.textContent = `${t('report.title')} — ${new Date().toLocaleString()}`;
  title.style.cssText = 'font-size:18px;margin:0 0 4px 0;';
  const subtitle = document.createElement('div');
  subtitle.textContent = t('report.subtitle', { count: frames.length });
  subtitle.style.cssText = 'color:#666;font-size:11px;margin-bottom:16px;';
  wrap.appendChild(title);
  wrap.appendChild(subtitle);

  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;';
  const headerKeys = [
    'report.col_index', 'report.col_proto', 'report.col_dir', 'report.col_status',
    'report.col_st', 'report.col_fc', 'report.col_function', 'report.col_addr',
    'report.col_qty', 'report.col_crc', 'report.col_hex',
  ];
  const headers = headerKeys.map((k) => t(k));
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.cssText =
      'border:1px solid #ddd;padding:4px 6px;text-align:left;background:#f5f5f5;font-weight:600;';
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  frames.forEach((f, i) => {
    const r = document.createElement('tr');
    const addrField = f.fields.find((fld) => fld.name.includes('start_address'));
    const qtyField = f.fields.find((fld) => fld.name.includes('quantity'));
    const hex = Array.from(f.raw)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    const cells = [
      String(i),
      f.protocol.toUpperCase(),
      f.direction,
      f.status,
      String(f.slaveAddress ?? f.unitId ?? ''),
      f.functionCode !== undefined
        ? '0x' + f.functionCode.toString(16).padStart(2, '0').toUpperCase()
        : '',
      f.functionCode !== undefined ? functionCodeName(f.functionCode, t) : '',
      addrField?.value !== undefined ? String(addrField.value) : '',
      qtyField?.value !== undefined ? String(qtyField.value) : '',
      f.crcValid === false ? t('report.crc_bad') : f.crc !== undefined ? t('report.crc_ok') : '',
      hex,
    ];
    cells.forEach((c) => {
      const td = document.createElement('td');
      td.textContent = c;
      td.style.cssText = 'border:1px solid #ddd;padding:3px 6px;font-family:monospace;';
      r.appendChild(td);
    });
    if (f.isException) r.style.backgroundColor = '#fee2e2';
    else if (f.status !== 'valid') r.style.backgroundColor = '#fffbeb';
    else if (f.direction === 'request') r.style.backgroundColor = '#eff6ff';
    else if (f.direction === 'response') r.style.backgroundColor = '#f0fdf4';
    tbody.appendChild(r);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}
