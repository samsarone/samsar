
import CommonButton from "../../common/CommonButton.tsx";
import { IMAGE_EDIT_MODEL_TYPES } from "../../../constants/Types.ts";
import { useColorMode } from "../../../contexts/ColorMode.jsx";
import RangeSlider from '../../editor/utils/RangeSlider.jsx';
import AutoExpandableTextarea from "../../common/AutoExpandableTextarea.jsx";
import ImagePayloadAspectRatioSelector from "../../image/ImagePayloadAspectRatioSelector.jsx";
import { imageAspectRatioOptions } from "../../../constants/ImageAspectRatios.js";

export default function ImageEditGenerator(props) {
  const { promptText, setPromptText, submitOutpaintRequest,
    selectedEditModel, setSelectedEditModel,
    selectedEditModelValue,
    isOutpaintPending, outpaintError,
    editBrushWidth, setEditBrushWidth,
    aspectRatio,
    setAspectRatio,
    canvasDimensions,
    showModelSelector = true,
    sizeVariant = "default"
  } = props;
  const { colorMode } = useColorMode();
  const isImageStudio = sizeVariant === "imageStudio";
  const isSidebarCollapsed = sizeVariant === "sidebarCollapsed";
  const isSidebarExpanded = sizeVariant === "sidebarExpanded";




  const modelOptionMap = IMAGE_EDIT_MODEL_TYPES.map((model) => {
    return (
      <option key={model.key} value={model.key} selected={model.key === selectedEditModel}>
        {model.name}
      </option>
    )
  })



  const setSelectedModelDisplay = (evt) => {
    setSelectedEditModel(evt.target.value);
  }

  let editOptionsDisplay = <span />;

  const inputShell =
    colorMode === "dark"
      ? "bg-slate-900/60 text-slate-100 border border-white/10"
      : "bg-white text-slate-900 border border-slate-200 shadow-sm";
  const modelLabelClass = isImageStudio ? "text-sm font-semibold" : "text-xs font-bold";
  const selectClass = isImageStudio
    ? `${inputShell} inline-flex min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm bg-transparent`
    : isSidebarExpanded
    ? `${inputShell} inline-flex min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm bg-transparent`
    : isSidebarCollapsed
    ? `${inputShell} inline-flex min-h-[44px] w-full rounded-xl px-3 py-2.5 text-sm bg-transparent`
    : `${inputShell} inline-flex w-[75%] rounded-md px-3 py-2 bg-transparent`;
  const buttonExtraClass = isImageStudio
    ? "min-h-[46px] min-w-[160px] text-sm"
    : isSidebarExpanded
    ? "min-w-[168px] text-sm"
    : isSidebarCollapsed
    ? "w-full whitespace-normal text-center leading-tight"
    : "";
  const editOptionsGridClass = isSidebarExpanded
    ? "grid grid-cols-3 gap-3"
    : isSidebarCollapsed
    ? "grid gap-2"
    : `grid grid-cols-3 ${isImageStudio ? "gap-2.5" : "gap-1"}`;
  const editOptionsGridStyle = isSidebarCollapsed
    ? { gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }
    : undefined;
  const modelFieldClass = isSidebarExpanded
    ? "grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3"
    : "block";



  if (selectedEditModelValue && selectedEditModelValue.editType === 'inpaint') {
    editOptionsDisplay = (
      <RangeSlider
        editBrushWidth={editBrushWidth}
        setEditBrushWidth={setEditBrushWidth}
        sizeVariant={sizeVariant}
      />
    )
  }

  if (selectedEditModel === "SDXL") {

    editOptionsDisplay = (<div className={editOptionsGridClass} style={editOptionsGridStyle}>
      <div>
        <input type="text" className={`${inputShell} w-full rounded-xl ${isImageStudio ? "px-3.5 py-2.5 text-sm" : "px-3 py-2"}`} name="guidanceScale" defaultValue={5} />
        <div className={isImageStudio ? "mt-1 text-sm" : "text-xs "}>
          Guidance
        </div>
      </div>
      <div>
        <input type="text" className={`${inputShell} w-full rounded-xl ${isImageStudio ? "px-3.5 py-2.5 text-sm" : "px-3 py-2"}`} name="numInferenceSteps" defaultValue={30} />
        <div className={isImageStudio ? "mt-1 text-sm" : "text-xs"}>
          Inference
        </div>
      </div>
      <div>

        <input type="text" className={`${inputShell} w-full rounded-xl ${isImageStudio ? "px-3.5 py-2.5 text-sm" : "px-3 py-2"}`} name="strength" defaultValue={0.99} />
        <div className={isImageStudio ? "mt-1 text-sm" : "text-xs"}>
          Strength
        </div>
      </div>

    </div>);
  }

  const errorDisplay = outpaintError ? (
    <div className="text-red-500 text-center text-sm">
      {outpaintError}
    </div>
  ) : null;

  let promptTextArea = null;



  if (selectedEditModelValue.isPromptEnabled) {
    promptTextArea = (
      <AutoExpandableTextarea
        name="promptText"
        onChange={(evt) => setPromptText((evt.target.value))}
        className={`${inputShell} w-full m-auto rounded-2xl bg-transparent ${isImageStudio ? "px-4 py-3.5 text-sm" : "px-3 py-3"}`}
        minRows={isImageStudio ? 4 : 3}
        maxRows={10}
        value={promptText}
      />
    )
  }

  return (
    <div>
      <form onSubmit={submitOutpaintRequest}>
        <div className="mb-3">
          <ImagePayloadAspectRatioSelector
            label="Edit ratio"
            name="aspectRatio"
            value={aspectRatio}
            onChange={setAspectRatio}
            options={imageAspectRatioOptions}
            canvasDimensions={canvasDimensions}
            sizeVariant={sizeVariant}
          />
        </div>

        <div className={`w-full ${isImageStudio ? "space-y-3" : "mt-2 mb-2"}`}>
          {showModelSelector && (
            <div className={modelFieldClass}>
              <div className={modelLabelClass}>
                Model
              </div>
              <select onChange={setSelectedModelDisplay} className={selectClass} value={selectedEditModel}>
                {modelOptionMap}
              </select>
            </div>
          )}
          <div>

          </div>
          <div className="block">
            {editOptionsDisplay}
          </div>
        </div>

        <div>

        </div>

        {promptTextArea}
        <div className={isImageStudio ? "pt-3 text-center" : isSidebarExpanded ? "pt-4 flex justify-end" : isSidebarCollapsed ? "pt-3" : "text-center"}>
          <CommonButton type="submit" isPending={isOutpaintPending} extraClasses={buttonExtraClass}>
            Submit
          </CommonButton>
        </div>
      </form>
      {errorDisplay}
    </div>
  )
}
