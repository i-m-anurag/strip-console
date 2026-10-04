---
"strip-console": patch
---

The CLI now exits with code 2 and a one-line message for an unknown flag such as `--metods`, instead of crashing with a stack trace and exit code 1.
