/*
 * nativeMenus – OS native menus (tray menu, context menu, menu bar etc.)
 */
import {
	app,
	Menu,
	BrowserWindow,
	MenuItem,
	Tray,
	shell,
	nativeImage, // Static methods, that initializes class (NativeImage).
	NativeImage, // Class, used after initialization and for types.
	MenuItemConstructorOptions,
	clipboard,
	WebContents
} from 'electron';

import {
	getBuildInfo,
	appInfo
} from './client';

import { AppConfig } from './config';

const appConfig = new AppConfig()

import { loadNodeAddons, loadChromeAddons } from './addons';
import fetch from 'electron-fetch';
import * as os from 'os';
import { EventEmitter } from 'events';
import { createGithubIssue } from '../../modules/bug';
import l10n from '../../modules/l10n';
import loadSettingsWindow from '../windows/settings';
import loadDocsWindow from '../windows/docs';

const sideBar = new EventEmitter();
const devel = getBuildInfo().type === 'devel';

sideBar.on('hide', async (contents: WebContents) => {
	const cssKey = await contents.insertCSS(".sidebar-2K8pFh{ width: 0px !important; }");
	sideBar.once('show', () => {
		contents.removeInsertedCSS(cssKey);
	});
});

let wantQuit = false;

// Contex Menu with spell checker

export function context(windowName: BrowserWindow): void {
	const strings = (new l10n()).client;
	windowName.webContents.on('context-menu', (event, params) => {
		const cmenu: (MenuItemConstructorOptions | MenuItem)[] = [
			{ type: 'separator' },
			{ label: strings.context.cut, role: 'cut', enabled: params.editFlags.canCut },
			{ label: strings.context.copy, role: 'copy', enabled: params.editFlags.canCopy },
			{ label: strings.context.paste, role: 'paste', enabled: params.editFlags.canPaste },
			{ type: 'separator' }
		];
		let position = 0;
		for (const suggestion of params.dictionarySuggestions) {
			cmenu.splice(++position, 0, {
				label: suggestion,
				click: () => windowName.webContents.replaceMisspelling(suggestion)
			});
		}
		if (params.misspelledWord) {
			cmenu.splice(++position, 0, { type: 'separator' });
			cmenu.splice(++position, 0, {
				label: strings.context.dictionaryAdd,
				click: () => windowName.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
			});
			cmenu.splice(++position, 0, { type: 'separator' });
		}
		if (params.linkURL) {
			cmenu.push({
				label: strings.context.copyURL,
				click: () => clipboard.writeText(params.linkURL)
			});
			if (params.linkText) cmenu.push({
				label: strings.context.copyURLText,
				click: () => clipboard.writeText(params.linkText)
			});
			cmenu.push({ type: 'separator' });
		}
		if (devel || appConfig.get().devel) {
			cmenu.push({
				label: strings.context.inspectElement,
				click: () => windowName.webContents.inspectElement(params.x, params.y)
			});
			cmenu.push({ type: 'separator' });
		}
		Menu.buildFromTemplate(cmenu).popup({
			window: windowName,
			x: params.x,
			y: params.y
		});
	});
}

let funMode = false;
const today = new Date();
if (os.userInfo().username == 'pi' && today.getDate() == 14 && today.getMonth() == 2) {
	funMode = true; // Happy π day!
}

// Tray menu

export async function tray(windowName: BrowserWindow): Promise<Tray> {
	const strings = (new l10n()).client;
	const tray = new Tray(appInfo.trayIcon);
	let icon: NativeImage;
	if (funMode) {
		icon = nativeImage.createFromBuffer(await (await fetch('https://raw.githubusercontent.com/iiiypuk/rpi-icon/master/16.png')).buffer());
	} else {
		icon = nativeImage.createFromPath(appInfo.icon);
	}
	function toogleVisibility() {
		if(windowName.isVisible() && windowName.isFocused()) {
			windowName.hide();
		} else if (!windowName.isVisible()) {
			windowName.show();
		} else {
			windowName.focus();
		}
	}
	const contextMenu = Menu.buildFromTemplate([
		{
			label: app.getName(),
			enabled: false,
			icon,
		},
		{ type: 'separator' },
		{
			label: strings.help.about,
			role: 'about',
			click: app.showAboutPanel
		},
		{
			label: strings.help.docs,
			click: () => loadDocsWindow(windowName)
		},
		{
			label: strings.help.bugs,
			click: () => createGithubIssue()
		},
		{ type: 'separator' },
		{
			label: strings.tray.toggle,
			click: toogleVisibility
		},
		{
			label: strings.tray.quit,
			click: function () {
				wantQuit = true;
				app.quit();
			}
		}
	]);
	tray.setContextMenu(contextMenu);
	tray.setToolTip(app.getName());
	tray.on("click", toogleVisibility);
	// Exit to the tray
	windowName.on('close', (event) => {
		if (!wantQuit) {
			event.preventDefault();
			windowName.hide();
		}
	});
	return tray;
}

// Menu Bar

export function bar(repoLink: string, mainWindow: BrowserWindow): Menu {
	const strings = (new l10n()).client;
	const webLink = repoLink.substring(repoLink.indexOf("+") + 1);
	const menu = Menu.buildFromTemplate([
		// File
		{
			label: strings.menubar.file.groupName, submenu: [
				// Settings
				{
					label: strings.settings.title,
					click: () => loadSettingsWindow(mainWindow)
				},
				// Extensions (Work In Progress state)
				{
					label: strings.menubar.file.addon.groupName, visible: devel || appConfig.get().devel, submenu: [
						// Node-based extensions
						{
							label: strings.menubar.file.addon.loadNode,
							enabled: devel,
							click: () => loadNodeAddons(mainWindow)
						},
						// Chrome/Chromium extensions
						{
							label: strings.menubar.file.addon.loadChrome,
							enabled: devel,
							click: () => loadChromeAddons(mainWindow)
						}
					]
				},
				{ type: 'separator' },
				// Reset
				{
					label: strings.menubar.file.relaunch,
					accelerator: 'CmdOrCtrl+Alt+R',
					click: () => {
						wantQuit = true;
						const newArgs:string[] = [];
						for (const arg of process.argv) {
							let willBreak = false;
							for (const sw of ['start-minimized', 'm'])
								if(arg.includes('-') && arg.endsWith(sw)) {
									willBreak = true;
									break;
								}
							if (willBreak) break;
							newArgs.push(arg);
						}
						newArgs.shift();
						app.relaunch({
							args: newArgs, 
						});
						app.quit();
					}
				},
				// Quit
				{
					label: strings.menubar.file.quit,
					accelerator: 'CmdOrCtrl+Q',
					click: () => {
						wantQuit = true;
						app.quit();
					}
				}
			]
		},
		// Edit
		{ role: 'editMenu', label: strings.menubar.edit.groupName, submenu: [
			{ label: strings.menubar.edit.undo, role: 'undo' },
			{ label: strings.menubar.edit.redo, role: 'redo' },
			{ type: 'separator' },
			{ label: strings.context.cut, role: 'cut' },
			{ label: strings.context.copy, role: 'copy' },
			{ label: strings.context.paste, role: 'paste' }
		]},
		// View
		{
			label: strings.menubar.view.groupName, submenu: [
				// Reload
				{ label: strings.menubar.view.reload, role: 'reload' },
				// Force reload
				{ label: strings.menubar.view.forceReload, role: 'forceReload' },
				{ type: 'separator' },
				// DevTools
				{
					label: strings.menubar.view.devTools,
					id: 'devTools',
					role: 'toggleDevTools',
					enabled: devel || appConfig.get().devel
				},
				{ type: 'separator' },
				// Zoom settings (reset, zoom in, zoom out)
				{ label: strings.menubar.view.resetZoom, role: 'resetZoom' },
				{ label: strings.menubar.view.zoomIn, role: 'zoomIn' },
				{ label: strings.menubar.view.zoomOut, role: 'zoomOut' },
				{ type: 'separator' },
				// Toggle full screen
				{ label: strings.menubar.view.fullScreen, role: 'togglefullscreen' }
			]
		},
		// Window
		{
			label: strings.menubar.window.groupName, submenu: [
			// Hide side bar
			{
				label: strings.menubar.window.mobileMode,
				type: 'checkbox',
				accelerator: 'CmdOrCtrl+Alt+M',
				checked: false,
				click: async () => {
					if ((sideBar.listenerCount('show') + sideBar.listenerCount('hide')) > 1) {
						sideBar.emit('show');
					} else {
						sideBar.emit('hide', mainWindow.webContents);
					}
				}
			}
			]
		},
		// Help
		{
			label: strings.help.groupName, role: 'help', submenu: [
				// About
				{ label: strings.help.about, role: 'about', click: () => app.showAboutPanel() },
				// Repository
				{ label: strings.help.repo, click: () => shell.openExternal(webLink) },
				// Documentation
				{ label: strings.help.docs, click: () => loadDocsWindow(mainWindow) },
				// Report a bug
				{ label: strings.help.bugs, click: () => createGithubIssue() }
			]
		}
	]);
	Menu.setApplicationMenu(menu);
	return menu;
}