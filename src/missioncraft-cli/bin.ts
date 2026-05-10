#!/usr/bin/env node
// @apnex/missioncraft CLI — `msn` entry point per Design v4.8 §2.3.2
// W0 scaffold: minimal entry point ensures `bin` field resolves + sovereign-module CLI/SDK separation established.
// W1+ waves implement actual CLI verb-handlers (create / list / show / start / apply / update / complete / abandon / tick / scope / workspace / config / join / leave per §2.3.2 Rule 1 reserved-verbs at v4.0).

import { VERSION } from '@apnex/missioncraft';

console.log(`missioncraft ${VERSION} — W0 scaffold; CLI verbs implemented in subsequent waves`);
