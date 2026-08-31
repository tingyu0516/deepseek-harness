import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPetPlugin, parsePetCharacterDocument } from "dsh-plugin-pet-core";
//#region src/index.ts
/** Hu Tao desktop pet: thin character entry over the shared pet engine. */
const require = createRequire(import.meta.url);
const characterPath = fileURLToPath(new URL("../assets/character.json", import.meta.url));
const live2dDir = fileURLToPath(new URL("../assets/live2d/", import.meta.url));
const plugin = createPetPlugin({
	pluginName: "desktop-pet-hutao",
	trayOrder: 30,
	loadCharacter: () => parsePetCharacterDocument(JSON.parse(readFileSync(characterPath, "utf8"))),
	loadHtmlPath: () => require.resolve("dsh-plugin-pet-core/pet.html"),
	loadLive2DDir: () => existsSync(live2dDir) ? live2dDir : void 0
});
const name = plugin.name;
const inject = plugin.inject;
const apply = plugin.apply;
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map