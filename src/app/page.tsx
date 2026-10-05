'use client';

import { useMemo } from 'react';
import { Activity, Hammer, LineChart, Settings, Github, Wifi } from 'lucide-react';
import { useAppStore, type TabId } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ParseTab } from '@/components/tabs/parse-tab';
import { BuilderTab } from '@/components/tabs/builder-tab';
import { TimelineTab } from '@/components/tabs/timeline-tab';
import { SettingsTab } from '@/components/tabs/settings-tab';
import { APP_VERSION } from '@/lib/version';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function Page() {
  const { t, locale, setLocale, listLocales } = useI18n();
  const { theme, setTheme, listThemes } = useTheme();
  const activeTab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setTab);
  const framesCount = useAppStore((s) => s.frames.length);

  const tabs = useMemo<Array<{ id: TabId; icon: typeof Activity; label: string }>>(
    () => [
      { id: 'parse', icon: Activity, label: t('app.tab.parse') },
      { id: 'builder', icon: Hammer, label: t('app.tab.builder') },
      { id: 'timeline', icon: LineChart, label: t('app.tab.timeline') },
      { id: 'settings', icon: Settings, label: t('app.tab.settings') },
    ],
    [t, locale],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:gap-4 sm:px-6">
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-foreground shrink-0">
                <Wifi className="h-4 w-4" />
              </div>
              <div className="hidden md:block min-w-0 max-w-[180px] lg:max-w-[260px]">
                <div className="text-sm font-semibold leading-none truncate">
                  {t('app.title')}
                </div>
                <div className="text-[10px] text-muted-foreground leading-none mt-0.5 truncate">
                  {t('app.subtitle')}
                </div>
              </div>
            </div>

            <div className="flex-1" />

            {/* Frame count chip */}
            {framesCount > 0 && (
              <div className="hidden md:flex items-center gap-1 rounded-md border border-border bg-surfaceAlt px-2 py-1 text-xs">
                <span className="font-mono font-semibold text-foreground">
                  {framesCount}
                </span>
                <span className="text-muted-foreground">{t('header.frames')}</span>
              </div>
            )}

            {/* Locale selector */}
            <Select value={locale} onValueChange={(v) => setLocale(v)}>
              <SelectTrigger className="h-8 w-[100px] sm:w-[120px] px-2 text-xs shrink-0" aria-label={t('locale.label')}>
                <SelectValue placeholder="EN" />
              </SelectTrigger>
              <SelectContent>
                {listLocales().map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    <span className="flex items-center gap-2">
                      <span>{l.name}</span>
                      {l.isCustom && (
                        <span className="rounded bg-accent px-1 text-[10px] text-accent-foreground">
                          {t('common.custom')}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Theme selector */}
            <Select value={theme.id} onValueChange={(v) => setTheme(v)}>
              <SelectTrigger className="h-8 w-[110px] sm:w-[140px] px-2 text-xs shrink-0" aria-label={t('header.theme')}>
                <SelectValue placeholder={t('header.theme')} />
              </SelectTrigger>
              <SelectContent>
                {listThemes().map((th) => (
                  <SelectItem key={th.id} value={th.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${th.isDark ? 'bg-zinc-900' : 'bg-zinc-100 border border-zinc-300'}`}
                      />
                      <span>{th.name.startsWith('theme.') ? t(th.name) : th.name}</span>
                      {th.isCustom && (
                        <span className="rounded bg-accent px-1 text-[10px] text-accent-foreground">
                          {t('common.custom')}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* GitHub */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  asChild
                >
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('header.github')}
                  >
                    <Github className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('header.github')}</TooltipContent>
            </Tooltip>
          </div>

          {/* Tabs */}
          <div className="mx-auto max-w-[1600px] px-3 sm:px-6">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setTab(v as TabId)}
              className="w-full"
            >
              <TabsList className="bg-transparent h-10 p-0 rounded-none border-b border-transparent w-full justify-start gap-1 overflow-x-auto scrollbar-hide sm:overflow-visible">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 sm:px-4 h-10 text-xs sm:text-sm gap-1.5 shrink-0 whitespace-nowrap"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden sm:inline">{tab.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 mx-auto w-full max-w-[1600px] px-3 sm:px-6 py-4">
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="w-full">
            <TabsContent value="parse" className="mt-0 focus-visible:outline-none">
              <ParseTab />
            </TabsContent>
            <TabsContent value="builder" className="mt-0 focus-visible:outline-none">
              <BuilderTab />
            </TabsContent>
            <TabsContent value="timeline" className="mt-0 focus-visible:outline-none">
              <TimelineTab />
            </TabsContent>
            <TabsContent value="settings" className="mt-0 focus-visible:outline-none">
              <SettingsTab />
            </TabsContent>
          </Tabs>
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t border-border bg-surface">
          <div className="mx-auto max-w-[1600px] px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono shrink-0">{t('app.title')}</span>
              <span className="shrink-0 font-mono text-accent/80">v{APP_VERSION}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline truncate">
                {t('footer.tagline')}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="https://github.com/Tutkis/Xmodbus-parser/releases"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                {t('footer.changelog')}
              </a>
              <span className="hidden md:inline">·</span>
              <span className="hidden md:inline">{t('footer.crc_verified')}</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
