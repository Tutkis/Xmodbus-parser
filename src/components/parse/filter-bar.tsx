'use client';

import { useState } from 'react';
import { useAppStore, type FilterField, type FilterOp, type FilterRule } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, Plus, Trash2, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const FIELDS: Array<{ value: FilterField; key: string }> = [
  { value: 'station', key: 'filter.field.station' },
  { value: 'function', key: 'filter.field.function' },
  { value: 'register', key: 'filter.field.register' },
  { value: 'value', key: 'filter.field.value' },
  { value: 'direction', key: 'filter.field.direction' },
  { value: 'status', key: 'filter.field.status' },
];

const OPS: Array<{ value: FilterOp; key: string }> = [
  { value: 'equals', key: 'filter.op.equals' },
  { value: 'contains', key: 'filter.op.contains' },
  { value: 'gt', key: 'filter.op.gt' },
  { value: 'lt', key: 'filter.op.lt' },
  { value: 'regex', key: 'filter.op.regex' },
];

export function FilterBar() {
  const { t } = useI18n();
  const filterRules = useAppStore((s) => s.filterRules);
  const filterCombinator = useAppStore((s) => s.filterCombinator);
  const addFilterRule = useAppStore((s) => s.addFilterRule);
  const updateFilterRule = useAppStore((s) => s.updateFilterRule);
  const removeFilterRule = useAppStore((s) => s.removeFilterRule);
  const clearFilters = useAppStore((s) => s.clearFilters);
  const setFilterCombinator = useAppStore((s) => s.setFilterCombinator);
  const [expanded, setExpanded] = useState(true);

  const activeCount = filterRules.filter((r) => r.enabled && r.value.trim()).length;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{t('filter.title')}</span>
        {activeCount > 0 && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
            {activeCount}
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t('filter.and')} / {t('filter.or')}:</span>
            <Select
              value={filterCombinator}
              onValueChange={(v) => setFilterCombinator(v as 'and' | 'or')}
            >
              <SelectTrigger className="h-7 w-[80px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">{t('filter.and')}</SelectItem>
                <SelectItem value="or">{t('filter.or')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={addFilterRule}
            >
              <Plus className="h-3 w-3" />
              {t('filter.add_rule')}
            </Button>
            {filterRules.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={clearFilters}
              >
                <Trash2 className="h-3 w-3" />
                {t('filter.clear')}
              </Button>
            )}
          </div>

          {filterRules.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span>
                No filters. Click "{t('filter.add_rule')}" to filter by station, function, register, value, direction, or status.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filterRules.map((rule, idx) => (
                <FilterRow
                  key={rule.id}
                  rule={rule}
                  index={idx}
                  total={filterRules.length}
                  combinator={filterCombinator}
                  onChange={(patch) => updateFilterRule(rule.id, patch)}
                  onRemove={() => removeFilterRule(rule.id)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  rule,
  index,
  total,
  combinator,
  onChange,
  onRemove,
  t,
}: {
  rule: FilterRule;
  index: number;
  total: number;
  combinator: 'and' | 'or';
  onChange: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-[24px]">
        {index === 0 ? '•' : combinator === 'and' ? '∧' : '∨'}
      </span>
      <Switch
        checked={rule.enabled}
        onCheckedChange={(checked) => onChange({ enabled: checked })}
        className="scale-75"
      />
      <Select
        value={rule.field}
        onValueChange={(v) => onChange({ field: v as FilterField })}
      >
        <SelectTrigger className="h-7 w-[110px] sm:w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELDS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {t(f.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={rule.op}
        onValueChange={(v) => onChange({ op: v as FilterOp })}
      >
        <SelectTrigger className="h-7 w-[90px] sm:w-[110px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {t(op.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="value (e.g. 1, 0x03, request)"
        className={cn(
          'h-7 flex-1 min-w-[120px] font-mono text-xs',
        )}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onRemove}
        aria-label="Remove rule"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
      {index < total - 1 && (
        <span className="text-[10px] text-muted-foreground w-[24px]" />
      )}
    </div>
  );
}
