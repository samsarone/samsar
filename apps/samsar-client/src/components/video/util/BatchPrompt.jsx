
import CommonButton from '../../common/CommonButton.tsx';
import { useColorMode } from '../../../contexts/ColorMode';

export default function BatchPrompt(props) {
  const { submitPromptList, defaultSceneDuration } = props;
  const { colorMode } = useColorMode();
  const fieldSurface =
    colorMode === 'light'
      ? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
      : 'bg-slate-900/70 text-slate-100 border border-white/10';
  return (
    <div>
      <form onSubmit={submitPromptList}>
        <div className='mt-2 text-sm font-bold'>
          <div className='inline-flex items-center'>
          Add Prompts
          </div>
          <div className='inline-flex items-center text-xs ml-4'>
            Duration
            <input
              type="number"
              name="duration"
              className={`w-20 ml-2 mr-2 px-3 py-1 rounded-md bg-transparent ${fieldSurface}`}
              placeholder="Enter duration per scene"
            defaultValue={defaultSceneDuration} />
          </div>  

         </div> 
        <textarea className={`${fieldSurface}
           h-auto min-h-64 overflow-y-scroll w-full mt-2 mb-2
          px-3 py-3 rounded-xl`} 
          name="promptList"
          placeholder='Enter the list of prompts separated by newlines.'></textarea>

        <CommonButton type="submit">
          Submit
        </CommonButton>
      </form>
    </div>
  )
}
