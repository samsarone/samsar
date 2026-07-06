// PublishOptionsDialog.js
import { useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../../../../utils/web';
import { useColorMode } from '../../../../contexts/ColorMode.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

export default function PublishOptionsDialog(props) {
  const { onSubmit, onClose, extraProps } = props;
  const { colorMode } = useColorMode();

  const [, setSessionMetadata] = useState(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

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

      const sessionMeta = resData.data;
      setSessionMetadata(sessionMeta);

      // Populate fields if present
      setTitle(sessionMeta.title || '');
      setDescription(sessionMeta.description || '');
      // Convert tags array to a comma-separated string if present
      setTags(sessionMeta.tags ? sessionMeta.tags.join(', ') : '');
    } catch  {
      
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ title, description, tags, id: extraProps.sessionId });
  };

  const dialogClassName = colorMode === 'dark'
    ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_14px_36px_rgba(0,0,0,0.4)]'
    : 'bg-white text-slate-900 border border-slate-200';
  const labelClassName = colorMode === 'dark' ? 'text-slate-200' : 'text-slate-600';
  const fieldClassName = colorMode === 'dark'
    ? 'border-[#1f2a3d] bg-[#111a2f] text-slate-100'
    : 'border-slate-200 bg-white text-slate-900';
  const cancelButtonClassName = colorMode === 'dark'
    ? 'bg-[#111a2f] text-slate-100 border border-[#1f2a3d] hover:border-rose-400/30'
    : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200';

  return (
    <div className={`p-4 w-full max-w-sm rounded-xl ${dialogClassName}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold">Publish Options</h2>
        {/* Button in the top-right corner */}
        <button
          type="button"
          onClick={generateMeta}
          className="px-3 py-1 rounded text-sm bg-rose-500 text-white hover:bg-rose-400"
        >
          Generate Meta
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className={`block text-sm font-medium mb-1 ${labelClassName}`}>
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full rounded p-2 ${fieldClassName}`}
          />
        </div>
        <div className="mb-3">
          <label className={`block text-sm font-medium mb-1 ${labelClassName}`}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`w-full rounded p-2 ${fieldClassName}`}
            rows={3}
          />
        </div>
        <div className="mb-3">
          <label className={`block text-sm font-medium mb-1 ${labelClassName}`}>
            Tags (comma-separated)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className={`w-full rounded p-2 ${fieldClassName}`}
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`mr-2 px-3 py-1 rounded text-sm ${cancelButtonClassName}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 rounded text-sm bg-rose-500 text-white hover:bg-rose-400"
          >
            Publish
          </button>
        </div>
      </form>
    </div>
  );
}
