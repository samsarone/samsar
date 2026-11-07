import { useId } from 'react';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';
import { SUPPORTED_LANGUAGES } from '../../constants/supportedLanguages.js';

export default function LanguageSelect({ className = '' }) {
  const { language, setLanguage, tx } = useLocalization();
  const id = useId();
  return (
    <div className={`flex items-center justify-end gap-2 text-sm ${className}`}>
      <label htmlFor={id}>{tx('Language')}</label>
      <select id={id} value={language} onChange={(event) => setLanguage(event.target.value)}
        className="max-w-full rounded-lg border border-line-control bg-surface px-2 py-1.5 text-fg">
        {SUPPORTED_LANGUAGES.map(({ code, nativeName }) => <option key={code} value={code} lang={code}>{nativeName}</option>)}
      </select>
    </div>
  );
}
