
import OverflowContainer from '../common/OverflowContainer.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import QuickEditor from './QuickEditor';

export default function QuickEditorHome() {


  const { colorMode } = useColorMode();

  const bgColor = colorMode === 'dark' ? 'bg-gray-900' : 'bg-gray-100';
  return (
    <div className={`${bgColor}`}>
      <OverflowContainer>
        <div className='container m-auto'>
          <QuickEditor />
        </div>
      </OverflowContainer>
    </div>
  )
}