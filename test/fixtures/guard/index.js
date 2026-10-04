// The method name is only known at runtime, so static stripping cannot see this call.
const method = ['lo', 'g'].join('');
console.log('static call');
console[method]('dynamic call');
console.warn('warn stays');
