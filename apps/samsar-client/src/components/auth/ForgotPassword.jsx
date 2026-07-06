import { useState } from 'react';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import axios from 'axios';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function ForgotPassword(props) {
  const { setCurrentLoginView } = props;
  const { colorMode } = useColorMode();
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const formBgColor = colorMode === 'light' ? 'bg-neutral-50' : 'bg-neutral-900';
  const formTextColor = colorMode === 'light' ? 'text-neutral-900' : 'text-neutral-50';

  const handleForgotPassword = (e) => {
    e.preventDefault();
    const email = e.target.email.value;

    axios
      .post(`${PROCESSOR_SERVER}/users/forgot_password`, { email })
      .then(() => {
        setSuccess('Check your email for password reset instructions.');
        setError(null);
      })
      .catch(() => {
        
        setError('Failed to send reset email. Please try again.');
        setSuccess(null);
      });
  };

  return (
    <div className="w-[300px] m-auto mt-8">
      <div className="text-center font-bold text-2xl mb-4">Forgot Password</div>
      {error && <div className="text-red-500 text-center mb-4">{error}</div>}
      {success && <div className="text-blue-500 text-center mb-4">{success}</div>}
      <p className="text-neutral-500 text-center mb-6">
        Enter your email address below to reset your password.
      </p>
      <form onSubmit={handleForgotPassword} className="w-full">
        <div className="form-group">
          <div className="text-xs text-left font-bold pl-1">Email</div>
          <input
            type="email"
            name="email"
            className={`form-control mb-4 mt-2 rounded-lg p-1 pl-4 h-[45px] w-full ${formBgColor} ${formTextColor}`}
            placeholder="Email"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg"
        >
          Reset Password
        </button>
      </form>
      <div className="mt-4 text-center text-xs text-neutral-500">
        <a href="#" onClick={() => setCurrentLoginView('login')}>
          Back to Login
        </a>
      </div>
    </div>
  );
}
