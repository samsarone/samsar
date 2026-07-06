export function getSessionType() {
  const CURRENT_ENV = import.meta.env.VITE_CURRENT_ENV;


  if (CURRENT_ENV === 'staging' || CURRENT_ENV === 'docker') {
    return 'docker';
  } else {
    return 'production';
  }
}
