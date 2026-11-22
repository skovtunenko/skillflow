// Finds the SkillFlow skill folder from this file, so the same tests run in both repository layouts:
// build/<path>/tests mirrors skills/<path> (private: build/productivity/skillflow, public: build/skillflow).
// Run the whole suite from the repository root, in either layout (quote the pattern; node expands it):
//   node --test "build/**/skillflow/tests/*.test.mjs"
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const BUILD = path.dirname(import.meta.dirname), at = BUILD.lastIndexOf(`${path.sep}build${path.sep}`);
/** The repository root. */
export const ROOT = BUILD.slice(0, at);
/** The skill folder: skills/<the path of this build folder below build/>. */
export const SKILL = path.join(ROOT, "skills", BUILD.slice(at + `${path.sep}build${path.sep}`.length));
if (at < 0 || !fs.existsSync(path.join(SKILL, "SKILL.md"))) throw new Error(`no SkillFlow skill folder at ${SKILL}: the tests expect build/<path>/tests next to skills/<path>`);
/** The file URL of a file in the skill folder, for import(). */
export const skillUrl = (file) => pathToFileURL(path.join(SKILL, file)).href;
