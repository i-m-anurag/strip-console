---
"strip-console": major
---

Options are now validated. An unknown option or a value of the wrong type throws a `TypeError` that names it and suggests the right name for a typo, instead of being silently ignored. The CLI prints the error, names the config file, and exits with code 2.
