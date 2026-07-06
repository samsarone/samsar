import { useEffect, useState } from "react";
import { FaUpload } from "react-icons/fa";
import { TbLibraryPhoto } from "react-icons/tb";
import { useColorMode } from "../../../../contexts/ColorMode";

export default function ImageUploadOverlay(props) {
  const { aspectRatio, canvasDimensions, onUpload, onOpenLibrary, activeTab } = props;
  const { colorMode } = useColorMode();

  const [selectedTab, setSelectedTab] = useState(activeTab || "upload");

  useEffect(() => {
    if (activeTab) {
      setSelectedTab(activeTab);
    }
  }, [activeTab]);

  let topH = "top-[40vh]";
  if ((canvasDimensions?.height || 0) > (canvasDimensions?.width || 0) || aspectRatio === "9:16") {
    topH = "top-[60vh]";
  }

  const overlaySurface =
    colorMode === "dark"
      ? "bg-[#0f1629]/95 text-slate-100 border border-[#1f2a3d] shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
      : "bg-white/90 text-slate-900 border border-slate-200 shadow-xl shadow-slate-200/60";
  const buttonShell =
    colorMode === "dark"
      ? "bg-[#111a2f] text-slate-100 border border-[#1f2a3d] hover:bg-[#17233d]"
      : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-white";
  const tabBase =
    colorMode === "dark"
      ? "bg-[#111a2f] text-slate-300 border border-[#1f2a3d] hover:text-white"
      : "bg-slate-100 text-slate-600 border border-slate-200 hover:text-slate-900";
  const tabActive =
    colorMode === "dark"
      ? "bg-rose-500/20 text-rose-100 border border-rose-400/30 shadow-sm"
      : "bg-indigo-500/10 text-indigo-600 border border-indigo-200 shadow-sm";
  const subText = colorMode === "dark" ? "text-slate-300" : "text-slate-600";

  const handleUpload = () => {
    setSelectedTab("upload");
    if (onUpload) {
      onUpload();
    }
  };

  const handleOpenLibrary = () => {
    setSelectedTab("library");
    if (onOpenLibrary) {
      onOpenLibrary();
    }
  };

  return (
    <div
      className={`
        absolute ${topH} left-1/2 transform -translate-x-1/2
        z-10
        ${overlaySurface} backdrop-blur
        flex flex-col items-center
        px-3 py-2
        rounded-lg
        w-[88vw] max-w-[420px]
        opacity-50 hover:opacity-80 focus-within:opacity-100 transition-opacity duration-150
      `}
    >
      <div className="text-sm font-semibold">No image in this frame</div>
      <div className={`text-xs text-center mt-1 ${subText}`}>
        Upload an image or pick one from the library to start editing.
      </div>

      <div className="flex space-x-2 mt-3">
        <button
          type="button"
          onClick={handleUpload}
          className={`px-3 py-1 text-xs rounded-full transition-colors duration-150 ${selectedTab === "upload" ? tabActive : tabBase}`}
        >
          Upload image
        </button>
        <button
          type="button"
          onClick={handleOpenLibrary}
          className={`px-3 py-1 text-xs rounded-full transition-colors duration-150 ${selectedTab === "library" ? tabActive : tabBase}`}
        >
          Library
        </button>
      </div>

      <div className="flex items-center justify-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleUpload}
          className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs transition-colors duration-150 ${buttonShell}`}
        >
          <FaUpload className="text-lg" />
          <span>Upload</span>
        </button>
        <button
          type="button"
          onClick={handleOpenLibrary}
          className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs transition-colors duration-150 ${buttonShell}`}
        >
          <TbLibraryPhoto className="text-lg" />
          <span>Library</span>
        </button>
      </div>
    </div>
  );
}
