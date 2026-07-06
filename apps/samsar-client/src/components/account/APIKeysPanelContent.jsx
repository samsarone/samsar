// src/components/account/APIKeysPanelContent.js

import { useState, useEffect } from 'react';
import axios from 'axios';
import { FaSave, FaTrash } from 'react-icons/fa';
import SecondaryButton from '../common/SecondaryButton.tsx';
import { getHeaders } from '../../utils/web.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useUser } from '../../contexts/UserContext.jsx';
const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

const API_KEY_EXPIRY_OPTIONS = [
  { label: '7 days', value: '7' },
  { label: '90 days', value: '90' },
  { label: '365 days', value: '365' },
  { label: 'Never', value: 'never' },
];

const API_KEY_LIMIT_OPTIONS = [
  { label: 'No limit', value: 'none' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Total', value: 'total' },
];

const getExpiryDateFromSelection = (selection) => {
  if (selection === 'never') {
    return null;
  }

  const days = Number.parseInt(selection, 10);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
};

const getLimitDraftFromKey = (keyItem = {}) => ({
  usageLimitPeriod: keyItem.usageLimitPeriod || 'none',
  usageLimit: keyItem.usageLimit ? String(keyItem.usageLimit) : '',
});

const buildLimitDrafts = (apiKeys = []) => (
  apiKeys.reduce((drafts, keyItem) => ({
    ...drafts,
    [keyItem._id]: getLimitDraftFromKey(keyItem),
  }), {})
);

const buildUsageLimitPayload = (usageLimitPeriod, usageLimit) => {
  if (usageLimitPeriod === 'none') {
    return {
      usageLimitPeriod: null,
      usageLimit: null,
    };
  }

  const numericLimit = Number(usageLimit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    throw new Error('Enter a positive credit limit.');
  }

  return {
    usageLimitPeriod,
    usageLimit: numericLimit,
  };
};

export default function APIKeysPanelContent() {
  const { colorMode } = useColorMode();
  const { user } = useUser();

  const textColor = colorMode === 'dark' ? 'text-neutral-100' : 'text-neutral-800';
  const secondaryTextColor = colorMode === 'dark' ? 'text-neutral-400' : 'text-neutral-500';
  const cardBgColor = colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white';
  const borderColor = colorMode === 'dark' ? 'border-[#1f2a3d]' : 'border-slate-200';
  const headerBg = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-50';

  const [apiKeys, setApiKeys] = useState([]);
  const [showKey, setShowKey] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState('never');
  const [selectedLimitPeriod, setSelectedLimitPeriod] = useState('none');
  const [selectedUsageLimit, setSelectedUsageLimit] = useState('');
  const [limitDrafts, setLimitDrafts] = useState({});
  const [savingLimitKeyId, setSavingLimitKeyId] = useState(null);

  useEffect(() => {
    if (user) {
      fetchAPIKeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchAPIKeys = async () => {
    setLoading(true);
    try {

      
      const headers = getHeaders();
      const response = await axios.get(`${PROCESSOR_SERVER}/users/api_keys`, headers);
      const apiKeyResponse = response.data.apiKeys || [];
      setApiKeys(apiKeyResponse);
      setLimitDrafts(buildLimitDrafts(apiKeyResponse));
    } catch  {
      
      toast.error('Failed to fetch API keys', {
        position: 'bottom-center',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    try {
      const headers = getHeaders();
      const expiresAt = getExpiryDateFromSelection(selectedExpiry);
      const payload = expiresAt ? { expiresAt } : {};
      const usageLimitPayload = buildUsageLimitPayload(selectedLimitPeriod, selectedUsageLimit);
      Object.assign(payload, usageLimitPayload);
      const response = await axios.post(`${PROCESSOR_SERVER}/users/api_keys`, payload, headers);
      const newKey = response.data.apiKey;
      setApiKeys((prevKeys) => [...prevKeys, newKey]);
      setLimitDrafts((prevDrafts) => ({
        ...prevDrafts,
        [newKey._id]: getLimitDraftFromKey(newKey),
      }));
      toast.success('API key created successfully!', {
        position: 'bottom-center',
      });
    } catch (error) {
      
      toast.error(error?.response?.data?.error || error?.message || 'Failed to create API key', {
        position: 'bottom-center',
      });
    }
  };

  const handleLimitDraftChange = (keyId, field, value) => {
    setLimitDrafts((prevDrafts) => ({
      ...prevDrafts,
      [keyId]: {
        ...prevDrafts[keyId],
        [field]: value,
      },
    }));
  };

  const handleSaveKeyLimit = async (keyId) => {
    const draft = limitDrafts[keyId] || { usageLimitPeriod: 'none', usageLimit: '' };
    try {
      setSavingLimitKeyId(keyId);
      const headers = getHeaders();
      const payload = buildUsageLimitPayload(draft.usageLimitPeriod, draft.usageLimit);
      const response = await axios.put(`${PROCESSOR_SERVER}/users/api_keys/${keyId}`, payload, headers);
      const updatedKey = response.data.apiKey;
      setApiKeys((prevKeys) => prevKeys.map((key) => (key._id === keyId ? updatedKey : key)));
      setLimitDrafts((prevDrafts) => ({
        ...prevDrafts,
        [keyId]: getLimitDraftFromKey(updatedKey),
      }));
      toast.success('API key limit updated!', {
        position: 'bottom-center',
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to update API key limit', {
        position: 'bottom-center',
      });
    } finally {
      setSavingLimitKeyId(null);
    }
  };

  const handleDeleteKey = async (keyId) => {
    try {
      const headers = getHeaders();
      await axios.delete(`${PROCESSOR_SERVER}/users/api_keys/${keyId}`, headers);
      setApiKeys((prevKeys) => prevKeys.filter((key) => key._id !== keyId));
      toast.success('API key deleted successfully!', {
        position: 'bottom-center',
      });
    } catch  {
      
      toast.error('Failed to delete API key', {
        position: 'bottom-center',
      });
    }
  };

  const toggleShowKey = (keyId) => {
    setShowKey((prevState) => ({
      ...prevState,
      [keyId]: !prevState[keyId],
    }));
  };

  const maskedKey = (key) => {
    const visibleChars = 6;
    if (key.length <= visibleChars * 2) {
      return '*'.repeat(key.length);
    }
    const start = key.slice(0, visibleChars);
    const end = key.slice(-visibleChars);
    const middle = '*'.repeat(key.length - visibleChars * 2);
    return `${start}${middle}${end}`;
  };

  const formatCredits = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return '0';
    }

    return numericValue.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  };

  const renderUsageSummary = (keyItem) => {
    const usage = keyItem.usage || {};
    if (keyItem.usageLimit && keyItem.usageLimitPeriod) {
      const used = keyItem.usageLimitPeriod === 'monthly'
        ? usage.monthlyCreditsUsed
        : usage.totalCreditsUsed;
      return `${formatCredits(used)} / ${formatCredits(keyItem.usageLimit)} credits`;
    }

    return `Monthly ${formatCredits(usage.monthlyCreditsUsed)} · Total ${formatCredits(usage.totalCreditsUsed)}`;
  };

  return (
    <div className={`flex min-w-0 flex-col flex-grow gap-4 ${textColor}`}>
      <ToastContainer />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-2xl font-bold">API Keys</h2>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 lg:flex lg:items-center lg:flex-wrap">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <label htmlFor="api-key-expiry" className={`text-sm ${secondaryTextColor}`}>
              Expiry
            </label>
            <select
              id="api-key-expiry"
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
              className={`w-full border ${borderColor} rounded px-3 py-2 sm:w-auto ${colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white'} ${textColor}`}
            >
              {API_KEY_EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-1 sm:col-span-2 sm:grid-cols-[auto_minmax(120px,1fr)_minmax(110px,0.6fr)] sm:items-center sm:gap-2 lg:col-span-1">
            <label htmlFor="api-key-limit-period" className={`text-sm ${secondaryTextColor}`}>
              Limit
            </label>
            <select
              id="api-key-limit-period"
              value={selectedLimitPeriod}
              onChange={(e) => setSelectedLimitPeriod(e.target.value)}
              className={`w-full border ${borderColor} rounded px-3 py-2 ${colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white'} ${textColor}`}
            >
              {API_KEY_LIMIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="1"
              value={selectedUsageLimit}
              disabled={selectedLimitPeriod === 'none'}
              onChange={(e) => setSelectedUsageLimit(e.target.value)}
              placeholder="Credits"
              className={`w-full border ${borderColor} rounded px-3 py-2 disabled:opacity-50 ${colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white'} ${textColor}`}
            />
          </div>
          <SecondaryButton onClick={handleCreateKey} className="w-full sm:w-auto">Create Key</SecondaryButton>
        </div>
      </div>
      {loading ? (
        <p className={secondaryTextColor}>Loading...</p>
      ) : apiKeys.length === 0 ? (
        <p className={`text-lg ${secondaryTextColor}`}>No API keys found.</p>
      ) : (
        <div className={`min-w-0 rounded-2xl border ${borderColor} ${cardBgColor} overflow-hidden shadow-sm`}>
          <div className={`flex flex-col gap-1 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between ${borderColor} ${headerBg}`}>
            <p className="text-lg font-semibold">Manage your API keys</p>
            <p className={`text-sm ${secondaryTextColor}`}>Store and rotate keys securely.</p>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-[900px] text-sm">
              <thead className={headerBg}>
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Index</th>
                  <th className="px-4 py-3 text-left font-semibold">Key</th>
                  <th className="px-4 py-3 text-left font-semibold">Created At</th>
                  <th className="px-4 py-3 text-left font-semibold">Expires At</th>
                  <th className="px-4 py-3 text-left font-semibold">Usage Limit</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((keyItem, index) => {
                  const rowBg =
                    index % 2 === 0
                      ? colorMode === 'dark'
                        ? 'bg-[#0b1224]'
                        : 'bg-slate-50'
                      : '';
                  return (
                    <tr key={keyItem._id} className={`border-t ${borderColor} ${rowBg}`}>
                      <td className="px-4 py-3">{index + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs break-all">
                            {showKey[keyItem._id]
                              ? keyItem.apiKey
                              : maskedKey(keyItem.apiKey)}
                          </span>
                          <button
                            onClick={() => toggleShowKey(keyItem._id)}
                            className={`rounded-md px-2 py-1 text-xs font-semibold border ${borderColor} ${colorMode === 'dark' ? 'hover:bg-[#0f1629]' : 'hover:bg-slate-100'}`}
                          >
                            {showKey[keyItem._id] ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </td>
                      <td className={`px-4 py-3 ${secondaryTextColor}`}>
                        {new Date(keyItem.createdAt).toLocaleString()}
                      </td>
                      <td className={`px-4 py-3 ${secondaryTextColor}`}>
                        {keyItem.expiresAt
                          ? new Date(keyItem.expiresAt).toLocaleString()
                          : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-[220px] flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={limitDrafts[keyItem._id]?.usageLimitPeriod || 'none'}
                              onChange={(e) => handleLimitDraftChange(keyItem._id, 'usageLimitPeriod', e.target.value)}
                              className={`border ${borderColor} rounded px-2 py-1 ${colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white'} ${textColor}`}
                            >
                              {API_KEY_LIMIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={limitDrafts[keyItem._id]?.usageLimit || ''}
                              disabled={(limitDrafts[keyItem._id]?.usageLimitPeriod || 'none') === 'none'}
                              onChange={(e) => handleLimitDraftChange(keyItem._id, 'usageLimit', e.target.value)}
                              placeholder="Credits"
                              className={`w-24 min-w-0 border ${borderColor} rounded px-2 py-1 disabled:opacity-50 ${colorMode === 'dark' ? 'bg-[#0f1629]' : 'bg-white'} ${textColor}`}
                            />
                            <button
                              type="button"
                              aria-label="Save API key limit"
                              title="Save API key limit"
                              disabled={savingLimitKeyId === keyItem._id}
                              onClick={() => handleSaveKeyLimit(keyItem._id)}
                              className={`rounded-md p-2 border ${borderColor} disabled:opacity-50 ${colorMode === 'dark' ? 'hover:bg-[#0f1629]' : 'hover:bg-slate-100'}`}
                            >
                              <FaSave />
                            </button>
                          </div>
                          <p className={`text-xs ${secondaryTextColor}`}>{renderUsageSummary(keyItem)}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteKey(keyItem._id)}
                          className="text-red-500 hover:text-red-600 focus:outline-none"
                        >
                          <FaTrash />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
