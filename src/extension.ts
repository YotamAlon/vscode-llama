import * as vscode from 'vscode';
import { OpenAI, ClientOptions } from 'openai';

import createMessages from './prompt';
import { ClientRequest } from 'http';


type AuthInfo = {address?: string};
export type Settings = {selectedInsideCodeblock?: boolean, pasteOnClick?: boolean, model?: string, maxTokens?: number, temperature?: number};


export function activate(context: vscode.ExtensionContext) {

	// Create a new llamafileViewProvider instance and register it with the extension's context
	const provider = new LlamafileViewProvider(context.extensionUri);

	// Get the API session token from the extension's configuration
	const config = vscode.workspace.getConfiguration('llamafile');
	// Put configuration settings into the provider
	provider.setAuthenticationInfo({
		address: config.get('address')
	});

	provider.setSettings({
		selectedInsideCodeblock: config.get('selectedInsideCodeblock') || false,
		pasteOnClick: config.get('pasteOnClick') || false,
		maxTokens: config.get('maxTokens') || 500,
		temperature: config.get('temperature') || 0.5,
		model: 'LLaMA_CPP'
	});

	// Register the provider with the extension's context
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(LlamafileViewProvider.viewType, provider,  {
			webviewOptions: { retainContextWhenHidden: true }
		})
	);


	const commandHandler = (command:string) => {
		const config = vscode.workspace.getConfiguration('llamafile');
		const prompt = config.get(command) as string;
		provider.search(prompt);
	};

	// Register the commands that can be called from the extension's package.json
	context.subscriptions.push(
		vscode.commands.registerCommand('llamafile.ask', () =>
			vscode.window.showInputBox({ prompt: 'What do you want to do?' })
			.then((value) => provider.search(value))
		),
		vscode.commands.registerCommand('llamafile.explain', () => commandHandler('promptPrefix.explain')),
		vscode.commands.registerCommand('llamafile.refactor', () => commandHandler('promptPrefix.refactor')),
		vscode.commands.registerCommand('llamafile.optimize', () => commandHandler('promptPrefix.optimize')),
		vscode.commands.registerCommand('llamafile.findProblems', () => commandHandler('promptPrefix.findProblems')),
		vscode.commands.registerCommand('llamafile.documentation', () => commandHandler('promptPrefix.documentation'))
	);


	// Change the extension's settings when configuration is changed
	vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
		if (event.affectsConfiguration('llamafile.address')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setAuthenticationInfo({ address: config.get('address') });
			console.log("API address changed");
		} else if (event.affectsConfiguration('llamafile.selectedInsideCodeblock')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setSettings({ selectedInsideCodeblock: config.get('selectedInsideCodeblock') || false });
		} else if (event.affectsConfiguration('llamafile.pasteOnClick')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setSettings({ pasteOnClick: config.get('pasteOnClick') || false });
		} else if (event.affectsConfiguration('llamafile.maxTokens')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setSettings({ maxTokens: config.get('maxTokens') || 500 });
		} else if (event.affectsConfiguration('llamafile.temperature')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setSettings({ temperature: config.get('temperature') || 0.5 });
		} else if (event.affectsConfiguration('llamafile.model')) {
			const config = vscode.workspace.getConfiguration('llamafile');
			provider.setSettings({ model: config.get('model') || 'text-davinci-003' });
		}
	});
}





class LlamafileViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'llamafile.chatView';
	private _view?: vscode.WebviewView;

	private _openai?: OpenAI;

	private _response?: string;
	private _prompt?: string;
	private _fullPrompt?: string;
	private _currentMessageNumber = 0;

	private _settings: Settings = {
		selectedInsideCodeblock: false,
		pasteOnClick: true,
		maxTokens: 500,
		temperature: 0.5
	};
	private _apiConfiguration?: ClientOptions;
	private _address?: string;

	// In the constructor, we store the URI of the extension
	constructor(private readonly _extensionUri: vscode.Uri) {

	}

	// Set the session token and create a new API instance based on this token
	public setAuthenticationInfo(authInfo: AuthInfo) {
		this._address = authInfo.address;
		this._apiConfiguration = {baseURL: authInfo.address, apiKey: 'fake key'};
		this._newAPI();
	}

	public setSettings(settings: Settings) {
		this._settings = {...this._settings, ...settings};
	}

	public getSettings() {
		return this._settings;
	}

	// This private method initializes a new OpenAIAPI instance, using the address if it is set
	private _newAPI() {
		if (!this._apiConfiguration || !this._address) {
			console.warn("API address not set, please go to extension settings (read README.md for more info)");
		}else{
			this._openai = new OpenAI(this._apiConfiguration);
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		// set options for the webview, allow scripts
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		// set the HTML for the webview
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// add an event listener for messages received by the webview
		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'codeSelected':
					{
						// do nothing if the pasteOnClick option is disabled
						if (!this._settings.pasteOnClick) {
							break;
						}
						let code = data.value;
						//code = code.replace(/([^\\])(\$)([^{0-9])/g, "$1\\$$$3");
						const snippet = new vscode.SnippetString();
						snippet.appendText(code);
						// insert the code as a snippet into the active text editor
						vscode.window.activeTextEditor?.insertSnippet(snippet);
						break;
					}
				case 'prompt':
					{
						this.search(data.value);
					}
			}
		});
	}


	public async search(prompt?:string) {
		this._prompt = prompt;
		if (!prompt) {
			return;
		};

		// Check if the OpenAIAPI instance is defined
		if (!this._openai) {
			this._newAPI();
		}

		// focus llamafile activity from activity bar
		if (!this._view) {
			await vscode.commands.executeCommand('llamafile.chatView.focus');
		} else {
			this._view?.show?.(true);
		}

		let response = '';
		this._response = '';
		// Get the selected text of the active editor
		const selection = vscode.window.activeTextEditor?.selection;
		const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
		let messages = createMessages(prompt, this._settings, selectedText);

		if (!this._openai) {
			response = '[ERROR] API token not set, please go to extension settings to set it (read README.md for more info)';
		} else {
			// If successfully signed in
			console.log("sendMessage");

			// Make sure the prompt is shown
			this._view?.webview.postMessage({ type: 'setPrompt', value: this._prompt });
			this._view?.webview.postMessage({ type: 'addResponse', value: '...' });

			// Increment the message number
			this._currentMessageNumber++;

			try {
				let currentMessageNumber = this._currentMessageNumber;

				// Send the search prompt to the OpenAI API and store the response

				let completion = await this._openai.chat.completions.create({
					model: this._settings.model || 'LLaMA_CPP',
					messages: messages,
					temperature: this._settings.temperature,
					max_tokens: this._settings.maxTokens,
					stream: false
				})

				if (this._currentMessageNumber !== currentMessageNumber) {
					return;
				}

				response = completion.choices[0].message.content || '';

				// close unclosed codeblocks
				// Use a regular expression to find all occurrences of the substring in the string
				const REGEX_CODEBLOCK = new RegExp('\`\`\`', 'g');
				const matches = response.match(REGEX_CODEBLOCK);
				// Return the number of occurrences of the substring in the response, check if even
				const count = matches ? matches.length : 0;
				if (count % 2 !== 0) {
					//  append ``` to the end to make the last code block complete
					response += '\n\`\`\`';
				}

				response += `\n\n---\n`;
				// add error message if max_tokens reached
				if (completion.choices[0].finish_reason === 'length') {
					response += `\n[WARNING] The response was truncated because it reached the maximum number of tokens. You may want to increase the maxTokens setting.\n\n`;
				}
				response += `Tokens used: ${completion.usage?.total_tokens}`;

			} catch (error:any) {
				let e = '';
				if (error.response) {
					console.log(error.response.status);
					console.log(error.response.data);
					e = `${error.response.status} ${error.response.data.message}`;
				} else {
					console.log(error.message);
					e = error.message;
				}
				response += `\n\n---\n[ERROR] ${e}`;
			}
		}

		// Saves the response
		this._response = response;

		// Show the view and send a message to the webview with the response
		if (this._view) {
			this._view.show?.(true);
			this._view.webview.postMessage({ type: 'addResponse', value: response });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const microlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'microlight.min.js'));
		const tailwindUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'showdown.min.js'));
		const showdownUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'tailwind.min.js'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<script src="${tailwindUri}"></script>
				<script src="${showdownUri}"></script>
				<script src="${microlightUri}"></script>
				<style>
				.code {
					white-space: pre;
				}
				p {
					padding-top: 0.4rem;
					padding-bottom: 0.4rem;
				}
				/* overrides vscodes style reset, displays as if inside web browser */
				ul, ol {
					list-style: initial !important;
					margin-left: 10px !important;
				}
				h1, h2, h3, h4, h5, h6 {
					font-weight: bold !important;
				}
				</style>
			</head>
			<body>
				<input class="h-10 w-full text-white bg-stone-700 p-4 text-sm" placeholder="Ask llamafile something" id="prompt-input" />

				<div id="response" class="pt-4 text-sm">
				</div>

				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}