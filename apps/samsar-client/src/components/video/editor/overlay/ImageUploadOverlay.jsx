import { useUiLanguage } from '../../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../../utils/localization.js';
import { useEffect, useState } from "react";
import { FaUpload } from "react-icons/fa";
import { TbLibraryPhoto } from "react-icons/tb";
import { useColorMode } from "../../../../contexts/ColorMode";

export default function ImageUploadOverlay(props) {
  useUiLanguage();
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
    `text-fg border border-line ${colorMode === "dark" ? 'bg-[#181b24]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)]' : 'bg-white/90 shadow-xl shadow-slate-200/60'}`;
  const buttonShell =
    `text-fg-body border border-line ${colorMode === "dark" ? 'bg-[#20232e] hover:bg-[#292d3a]' : 'bg-slate-100 hover:bg-white'}`;
  const tabBase =
    `text-fg-tertiary border border-line ${colorMode === "dark" ? 'bg-[#20232e] hover:text-white' : 'bg-slate-100 hover:text-slate-900'}`;
  const tabActive =
    colorMode === "dark"
      ? "bg-[#f6c453]/14 text-[#fff1c8] border border-[#f6c453]/55 shadow-sm"
      : "bg-indigo-500/10 text-indigo-600 border border-indigo-200 shadow-sm";
  const subText = "text-fg-tertiary";

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
      <div className="text-sm font-semibold">{uiText("No image in this frame")}</div>
      <div className={`text-xs text-center mt-1 ${subText}`}>{uiText("Upload an image or pick one from the library to start editing.")}</div>

      <div className="flex space-x-2 mt-3">
        <button
          type="button"
          onClick={handleUpload}
          className={`px-3 py-1 text-xs rounded-full transition-colors duration-150 ${selectedTab === "upload" ? tabActive : tabBase}`}
        >{uiText("Upload image")}</button>
        <button
          type="button"
          onClick={handleOpenLibrary}
          className={`px-3 py-1 text-xs rounded-full transition-colors duration-150 ${selectedTab === "library" ? tabActive : tabBase}`}
        >{uiText("Library")}</button>
      </div>

      <div className="flex items-center justify-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleUpload}
          className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs transition-colors duration-150 ${buttonShell}`}
        >
          <FaUpload className="text-lg" />
          <span>{uiText("Upload")}</span>
        </button>
        <button
          type="button"
          onClick={handleOpenLibrary}
          className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs transition-colors duration-150 ${buttonShell}`}
        >
          <TbLibraryPhoto className="text-lg" />
          <span>{uiText("Library")}</span>
        </button>
      </div>
    </div>
  );
}
