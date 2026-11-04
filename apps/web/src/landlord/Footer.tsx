import React from 'react';
import { RefreshCw } from 'lucide-react';

interface FooterProps {
  onRefresh: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onRefresh }) => {
  return (
    <footer className="mt-auto border-t border-slate-200/80 bg-white py-6">
      <div className="max-w-[1440px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div>
          <span>ChargeMesh — Straightforward utility &amp; rent management</span>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={() => alert("ChargeMesh Support: Contact support@chargemesh.local or phone +977 1 4220000 for sub-meter IoT hardware support.")}
            className="hover:text-slate-900 transition-colors"
          >
            Support
          </button>
          <button
            onClick={() => alert("ChargeMesh Terms: All meter readings and calculations follow the standard Nepal Electricity Authority (NEA) and landlord-tenant utility bylaws.")}
            className="hover:text-slate-900 transition-colors"
          >
            Terms
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 transition-colors"
            title="Reload live data from the server"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh data</span>
          </button>
        </div>
      </div>
    </footer>
  );
};
