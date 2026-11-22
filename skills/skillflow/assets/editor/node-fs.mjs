// node:fs for the editor page: the files the server put into the page. The import map gives this module to validate.mjs and render.mjs.
import {boot} from "./boot.mjs";
import {memoryFs} from "./memory-fs.mjs";

export const {lstatSync, readdirSync, readFileSync, realpathSync, replaceFolder, statSync, writeFileSync} = memoryFs(boot.files);
