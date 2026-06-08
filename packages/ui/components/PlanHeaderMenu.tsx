import React from 'react';
import {
  ActionMenu,
  ActionMenuDivider,
  ActionMenuItem,
  ActionMenuSectionLabel,
} from './ActionMenu';
import { useTheme } from './ThemeProvider';
import { SunIcon, MoonIcon, SystemIcon } from './icons/themeIcons';
import { ReviewAgentsIcon } from './ReviewAgentsIcon';
import { MenuVersionSection } from './MenuVersionSection';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { Menu, X, Settings as SettingsLucide, Upload, Download, Printer, Link as LinkLucide, LogIn } from 'lucide-react';
import type { UpdateInfo } from '../hooks/useUpdateCheck';
import type { Origin } from '@plannotator/shared/agents';

interface PlanHeaderMenuProps {
  appVersion: string;
  updateInfo?: UpdateInfo | null;
  origin?: Origin | null;
  isWSL?: boolean;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onCopyAgentInstructions: () => void;
  onDownloadAnnotations: () => void;
  onPrint: () => void;
  onCopyShareLink: () => void;
  onOpenImport: () => void;
  sharingEnabled: boolean;
  isApiMode: boolean;
  agentInstructionsEnabled: boolean;
}

export const PlanHeaderMenu: React.FC<PlanHeaderMenuProps> = ({
  appVersion,
  updateInfo,
  origin,
  isWSL = false,
  onOpenSettings,
  onOpenExport,
  onCopyAgentInstructions,
  onDownloadAnnotations,
  onPrint,
  onCopyShareLink,
  onOpenImport,
  sharingEnabled,
  isApiMode,
  agentInstructionsEnabled,
}) => {
  const { theme, setTheme } = useTheme();

  const showUpdateDot = !!updateInfo?.updateAvailable && !updateInfo.dismissed;

  return (
    <ActionMenu
      renderTrigger={({ isOpen, toggleMenu }) => (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (!isOpen && showUpdateDot) updateInfo?.dismiss();
            toggleMenu();
          }}
          title="Options"
          aria-label="Options"
          aria-expanded={isOpen}
          className={cn('relative', isOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
        >
          {isOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          <span className="hidden md:inline">Options</span>
          {showUpdateDot && (
            <span className="absolute top-0.5 right-0.5 md:-top-0.5 md:-right-0.5 w-2 h-2 rounded-full bg-primary ring-2 ring-background" />
          )}
        </Button>
      )}
    >
      {({ closeMenu }) => (
        <>
          <div className="px-3 py-2 space-y-1.5">
            <ActionMenuSectionLabel>Theme</ActionMenuSectionLabel>
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    closeMenu();
                    setTheme(mode);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    theme === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mode === 'light' ? <SunIcon /> : mode === 'dark' ? <MoonIcon /> : <SystemIcon />}
                  <span className="capitalize">{mode}</span>
                </button>
              ))}
            </div>
          </div>

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenSettings();
            }}
            icon={<SettingsLucide className="w-3.5 h-3.5" />}
            label="Settings"
          />
          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenExport();
            }}
            icon={<Upload className="w-3.5 h-3.5" />}
            label="Export"
          />
          {agentInstructionsEnabled && (
            <ActionMenuItem
              onClick={() => {
                closeMenu();
                onCopyAgentInstructions();
              }}
              icon={<ReviewAgentsIcon />}
              label="Agent Instructions"
              subtitle="Copy agent instructions for external annotations"
            />
          )}

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onDownloadAnnotations();
            }}
            icon={<Download className="w-3.5 h-3.5" />}
            label="Download Annotations"
          />
          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onPrint();
            }}
            icon={<Printer className="w-3.5 h-3.5" />}
            label="Print / Save as PDF"
            subtitle="Choose 'Save as PDF' in the print dialog"
          />
          {sharingEnabled && (
            <ActionMenuItem
              onClick={() => {
                closeMenu();
                onCopyShareLink();
              }}
              icon={<LinkLucide className="w-3.5 h-3.5" />}
              label="Copy Share Link"
            />
          )}
          {sharingEnabled && (
            <ActionMenuItem
              onClick={() => {
                closeMenu();
                onOpenImport();
              }}
              icon={<LogIn className="w-3.5 h-3.5" />}
              label="Import Review"
            />
          )}

          <ActionMenuDivider />

          <MenuVersionSection
            appVersion={appVersion}
            updateInfo={updateInfo}
            origin={origin}
            isWSL={isWSL}
            closeMenu={closeMenu}
          />
        </>
      )}
    </ActionMenu>
  );
};


