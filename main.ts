import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	ButtonComponent,
	TextComponent,
	TextAreaComponent,
	ExtraButtonComponent,
	FuzzySuggestModal, FuzzyMatch
} from 'obsidian';

interface Prompt {
	id: string;
	name: string;
	body: string;
	systemPrompt?: string;
}

interface OllamaTranscriptProcessorSettings {
	prompts: Prompt[];
	defaultModel: string;
	ollamaHost: string;
	lastUsedPromptId: string | null;
}

const DEFAULT_SETTINGS: OllamaTranscriptProcessorSettings = {
	prompts: [
		{
			id: 'default',
			name: 'Summarize Meeting',
			body: 'Create concise, well-structured notes from the following meeting transcript. Include key points, decisions, action items, and important details. Organize the information logically with clear headings.',
			systemPrompt: 'You are a professional note-taker with expertise in creating clear, organized summaries of meetings.'
		}
	],
	defaultModel: 'gemma:3b',
	ollamaHost: 'http://localhost:11434',
	lastUsedPromptId: null
}

interface OllamaModel {
	name: string;
	modified_at: string;
	size: number;
}

interface OllamaResponse {
	model: string;
	created_at: string;
	response: string;
	done: boolean;
}

interface OllamaModelInfo {
	parameters: {
		context_length: number;
		[key: string]: any;
	};

	[key: string]: any;
}

class OllamaService {
	private readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl;
	}

	async getModels(): Promise<string[]> {
		try {
			const response = await fetch(`${this.baseUrl}/api/tags`);
			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.statusText}`);
			}
			const data = await response.json();
			return data.models.map((model: OllamaModel) => model.name);
		} catch (error) {
			console.error("Error fetching Ollama models:", error);
			throw error;
		}
	}

	async getModelInfo(model: string): Promise<OllamaModelInfo> {
		try {
			const response = await fetch(`${this.baseUrl}/api/show`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					name: model
				}),
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch model info: ${response.statusText}`);
			}

			const data = await response.json() as OllamaModelInfo;
			return data;
		} catch (error) {
			console.error(`Error fetching info for model ${model}:`, error);
			throw error;
		}
	}

	// Simple token count estimation - roughly 4 characters per token
	estimateTokenCount(text: string): number {
		return Math.ceil(text.length / 4);
	}

	async generateText(model: string, prompt: string, systemPrompt: string): Promise<string> {
		try {
			// Get model info to check context window size
			const modelInfo = await this.getModelInfo(model);
			const contextLength = modelInfo.parameters.context_length;

			// Estimate token count for prompt and system prompt
			const combinedText = prompt + (systemPrompt ? "\n" + systemPrompt : "");
			const estimatedTokens = this.estimateTokenCount(combinedText);

			// Check if estimated tokens exceed context window
			if (estimatedTokens >= contextLength) {
				throw new Error(`Input exceeds model's context window (${estimatedTokens} tokens > ${contextLength} tokens). Please reduce the size of your input.`);
			}

			const response = await fetch(`${this.baseUrl}/api/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: model,
					prompt: prompt,
					system: systemPrompt,
					stream: false
				}),
			});

			if (!response.ok) {
				throw new Error(`Failed to generate text: ${response.statusText}`);
			}

			const data = await response.json() as OllamaResponse;
			return data.response;
		} catch (error) {
			console.error("Error generating text with Ollama:", error);
			throw error;
		}
	}
}

export default class OllamaTranscriptProcessor extends Plugin {
	settings: OllamaTranscriptProcessorSettings;
	ollamaService: OllamaService;

	async onload() {
		await this.loadSettings();

		// Initialize Ollama service
		this.updateOllamaService();

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon('file-text', 'Process with LLM prompt', (evt: MouseEvent) => {
			this.openPromptSelectionModal();
		});

		// Add commands
		this.addCommand({
			id: 'process-with-llm-prompt',
			name: 'Process with LLM prompt...',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.openPromptSelectionModal();
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 're-run-last-prompt',
			name: 'Re-run last prompt',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView && this.settings.lastUsedPromptId) {
					if (!checking) {
						const lastPrompt = this.settings.prompts.find(p => p.id === this.settings.lastUsedPromptId);
						if (lastPrompt) {
							this.processTranscriptWithPrompt(lastPrompt);
						} else {
							new Notice('Last used prompt not found. Please select a prompt first.');
						}
					}
					return true;
				}
				return false;
			}
		});

		// Add settings tab
		this.addSettingTab(new OllamaSettingTab(this.app, this));
	}

	onunload() {
		// Clean up any resources
	}

	updateOllamaService() {
		this.ollamaService = new OllamaService(this.settings.ollamaHost);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	openPromptSelectionModal() {
		new PromptSelectionModal(this.app, this, (prompt) => {
			this.processTranscriptWithPrompt(prompt);
		}).open();
	}

	async processTranscriptWithPrompt(prompt: Prompt) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active markdown view');
			return;
		}

		const editor = activeView.editor;
		const noteText = editor.getValue();

		if (!noteText.trim()) {
			new Notice('The note is empty');
			return;
		}

		// Save the last used prompt ID
		this.settings.lastUsedPromptId = prompt.id;
		await this.saveSettings();

		// Show processing notification
		const processingNotice = new Notice('Processing transcript with Ollama...', 0);

		try {
			// Prepare the prompt with the transcript
			const fullPrompt = `${prompt.body}
			\n
			====TEXT_BEGIN====\n
			${noteText}
			====TEXT_END====
			`;

			// Call Ollama API
			const response = await this.ollamaService.generateText(
				this.settings.defaultModel,
				fullPrompt,
				prompt.systemPrompt || ""  // Use the prompt's system instruction
			);

			// Format the note with the AI response
			const formattedNote = this.formatProcessedNote(noteText, response);

			// Update the note content
			editor.setValue(formattedNote);

			// Set cursor position to the beginning of the AI Notes section
			const aiNotesPosition = formattedNote.indexOf('## AI Notes') + 11;
			editor.setCursor(editor.offsetToPos(aiNotesPosition));

			// Close the processing notice
			processingNotice.hide();

			// Show success notice
			new Notice('Transcript processed successfully');
		} catch (error) {
			// Close the processing notice
			processingNotice.hide();

			// Show error notice
			new Notice(`Error processing transcript: ${(error as Error).message}`);
			console.error('Error processing transcript:', error);
		}
	}

	formatProcessedNote(originalText: string, aiResponse: string): string {
		// Format the original text as a collapsible block
		const originalBlock = originalText.split('\n')
			.map(line => `> ${line}`)
			.join('\n');

		// Combine into the final format
		return `
# AI Notes
${aiResponse}

# Original Transcript
> [!details] ORIGINAL TRANSCRIPTION
${originalBlock}

`;
	}
}

class PromptSelectionModal extends FuzzySuggestModal<Prompt> {
	plugin: OllamaTranscriptProcessor;
	prompts: Prompt[];
	onChoosePrompt: (prompt: Prompt) => void;

	constructor(app: App, plugin: OllamaTranscriptProcessor, onChoosePrompt: (prompt: Prompt) => void) {
		super(app);
		this.plugin = plugin;
		this.prompts = plugin.settings.prompts;
		this.onChoosePrompt = onChoosePrompt;
		this.setPlaceholder("Select a prompt or create a new one");
	}

	getItems(): Prompt[] {
		return this.prompts;
	}

	getItemText(prompt: Prompt): string {
		return prompt.name;
	}

	onChooseItem(prompt: Prompt, evt: MouseEvent | KeyboardEvent): void {
		this.onChoosePrompt(prompt);
	}

	renderSuggestion(item: FuzzyMatch<Prompt>, el: HTMLElement): void {
		super.renderSuggestion(item, el);

		// Add buttons for edit and delete
		const buttonsContainer = el.createDiv({cls: "prompt-buttons"});

		const editButton = new ExtraButtonComponent(buttonsContainer)
			.setIcon("pencil")
			.setTooltip("Edit prompt")
			.onClick(() => {
				this.close();
				new PromptEditModal(this.app, this.plugin, item.item, (updatedPrompt) => {
					// Update the prompt in settings
					const index = this.plugin.settings.prompts.findIndex(p => p.id === updatedPrompt.id);
					if (index !== -1) {
						this.plugin.settings.prompts[index] = updatedPrompt;
						this.plugin.saveSettings();
					}
					// Reopen the selection modal
					new PromptSelectionModal(this.app, this.plugin, this.onChoosePrompt).open();
				}).open();
			});

		const deleteButton = new ExtraButtonComponent(buttonsContainer)
			.setIcon("trash")
			.setTooltip("Delete prompt")
			.onClick(() => {
				// Confirm deletion
				if (confirm(`Are you sure you want to delete the prompt "${item.item.name}"?`)) {
					// Remove the prompt from settings
					this.plugin.settings.prompts = this.plugin.settings.prompts.filter(p => p.id !== item.item.id);
					this.plugin.saveSettings();
					// Refresh the modal
					this.prompts = this.plugin.settings.prompts;
					this.close();
					new PromptSelectionModal(this.app, this.plugin, this.onChoosePrompt).open();
				}
			});
	}

	onOpen(): void {
		super.onOpen();

		// Add a button to create a new prompt
		const {contentEl} = this;
		const newPromptButton = new ButtonComponent(contentEl)
			.setButtonText("New Prompt")
			.onClick(() => {
				this.close();
				const newPrompt: Prompt = {
					id: Date.now().toString(),
					name: "New Prompt",
					body: ""
				};
				new PromptEditModal(this.app, this.plugin, newPrompt, (createdPrompt) => {
					// Add the new prompt to settings
					this.plugin.settings.prompts.push(createdPrompt);
					this.plugin.saveSettings();
					// Reopen the selection modal
					new PromptSelectionModal(this.app, this.plugin, this.onChoosePrompt).open();
				}).open();
			});

		// Style the button
		newPromptButton.buttonEl.style.marginTop = "8px";
		newPromptButton.buttonEl.style.width = "100%";
	}
}

class PromptEditModal extends Modal {
	plugin: OllamaTranscriptProcessor;
	prompt: Prompt;
	onSave: (prompt: Prompt) => void;
	nameInput: TextComponent;
	bodyInput: TextAreaComponent;
	systemPromptInput: TextAreaComponent;

	constructor(app: App, plugin: OllamaTranscriptProcessor, prompt: Prompt, onSave: (prompt: Prompt) => void) {
		super(app);
		this.plugin = plugin;
		this.prompt = {...prompt}; // Clone to avoid modifying the original
		if (!this.prompt.systemPrompt) {
			this.prompt.systemPrompt = ""; // Initialize if not present
		}
		this.onSave = onSave;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl("h2", {text: this.prompt.id ? "Edit Prompt" : "Create Prompt"});

		// Name input
		new Setting(contentEl)
			.setName("Name")
			.setDesc("A short, descriptive name for this prompt")
			.addText(text => {
				this.nameInput = text;
				text.setValue(this.prompt.name)
					.onChange(value => {
						this.prompt.name = value;
					});
			});

		// System Prompt input
		contentEl.createEl("h3", {text: "System Instruction"});
		contentEl.createEl("p", {
			text: "Define the AI's role and general behavior. This is sent as the system instruction to the model.",
			cls: "setting-item-description"
		});

		const systemPromptContainer = contentEl.createDiv();
		this.systemPromptInput = new TextAreaComponent(systemPromptContainer)
			.setValue(this.prompt.systemPrompt || "")
			.onChange(value => {
				this.prompt.systemPrompt = value;
			});

		// Style the system prompt textarea
		this.systemPromptInput.inputEl.style.width = "100%";
		this.systemPromptInput.inputEl.style.height = "100px";
		this.systemPromptInput.inputEl.style.minHeight = "100px";

		// Body input
		contentEl.createEl("h3", {text: "Prompt Body"});
		contentEl.createEl("p", {
			text: "Write your specific instructions for the AI model. The transcript will be appended after this prompt. Text will be placed automatically between `====TEXT_BEGIN====` and `====TEXT_END====`. You may reference them in your prompt.",
			cls: "setting-item-description"
		});

		const textAreaContainer = contentEl.createDiv();
		this.bodyInput = new TextAreaComponent(textAreaContainer)
			.setValue(this.prompt.body)
			.onChange(value => {
				this.prompt.body = value;
			});

		// Style the textarea
		this.bodyInput.inputEl.style.width = "100%";
		this.bodyInput.inputEl.style.height = "200px";
		this.bodyInput.inputEl.style.minHeight = "200px";

		// Buttons
		const buttonContainer = contentEl.createDiv({cls: "prompt-edit-buttons"});

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				if (!this.prompt.name.trim()) {
					new Notice("Prompt name cannot be empty");
					return;
				}

				if (!this.prompt.body.trim()) {
					new Notice("Prompt body cannot be empty");
					return;
				}

				// systemPrompt is optional, so no validation needed

				this.onSave(this.prompt);
				this.close();
			});

		// Style the button container
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "8px";
		buttonContainer.style.marginTop = "16px";
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class OllamaSettingTab extends PluginSettingTab {
	plugin: OllamaTranscriptProcessor;
	private availableModels: string[] = [];

	constructor(app: App, plugin: OllamaTranscriptProcessor) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Ollama Transcript Processor Settings'});

		// Ollama Connection Settings
		containerEl.createEl('h3', {text: 'Ollama Connection'});

		new Setting(containerEl)
			.setName('Ollama Host')
			.setDesc('The URL of your Ollama instance (including protocol and port)')
			.addText(text => text
				.setPlaceholder('http://localhost:11434')
				.setValue(this.plugin.settings.ollamaHost)
				.onChange(async (value) => {
					this.plugin.settings.ollamaHost = value;
					await this.plugin.saveSettings();
					// Update the Ollama service with the new host
					this.plugin.updateOllamaService();
					// Refresh available models
					await this.loadAvailableModels();
				}));

		// Model Settings
		containerEl.createEl('h3', {text: 'Model Settings'});

		const modelSetting = new Setting(containerEl)
			.setName('Default Model')
			.setDesc('The default Ollama model to use for processing transcripts');

		// Try to load available models
		try {
			await this.loadAvailableModels();

			if (this.availableModels.length > 0) {
				modelSetting.addDropdown(dropdown => {
					// Add all available models to the dropdown
					this.availableModels.forEach(model => {
						dropdown.addOption(model, model);
					});

					dropdown.setValue(this.plugin.settings.defaultModel)
						.onChange(async (value) => {
							this.plugin.settings.defaultModel = value;
							await this.plugin.saveSettings();
						});
				});
			} else {
				modelSetting.addText(text => text
					.setPlaceholder('gemma:3b')
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value;
						await this.plugin.saveSettings();
					}));
			}
		} catch (error) {
			// If we can't load models, fall back to a text input
			new Notice("Could not connect to Ollama. Please check your connection settings.");
			console.error("Error loading Ollama models:", error);

			modelSetting.addText(text => text
				.setPlaceholder('gemma:3b')
				.setValue(this.plugin.settings.defaultModel)
				.onChange(async (value) => {
					this.plugin.settings.defaultModel = value;
					await this.plugin.saveSettings();
				}));
		}

		// Prompt Management
		containerEl.createEl('h3', {text: 'Prompt Management'});

		// Display existing prompts
		const promptsContainer = containerEl.createDiv({cls: 'prompts-container'});
		this.renderPromptsList(promptsContainer);

		// Add button for creating a new prompt
		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add New Prompt')
				.setCta()
				.onClick(() => {
					const newPrompt: Prompt = {
						id: Date.now().toString(),
						name: "New Prompt",
						body: ""
					};
					new PromptEditModal(this.app, this.plugin, newPrompt, (createdPrompt) => {
						this.plugin.settings.prompts.push(createdPrompt);
						this.plugin.saveSettings();
						this.display(); // Refresh the settings tab
					}).open();
				}));

		// Import/Export buttons
		const importExportContainer = containerEl.createDiv({cls: 'import-export-container'});

		new Setting(importExportContainer)
			.setName('Import/Export Prompts')
			.setDesc('Import or export your prompts as JSON')
			.addButton(button => button
				.setButtonText('Export')
				.onClick(() => {
					this.exportPrompts();
				}))
			.addButton(button => button
				.setButtonText('Import')
				.onClick(() => {
					this.importPrompts();
				}));
	}

	private renderPromptsList(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.prompts.length === 0) {
			container.createEl('p', {text: 'No prompts created yet. Click "Add New Prompt" to create one.'});
			return;
		}

		// Create a table for prompts
		const table = container.createEl('table', {cls: 'prompts-table'});
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		headerRow.createEl('th', {text: 'Name'});
		headerRow.createEl('th', {text: 'Actions'});

		const tbody = table.createEl('tbody');

		this.plugin.settings.prompts.forEach(prompt => {
			const row = tbody.createEl('tr');
			row.createEl('td', {text: prompt.name});

			const actionsCell = row.createEl('td');
			const actionsContainer = actionsCell.createDiv({cls: 'prompt-actions'});

			// Edit button
			const editButton = new ButtonComponent(actionsContainer)
				.setButtonText('Edit')
				.onClick(() => {
					new PromptEditModal(this.app, this.plugin, prompt, (updatedPrompt) => {
						const index = this.plugin.settings.prompts.findIndex(p => p.id === updatedPrompt.id);
						if (index !== -1) {
							this.plugin.settings.prompts[index] = updatedPrompt;
							this.plugin.saveSettings();
							this.display(); // Refresh the settings tab
						}
					}).open();
				});

			// Delete button
			const deleteButton = new ButtonComponent(actionsContainer)
				.setButtonText('Delete')
				.onClick(() => {
					if (confirm(`Are you sure you want to delete the prompt "${prompt.name}"?`)) {
						this.plugin.settings.prompts = this.plugin.settings.prompts.filter(p => p.id !== prompt.id);
						this.plugin.saveSettings();
						this.display(); // Refresh the settings tab
					}
				});

			// Style the buttons
			actionsContainer.style.display = 'flex';
			actionsContainer.style.gap = '8px';
		});
	}

	private async loadAvailableModels(): Promise<void> {
		try {
			this.availableModels = await this.plugin.ollamaService.getModels();
		} catch (error) {
			this.availableModels = [];
			console.error("Error loading models:", error);
		}
	}

	private exportPrompts(): void {
		const promptsJson = JSON.stringify(this.plugin.settings.prompts, null, 2);
		const blob = new Blob([promptsJson], {type: 'application/json'});
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = 'ollama-transcript-prompts.json';
		a.click();

		URL.revokeObjectURL(url);
	}

	private importPrompts(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';

		input.onchange = async (e: Event) => {
			const target = e.target as HTMLInputElement;
			if (!target.files || target.files.length === 0) return;

			const file = target.files[0];
			const reader = new FileReader();

			reader.onload = async (e) => {
				try {
					const content = e.target?.result as string;
					const importedPrompts = JSON.parse(content) as Prompt[];

					// Validate imported prompts
					if (!Array.isArray(importedPrompts)) {
						throw new Error("Invalid format: Expected an array of prompts");
					}

					for (const prompt of importedPrompts) {
						if (!prompt.id || !prompt.name || !prompt.body) {
							throw new Error("Invalid prompt format: Each prompt must have id, name, and body properties");
						}
					}

					// Ask user if they want to replace or merge
					const shouldReplace = confirm("Do you want to replace all existing prompts? Click 'OK' to replace, or 'Cancel' to merge with existing prompts.");

					if (shouldReplace) {
						this.plugin.settings.prompts = importedPrompts;
					} else {
						// Merge prompts, avoiding duplicates by ID
						const existingIds = new Set(this.plugin.settings.prompts.map(p => p.id));
						for (const prompt of importedPrompts) {
							if (!existingIds.has(prompt.id)) {
								this.plugin.settings.prompts.push(prompt);
								existingIds.add(prompt.id);
							}
						}
					}

					await this.plugin.saveSettings();
					this.display(); // Refresh the settings tab
					new Notice("Prompts imported successfully");
				} catch (error) {
					console.error("Error importing prompts:", error);
					new Notice("Failed to import prompts: " + (error as Error).message);
				}
			};

			reader.readAsText(file);
		};

		input.click();
	}
}
