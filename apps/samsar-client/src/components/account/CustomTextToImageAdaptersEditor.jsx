import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useUser } from "../../contexts/UserContext.jsx";
import { getHeaders } from "../../utils/web.jsx";
import {
  CUSTOM_TEXT_TO_IMAGE_OPERATION,
  createEmptyCustomTextToImageAdapter,
  inferCustomTextToImageUrls,
  normalizeCustomTextToImageAdapters,
  validateCustomTextToImageAdapter,
} from "../../utils/customTextToImageAdapters.mjs";
import SecondaryButton from "../common/SecondaryButton.tsx";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || "";

function getErrorMessage(error, fallbackMessage) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage
  );
}

function serializeTextToImageAdapter(adapter) {
  return {
    id: adapter.id,
    model_key: adapter.model_key,
    name: adapter.name.trim(),
    operation: CUSTOM_TEXT_TO_IMAGE_OPERATION,
    generate_url: adapter.generate_url.trim(),
    status_url: adapter.status_url.trim(),
    result_url: adapter.result_url.trim(),
    header_key: adapter.header_key.trim() || "Authorization",
    ...(adapter.header_value.trim()
      ? { header_value: adapter.header_value.trim() }
      : {}),
    ...(adapter.has_header_value === true ? { has_header_value: true } : {}),
  };
}

function buildCustomAdaptersUpdate(currentCustomAdapters, adapters) {
  const source = currentCustomAdapters && typeof currentCustomAdapters === "object"
    ? currentCustomAdapters
    : {};
  const existingEndpoints = Array.isArray(source.custom_endpoints)
    ? source.custom_endpoints
    : [];
  const otherEndpoints = existingEndpoints.filter(
    (endpoint) => endpoint?.operation !== CUSTOM_TEXT_TO_IMAGE_OPERATION,
  );
  const nextEndpoints = [
    ...otherEndpoints,
    ...adapters.map(serializeTextToImageAdapter),
  ];
  const nextCustomAdapters = { ...source };
  delete nextCustomAdapters.has_api_key;
  nextCustomAdapters.custom_endpoints = nextEndpoints;

  const hasLegacyConfiguration = Object.entries(nextCustomAdapters).some(
    ([key, value]) => (
      key !== "custom_endpoints" &&
      value !== null &&
      value !== undefined &&
      value !== ""
    ),
  );
  return nextEndpoints.length > 0 || hasLegacyConfiguration
    ? nextCustomAdapters
    : null;
}

export default function CustomTextToImageAdaptersEditor() {
  const { colorMode } = useColorMode();
  const { user, setUser, getUserAPI } = useUser();
  const [adapters, setAdapters] = useState(() =>
    normalizeCustomTextToImageAdapters(user?.custom_adapters),
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setAdapters(normalizeCustomTextToImageAdapters(user?.custom_adapters));
  }, [user?.custom_adapters]);

  const borderColor = colorMode === "dark" ? "border-[#3a4050]" : "border-slate-200";
  const surface = colorMode === "dark" ? "bg-[#151720]" : "bg-slate-50";
  const inputSurface = colorMode === "dark" ? "bg-[#181b24] text-slate-100" : "bg-white text-slate-900";
  const secondaryText = colorMode === "dark" ? "text-slate-400" : "text-slate-600";
  const inputClasses = `w-full rounded-lg border ${borderColor} ${inputSurface} px-3 py-2 text-sm`;

  const hasSavedAdapters = useMemo(
    () => normalizeCustomTextToImageAdapters(user?.custom_adapters).length > 0,
    [user?.custom_adapters],
  );

  const updateAdapter = (index, field, value) => {
    setAdapters((current) => current.map((adapter, adapterIndex) => {
      if (adapterIndex !== index) return adapter;
      if (field !== "generate_url") {
        return { ...adapter, [field]: value };
      }

      const previousInferred = inferCustomTextToImageUrls(adapter.generate_url);
      const nextInferred = inferCustomTextToImageUrls(value);
      const shouldUpdateStatus =
        !adapter.status_url || adapter.status_url === previousInferred.statusUrl;
      const shouldUpdateResult =
        !adapter.result_url || adapter.result_url === previousInferred.resultUrl;
      return {
        ...adapter,
        generate_url: value,
        ...(shouldUpdateStatus ? { status_url: nextInferred.statusUrl } : {}),
        ...(shouldUpdateResult ? { result_url: nextInferred.resultUrl } : {}),
      };
    }));
  };

  const addAdapter = () => {
    setAdapters((current) => [...current, createEmptyCustomTextToImageAdapter()]);
  };

  const removeAdapter = (index) => {
    setAdapters((current) => current.filter((_, adapterIndex) => adapterIndex !== index));
  };

  const saveAdapters = async () => {
    for (let index = 0; index < adapters.length; index += 1) {
      const validationError = validateCustomTextToImageAdapter(adapters[index], index);
      if (validationError) {
        toast.error(validationError, { position: "bottom-center" });
        return;
      }
    }

    setIsSaving(true);
    try {
      const customAdapters = buildCustomAdaptersUpdate(user?.custom_adapters, adapters);
      const response = await axios.post(
        `${PROCESSOR_SERVER}/users/update`,
        { custom_adapters: customAdapters },
        getHeaders(),
      );
      if (response.data) {
        setUser(response.data);
      }
      await getUserAPI();
      toast.success("Custom image models saved.", { position: "bottom-center" });
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Unable to save custom image models."),
        { position: "bottom-center" },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={`rounded-xl border ${borderColor} ${surface} p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Custom text-to-image models</h3>
          <p className={`mt-1 max-w-3xl text-sm ${secondaryText}`}>
            Add asynchronous image APIs for this user. Saved models appear in
            Studio and VidGenie. Authentication values are encrypted and are
            never returned to the browser.
          </p>
        </div>
        <SecondaryButton type="button" onClick={addAdapter} className="w-full sm:w-auto">
          Add model
        </SecondaryButton>
      </div>

      {adapters.length === 0 ? (
        <div className={`mt-4 rounded-lg border border-dashed ${borderColor} p-4 text-sm ${secondaryText}`}>
          No custom text-to-image models are configured for this user.
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {adapters.map((adapter, index) => (
            <div key={adapter.id} className={`rounded-xl border ${borderColor} p-4`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{adapter.name || `Model ${index + 1}`}</div>
                  <div className={`break-all text-xs ${secondaryText}`}>{adapter.model_key}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAdapter(index)}
                  className={`rounded-lg border ${borderColor} px-3 py-2 text-sm`}
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Model name</span>
                  <input
                    type="text"
                    value={adapter.name}
                    onChange={(event) => updateAdapter(index, "name", event.target.value)}
                    placeholder="FLUX.2 Klein 4B"
                    className={inputClasses}
                  />
                </label>

                <label className="block lg:col-span-2">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Generate URL</span>
                  <input
                    type="url"
                    value={adapter.generate_url}
                    onChange={(event) => updateAdapter(index, "generate_url", event.target.value)}
                    placeholder="https://flux.example/v1/images/generations"
                    className={inputClasses}
                  />
                </label>

                <label className="block">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Status / poll URL</span>
                  <input
                    type="text"
                    value={adapter.status_url}
                    onChange={(event) => updateAdapter(index, "status_url", event.target.value)}
                    placeholder="https://flux.example/v1/images/generations/{request_id}/status"
                    className={inputClasses}
                  />
                </label>

                <label className="block">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Result URL</span>
                  <input
                    type="text"
                    value={adapter.result_url}
                    onChange={(event) => updateAdapter(index, "result_url", event.target.value)}
                    placeholder="https://flux.example/v1/images/generations/{request_id}/result"
                    className={inputClasses}
                  />
                </label>

                <label className="block">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Authentication header</span>
                  <input
                    type="text"
                    value={adapter.header_key}
                    onChange={(event) => updateAdapter(index, "header_key", event.target.value)}
                    placeholder="Authorization"
                    className={inputClasses}
                  />
                </label>

                <label className="block">
                  <span className={`mb-1 block text-sm ${secondaryText}`}>Header value</span>
                  <input
                    type="password"
                    value={adapter.header_value}
                    onChange={(event) => updateAdapter(index, "header_value", event.target.value)}
                    placeholder={adapter.has_header_value ? "Saved securely — enter to replace" : "Bearer …"}
                    autoComplete="new-password"
                    className={inputClasses}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-xs ${secondaryText}`}>
          Status and result URLs use <code>{"{request_id}"}</code> as the request identifier placeholder.
          {hasSavedAdapters ? " Existing credentials remain unchanged when the value is left blank." : ""}
        </p>
        <SecondaryButton
          type="button"
          onClick={saveAdapters}
          isPending={isSaving}
          className="w-full sm:w-auto"
        >
          Save custom models
        </SecondaryButton>
      </div>
    </section>
  );
}
