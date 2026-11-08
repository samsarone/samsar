import { useInRouterContext } from 'react-router-dom';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import OverflowContainer from '../common/OverflowContainer.tsx';
import { VIDGENIE_PAGE_CLASS } from './vidgenieLayout.js';
import './mobileStyles.css';

// Keep navigation and the page surface mounted while auth, code, and session
// data resolve. Only the content inside the page changes from loading to ready.
export default function VidgeniePageShell({ children }) {
  const { colorMode } = useColorMode();
  const inRouter = useInRouterContext();
  const surface = colorMode === 'dark'
    ? 'bg-[#0c0d12] bg-[linear-gradient(180deg,#15171f_0%,#12141c_44%,#0c0d12_100%)]'
    : 'bg-gradient-to-b from-[#e9edf7] via-[#e4ebf8] to-[#f7fbff]';
  const content = <div className={VIDGENIE_PAGE_CLASS}>{children}</div>;
  return (
    <div className={`vidgenie-page-surface min-h-screen text-fg ${surface}`}>
      {inRouter ? <OverflowContainer>{content}</OverflowContainer> : content}
    </div>
  );
}
