import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  FileSpreadsheet,
  HelpCircle,
  LogOut,
  Menu,
  ShieldAlert,
  Sliders,
  User,
  Users,
  X,
  Zap
} from 'lucide-react';
import { ChargeMeshBrand } from '../components/Brand.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import type { PropertySettings } from './types';

export type NavTab = 'overview' | 'rooms' | 'bills' | 'readings' | 'disputes' | 'settings';

interface NavbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  openDisputeCount: number;
  settings: PropertySettings;
  onOpenTariffModal: () => void;
  onSwitchPortal: () => void;
  onLogout: () => void;
}

const TABS: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <FileSpreadsheet className="w-4 h-4" /> },
  { id: 'rooms', label: 'Rooms & Renters', icon: <Users className="w-4 h-4" /> },
  { id: 'bills', label: 'Bills', icon: <FileSpreadsheet className="w-4 h-4" /> },
  { id: 'readings', label: 'Meter Readings', icon: <Sliders className="w-4 h-4" /> },
  { id: 'disputes', label: 'Questions & Disputes', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'settings', label: 'Settings', icon: <ShieldAlert className="w-4 h-4" /> }
];

const NotificationCount: React.FC<{ count: number; className?: string }> = ({
  count,
  className = '',
}) => {
  if (count <= 0) return null;

  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm ${className}`}
      aria-label={`${count} open ${count === 1 ? 'question' : 'questions'}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  openDisputeCount,
  settings,
  onOpenTariffModal,
  onSwitchPortal,
  onLogout,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectTab = (tab: NavTab) => {
    onSelectTab(tab);
    setMobileOpen(false);
    setMoreOpen(false);
  };

  return (
    <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 min-h-16 h-16 sm:h-18 flex items-center justify-between gap-3 sm:gap-8">
        {/* Brand Zone */}
        <ChargeMeshBrand
          subtitle="Electricity & Rent Billing"
          onClick={() => selectTab('overview')}
          className="shrink min-w-0"
        />

        {/* Desktop Navigation Tabs */}
        <nav className="hidden xl:flex items-center gap-1 text-sm">
          <button
            onClick={() => selectTab('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Overview
          </button>

          <button
            onClick={() => selectTab('rooms')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'rooms'
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Rooms &amp; Renters
          </button>

          <button
            onClick={() => selectTab('bills')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap relative ${
              activeTab === 'bills'
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Bills
          </button>

          <button
            onClick={() => selectTab('readings')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'readings'
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Meter Readings
          </button>

          <button
            onClick={() => selectTab('settings')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Settings
          </button>

          {/* More Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={`flex items-center gap-1 px-3.5 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                activeTab === 'disputes' || moreOpen
                  ? 'bg-blue-100 text-blue-900 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>More</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
              <NotificationCount count={openDisputeCount} className="ml-0.5" />
            </button>

            {moreOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200/90 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  onClick={() => selectTab('disputes')}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-100 hover:text-blue-900 flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <HelpCircle className="w-4 h-4 shrink-0 text-amber-500" />
                    <span className="truncate font-medium">Tenant Questions &amp; Disputes</span>
                  </div>
                  <NotificationCount count={openDisputeCount} />
                </button>

                <button
                  onClick={() => {
                    onOpenTariffModal();
                    setMoreOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-100 hover:text-blue-900 flex items-center gap-2.5"
                >
                  <Zap className="w-4 h-4 text-blue-600" />
                  <span>Update Tariff Rate (USD {settings.electricityRateNpr.toFixed(2)})</span>
                </button>

                <button
                  onClick={() => selectTab('readings')}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-100 hover:text-blue-900 flex items-center gap-2.5"
                >
                  <Sliders className="w-4 h-4 text-emerald-600" />
                  <span>Sub-meter Diagnostics</span>
                </button>

                <div className="my-1 border-t border-slate-100" />

                <div className="px-4 py-2 text-[11px] text-slate-400">
                  Building: {settings.propertyName} ({settings.address})
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Desktop User & Actions */}
        <div className="hidden xl:flex items-center gap-4 lg:gap-6 shrink-0">
          <ThemeToggle />
          <div className="hidden lg:flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight">{settings.landlordName}</div>
              <div className="text-xs text-slate-500 font-medium">{settings.landlordRole}</div>
            </div>

            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <User className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>

          <div className="hidden lg:block h-5 w-px bg-slate-200" />

          <button
            onClick={onSwitchPortal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-lg text-xs font-semibold text-slate-700 transition-colors whitespace-nowrap"
            title="Open the tenant portal"
          >
            <Users className="w-3.5 h-3.5 text-blue-600" />
            <span>Renter view</span>
            <ArrowLeftRight className="w-3 h-3 text-slate-400" />
          </button>

          <button
            onClick={onLogout}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            Log out
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileOpen((open) => !open)}
          className="xl:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 shrink-0"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Navigation */}
      {mobileOpen && (
        <nav className="xl:hidden border-t border-slate-100 bg-white px-4 py-3 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="flex items-center gap-3 pb-3 mb-2 border-b border-slate-100">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{settings.landlordName}</div>
              <div className="text-xs text-slate-500 truncate">
                {settings.landlordRole} · {settings.propertyName}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 text-blue-900 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <span className={activeTab === tab.id ? 'text-blue-600' : 'text-slate-400'}>
                    {tab.icon}
                  </span>
                  {tab.label}
                </span>
                {tab.id === 'disputes' && <NotificationCount count={openDisputeCount} />}
              </button>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 gap-1">
            <ThemeToggle showLabel className="w-full justify-between" />
            <button
              onClick={() => {
                onOpenTariffModal();
                setMobileOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Zap className="w-4 h-4 text-blue-600" />
              Update tariff (USD {settings.electricityRateNpr.toFixed(2)})
            </button>
            <button
              onClick={() => {
                setMobileOpen(false);
                onSwitchPortal();
              }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Users className="w-4 h-4 text-blue-600" />
              Open renter view
            </button>
            <button
              onClick={() => {
                setMobileOpen(false);
                onLogout();
              }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
};
