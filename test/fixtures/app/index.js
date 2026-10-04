import { greet } from './util.js';

export function main(name) {
  console.log('main called', name);
  console.error('errors stay');
  /* keep */ console.log('kept on purpose');
  return greet(name);
}
