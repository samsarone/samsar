
export function getCurrentEnvironment() {
  let currentEnv = process.env.CURRENT_ENV;
  if (currentEnv === 'staging' || currentEnv === 'docker') {
   return 'docker';
  }
  return 'server';
}
