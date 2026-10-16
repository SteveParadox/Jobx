import { assertRuntime, env } from '../src/lib/config';
assertRuntime();
console.log(
  'Core environment valid for ' +
    env.APP_ENV +
    '. Optional provider connectivity and permissions require staging verification.',
);
