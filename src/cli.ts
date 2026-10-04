import { cac } from 'cac';
import pkg from '../package.json' with { type: 'json' };

function createCli() {
  const cli = cac('strip-console');
  cli.help();
  cli.version(pkg.version);
  return cli;
}

const cli = createCli();
cli.parse();
if (!cli.matchedCommand && !cli.options.help && !cli.options.version) {
  cli.outputHelp();
}
