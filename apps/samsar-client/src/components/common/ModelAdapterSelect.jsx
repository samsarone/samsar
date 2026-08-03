import { useId, useMemo } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "react-tooltip";

import {
  getPrimaryAdapterKeyForModel,
  normalizeAdapterKey,
} from "../../utils/adapterPresentation.mjs";
import AdapterIcon from "./AdapterIcon.jsx";
import SingleSelect from "./SingleSelect.jsx";

import "react-tooltip/dist/react-tooltip.css";

const ADAPTER_TOOLTIP_Z_INDEX = 2147483647;

function getOptionValue(option) {
  return option?.value ?? option?.key ?? "";
}

function getOptionLabel(option) {
  return option?.label ?? option?.name ?? getOptionValue(option);
}

export default function ModelAdapterSelect({
  options = [],
  value,
  onChange,
  primaryAdapterByModel = {},
  isStandaloneDeployment = false,
  valueMode = "option",
  hostedControl = "select",
  nativeClassName = "",
  isDisabled = false,
  isSearchable,
  ...selectProps
}) {
  const reactId = useId();
  const tooltipId = `adapter-icon-${reactId.replace(/:/g, "")}`;
  const normalizedOptions = useMemo(
    () => options.map((option) => ({
      ...option,
      value: getOptionValue(option),
      label: getOptionLabel(option),
    })),
    [options],
  );
  const selectedOption = valueMode === "value"
    ? normalizedOptions.find((option) => option.value === value) || null
    : normalizedOptions.find((option) => option.value === value?.value) || value || null;
  const resolvedIsSearchable = isSearchable ?? hostedControl !== "native";

  const handleChange = (option) => {
    if (valueMode === "value") {
      onChange?.(option?.value || "");
      return;
    }
    onChange?.(option);
  };

  if (!isStandaloneDeployment && hostedControl === "native") {
    return (
      <select
        value={selectedOption?.value || ""}
        onChange={(event) => {
          const option = normalizedOptions.find(
            (candidate) => candidate.value === event.target.value,
          ) || null;
          handleChange(option);
        }}
        disabled={isDisabled}
        className={nativeClassName}
      >
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const formatOptionLabel = (option) => {
    const explicitAdapterKey = normalizeAdapterKey(option.adapterKey);
    const mappedAdapterKey = getPrimaryAdapterKeyForModel(
      option.adapterModelKey || option.value,
      primaryAdapterByModel,
    );
    const fallbackAdapterKey = normalizeAdapterKey(option.fallbackAdapterKey);
    const adapterKey = explicitAdapterKey || mappedAdapterKey || fallbackAdapterKey;
    const isCustomAdapter = adapterKey === "custom";
    const adapterLabel = option.adapterLabel || (
      !explicitAdapterKey && !mappedAdapterKey && fallbackAdapterKey
        ? option.fallbackAdapterLabel
        : isCustomAdapter
          ? `${option.label} custom adapter`
          : undefined
    );

    return (
      <span className="flex min-w-0 w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {adapterKey ? (
          <AdapterIcon
            adapterKey={adapterKey}
            adapterLabel={adapterLabel}
            tooltipId={tooltipId}
          />
        ) : null}
      </span>
    );
  };

  return (
    <>
      <SingleSelect
        {...selectProps}
        options={normalizedOptions}
        value={selectedOption}
        onChange={handleChange}
        isDisabled={isDisabled}
        isSearchable={resolvedIsSearchable}
        formatOptionLabel={isStandaloneDeployment ? formatOptionLabel : undefined}
      />
      {isStandaloneDeployment && typeof document !== "undefined"
        ? createPortal(
          <Tooltip
            id={tooltipId}
            place="top"
            positionStrategy="fixed"
            delayShow={180}
            style={{ zIndex: ADAPTER_TOOLTIP_Z_INDEX }}
            className="!rounded-md !px-2 !py-1 !text-xs"
          />,
          document.body,
        )
        : null}
    </>
  );
}
