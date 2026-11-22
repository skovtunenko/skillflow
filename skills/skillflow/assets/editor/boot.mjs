// What the server put into the page: {flow, skill, name, title, server, files}; flow and skill are paths in the page's file system.
export const boot = JSON.parse(document.getElementById("sf-editor").textContent);
