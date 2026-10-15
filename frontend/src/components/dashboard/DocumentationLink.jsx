import React, { useState, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { FileUp, ChevronDown, BookOpen, Check, UploadCloud } from 'lucide-react';

export default function DocumentationLink({ onNavigate }) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      setTimeout(() => {
        setUploadedFile(file.name);
        setUploading(false);
      }, 1200);
    }
  };

  return (
    <div className="pt-4 border-t border-[#E2E5E8] space-y-2">
      {/* PDF Upload Collapsible Section */}
      <div className="rounded-xl border border-[#E2E5E8] bg-white overflow-hidden transition-all">
        <button
          onClick={() => setPdfOpen(!pdfOpen)}
          className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-[#111827] hover:bg-zinc-50 transition-colors"
          aria-expanded={pdfOpen}
        >
          <div className="flex items-center gap-2">
            <FileUp className="w-3.5 h-3.5 text-[#52525B]" />
            <span>PDF Upload</span>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
              pdfOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {pdfOpen && (
          <div className="p-3 bg-zinc-50/70 border-t border-[#E2E5E8] space-y-2 text-xs">
            <p className="text-[11px] text-[#64748B] leading-relaxed">
              Convert product briefs, wireframe specs, or PRD documents into interactive UI prototypes.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2 px-2.5 rounded-lg border border-dashed border-[#52525B] bg-zinc-50/40 hover:bg-zinc-50/80 text-[#52525B] flex items-center justify-center gap-1.5 font-medium transition-colors cursor-pointer"
            >
              {uploading ? (
                <span className="animate-pulse">Processing PDF...</span>
              ) : uploadedFile ? (
                <div className="flex items-center gap-1 text-emerald-600 truncate">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{uploadedFile}</span>
                </div>
              ) : (
                <>
                  <UploadCloud className="w-3.5 h-3.5 shrink-0" />
                  <span>Upload PRD / Spec (.pdf)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Documentation Link */}
      <NavLink
        to="/documentation"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
            isActive
              ? 'bg-zinc-100 text-[#111827] font-semibold'
              : 'text-[#64748B] hover:text-[#111827] hover:bg-zinc-50'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <BookOpen
              className={`w-4 h-4 transition-colors ${
                isActive ? 'text-[#52525B]' : 'text-zinc-400'
              }`}
            />
            <span>Documentation</span>
          </>
        )}
      </NavLink>
    </div>
  );
}
