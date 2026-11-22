// Where the editor saves the flow: the server that serves the page, or a file the person links in the browser.
// A store has save(base, text): {saved: true}, or {saved: false, disk} when the file no longer holds `base`.

export const serverStore = {
  async save(base, text) {
    let response;
    try { response = await fetch("flow", {method: "PUT", headers: {"content-type": "application/json"}, body: JSON.stringify({base, text})}); }
    catch { throw new Error("the editor server does not answer"); }
    const answer = await response.json();
    if (response.ok || response.status === 409) return answer;
    throw new Error(answer.error);
  },
};

/** True in a browser that can write to a file the person picks (Chromium); others download. */
export const canLink = () => typeof window.showSaveFilePicker === "function" && window.isSecureContext;

/** Ask the person for the flow file. Resolves to {store, disk}: the store of that file and the text it holds now. */
export async function linkFile(name) {
  const handle = await window.showSaveFilePicker({suggestedName: name, types: [{description: "SkillFlow file", accept: {"text/plain": [".kdl"]}}]});
  const read = async () => (await handle.getFile()).text();
  return {disk: await read(), store: {
    name: handle.name,
    async save(base, text) {
      const disk = await read();
      if (disk !== base) return {saved: false, disk};
      const file = await handle.createWritable();
      await file.write(text);
      await file.close();
      return {saved: true};
    },
  }};
}

export function download(name, text, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], {type}));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
