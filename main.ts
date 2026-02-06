import { Plugin } from "obsidian";

export default class MyLocPlugin extends Plugin {
	async onload() {
		console.log("MyLoc: loaded");
	}

	onunload() {
		console.log("MyLoc: unloaded");
	}
}
