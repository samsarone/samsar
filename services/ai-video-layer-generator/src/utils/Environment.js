export function getCurrentEnvironment() {
  const currentEnv = process.env.CURRENT_ENV;
  if (currentEnv === 'docker' || currentEnv === 'staging'){
    return 'docker';
  }

  return 'server';
}
