import React, { useState, useRef, useEffect } from 'react';
import type { Agent } from '../hooks/useAgents';
import { getAgentSwitchSettings, saveAgentSwitchSettings, type AgentSwitchSettings } from '../utils/agentSwitch';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { Check, ChevronDown } from 'lucide-react';

interface ApproveDropdownProps {
  onApprove: () => void;
  agents: Agent[];
  disabled?: boolean;
  isLoading?: boolean;
}

function getSelectedLabel(setting: AgentSwitchSettings, agents: Agent[]): string | null {
  if (setting.switchTo === 'disabled') return null;
  if (setting.switchTo === 'custom' && setting.customName) {
    return setting.customName;
  }
  const match = agents.find(a => a.id.toLowerCase() === setting.switchTo.toLowerCase());
  return match?.name ?? setting.switchTo;
}

function isSelected(agentId: string, setting: AgentSwitchSettings): boolean {
  if (setting.switchTo === 'custom') return false;
  if (setting.switchTo === 'disabled') return false;
  return agentId.toLowerCase() === setting.switchTo.toLowerCase();
}

export const ApproveDropdown: React.FC<ApproveDropdownProps> = ({
  onApprove,
  agents,
  disabled = false,
  isLoading = false,
}) => {
  const [setting, setSetting] = useState<AgentSwitchSettings>(() => getAgentSwitchSettings());
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleSelect = (newSetting: AgentSwitchSettings) => {
    setSetting(newSetting);
    saveAgentSwitchSettings(newSetting);
    setIsOpen(false);
  };

  const agentLabel = getSelectedLabel(setting, agents);
  const isNoSwitch = setting.switchTo === 'disabled';
  const isCustom = setting.switchTo === 'custom';
  const notFound = agentLabel && !isNoSwitch && !isCustom
    && !agents.some(a => a.id.toLowerCase() === setting.switchTo.toLowerCase());

  const baseClasses = disabled
    ? 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground'
    : 'bg-success text-success-foreground hover:opacity-90';

  const handleApproveClick = () => {
    setIsOpen(false);
    onApprove();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Mobile: simple button */}
      <Button
        variant="success"
        size="xs"
        onClick={handleApproveClick}
        disabled={disabled}
        className={cn('md:hidden', baseClasses)}
      >
        {isLoading ? '...' : 'OK'}
      </Button>

      {/* Desktop: split button */}
      <div className="hidden md:flex items-stretch">
        <Button
          variant="success"
          size="xs"
          onClick={handleApproveClick}
          disabled={disabled}
          className={cn('rounded-r-none', baseClasses)}
        >
          {isLoading ? 'Approving...' : (
            agentLabel ? (
              <span className="flex items-center gap-1">
                Approve
                <span className="opacity-60">&rarr;</span>
                <span className="max-w-[120px] truncate">{agentLabel}</span>
                {notFound && <span className="opacity-60 text-[10px]">(?)</span>}
              </span>
            ) : 'Approve'
          )}
        </Button>
        <Button
          variant="success"
          size="xs"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn('rounded-l-none border-l border-success-foreground/20 px-1.5', baseClasses)}
        >
          <ChevronDown className="w-3 h-3" />
        </Button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border bg-popover shadow-xl z-[70] overflow-hidden py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
            Switch to agent
          </div>
          {agents.map((agent) => {
            const selected = isSelected(agent.id, setting);
            return (
              <button
                key={agent.id}
                onClick={() => handleSelect({ switchTo: agent.id })}
                className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${
                  selected
                    ? 'text-primary bg-primary/10 font-medium'
                    : 'text-popover-foreground hover:bg-muted'
                }`}
              >
                <span className="w-4 flex-shrink-0">{selected && <Check className="w-3.5 h-3.5" />}</span>
                <span className="truncate">{agent.name}</span>
              </button>
            );
          })}
          {isCustom && setting.customName && (
            <button
              onClick={() => setIsOpen(false)}
              className="w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 text-primary bg-primary/10 font-medium"
            >
              <span className="w-4 flex-shrink-0"><Check className="w-3.5 h-3.5" /></span>
              <span className="truncate">{setting.customName}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">(custom)</span>
            </button>
          )}
          <div className="border-t border-border my-1" />
          <button
            onClick={() => handleSelect({ switchTo: 'disabled' })}
            className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${
              isNoSwitch
                ? 'text-primary bg-primary/10 font-medium'
                : 'text-popover-foreground hover:bg-muted'
            }`}
          >
            <span className="w-4 flex-shrink-0">{isNoSwitch && <Check className="w-3.5 h-3.5" />}</span>
            No switch
          </button>
        </div>
      )}
    </div>
  );
};
