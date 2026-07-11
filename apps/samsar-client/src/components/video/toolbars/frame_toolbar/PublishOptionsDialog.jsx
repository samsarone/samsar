// PublishOptionsDialog.js
import { useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../../../../utils/web';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

export default function PublishOptionsDialog(props) {
  const {
    onSubmit,
    onClose,
    extraProps,
    publishDraft,
    onDraftChange,
    isRepublish = false,
  } = props;
  const { colorMode } = useColorMode();

  const initialDraft = {
    title: publishDraft?.title ?? extraProps?.publishedTitle ?? '',
    description: publishDraft?.description ?? extraProps?.publishedDescription ?? '',
  };
  const [title, setTitle] = useState(initialDraft.title);
  const [description, setDescription] = useState(initialDraft.description);

  const generateMeta = async () => {
    try {
      const sessionId = extraProps.sessionId;
      const payload = { sessionId: sessionId };
      const headers = getHeaders();
      const resData = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/generate_meta`,
        payload,
        headers
      );

      const sessionMeta = resData.data || {};
      const generatedDraft = {
        title: sessionMeta.title || '',
        description: sessionMeta.description || '',
      };

      setTitle(generatedDraft.title);
      setDescription(generatedDraft.description);
      onDraftChange?.(generatedDraft);
    } catch  {
      // Keep the current draft when metadata generation fails.
    }
  };

  const updateDraftField = (field, value, setValue) => {
    setValue(value);
    onDraftChange?.({ [field]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ title, description, id: extraProps.sessionId });
  };

  const labelClassName = colorMode === 'dark' ? 'text-slate-200' : 'text-slate-700';
  const fieldClassName = colorMode === 'dark'
    ? 'border-[#2a3a57] bg-[#111a2f] text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-cyan-400/20'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-sky-500/20';
  const cancelButtonClassName = colorMode === 'dark'
    ? 'border border-[#2a3a57] bg-[#111a2f] text-slate-100 hover:bg-[#16213a]'
    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <div className="w-full text-left">
      <div className={`flex items-start justify-between gap-4 border-b pb-4 pr-10 ${colorMode === 'dark' ? 'border-[#243452]' : 'border-slate-200'}`}>
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${colorMode === 'dark' ? 'text-cyan-300' : 'text-sky-600'}`}>
            Gallery publication
          </p>
          <h2 className={`mt-1 text-xl font-semibold ${colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>
            {isRepublish ? 'Republish video' : 'Publish video'}
          </h2>
          <p className={`mt-1 text-sm ${colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
            Add the details viewers will see in the public gallery.
          </p>
        </div>
        <button
          type="button"
          onClick={generateMeta}
          className="shrink-0 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
        >
          Generate metadata
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="publish-title" className={`block text-sm font-medium ${labelClassName}`}>
            Title
          </label>
          <input
            id="publish-title"
            type="text"
            value={title}
            onChange={(e) => updateDraftField('title', e.target.value, setTitle)}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${fieldClassName}`}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="publish-description" className={`block text-sm font-medium ${labelClassName}`}>
            Description
          </label>
          <textarea
            id="publish-description"
            value={description}
            onChange={(e) => updateDraftField('description', e.target.value, setDescription)}
            className={`w-full resize-y rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${fieldClassName}`}
            rows={4}
          />
        </div>

        <div className={`flex justify-end gap-3 border-t pt-4 ${colorMode === 'dark' ? 'border-[#243452]' : 'border-slate-200'}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 ${cancelButtonClassName}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
          >
            {isRepublish ? 'Republish' : 'Publish'}
          </button>
        </div>
      </form>
    </div>
  );
}
