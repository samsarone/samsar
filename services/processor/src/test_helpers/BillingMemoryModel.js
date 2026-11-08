export const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
export function set(object, path, value) {
  const parts = path.split('.'); const last = parts.pop(); let target = object;
  for (const key of parts) target = target[key] ||= {};
  target[last] = clone(value);
}
export function matches(object, filter = {}) {
  if (!object) return false;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some(item => matches(object, item));
    if (key === '$and') return condition.every(item => matches(object, item));
    const value = get(object, key);
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      return Object.entries(condition).every(([op, expected]) => {
        if (op === '$exists') return (value !== undefined) === expected;
        if (op === '$gte') return value >= expected;
        if (op === '$ne') return value !== expected;
        if (op === '$in') return expected.includes(value);
        if (op === '$nin') return !expected.includes(value);
        throw new Error(`Unsupported test operator: ${op}`);
      });
    }
    return condition === null ? value == null : String(value) === String(condition);
  });
}
export function applyUpdate(object, update, { inserting = false } = {}) {
  for (const [path, value] of Object.entries({ ...(inserting ? update.$setOnInsert : {}), ...update.$set })) set(object, path, value);
  for (const [path, value] of Object.entries(update.$inc || {})) set(object, path, (Number(get(object, path)) || 0) + value);
  for (const path of Object.keys(update.$unset || {})) {
    const parts = path.split('.'); const key = parts.pop(); const target = parts.length ? get(object, parts.join('.')) : object;
    if (target) delete target[key];
  }
  return clone(object);
}
export function query(value) {
  const snapshot = clone(value);
  return { select() { return this; }, sort() { return this; }, lean: async () => clone(snapshot),
    then(resolve, reject) { return Promise.resolve(clone(snapshot)).then(resolve, reject); } };
}
