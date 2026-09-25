# Security and data handling

## Reporting a concern

Do not put credentials, private saves, exploit instructions or an unpatched
vulnerability in a public issue.

Check the repository's [Security page](https://github.com/appunni-m/tripelkins/security).
If **Report a vulnerability** is available, use that private channel. If it is
unavailable, open an issue containing only a request for a private reporting
channel, with no sensitive details, and wait for the maintainer to provide one.
Private reporting availability and a dedicated contact have not been confirmed;
this is an outstanding maintainer task. No response-time commitment is published.

For a private report, include the affected URL/revision, browser, reproduction
steps and impact. Use a disposable colony. Never include an API key, even in a
private report. Revoke an exposed provider key through the provider.

## Version scope

The project deploys `main` through GitHub Pages. It has no published long-term
support schedule or separately supported historical versions. The deployment
manifest identifies the published commit. A passing test or asset hash is not a
security certification.

## What is stored and sent

| Data or activity | Boundary |
| --- | --- |
| World, goals, names, conversations and bounded history | Browser IndexedDB on this origin; no cloud save service |
| Local model files and interrupted-download checkpoints | Browser-managed storage; subject to quota and eviction |
| Laya inference | Local WASM/WebGPU model workers |
| Microphone recording | Local capture/transcription worker; not saved in world files or uploaded |
| Hosted intelligence | Bounded context, including relevant commands/transcripts, sent to the configured endpoint |
| Provider API key | In-memory value in the current tab; sent as authorization to the configured provider; omitted from saves/exports |
| Fonts | Requested from Google Fonts |
| Approved model downloads | Requested from Hugging Face and its download delivery endpoints |
| Game and runtime files | Requested from the site host |

Local inference still needs network access for uncached assets. The host and
external services receive ordinary connection/request information. This guide
does not make claims about their independent retention policies.

Only configure a hosted endpoint you trust: it receives the key and request
context. A key in tab memory is still available to the running page; the game
cannot protect it from malicious browser extensions or a compromised device.
Shared-origin tabs share storage. Writer-conflict protections and hidden-tab
pauses are not separate accounts or access control.

Exported worlds can contain names and conversation history. Review a file before
sharing it. Make a backup before clearing site data, changing origins or removing
a browser profile. Clearing browser storage can remove saves and model caches.

For loading and recovery problems, use [troubleshooting](docs/TROUBLESHOOTING.md).
